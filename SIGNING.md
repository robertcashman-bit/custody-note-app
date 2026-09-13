# Code signing (Windows + Mac)

Unsigned Windows installers trigger SmartScreen (“Windows protected your PC” / “Unknown publisher”) and can be blocked by policy. Custody Note signs the Windows NSIS installer in CI with **Azure Artifact Signing** (formerly Trusted Signing), Basic plan.

Mac Developer ID signing + notarization is unchanged — see the Mac secrets listed in [`.github/workflows/release-publish.yml`](.github/workflows/release-publish.yml).

**Publisher (legal name for identity validation):** `DEFENCELEGALSERVICES LIMITED` (UK).  
The `publisherName` passed to electron-builder must match the **certificate Common Name (CN)** exactly after Azure finishes identity validation (usually the company legal name without extra suffixes).

---

## Windows — Azure Artifact Signing (Basic) — Robert’s checklist

Do these once in Azure + GitHub. Use **placeholders** below until your real account/profile names exist — do **not** invent production names in the repo.

### 1. Azure subscription + resource provider

1. Sign in at [portal.azure.com](https://portal.azure.com) with the Microsoft account that owns the subscription.
2. **Subscriptions** → your subscription → **Settings** → **Resource providers**.
3. Search `Microsoft.CodeSigning` → **Register**.
4. Ensure a payment method is on file (Artifact Signing Basic is a paid monthly plan).

### 2. Create an Artifact Signing account (Basic)

1. Portal search → **Artifact Signing** (may still appear as “Trusted Signing” in older UI).
2. **Create**:
   - **Resource group:** e.g. `YOUR_RESOURCE_GROUP` (example: `custody-note-signing`)
   - **Account name:** e.g. `YOUR_ACCOUNT` (this becomes `codeSigningAccountName`)
   - **Region / endpoint:** pick one region and note the matching endpoint URI, e.g.  
     `https://eus.codesigning.azure.net/` (East US example — use the endpoint Azure shows for *your* region)
3. Open the new account → **Access control (IAM)** → **Add role assignment**:
   - Role: **Artifact Signing Identity Verifier**
   - Assign to: your user (the person who will complete identity validation)

### 3. Organisation identity validation

1. In the Artifact Signing account → **Objects** → **Identity validations**.
2. **New identity** → **Organization** (public trust) for the company.
3. Enter legal details for **DEFENCELEGALSERVICES LIMITED** (UK) exactly as on Companies House / verification docs.
4. Complete the verification partner flow (documents + any authenticator steps).
5. Wait until status is **Completed** (can take minutes to several business days).
6. Note the **CN / subject name** Azure shows for the validated identity — that string is `publisherName`.

### 4. Certificate profile

1. Same account → **Objects** → **Certificate profiles** → **Create**.
2. Profile type: **Public Trust**.
3. Name: e.g. `YOUR_CERT_PROFILE` (this becomes `certificateProfileName`).
4. Select the completed organisation identity. Prefer **not** embedding street address in the public cert unless you intentionally want it.
5. Confirm the profile is ready before the first signed release.

### 5. App registration + OIDC federated credential (GitHub)

OIDC avoids long-lived client secrets for CI.

1. Portal search → **App registrations** → **New registration**.
   - Name: e.g. `custody-note-github-signing`
   - Supported account types: **Single tenant**
   - Redirect URI: leave blank
2. Overview → copy:
   - **Application (client) ID** → GitHub secret `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → GitHub secret `AZURE_TENANT_ID`
3. Subscriptions → your subscription → copy **Subscription ID** → GitHub secret `AZURE_SUBSCRIPTION_ID`
4. App registration → **Certificates & secrets** → **Federated credentials** → **Add credential**:
   - Scenario: **GitHub Actions deploying Azure resources**
   - Organization: `robertcashman-bit`
   - Repository: `custody-note-app`
   - Entity type: **Environment**
   - Environment name: `windows-signing` (must match `environment:` on the `release-windows` job)
   - Name: e.g. `github-custody-note-app-windows-signing`
   - **Why Environment (not Branch):** release builds run on `refs/tags/v*`. A federated credential scoped only to branch `master` will **not** match tag OIDC subjects, and signing login will fail.
5. In GitHub → **Settings → Environments** → ensure `windows-signing` exists (Actions will create it on first run if missing). No required reviewers needed unless you want a manual gate.
6. Back on the **Artifact Signing** account → **IAM** → **Add role assignment**:
   - Role: **Artifact Signing Certificate Profile Signer**
   - Members: the app registration (search by app name — it may only appear after you type the name)
7. Optional but useful: also grant the app **Reader** on the Artifact Signing resource if signer-only auth errors appear during first runs.

### 6. GitHub Actions secrets / vars

Repo: **Settings → Secrets and variables → Actions**.

| Secret | Example / placeholder | Used for |
|--------|------------------------|----------|
| `AZURE_CLIENT_ID` | App registration Application (client) ID | `azure/login` OIDC |
| `AZURE_TENANT_ID` | Entra directory (tenant) ID | `azure/login` OIDC |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | `azure/login` OIDC |
| `AZURE_CODE_SIGNING_ENDPOINT` | `https://eus.codesigning.azure.net/` | electron-builder `endpoint` |
| `AZURE_CODE_SIGNING_ACCOUNT_NAME` | `YOUR_ACCOUNT` | electron-builder `codeSigningAccountName` |
| `AZURE_CERTIFICATE_PROFILE_NAME` | `YOUR_CERT_PROFILE` | electron-builder `certificateProfileName` |
| `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` | `DEFENCELEGALSERVICES LIMITED` | electron-builder `publisherName` (must match cert CN) |

Optional repo **variable**:

| Variable | Value | Effect |
|----------|-------|--------|
| `CN_WINDOWS_SIGN` | `1` | Require signing (fail if secrets absent/incomplete). Soft gate stays off until you set this after Azure is ready. |

### 7. How CI wires signing (`release-windows`)

In [`.github/workflows/release-publish.yml`](.github/workflows/release-publish.yml):

1. Job permissions include `contents: write` and `id-token: write` (required for OIDC).
2. Soft gate (default, until Azure signup is finished):
   - **All** signing secrets present → sign (build fails if signing itself fails)
   - **No** signing secrets present → build + publish **unsigned**, with a clear `::warning::` log line
   - **Partial** secrets / misconfiguration → **fail closed** (do not ship half-configured)
   - `CN_WINDOWS_SIGN=1` with secrets missing → **fail closed** (explicit hard require)
3. When enabled, the job runs `azure/login` (OIDC), then electron-builder with Azure options via CLI (so local/unsigned builds stay unsigned by default):

```bash
npx electron-builder --win --publish always \
  -c.win.azureSignOptions.publisherName="$AZURE_TRUSTED_SIGNING_PUBLISHER_NAME" \
  -c.win.azureSignOptions.endpoint="$AZURE_CODE_SIGNING_ENDPOINT" \
  -c.win.azureSignOptions.codeSigningAccountName="$AZURE_CODE_SIGNING_ACCOUNT_NAME" \
  -c.win.azureSignOptions.certificateProfileName="$AZURE_CERTIFICATE_PROFILE_NAME"
```

`azure/login` exports Entra credentials (including federated token material) that the Trusted Signing PowerShell module consumes via `DefaultAzureCredential`.

**Why options are not hard-coded in `package.json`:** if `build.win.azureSignOptions` is present, electron-builder always selects the Azure sign manager and will try to sign. Keeping them CLI-only preserves unsigned local builds and PR CI without Azure secrets.

Equivalent structure (reference only — enable via CLI/env in CI):

```json
{
  "win": {
    "azureSignOptions": {
      "publisherName": "DEFENCELEGALSERVICES LIMITED",
      "endpoint": "https://eus.codesigning.azure.net/",
      "codeSigningAccountName": "YOUR_ACCOUNT",
      "certificateProfileName": "YOUR_CERT_PROFILE"
    }
  }
}
```

Requires **electron-builder ≥ 26.15** (OIDC / `DefaultAzureCredential` without the old client-secret-only preflight). This repo pins `electron-builder@26.16.1`.

### 8. Soft gate now; hard require after Azure is ready

**Merge-safe soft gate:** `v*` tag releases keep working **unsigned** while Azure Artifact Signing signup is incomplete (all secrets absent). You will see a CI warning that the installer is unsigned.

When Azure is fully set up and secrets in §6 are populated, the next release signs automatically. To make unsigned releases impossible after that, set repo variable `CN_WINDOWS_SIGN=1`.

Do **not** set `CN_WINDOWS_SIGN=1` until secrets are complete — that would block Windows releases.

### 9. Verify a signed installer

1. Download `Custody-Note-Setup-*.exe` from the GitHub Release.
2. Right-click → **Properties** → **Digital Signatures**.
3. Publisher should show the Artifact Signing certificate subject (e.g. DEFENCELEGALSERVICES LIMITED).
4. SmartScreen reputation still builds over time for a new publisher; first installs may show more warnings than a long-lived EV cert.

---

## Legacy PFX / local CSC signing (optional)

Azure Artifact Signing in CI is the supported production path. Local PFX signing remains possible for ad-hoc machines:

```powershell
$env:CSC_LINK = "C:\certs\custody-note.pfx"
$env:CSC_KEY_PASSWORD = "YourCertificatePassword"
npm run build
```

Do not commit `.pfx` files or passwords. Prefer Azure OIDC for GitHub Releases.

---

## Mac (unchanged)

Mac release signing uses Developer ID + notarytool secrets (`MAC_CERTIFICATE_*`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). See the header comments in `release-publish.yml`. Do not set `CN_SKIP_NOTARIZE` in that workflow.
