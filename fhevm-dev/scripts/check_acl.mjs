#!/usr/bin/env node
// check_acl.mjs — static ACL + deprecation checker for FHEVM v0.11 contracts.
//
// USAGE
//   node check_acl.mjs <file.sol> [<file.sol> ...]
//
// What this catches
//
//   1. **Deprecated v0.7/v0.8 symbols.** Imports of `fhevm/lib/TFHE.sol`,
//      `fhevmjs`, base contracts named `SepoliaConfig` / `LocalConfig` /
//      `GatewayCaller`, and any reference to `TFHE.*`, `Gateway.*`,
//      `IGateway`, `onlyGateway`, or `requestDecryption`. None of these
//      exist in `@fhevm/solidity ^0.11`; code that references them will
//      not compile against the current toolchain.
//
//   2. **Missing ACL discipline.** For every external/public function that
//      performs FHE compute (`FHE.add / sub / mul / select / fromExternal /
//      min / max / isInitialized` etc.), we count:
//        * "state-assign sites": lines like `_var = ...` or `_map[k] = ...`
//          where `_var` is a contract-level encrypted state variable
//        * `FHE.allowThis(...)` calls
//        * `FHE.allow(...)` and `FHE.allowTransient(...)` calls
//      We flag a function as ACL-suspicious if it has >=1 state-assign
//      sites but 0 `FHE.allowThis` calls — the canonical "forgot the
//      second-side ACL" bug that silently breaks `userDecrypt`.
//
// State-variable detection masks out the bodies of `struct { ... }` blocks
// so that struct fields do not get mis-classified as contract storage.
//
// Exit codes
//   0  no violations
//   1  one or more violations
//   2  could not read input (missing file, etc.)
//   3  internal analyzer error (a bug in this script)

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
  "randEbool", "randEuint8", "randEuint16", "randEuint32", "randEuint64", "randEuint128",
];

// --- Deprecated-namespace detection -----------------------------------------

const DEPRECATED_PATTERNS = [
  {
    rule: "deprecated-import-tfhe",
    severity: "error",
    pattern: /import\s+["']fhevm\/lib\/TFHE\.sol["']|import\s*\{[^}]*\}\s*from\s*["']fhevm\/lib\/TFHE\.sol["']/g,
    message: "Imports the legacy `fhevm/lib/TFHE.sol`. v0.11 uses `@fhevm/solidity/lib/FHE.sol`.",
  },
  {
    rule: "deprecated-import-gateway",
    severity: "error",
    pattern: /import\s+["']fhevm\/gateway\/GatewayCaller\.sol["']|import\s+["'][^"']*Gateway[^"']*\.sol["']/g,
    message: "Imports a v0.7/v0.8 Gateway header. Gateway-based oracle decryption was removed in v0.9+; use `FHE.makePubliclyDecryptable` + `FHE.checkSignatures`.",
  },
  {
    rule: "deprecated-import-config",
    severity: "error",
    pattern: /import\s*\{?\s*[^}]*?\b(SepoliaConfig|LocalConfig|MainnetConfig)\b[^}]*?\}?\s*from\s*["']fhevm\/config\/[^"']*["']/g,
    message: "Imports a deprecated config contract. v0.11 uses `ZamaEthereumConfig` from `@fhevm/solidity/config/ZamaConfig.sol`.",
  },
  {
    rule: "deprecated-namespace-tfhe",
    severity: "error",
    pattern: /\bTFHE\s*\.[a-zA-Z_]/g,
    message: "References the legacy `TFHE.*` namespace. Replace with `FHE.*` (v0.11).",
  },
  {
    rule: "deprecated-base-config",
    severity: "error",
    pattern: /\bcontract\s+\w+\s+is\s+(?:[\w,\s]+,\s*)?(SepoliaConfig|LocalConfig|MainnetConfig)\b/g,
    message: "Inherits a deprecated config contract. v0.11 uses `ZamaEthereumConfig`.",
  },
  {
    rule: "deprecated-base-gateway",
    severity: "error",
    pattern: /\bcontract\s+\w+\s+is\s+(?:[\w,\s]+,\s*)?GatewayCaller\b/g,
    message: "Inherits `GatewayCaller`. v0.11 has no on-chain Gateway; use `FHE.makePubliclyDecryptable` + `FHE.checkSignatures` self-relay flow.",
  },
  {
    rule: "deprecated-onchain-decryption",
    severity: "error",
    pattern: /\b(?:Gateway\.|FHE\.)requestDecryption\s*\(/g,
    message: "Calls `requestDecryption`. This API was removed in v0.9+; use `FHE.makePubliclyDecryptable(handle)` on-chain plus `instance.publicDecrypt([handle])` off-chain plus `FHE.checkSignatures(...)` settlement.",
  },
  {
    rule: "deprecated-modifier-onlygateway",
    severity: "error",
    pattern: /\bonlyGateway\b/g,
    message: "Uses `onlyGateway` modifier from the removed Gateway pattern.",
  },
  {
    rule: "deprecated-frontend-fhevmjs",
    severity: "warning",
    pattern: /\bfhevmjs\b/g,
    message: "References `fhevmjs`. The v0.11 frontend SDK is `@zama-fhe/relayer-sdk`.",
  },
];

