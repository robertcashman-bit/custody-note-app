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
  return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    .then(r => {
      if (r.result?.exceptionDetails) {
        return 'ERROR: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      }
      return r.result?.result?.value;
    });
}

async function run() {
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable', {});

  console.log('=== Deep Email Client Debug ===\n');

  // 1. Current cache state
  const cache = await evaluate('JSON.stringify(window._appSettingsCache || {})');
  const parsed = JSON.parse(cache || '{}');
  console.log('1. Cache preferredEmailClient:', JSON.stringify(parsed.preferredEmailClient));
  console.log('   Cache type:', typeof parsed.preferredEmailClient);

  // 2. DB state (with awaitPromise)
  const dbResult = await evaluate(`
    window.api.getSettings().then(function(s) {
      return JSON.stringify({
        full: s,
        client: s ? s.preferredEmailClient : 'NO_SETTINGS',
        clientType: s ? typeof s.preferredEmailClient : 'N/A'
      });
    })
  `);
  console.log('\n2. DB getSettings result:');
  try {
    const db = JSON.parse(dbResult);
    console.log('   preferredEmailClient:', JSON.stringify(db.client));
    console.log('   type:', db.clientType);
    console.log('   full settings keys:', Object.keys(db.full || {}).join(', '));
  } catch(e) {
    console.log('   raw:', dbResult);
  }

  // 3. What happens when we merge
  const mergeTest = await evaluate(`
    (function() {
      var cache = { preferredEmailClient: 'owa', foo: 'bar' };
      var db = window.api.getSettings ? 'will test' : 'no api';
      return db;
    })()
  `);
  
  const mergeSimulation = await evaluate(`
    window.api.getSettings().then(function(s) {
      var before = (window._appSettingsCache || {}).preferredEmailClient;
      var merged = Object.assign({}, window._appSettingsCache || {}, s || {});
      var after = merged.preferredEmailClient;
      return JSON.stringify({
        before: before,
        beforeType: typeof before,
        sHasKey: s ? s.hasOwnProperty('preferredEmailClient') : 'no s',
        sValue: s ? s.preferredEmailClient : 'no s',
        sValueType: s ? typeof s.preferredEmailClient : 'no s',
        after: after,
        afterType: typeof after
      });
    })
  `);
  console.log('\n3. Merge simulation (what happens when Open Email App is clicked):');
  try {
    const m = JSON.parse(mergeSimulation);
    console.log('   Before merge - preferredEmailClient:', JSON.stringify(m.before), '(type: ' + m.beforeType + ')');
    console.log('   DB has preferredEmailClient key:', m.sHasKey);
    console.log('   DB value:', JSON.stringify(m.sValue), '(type: ' + m.sValueType + ')');
    console.log('   After merge - preferredEmailClient:', JSON.stringify(m.after), '(type: ' + m.afterType + ')');
    if (m.before !== m.after) {
      console.log('   *** BUG: merge OVERWRITES cache value! ***');
    } else {
      console.log('   OK: merge preserves value');
    }
  } catch(e) {
    console.log('   raw:', mergeSimulation);
  }

  // 4. Test buildEmailClientUrl for each client
  console.log('\n4. buildEmailClientUrl output for each client:');
  const clients = ['default', 'gmail', 'owa', 'outlook', 'yahoo', 'aol'];
  for (const c of clients) {
    const url = await evaluate(`buildEmailClientUrl("${c}", "test@test.com", "Subj", "Body").substring(0, 120)`);
    console.log('   ' + c + ': ' + url);
  }

  // 5. Check the guard URL
  const guard = await evaluate('JSON.stringify(window._emailOpenGuard || null)');
  if (guard && guard !== 'null') {
    const g = JSON.parse(guard);
    const ago = Date.now() - g.ts;
    console.log('\n5. Last email opened:');
    console.log('   ' + (ago/1000).toFixed(0) + 's ago');
    console.log('   URL prefix:', (g.url || '').substring(0, 80));
    const isOwa = (g.url || '').includes('outlook.office.com');
    const isMailto = (g.url || '').startsWith('mailto:');
    console.log('   Type:', isOwa ? 'Outlook Web' : isMailto ? 'mailto (system default)' : 'other');
  }

  // 6. Check settings dropdown on settings page
  const settingsDropdown = await evaluate(`
    (function() {
      var sel = document.getElementById('setting-preferred-email-client');
      return sel ? sel.value : 'DROPDOWN NOT FOUND';
    })()
  `);
  console.log('\n6. Settings page dropdown value:', settingsDropdown);

  ws.close();
}

run().catch(err => { console.error(err); process.exit(1); });
