#!/bin/bash
# Verify Vercel Git links for the four website projects.
# Requires VERCEL_TOKEN (https://vercel.com/account/tokens) or Vercel MCP auth in Cursor.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERCEL_BIN="${ROOT}/.vercel-tools/node_modules/.bin/vercel"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN is not set."
  echo "Add it to Cloud Agent secrets or export it locally, then re-run."
  echo "Alternatively, connect Vercel MCP in Cursor Desktop."
  echo ""
  echo "Manual checklist (Vercel Dashboard -> Project -> Settings -> Git):"
  echo "  web44ai              -> robertdavidcashman-droid/one"
  echo "  policestationrepuk   -> robertdavidcashman-droid/policestationrepuk"
  echo "  custody-note-website -> robertdavidcashman-droid/custody-note-website"
  echo "  pstrain              -> robertdavidcashman-droid/psrtrain"
  exit 2
fi

if [[ ! -x "$VERCEL_BIN" ]]; then
  echo "Installing Vercel CLI..."
  npm install vercel@latest --prefix "$ROOT/.vercel-tools" --silent
fi

export VERCEL_ORG_ID="${VERCEL_ORG_ID:-}"
export VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-}"

echo "=== Vercel projects (teams) ==="
"$VERCEL_BIN" teams ls --token "$VERCEL_TOKEN" 2>&1 || true

echo ""
echo "=== Expected Git links ==="
declare -A EXPECTED=(
  ["web44ai"]="one"
  ["custody-note-website"]="custody-note-website"
  ["pstrain"]="psrtrain"
  ["policestationrepuk"]="policestationrepuk"
)

FAIL=0
for project in "${!EXPECTED[@]}"; do
  repo="${EXPECTED[$project]}"
  echo "--- $project -> robertdavidcashman-droid/$repo ---"
  # List project via API through vercel CLI project ls
  if "$VERCEL_BIN" project ls --token "$VERCEL_TOKEN" 2>/dev/null | grep -qi "$project"; then
    echo "  OK: project name found in account"
  else
    echo "  WARN: project '$project' not found (may use a different name)"
    ((FAIL++)) || true
  fi
done

echo ""
if [[ $FAIL -gt 0 ]]; then
  echo "Some projects need manual verification in https://vercel.com/dashboard"
  exit 1
fi
echo "Basic Vercel project presence check complete."
echo "Confirm each project's Git tab links to the correct GitHub repo."
exit 0
