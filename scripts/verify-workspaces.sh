#!/bin/bash
# Health check for all five workspace folders.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL=0
WARN=0

check_repo() {
  local name="$1"
  local dir="$2"
  local remote="$3"
  local branch="${4:-master}"
  local need_pkg="${5:-false}"

  echo "--- $name ($dir) ---"

  if [[ ! -d "$dir" ]]; then
    echo "  MISSING: folder not found"
    ((FAIL++)) || true
    return
  fi

  if [[ ! -d "$dir/.git" ]]; then
    echo "  FAIL: not a git repository"
    ((FAIL++)) || true
    return
  fi

  local url
  url=$(git -C "$dir" remote get-url origin 2>/dev/null || echo "")
  if [[ "$url" != *"$remote"* ]]; then
    echo "  FAIL: origin should contain '$remote' (got: ${url:-none})"
    ((FAIL++)) || true
  else
    echo "  OK: remote -> $remote"
  fi

  local cur
  cur=$(git -C "$dir" branch --show-current 2>/dev/null || echo "")
  if [[ "$cur" == "$branch" ]] || [[ "$cur" == "main" && "$branch" == "master" ]]; then
    echo "  OK: branch $cur"
  else
    echo "  WARN: on branch '$cur' (expected $branch or main)"
    ((WARN++)) || true
  fi

  if [[ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]]; then
    echo "  WARN: uncommitted changes"
    ((WARN++)) || true
  else
    echo "  OK: clean working tree"
  fi

  if [[ "$need_pkg" == "true" ]] && [[ ! -f "$dir/package.json" ]]; then
    echo "  WARN: package.json missing (repo may be README-only — push from Mac?)"
    ((WARN++)) || true
  elif [[ "$need_pkg" == "true" ]]; then
    echo "  OK: package.json present"
  fi
}

echo "Workspace root: $ROOT"
echo ""

check_repo "PoliceStationAgent.com" "one" "robertdavidcashman-droid/one" master true
check_repo "PoliceStationRepUK.com" "Policestationrepuk" "robertdavidcashman-droid/policestationrepuk" master true
check_repo "CustodyNote website" "custody-note-website" "robertdavidcashman-droid/custody-note-website" master true
check_repo "PSRUKTrain.com" "pstrain-rebuild" "robertdavidcashman-droid/psrtrain" master true
check_repo "CustodyNoteApp (root)" "." "robertdavidcashman-droid/custody-note-app" main false

echo ""
echo "=== Summary ==="
echo "Failures: $FAIL"
echo "Warnings: $WARN"

if [[ $FAIL -gt 0 ]]; then
  echo "Some workspaces are missing. Run scripts/mac-push-missing-repos.sh on your Mac, then clone missing repos."
  exit 1
fi

if [[ $WARN -gt 0 ]]; then
  exit 0
fi

echo "All workspace checks passed."
exit 0
