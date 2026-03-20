const http = require('http');
const WebSocket = require('ws');

let ws, msgId = 0;
const pending = {};

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id && pending[msg.id]) {
        pending[msg.id](msg);
        delete pending[msg.id];
      }
    });
  });
}

function send(method, params) {
  return new Promise(resolve => {
    const id = ++msgId;
    pending[id] = resolve;
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(expr) {
  return send('Runtime.evaluate', { expression: expr, returnByValue: true })
    .then(r => r.result?.result?.value);
}

async function run() {
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable', {});

  console.log('=== Email Client Debug ===\n');

  const cachedClient = await evaluate('(window._appSettingsCache || {}).preferredEmailClient || "NOT SET"');
  console.log('Cached preferredEmailClient:', cachedClient);

  const dbSettings = await evaluate(`
    (async function() {
      if (window.api && window.api.getSettings) {
        var s = await window.api.getSettings();
        return s ? (s.preferredEmailClient || "NOT SET in DB") : "getSettings returned null";
      }
      return "api.getSettings not available";
    })()
  `);
  console.log('DB preferredEmailClient:', dbSettings);

  const emailClients = await evaluate('JSON.stringify(typeof EMAIL_CLIENTS !== "undefined" ? EMAIL_CLIENTS : "NOT DEFINED")');
  console.log('EMAIL_CLIENTS:', emailClients);

  const buildUrlFn = await evaluate('typeof buildEmailClientUrl');
  console.log('buildEmailClientUrl type:', buildUrlFn);

  const testUrl = await evaluate('typeof buildEmailClientUrl === "function" ? buildEmailClientUrl("outlook_web", "test@test.com", "Test Subject", "Test Body") : "N/A"');
  console.log('Test URL for outlook_web:', testUrl ? testUrl.substring(0, 150) : 'null');

  const testDefault = await evaluate('typeof buildEmailClientUrl === "function" ? buildEmailClientUrl("default", "test@test.com", "Test Subject", "Test Body") : "N/A"');
  console.log('Test URL for default:', testDefault ? testDefault.substring(0, 150) : 'null');

  const openExternalType = await evaluate('window.api && typeof window.api.openExternal');
  console.log('api.openExternal type:', openExternalType);

  const guardState = await evaluate('JSON.stringify(window._emailOpenGuard || "NOT SET")');
  console.log('_emailOpenGuard state:', guardState);

  ws.close();
}

run().catch(err => { console.error(err); process.exit(1); });
