/**
 * GitHub release helpers — draft releases are invisible to /releases/tags/{tag}.
 * Supports a single canonical draft per tag (CI prepare job + upload-only build jobs).
 */
export const RELEASE_OWNER = 'robertcashman-bit';
export const RELEASE_REPO = 'custody-note-app';

export function normaliseReleaseTag(tag) {
  const t = String(tag || '').trim();
  if (!t) return '';
  return t.startsWith('v') ? t : `v${t}`;
}

export function resolveReleaseRepo() {
  const slug = String(process.env.GITHUB_REPOSITORY || '').trim();
  if (slug && slug.includes('/')) {
    const [owner, repo] = slug.split('/');
    if (owner && repo) return { owner, repo };
  }
  return { owner: RELEASE_OWNER, repo: RELEASE_REPO };
}

export function releaseApiHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CustodyNote-GitHubReleaseApi',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function apiBase(owner, repo) {
  return `https://api.github.com/repos/${owner}/${repo}`;
}

/**
 * All releases with this tag_name (GitHub can return multiple drafts for one tag).
 */
export async function listReleasesByTagName(tag, token, repoOpts) {
  const normalised = normaliseReleaseTag(tag);
  const { owner, repo } = repoOpts || resolveReleaseRepo();
  const headers = releaseApiHeaders(token);
  const base = apiBase(owner, repo);
  const matches = [];

  for (let page = 1; page <= 10; page++) {
    const listRes = await fetch(`${base}/releases?per_page=100&page=${page}`, { headers });
    if (!listRes.ok) {
      throw new Error(`Release list failed: HTTP ${listRes.status} ${await listRes.text()}`);
    }
    const releases = await listRes.json();
    if (!Array.isArray(releases) || releases.length === 0) break;
    for (const r of releases) {
      if (r && r.tag_name === normalised) matches.push(r);
    }
    if (releases.length < 100) break;
  }

  return matches;
}

/** Pick the release row that should own assets when duplicates exist. */
export function pickPrimaryRelease(releases) {
  if (!Array.isArray(releases) || releases.length === 0) return null;
  const sorted = [...releases].sort((a, b) => {
    const ac = (a.assets && a.assets.length) || 0;
    const bc = (b.assets && b.assets.length) || 0;
    if (bc !== ac) return bc - ac;
    return (b.id || 0) - (a.id || 0);
  });
  return sorted[0];
}

