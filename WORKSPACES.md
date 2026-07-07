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

CustodyNoteApp desktop source (when pushed) can live in `custody-note-app-desktop/` to keep the root repo as a release stub.

## Open all five in Cursor

**Cloud Agent:** File → Open Workspace from File → `all-workspaces.code-workspace`

**MacBook (sibling folders):** use `one/policestationagent.code-workspace` on branch `cursor/update-all-workspaces-b9c1`, or clone all repos as siblings and open `all-workspaces.code-workspace` from a parent folder.

## Setup from Mac (one-time)

Repos `policestationrepuk` and `psrtrain` must exist on GitHub and contain your Mac code:

```bash
bash scripts/mac-push-missing-repos.sh
```

Then in Cloud Agent (or locally), clone missing folders:

```bash
git clone https://github.com/robertdavidcashman-droid/policestationrepuk.git Policestationrepuk
git clone https://github.com/robertdavidcashman-droid/psrtrain.git pstrain-rebuild
```

## Verify

```bash
bash scripts/verify-workspaces.sh
```

## Vercel

Each website repo connects to **one** Vercel project. Do not link `one` to the pstrain project (see `one/scripts/verify-deployment-target.js`).

Authenticate Vercel (MCP in Cursor or `VERCEL_TOKEN`), then run:

```bash
bash scripts/verify-vercel-links.sh
```
