#!/bin/bash
# Run once on your MacBook to create missing GitHub repos and push local code.
set -euo pipefail

GH="robertdavidcashman-droid"

create_repo_if_missing() {
  local name="$1"
  local desc="$2"
  if gh repo view "$GH/$name" &>/dev/null; then
    echo "Repo $GH/$name already exists"
  else
    echo "Creating $GH/$name..."
    gh repo create "$GH/$name" --public --description "$desc" --add-readme
  fi
}

push_local() {
  local dir="$1"
  local repo="$2"
  local branch="${3:-main}"

  if [[ ! -d "$dir" ]]; then
    echo "SKIP: $dir not found"
    return 1
  fi

  cd "$dir"
  if [[ ! -d .git ]]; then
    echo "Initializing git in $dir"
    git init
    git add -A
    if ! git commit -m "Initial commit from Mac"; then
      echo "ERROR: Initial commit failed (nothing to commit or git identity/hooks issue)."
      echo "Fix the issue (add files, configure git user, or resolve hooks) and re-run."
      return 1
    fi
  fi

  if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    echo "ERROR: Repository has no commits; nothing to push from $dir."
    return 1
  fi

  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$GH/$repo.git"
  git fetch origin --prune

  local src=""
  if git show-ref --verify --quiet refs/heads/main; then
    src="main"
  elif git show-ref --verify --quiet "refs/heads/$branch"; then
    src="$branch"
  elif git show-ref --verify --quiet refs/heads/master; then
    src="master"
  else
    src="$branch"
    git branch -M "$src"
  fi

  local dest="main"
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    dest="main"
  elif git show-ref --verify --quiet refs/remotes/origin/master; then
    dest="master"
  fi

  git push -u origin "$src:$dest" --force-with-lease
  echo "Pushed $dir ($src -> $dest) -> $GH/$repo"
}

echo "=== Creating GitHub repos (if missing) ==="
create_repo_if_missing "policestationrepuk" "PoliceStationRepUK website - policestationrepuk.org"
create_repo_if_missing "psrtrain" "PSRUKTrain website - psrtrain.com"

echo ""
echo "=== Pushing PoliceStationRepUK ==="
FAIL=0
push_local "$HOME/Policestationrepuk" "policestationrepuk" main || FAIL=1

echo ""
echo "=== Pushing PSRUKTrain ==="
push_local "$HOME/pstrain-rebuild" "psrtrain" main || FAIL=1

if [[ $FAIL -ne 0 ]]; then
  echo ""
  echo "ERROR: One or more pushes failed; see logs above."
  exit 1
fi

echo ""
echo "=== CustodyNoteApp desktop (optional) ==="
echo "If desktop source is in a separate folder, push it to custody-note-app:"
echo "  cd /path/to/desktop-source"
echo "  git remote add origin https://github.com/$GH/custody-note-app.git"
echo "  git push -u origin main"
echo ""
echo "Done. Re-run verify in Cloud Agent: bash scripts/verify-workspaces.sh"
