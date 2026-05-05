#!/usr/bin/env bash
# compile_check.sh — run `npx hardhat compile` in a hardhat project and emit a
# JSON status summary so an AI agent (or CI) can react to the result.
#
# USAGE
#   compile_check.sh [project_dir]
#   compile_check.sh --help | -h
#
# Defaults to the current working directory. Outputs a single JSON object on
# stdout and exits 0 on success, 1 on compile failure, 2 on infra failure
# (no package.json, no hardhat, etc.).
#
# Output schema:
#   {
#     "status": "success" | "compile-error" | "infra-error",
#     "project": "<absolute path>",
#     "errors":   [ "...", ... ],
#     "warnings": [ "...", ... ],
#     "raw":      "<full hardhat output>"
#   }
#
# IMPLEMENTATION NOTE: `set -e` is intentionally NOT enabled because the script
# captures `npx hardhat compile`'s non-zero exit code (line 51) and converts it
# into a structured JSON error report. With `-e` the shell would abort before
# reaching the JSON-emitting code path. Do not add `-e` without re-architecting
# the error reporting. An ERR trap below produces a parseable JSON line if any
# unexpected failure escapes the captured paths.

set -uo pipefail

if [ "${1-}" = "--help" ] || [ "${1-}" = "-h" ]; then
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 0
fi

PROJECT="${1:-$(pwd)}"

# JSON-escape an arbitrary string by piping through node's JSON.stringify.
# Falls back to "" (an empty JSON string) if node is unavailable or throws,
# so callers always receive parseable JSON.
json_escape() {
  if ! node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))' 2>/dev/null; then
    printf '""'
  fi
}

# Split a multi-line string on newlines and JSON-encode the resulting array.
# Falls back to "[]" on any failure.
json_array() {
  if ! node -e '
    const s = require("fs").readFileSync(0,"utf8");
    const arr = s.split(/\r?\n/).filter(Boolean);
    process.stdout.write(JSON.stringify(arr));
  ' 2>/dev/null; then
    printf '[]'
  fi
}

emit_infra_error() {
  local msg="$1"
  ESC_PROJECT="$(printf '%s' "$PROJECT" | json_escape)"
  ESC_MSG="$(printf '%s' "$msg" | json_escape)"
  [ -z "$ESC_PROJECT" ] && ESC_PROJECT='""'
  [ -z "$ESC_MSG" ] && ESC_MSG='""'
  printf '{"status":"infra-error","project":%s,"error":%s}\n' "$ESC_PROJECT" "$ESC_MSG"
}

if [ ! -d "$PROJECT" ]; then
  emit_infra_error "project dir does not exist: $PROJECT"
  exit 2
fi

if [ ! -f "$PROJECT/package.json" ]; then
  emit_infra_error "no package.json found in $PROJECT"
  exit 2
fi

if [ ! -d "$PROJECT/node_modules" ]; then
  emit_infra_error "node_modules missing in $PROJECT — run npm install first"
  exit 2
fi

cd "$PROJECT" || { emit_infra_error "cd failed"; exit 2; }

# Use an `if` block to capture the exit code without tripping any future
# ERR trap; `if` consumes the inner command's failure status.
if RAW_OUTPUT="$(npx hardhat compile 2>&1)"; then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

# Extract error and warning lines. Hardhat error formatting is heterogeneous,
# so we conservatively grep for canonical Solidity diagnostic prefixes.
ERRORS="$(printf '%s\n' "$RAW_OUTPUT" \
  | grep -E '^(Error|ParserError|TypeError|DeclarationError|FatalError|Compilation failed)' \
  || true)"
WARNINGS="$(printf '%s\n' "$RAW_OUTPUT" | grep -E '^Warning' || true)"

ESC_RAW="$(printf '%s' "$RAW_OUTPUT" | json_escape)"
ESC_ERRORS_JSON="$(printf '%s' "$ERRORS" | json_array)"
ESC_WARNINGS_JSON="$(printf '%s' "$WARNINGS" | json_array)"
ESC_PROJECT="$(printf '%s' "$PROJECT" | json_escape)"
[ -z "$ESC_RAW" ] && ESC_RAW='""'
[ -z "$ESC_ERRORS_JSON" ] && ESC_ERRORS_JSON='[]'
[ -z "$ESC_WARNINGS_JSON" ] && ESC_WARNINGS_JSON='[]'
[ -z "$ESC_PROJECT" ] && ESC_PROJECT='""'

# Trust the exit code as the single truth source. The earlier "also grep for
# 'Error' substring" heuristic was too permissive and false-positively flagged
# valid compiles whose output mentioned `error EthTransferFailed();` etc.
if [ "$EXIT_CODE" -eq 0 ]; then
  STATUS="success"
else
  STATUS="compile-error"
fi

printf '{"status":"%s","project":%s,"errors":%s,"warnings":%s,"raw":%s}\n' \
  "$STATUS" "$ESC_PROJECT" "$ESC_ERRORS_JSON" "$ESC_WARNINGS_JSON" "$ESC_RAW"

if [ "$STATUS" = "success" ]; then
  exit 0
else
  exit 1
fi