async function downloadReleaseAsset(asset, token) {
  const headers = {
    ...releaseApiHeaders(token),
    Accept: 'application/octet-stream',
  };
  const res = await fetch(asset.url, { headers, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Asset download failed (${asset.name}): HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadReleaseAssetBuffer(release, fileName, buffer, token) {
  if (!release || !release.upload_url) {
    throw new Error('Release upload_url missing');
  }
  const uploadUrl = release.upload_url.replace(/\{.*$/, `?name=${encodeURIComponent(fileName)}`);
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...releaseApiHeaders(token),
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(`Upload ${fileName} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

export async function deleteReleaseAsset(assetId, token, owner, repo) {
  const { owner: o, repo: r } = owner && repo ? { owner, repo } : resolveReleaseRepo();
  const res = await fetch(`${apiBase(o, r)}/releases/assets/${assetId}`, {
    method: 'DELETE',
    headers: releaseApiHeaders(token),
  });
  if (res.status !== 204 && !res.ok) {
    throw new Error(`Delete asset ${assetId} failed: HTTP ${res.status}`);
  }
}

async function deleteRelease(releaseId, token, owner, repo) {
  const res = await fetch(`${apiBase(owner, repo)}/releases/${releaseId}`, {
    method: 'DELETE',
    headers: releaseApiHeaders(token),
  });
  if (res.status === 404) return;
  if (res.status !== 204 && !res.ok) {
    throw new Error(`Delete release ${releaseId} failed: HTTP ${res.status} ${await res.text()}`);
  }
}

/**
 * Merge duplicate draft releases for one tag into a single canonical release.
 */
export async function consolidateDuplicateReleases(tag, token, repoOpts) {
  const normalised = normaliseReleaseTag(tag);
  const { owner, repo } = repoOpts || resolveReleaseRepo();
  const matches = await listReleasesByTagName(normalised, token, { owner, repo });
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  console.warn(
    `[github-release] Found ${matches.length} releases for ${normalised} — consolidating into one draft.`,
  );
  let primary = pickPrimaryRelease(matches);
  if (!primary) return null;

  for (const dup of matches) {
    if (dup.id === primary.id) continue;
    const primaryNames = new Set((primary.assets || []).map((a) => a.name));
    for (const asset of dup.assets || []) {
      if (primaryNames.has(asset.name)) continue;
      console.log(`[github-release] Copying ${asset.name} from release ${dup.id} → ${primary.id}`);
      const buf = await downloadReleaseAsset(asset, token);
      await uploadReleaseAssetBuffer(primary, asset.name, buf, token);
      primaryNames.add(asset.name);
    }
    console.log(`[github-release] Deleting duplicate release ${dup.id} (${normalised})`);
    await deleteRelease(dup.id, token, owner, repo);
    primary = await fetchReleaseByTag(normalised, token, { owner, repo });
  }

  return fetchReleaseByTag(normalised, token, { owner, repo });
}

/**
 * Fetch the canonical release by tag (consolidates duplicates when present).
 */
export async function fetchReleaseByTag(tag, token, repoOpts) {
  const normalised = normaliseReleaseTag(tag);
  const { owner, repo } = repoOpts || resolveReleaseRepo();
  const headers = releaseApiHeaders(token);
  const base = apiBase(owner, repo);

  const tagRes = await fetch(`${base}/releases/tags/${encodeURIComponent(normalised)}`, { headers });
  if (tagRes.ok) {
    const release = await tagRes.json();
    const matches = await listReleasesByTagName(normalised, token, { owner, repo });
    if (matches.length > 1) {
      return consolidateDuplicateReleases(normalised, token, { owner, repo });
    }
    return release;
  }
  if (tagRes.status !== 404) {
    throw new Error(`Release ${normalised} lookup failed: HTTP ${tagRes.status} ${await tagRes.text()}`);
  }

  const matches = await listReleasesByTagName(normalised, token, { owner, repo });
  if (matches.length === 0) {
    throw new Error(`Release ${normalised} not found (including drafts)`);
  }
  if (matches.length > 1) {
    return consolidateDuplicateReleases(normalised, token, { owner, repo });
  }
  return matches[0];
}

/**
 * Create a draft release for tag if missing; idempotent under parallel callers.
 */
export async function ensureDraftRelease(tag, token, opts = {}) {
  const normalised = normaliseReleaseTag(tag);
  const { owner, repo } = opts.repo || resolveReleaseRepo();
  const title = opts.title || normalised;

  let matches = await listReleasesByTagName(normalised, token, { owner, repo });
  if (matches.length > 1) {
    return consolidateDuplicateReleases(normalised, token, { owner, repo });
  }
  if (matches.length === 1) return matches[0];

  const createRes = await fetch(`${apiBase(owner, repo)}/releases`, {
    method: 'POST',
    headers: {
      ...releaseApiHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: normalised,
      name: title,
      draft: true,
      prerelease: false,
      generate_release_notes: false,
    }),
  });

  if (createRes.ok) {
    const release = await createRes.json();
    console.log(`[github-release] Created draft release ${normalised} (id ${release.id}).`);
    return release;
  }

  const body = await createRes.text();
  if (createRes.status === 422) {
    const afterRace = await listReleasesByTagName(normalised, token, { owner, repo });
    if (afterRace.length > 0) {
      return consolidateDuplicateReleases(normalised, token, { owner, repo });
    }
  }
  throw new Error(`Create draft release ${normalised} failed: HTTP ${createRes.status} ${body.slice(0, 400)}`);
}

/**
 * Poll until a release exists (CI may still be creating the draft).
 */
export async function waitForReleaseByTag(tag, token, opts = {}) {
  const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 60;
  const delayMs = opts.delayMs != null ? opts.delayMs : 5000;
  const normalised = normaliseReleaseTag(tag);
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchReleaseByTag(normalised, token, opts.repo);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.log(`[github-release] Waiting for ${normalised} (attempt ${attempt}/${maxAttempts})…`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr || new Error(`Release ${normalised} not found after ${maxAttempts} attempts`);
}
