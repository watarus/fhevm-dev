#!/usr/bin/env node
// check_acl.mjs — static ACL discipline checker for FHEVM v0.11 contracts.
//
// USAGE
//   node check_acl.mjs <file.sol> [<file.sol> ...]
//
// What this catches
//   For every external/public function that performs FHE compute (FHE.add /
//   sub / mul / select / fromExternal / min / max / isInitialized), we count:
//     * "state-assign sites": lines that look like `_var = FHE.<op>(...)` or
//       `_map[key] = FHE.<op>(...)` where `_var` is a contract state variable
//     * `FHE.allowThis(...)` calls
//     * `FHE.allow(...)` calls (any non-`allowThis` `FHE.allow*`)
//   We flag a function as ACL-suspicious if it has >=1 state-assign sites but
//   0 `FHE.allowThis` calls — the canonical "forgot the second-side ACL" bug
//   that silently breaks userDecrypt.
//
// This is intentionally conservative: false negatives are possible (e.g. when
// state is updated through a helper). False positives should be rare. The
// output is JSON and is meant to be machine-readable; pipe into `jq` for
// inspection.
//
// Exit codes
//   0  no violations
//   1  one or more violations
//   2  could not read input (missing file, parse failure, etc.)

import fs from "node:fs";
import path from "node:path";

const FHE_OPS = [
  "add", "sub", "mul", "div", "rem", "neg",
  "and", "or", "xor", "not",
  "eq", "ne", "lt", "le", "gt", "ge",
  "min", "max",
  "shl", "shr", "rotl", "rotr",
  "select", "fromExternal",
  "asEbool", "asEuint8", "asEuint16", "asEuint32", "asEuint64", "asEuint128", "asEuint256", "asEaddress",
  "isInitialized",
  "randEuint8", "randEuint16", "randEuint32", "randEuint64", "randEuint128",
];

function findStateVarNames(source) {
  // Match top-level state declarations of encrypted types.
  const stateVarPattern =
    /^\s*(?:mapping\([^)]+=>\s*)?(ebool|euint8|euint16|euint32|euint64|euint128|euint256|eaddress)(?:\s*\)\s*[a-zA-Z0-9_]*\s+|\s+)(?:public\s+|private\s+|internal\s+)?(_?[a-zA-Z][a-zA-Z0-9_]*)\s*;/gm;
  const names = new Set();
  for (const m of source.matchAll(stateVarPattern)) {
    names.add(m[2]);
  }
  // Also pick up generic `mapping(... => ...) (private|public|internal)? _name;`
  const mappingPattern = /^\s*mapping\([^)]+\)\s*(?:public\s+|private\s+|internal\s+)?(_?[a-zA-Z][a-zA-Z0-9_]*)\s*;/gm;
  for (const m of source.matchAll(mappingPattern)) {
    names.add(m[1]);
  }
  return names;
}

