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
  local branch="${3:-master}"

  if [[ ! -d "$dir" ]]; then
    echo "SKIP: $dir not found"
    return 1
  fi

  cd "$dir"
  if [[ ! -d .git ]]; then
    echo "Initializing git in $dir"
    git init
    git add -A
    git commit -m "Initial commit from Mac" || true
  fi

  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$GH/$repo.git"

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git push -u origin "$branch" --force-with-lease
  elif git show-ref --verify --quiet refs/heads/main; then
    git push -u origin main --force-with-lease
  else
    git branch -M "$branch"
    git push -u origin "$branch"
  fi
  echo "Pushed $dir -> $GH/$repo"
}

echo "=== Creating GitHub repos (if missing) ==="
create_repo_if_missing "policestationrepuk" "PoliceStationRepUK website - policestationrepuk.org"
create_repo_if_missing "psrtrain" "PSRUKTrain website - psrtrain.com"

echo ""
echo "=== Pushing PoliceStationRepUK ==="
push_local "$HOME/Policestationrepuk" "policestationrepuk" master || true

echo ""
echo "=== Pushing PSRUKTrain ==="
push_local "$HOME/pstrain-rebuild" "psrtrain" master || true

echo ""
echo "=== CustodyNoteApp desktop (optional) ==="
echo "If desktop source is in a separate folder, push it to custody-note-app:"
echo "  cd /path/to/desktop-source"
echo "  git remote add origin https://github.com/$GH/custody-note-app.git"
echo "  git push -u origin main"
echo ""
echo "Done. Re-run verify in Cloud Agent: bash scripts/verify-workspaces.sh"
