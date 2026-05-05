#!/usr/bin/env bash
# compile_check.sh — run `npx hardhat compile` in a hardhat project and emit a
# JSON status summary so an AI agent (or CI) can react to the result.
#
# USAGE
#   compile_check.sh [project_dir]
#
# Defaults to the current working directory. Outputs a single JSON object on
# stdout and exits 0 on success, 1 on compile failure, 2 on infra failure
# (no package.json, no hardhat, etc.).
#
# Output schema:
#   {
#     "status": "success" | "compile-error" | "infra-error",
#     "project": "<absolute path>",
#     "errors":   [ "...", ... ],   // present when status != "success"
#     "warnings": [ "...", ... ],
#     "raw":      "<full hardhat output>"
#   }

set -uo pipefail

PROJECT="${1:-$(pwd)}"
if [ ! -d "$PROJECT" ]; then
  printf '{"status":"infra-error","error":"project dir does not exist: %s"}\n' "$PROJECT"
  exit 2
fi

if [ ! -f "$PROJECT/package.json" ]; then
  printf '{"status":"infra-error","error":"no package.json found in %s"}\n' "$PROJECT"
  exit 2
fi

if [ ! -d "$PROJECT/node_modules" ]; then
  printf '{"status":"infra-error","error":"node_modules missing in %s — run npm install first"}\n' "$PROJECT"
  exit 2
fi

cd "$PROJECT" || { printf '{"status":"infra-error","error":"cd failed"}\n'; exit 2; }

RAW_OUTPUT="$(npx hardhat compile 2>&1)"
EXIT_CODE=$?

# Extract error and warning lines. Hardhat error formatting is heterogeneous,
# but most useful lines start with "Error" or include "ParserError" /
# "TypeError" / "DeclarationError".
ERRORS="$(printf '%s\n' "$RAW_OUTPUT" \
  | grep -E '^(Error|ParserError|TypeError|DeclarationError|TypeError|FatalError|Compilation failed)' \
  || true)"
WARNINGS="$(printf '%s\n' "$RAW_OUTPUT" | grep -E '^Warning' || true)"

# JSON-escape a string by piping through node's JSON.stringify to keep this
# robust against backslashes, quotes, and unicode in the hardhat output.
json_escape() {
  node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))'
}

ESC_RAW="$(printf '%s' "$RAW_OUTPUT" | json_escape)"
ESC_ERRORS_JSON="$(printf '%s' "$ERRORS" | node -e '
  const s = require("fs").readFileSync(0,"utf8");
  const arr = s.split(/\n/).filter(Boolean);
  process.stdout.write(JSON.stringify(arr));
')"
ESC_WARNINGS_JSON="$(printf '%s' "$WARNINGS" | node -e '
  const s = require("fs").readFileSync(0,"utf8");
  const arr = s.split(/\n/).filter(Boolean);
  process.stdout.write(JSON.stringify(arr));
')"

if [ $EXIT_CODE -eq 0 ] && ! echo "$RAW_OUTPUT" | grep -qE '(Compilation failed|Error)'; then
  STATUS="success"
else
  STATUS="compile-error"
fi

printf '{"status":"%s","project":"%s","errors":%s,"warnings":%s,"raw":%s}\n' \
  "$STATUS" "$PROJECT" "$ESC_ERRORS_JSON" "$ESC_WARNINGS_JSON" "$ESC_RAW"

if [ "$STATUS" = "success" ]; then
  exit 0
else
  exit 1
fi