// Strip Solidity comments (// line and /* block */) by replacing their content
// with spaces, preserving newlines so line numbers remain accurate.
function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = i + 1 < n ? source[i + 1] : "";
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && i + 1 < n && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) {
          out += source[i] + source[i + 1];
          i += 2;
        } else {
          out += source[i];
          i++;
        }
      }
      if (i < n) {
        out += source[i];
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function findDeprecations(source) {
  // Run pattern matching on a comment-free copy so a doc comment that mentions
  // (e.g.) "no onlyGateway" is not flagged as a violation. Indexes still
  // align with the original because we replace comment chars with spaces.
  const codeOnly = stripComments(source);
  const findings = [];
  for (const { rule, severity, pattern, message } of DEPRECATED_PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of codeOnly.matchAll(pattern)) {
      const line = source.slice(0, m.index).split("\n").length;
      findings.push({ rule, severity, line, snippet: m[0].trim(), message });
    }
  }
  return findings;
}

// --- Source masking: blank out struct bodies for state-var detection --------

function maskStructBlocks(source) {
  // Replace the body of every `struct Name { ... }` with whitespace (newlines
  // preserved) so subsequent regexes do not mis-classify struct fields as
  // contract-level state variables.
  const re = /\bstruct\s+[A-Za-z_]\w*\s*\{/g;
  let out = source;
  let m;
  while ((m = re.exec(out)) !== null) {
    const startBody = m.index + m[0].length;
    let depth = 1;
    let i = startBody;
    while (i < out.length && depth > 0) {
      const c = out[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const replaced = out.slice(startBody, i - 1).replace(/[^\n]/g, " ");
    out = out.slice(0, startBody) + replaced + out.slice(i - 1);
    re.lastIndex = i;
  }
  return out;
}

// --- State-var + function detection -----------------------------------------

function findStateVarNames(source) {
  const masked = maskStructBlocks(source);
  const stateVarPattern =
    /^\s*(?:mapping\([^)]+=>\s*)?(ebool|euint8|euint16|euint32|euint64|euint128|euint256|eaddress)(?:\s*\)\s*[a-zA-Z0-9_]*\s+|\s+)(?:public\s+|private\s+|internal\s+)?(_?[a-zA-Z][a-zA-Z0-9_]*)\s*;/gm;
  const names = new Set();
  for (const m of masked.matchAll(stateVarPattern)) {
    names.add(m[2]);
  }
  const mappingPattern = /^\s*mapping\([^)]+\)\s*(?:public\s+|private\s+|internal\s+)?(_?[a-zA-Z][a-zA-Z0-9_]*)\s*;/gm;
  for (const m of masked.matchAll(mappingPattern)) {
    names.add(m[1]);
  }
  return names;
}

function findFunctions(source) {
  const fns = [];
  const re = /function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*([^\{]*)\{/gm;
  for (const m of source.matchAll(re)) {
    const name = m[1];
    const modifiers = (m[2] || "").trim();
    if (!/(external|public)/.test(modifiers)) continue;
    if (/(view|pure)/.test(modifiers)) continue;
    const startOfBody = m.index + m[0].length;
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

  // Count any LHS reference to a state var inside a function body that
  // performs FHE ops. The RHS may be either `FHE.<op>(...)` directly or a
  // local that holds the result; we count both because the ACL discipline
  // applies either way.
  const lines = fn.body.split("\n");
  let stateAssignCount = 0;
  for (const line of lines) {
    if (!/=/.test(line)) continue;
    for (const v of stateVars) {
      const direct = new RegExp(`\\b${v}\\s*=`);
      const indexed = new RegExp(`\\b${v}\\s*\\[[^\\]]+\\]\\s*=`);
      const structAccess = new RegExp(`\\b${v}\\s*\\.[a-zA-Z0-9_]+\\s*=`);
      const lhsMatch = direct.test(line) || indexed.test(line) || structAccess.test(line);
      if (lhsMatch && !/==/.test(line.split("=")[0] + "=")) {
        stateAssignCount++;
        break;
      }
    }
  }

  const allowThisCount = (fn.body.match(/\bFHE\.allowThis\s*\(/g) || []).length;
  const allowCount = (fn.body.match(/\bFHE\.allow\s*\(/g) || []).length;
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

// --- Top-level orchestration -----------------------------------------------

function checkFileFromSource(file, source) {
  const deprecations = findDeprecations(source);
  const stateVars = findStateVarNames(source);
  const fns = findFunctions(source);
  const fnReports = [];
  let totalAclViolations = 0;
  for (const fn of fns) {
    const r = analyzeFunction(fn, stateVars);
    if (r === null) continue;
    fnReports.push(r);
    totalAclViolations += r.violations.length;
  }
  const totalDeprecations = deprecations.filter((d) => d.severity === "error").length;
  return {
    file: path.relative(process.cwd(), file),
    stateVars: [...stateVars],
    deprecations,
    functions: fnReports,
    totalDeprecationViolations: totalDeprecations,
    totalAclViolations,
    totalViolations: totalDeprecations + totalAclViolations,
  };
}

function emitJsonError(payload, exitCode) {
  process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(exitCode);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stderr.write(
      "USAGE: node check_acl.mjs <file.sol> [<file.sol> ...]\n" +
        "Detects (1) deprecated v0.7/v0.8 namespaces (TFHE.*, Gateway, requestDecryption,\n" +
        "fhevmjs) and (2) missing FHE.allowThis discipline in v0.11 contracts.\n" +
        "Exit 0 = clean, 1 = violations, 2 = read failure, 3 = analyzer bug.\n",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }

  const reports = [];
  let totalViolations = 0;
  let totalFunctions = 0;

  for (const f of args) {
    let source;
    try {
      source = fs.readFileSync(f, "utf8");
    } catch (err) {
      emitJsonError(
        {
          status: "read-error",
          file: f,
          error: err.message ?? String(err),
          code: err.code,
          stack: err.stack,
        },
        2,
      );
    }
    let report;
    try {
      report = checkFileFromSource(f, source);
    } catch (err) {
      emitJsonError(
        {
          status: "analyzer-error",
          file: f,
          error: err.message ?? String(err),
          code: err.code,
          stack: err.stack,
        },
        3,
      );
    }
    reports.push(report);
    totalViolations += report.totalViolations;
    totalFunctions += report.functions.length;
  }

  const status = totalViolations === 0 ? "clean" : "violations-found";
  process.stdout.write(
    JSON.stringify({ status, totalViolations, totalFunctionsAnalyzed: totalFunctions, reports }, null, 2) + "\n",
  );
  process.exit(totalViolations === 0 ? 0 : 1);
}

main();
