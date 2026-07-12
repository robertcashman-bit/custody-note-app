#!/bin/bash
# Health check for all workspace folders (reads workspaces.manifest.json).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/workspaces.manifest.json"
cd "$ROOT"

FAIL=0
WARN=0

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: $MANIFEST not found"
  exit 1
fi

check_repo() {
  local name="$1"
  local dir="$2"
  local remote="$3"
  local branch="$4"
  local need_pkg="$5"

  echo "--- $name ($dir) ---"

  if [[ "$dir" == "." ]]; then
    dir="."
  fi

  if [[ "$dir" != "." ]] && [[ ! -d "$dir" ]]; then
    echo "  MISSING: folder not found"
    ((FAIL++)) || true
    return
  fi

  local git_dir="$ROOT"
  [[ "$dir" != "." ]] && git_dir="$ROOT/$dir"

  if [[ ! -d "$git_dir/.git" ]]; then
    echo "  FAIL: not a git repository"
    ((FAIL++)) || true
    return
  fi

  local url
  url=$(git -C "$git_dir" remote get-url origin 2>/dev/null || echo "")
  if [[ "$url" != *"$remote"* ]]; then
    echo "  FAIL: origin should contain '$remote' (got: ${url:-none})"
    ((FAIL++)) || true
  else
    echo "  OK: remote -> $remote"
  fi

  local cur
  cur=$(git -C "$git_dir" branch --show-current 2>/dev/null || echo "")
  if [[ "$cur" == "$branch" ]] || [[ "$cur" == "main" && "$branch" == "master" ]] || [[ "$cur" == "master" && "$branch" == "main" ]]; then
    echo "  OK: branch $cur"
  else
    echo "  WARN: on branch '$cur' (expected $branch)"
    ((WARN++)) || true
  fi

  if [[ -n "$(git -C "$git_dir" status --porcelain 2>/dev/null)" ]]; then
    echo "  WARN: uncommitted changes"
    ((WARN++)) || true
  else
    echo "  OK: clean working tree"
  fi

  if [[ "$need_pkg" == "true" ]] && [[ ! -f "$git_dir/package.json" ]]; then
    echo "  WARN: package.json missing (repo may be README-only — push from Mac?)"
    ((WARN++)) || true
  elif [[ "$need_pkg" == "true" ]]; then
    echo "  OK: package.json present"
  fi
}

echo "Workspace root: $ROOT"
echo ""

while IFS=$'\t' read -r name dir remote branch need_pkg; do
  check_repo "$name" "$dir" "$remote" "$branch" "$need_pkg"
done < <(python3 - "$MANIFEST" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
for repo in manifest["repos"]:
    need_pkg = "false" if repo["dir"] == "." else "true"
    print("\t".join([
        repo["name"],
        repo["dir"],
        repo["github"],
        repo["branch"],
        need_pkg,
    ]))
PY
)

echo ""
echo "=== Summary ==="
echo "Failures: $FAIL"
echo "Warnings: $WARN"

if [[ $FAIL -gt 0 ]]; then
  echo "Some workspaces are missing. Install Mac sync agent: bash scripts/install-mac-sync-agent.sh"
  exit 1
fi

if [[ $WARN -gt 0 ]]; then
  exit 0
fi

echo "All workspace checks passed."
exit 0
