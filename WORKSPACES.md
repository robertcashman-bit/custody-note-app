# Five Workspaces

Multi-project layout for all Custody Note / police station rep sites.

## Projects

| Workspace | Domain | Folder | GitHub repo | Vercel project |
|-----------|--------|--------|-------------|----------------|
| PoliceStationAgent.com | policestationagent.com | `one/` | `robertdavidcashman-droid/one` | web44ai |
| PoliceStationRepUK.com | policestationrepuk.org | `Policestationrepuk/` | `robertdavidcashman-droid/policestationrepuk` | policestationrepuk |
| CustodyNote website | custodynote.com | `custody-note-website/` | `robertdavidcashman-droid/custody-note-website` | custody-note-website |
| PSRUKTrain.com | psrtrain.com | `pstrain-rebuild/` | `robertdavidcashman-droid/psrtrain` | pstrain |
| CustodyNoteApp | (desktop) | `.` (root) | `robertdavidcashman-droid/custody-note-app` | none (GitHub Releases) |

Configuration: [`workspaces.manifest.json`](workspaces.manifest.json)

## Automatic setup

### Cloud Agent (automatic on every run)

[`.cursor/environment.json`](.cursor/environment.json) runs:

1. `scripts/bootstrap-github-repos.sh` — create missing GitHub repos (needs `GITHUB_PAT`)
2. `scripts/sync-all-workspaces.sh` — clone or pull all repos
3. `scripts/verify-workspaces.sh` — health check

Manual sync anytime:

```bash
bash scripts/sync-all-workspaces.sh
bash scripts/verify-workspaces.sh
```

### MacBook (one-time install, then automatic every 5 min)

```bash
# Optional: custom folder paths
export REPUK_DIR="$HOME/Policestationrepuk"
export PSRTRAIN_DIR="$HOME/pstrain-rebuild"

bash scripts/install-mac-sync-agent.sh
```

Test without pushing:

```bash
bash scripts/mac-push-missing-repos.sh --dry-run
```

Logs: `~/Library/Logs/cursor-workspace-sync.log`

### Cursor Cloud secrets (one-time)

| Secret | Purpose |
|--------|---------|
| `GITHUB_PAT` | Create missing repos from cloud bootstrap |
| `VERCEL_TOKEN` | Verify Vercel Git links |

## Open all five in Cursor

File → Open Workspace from File → `all-workspaces.code-workspace`

## Vercel

Each website repo connects to **one** Vercel project. Do not link `one` to the pstrain project (see `one/scripts/verify-deployment-target.js`).

```bash
bash scripts/verify-vercel-links.sh
```

## GitHub health check

Workflow [`.github/workflows/workspace-sync-check.yml`](.github/workflows/workspace-sync-check.yml) runs every 6 hours and reports missing repos.
