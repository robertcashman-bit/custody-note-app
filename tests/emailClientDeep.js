/**
 * DevTools helper: verify emailAPI / invokeOutlookWebCompose are present.
 * Custody Note uses Outlook Web only — no preferredEmailClient / mailto builders.
 */
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

  console.log('=== Outlook Web compose debug ===\n');

  const apiOpen = await evaluate('typeof (window.emailAPI && window.emailAPI.open)');
  const invokeOpen = await evaluate('typeof (window.invokeOutlookWebCompose)');
  console.log('emailAPI.open:', apiOpen, '| invokeOutlookWebCompose:', invokeOpen);

  console.log('\nCompose uses invokeOutlookWebCompose → emailAPI.open (single-flight guard in outlook-email-invoke.js).');

  ws.close();
}

run().catch(err => { console.error(err); process.exit(1); });