function findFunctions(source) {
  // Walk function bodies by brace counting. Returns [{name, modifiers, body, startLine}].
  const fns = [];
  const re = /function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*([^\{]*)\{/gm;
  for (const m of source.matchAll(re)) {
    const name = m[1];
    const modifiers = (m[2] || "").trim();
    if (!/(external|public)/.test(modifiers)) continue;
    if (/(view|pure)/.test(modifiers)) continue;
    const startOfBody = m.index + m[0].length; // points past the opening `{`
    let depth = 1;
    let i = startOfBody;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const body = source.slice(startOfBody, i - 1);
    const startLine = source.slice(0, m.index).split("\n").length;
    fns.push({ name, modifiers, body, startLine });
  }
  return fns;
}

function analyzeFunction(fn, stateVars) {
  const opsAlternation = FHE_OPS.join("|");
  const opsRegex = new RegExp(`\\bFHE\\.(?:${opsAlternation})\\s*\\(`, "g");
  const fheCalls = [...fn.body.matchAll(opsRegex)];
  if (fheCalls.length === 0) {
    return null;
  }

  // We treat any LHS reference to a state var inside a function body that
  // *also* performs FHE ops as a state-assign site. The RHS may be either a
  // direct `FHE.<op>(...)` call or a previously-bound local that holds the
  // result of one — we count both equally because the ACL discipline applies
  // either way.
  const lines = fn.body.split("\n");
  let stateAssignCount = 0;
  for (const line of lines) {
    if (!/=/.test(line)) continue;
    for (const v of stateVars) {
      const direct       = new RegExp(`\\b${v}\\s*=`);
      const indexed      = new RegExp(`\\b${v}\\s*\\[[^\\]]+\\]\\s*=`);
      const structAccess = new RegExp(`\\b${v}\\s*\\.[a-zA-Z0-9_]+\\s*=`);
      // Avoid counting `==` (equality, not assignment).
      const lhsMatch = direct.test(line) || indexed.test(line) || structAccess.test(line);
      if (lhsMatch && !/==/.test(line.split("=")[0] + "=")) {
        stateAssignCount++;
        break;
      }
    }
  }

  const allowThisCount      = (fn.body.match(/\bFHE\.allowThis\s*\(/g)      || []).length;
  const allowCount          = (fn.body.match(/\bFHE\.allow\s*\(/g)          || []).length;
  const allowTransientCount = (fn.body.match(/\bFHE\.allowTransient\s*\(/g) || []).length;

  const violations = [];
  if (stateAssignCount > 0 && allowThisCount === 0) {
    violations.push({
      rule: "missing-allowThis",
      severity: "error",
      message:
        `function ${fn.name}: assigns ${stateAssignCount} encrypted state var(s) but never calls FHE.allowThis. ` +
        `The contract will not be able to compute on the new handle next time. ` +
        `Issue FHE.allowThis(_handle) after every assignment.`,
    });
  }
  if (stateAssignCount > 0 && allowCount === 0 && allowTransientCount === 0) {
    violations.push({
      rule: "missing-allow",
      severity: "warning",
      message:
        `function ${fn.name}: assigns ${stateAssignCount} encrypted state var(s) but never calls FHE.allow or FHE.allowTransient. ` +
        `If the value should ever be userDecryptable by anyone, issue FHE.allow(_handle, recipient).`,
    });
  }

  return {
    function: fn.name,
    startLine: fn.startLine,
    fheOps: fheCalls.length,
    stateAssigns: stateAssignCount,
    allowThis: allowThisCount,
    allow: allowCount,
    allowTransient: allowTransientCount,
    violations,
  };
}

function checkFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const stateVars = findStateVarNames(source);
  const fns = findFunctions(source);
  const fnReports = [];
  let totalViolations = 0;
  for (const fn of fns) {
    const r = analyzeFunction(fn, stateVars);
    if (r === null) continue;
    fnReports.push(r);
    totalViolations += r.violations.length;
  }
  return {
    file: path.relative(process.cwd(), file),
    stateVars: [...stateVars],
    functions: fnReports,
    totalViolations,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stderr.write(
      "USAGE: node check_acl.mjs <file.sol> [<file.sol> ...]\n" +
        "Checks every external/public function that performs FHE ops for missing\n" +
        "FHE.allowThis / FHE.allow grants. Exit 0 = clean, 1 = violations, 2 = read failure.\n",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const reports = [];
  let totalViolations = 0;
  let totalFunctions = 0;
  try {
    for (const f of args) {
      const r = checkFile(f);
      reports.push(r);
      totalViolations += r.totalViolations;
      totalFunctions += r.functions.length;
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({ status: "read-error", error: String(err) }, null, 2) + "\n");
    process.exit(2);
  }
  const status = totalViolations === 0 ? "clean" : "violations-found";
  process.stdout.write(
    JSON.stringify({ status, totalViolations, totalFunctionsAnalyzed: totalFunctions, reports }, null, 2) + "\n",
  );
  process.exit(totalViolations === 0 ? 0 : 1);
}

main();
