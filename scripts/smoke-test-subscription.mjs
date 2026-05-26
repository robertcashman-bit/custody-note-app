#!/usr/bin/env node
/**
 * Smoke test: custodynote.com subscription / licence API wiring (no payment).
 * Run: node scripts/smoke-test-subscription.mjs
 * Optional: BASE_URL=https://custodynote.com node scripts/smoke-test-subscription.mjs
 */
const BASE = (process.env.BASE_URL || 'https://custodynote.com').replace(/\/$/, '');

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  const text = await res.text();
  return { status: res.status, url: res.url, text };
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, text, json };
}

async function main() {
  console.log(`Subscription smoke test — ${BASE}\n`);

  // Health + email
  try {
    const h = await get('/api/health');
    if (h.status !== 200) fail('GET /api/health', `HTTP ${h.status}`);
    else {
      const j = JSON.parse(h.text);
      if (j.status === 'healthy' && j.checks?.email?.ok) {
        pass('GET /api/health', 'email configured');
      } else {
        fail('GET /api/health', JSON.stringify(j.checks || j));
      }
    }
  } catch (e) {
    fail('GET /api/health', e.message);
  }

  // /buy redirect (after website deploy; may 404 until then)
  try {
    const buy = await get('/buy');
    if (buy.url.includes('/pricing') || buy.text.includes('Subscribe Now')) {
      pass('GET /buy', `resolves to pricing (${buy.status})`);
    } else if (buy.status === 404) {
      fail('GET /buy', '404 — deploy custody-note-website /buy → /pricing redirect');
    } else {
      fail('GET /buy', `HTTP ${buy.status}, final URL ${buy.url}`);
    }
  } catch (e) {
    fail('GET /buy', e.message);
  }

  // Pricing page checkout link
  try {
    const pricing = await get('/pricing');
    if (pricing.status !== 200) fail('GET /pricing', `HTTP ${pricing.status}`);
    else if (
      pricing.text.includes('lemonsqueezy.com/checkout/buy') &&
      pricing.text.includes('Subscribe Now')
    ) {
      pass('GET /pricing', 'Lemon Squeezy checkout linked');
    } else if (pricing.text.includes('Subscribe — Email Us')) {
      fail('GET /pricing', 'checkout URL missing (NEXT_PUBLIC_CHECKOUT_URL unset?)');
    } else {
      fail('GET /pricing', 'unexpected pricing page content');
    }
  } catch (e) {
    fail('GET /pricing', e.message);
  }

  // Thank-you page
  try {
    const ty = await get('/thank-you');
    if (ty.status === 200 && ty.text.includes('licence key')) {
      pass('GET /thank-you', 'onboarding page OK');
    } else {
      fail('GET /thank-you', `HTTP ${ty.status}`);
    }
  } catch (e) {
    fail('GET /thank-you', e.message);
  }

  // Licence validate — bogus key
  try {
    const v = await post('/api/licence/validate', {
      key: 'CN-TEST-TEST-TEST-TEST',
      machineId: 'smoke-test-machine',
      appVersion: '1.9.11',
    });
    if (v.status === 200 && v.json && v.json.valid === false) {
      pass('POST /api/licence/validate', 'rejects unknown key');
    } else {
      fail('POST /api/licence/validate', `HTTP ${v.status} ${v.text.slice(0, 120)}`);
    }
  } catch (e) {
    fail('POST /api/licence/validate', e.message);
  }

  // Lemon Squeezy webhook — must reject unsigned
  try {
    const w = await post('/api/webhooks/lemonsqueezy', { meta: { event_name: 'test' } });
    if (w.status === 401) {
      pass('POST /api/webhooks/lemonsqueezy', 'signature required (401)');
    } else if (w.status === 500 && w.text.includes('not configured')) {
      fail('POST /api/webhooks/lemonsqueezy', 'LEMONSQUEEZY_WEBHOOK_SECRET not set');
    } else {
      fail('POST /api/webhooks/lemonsqueezy', `expected 401, got ${w.status}`);
    }
  } catch (e) {
    fail('POST /api/webhooks/lemonsqueezy', e.message);
  }

  // Magic link — invalid email
  try {
    const ml = await post('/api/auth/magic-link', { email: 'not-an-email' });
    if (ml.status === 400) {
      pass('POST /api/auth/magic-link', 'validates email');
    } else {
      fail('POST /api/auth/magic-link', `HTTP ${ml.status}`);
    }
  } catch (e) {
    fail('POST /api/auth/magic-link', e.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
