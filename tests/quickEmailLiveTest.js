/**
 * Live test: connects to running Electron app via Chrome DevTools Protocol
 * and exercises the Quick Email template flow.
 * 
 * Prerequisites: app must be running with --remote-debugging-port=9222
 */
const http = require('http');
const WebSocket = require('ws');

let ws;
let msgId = 0;
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('--- Quick Email Live Integration Test ---\n');

  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.error('No page target found'); process.exit(1); }
  console.log('Connected to:', page.title, page.url, '\n');
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable', {});

  // Step 1: Open Quick Email modal
  console.log('1. Opening Quick Email modal...');
  await evaluate('if (typeof openQuickEmailModal === "function") openQuickEmailModal(); "ok"');
  await sleep(500);
  const modalExists = await evaluate('!!document.getElementById("quick-email-modal")');
  console.log('   Modal exists:', modalExists);
  if (!modalExists) { console.error('   FAIL: Modal did not open!'); ws.close(); process.exit(1); }

  // Step 2: Check template dropdown
  const dropdownExists = await evaluate('!!document.getElementById("quick-email-custom-template")');
  console.log('   Template dropdown exists:', dropdownExists);
  const optionCount = await evaluate('document.getElementById("quick-email-custom-template")?.options.length || 0');
  console.log('   Option count:', optionCount);
  const optionValues = await evaluate(`
    Array.from(document.getElementById("quick-email-custom-template")?.options || [])
      .map(o => o.value + " => " + o.textContent.trim()).join("\\n")
  `);
  console.log('   Options:\n   ' + (optionValues || '').split('\n').join('\n   '));

  // Step 3: Fill in form fields BEFORE selecting template
  console.log('\n2. Filling in form fields...');
  await evaluate('document.getElementById("quick-email-officer-name").value = "DC Smith"');
  await evaluate('document.getElementById("quick-email-client-name").value = "John Doe"');
  await evaluate('document.getElementById("quick-email-station").value = "Holborn"');
  await evaluate('document.getElementById("quick-email-date").value = "2026-03-18"');
  
  const officerVal = await evaluate('document.getElementById("quick-email-officer-name").value');
  const clientVal = await evaluate('document.getElementById("quick-email-client-name").value');
  const stationVal = await evaluate('document.getElementById("quick-email-station").value');
  console.log('   Officer:', officerVal, '| Client:', clientVal, '| Station:', stationVal);

  // Step 4: Select "Disclosure Request" template
  console.log('\n3. Selecting "Disclosure Request" template...');
  await evaluate(`
    var sel = document.getElementById("quick-email-custom-template");
    sel.value = "builtin:disclosure";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    "dispatched"
  `);
  await sleep(300);

  const subject = await evaluate('document.getElementById("quick-email-subject").value');
  const body = await evaluate('document.getElementById("quick-email-body").value');
  
  console.log('   Subject:', JSON.stringify(subject));
  console.log('   Body (first 200 chars):', JSON.stringify((body || '').substring(0, 200)));

  // Step 5: Validate results
  console.log('\n4. Validation:');
  let pass = true;

  function check(label, condition) {
    const status = condition ? 'PASS' : 'FAIL';
    console.log('   [' + status + '] ' + label);
    if (!condition) pass = false;
  }

  check('Subject contains "John Doe"', (subject || '').includes('John Doe'));
  check('Subject contains "Holborn"', (subject || '').includes('Holborn'));
  check('Subject contains "Disclosure Request"', (subject || '').includes('Disclosure Request'));
  check('Body contains "Dear DC DC Smith"', (body || '').includes('Dear DC DC Smith'));
  check('Body contains "John Doe"', (body || '').includes('John Doe'));
  check('Body contains "Holborn"', (body || '').includes('Holborn'));
  check('Body contains "18/03/2026"', (body || '').includes('18/03/2026'));

  // Step 6: Test live update — change officer name
  console.log('\n5. Testing live update (changing officer to "Williams")...');
  await evaluate(`
    var el = document.getElementById("quick-email-officer-name");
    el.value = "Williams";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    "dispatched"
  `);
  await sleep(200);

  const updatedBody = await evaluate('document.getElementById("quick-email-body").value');
  check('Body updated to "Dear DC Williams"', (updatedBody || '').includes('Dear DC Williams'));
  check('Body no longer contains "DC Smith"', !(updatedBody || '').includes('DC Smith'));

  // Step 7: Test subject update — change client name
  console.log('\n6. Testing subject update (changing client to "Alice Brown")...');
  await evaluate(`
    var el = document.getElementById("quick-email-client-name");
    el.value = "Alice Brown";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    "dispatched"
  `);
  await sleep(200);

  const updatedSubject = await evaluate('document.getElementById("quick-email-subject").value');
  check('Subject updated to contain "Alice Brown"', (updatedSubject || '').includes('Alice Brown'));
  console.log('   Updated subject:', JSON.stringify(updatedSubject));

  // Step 8: Switch to Bail template
  console.log('\n7. Switching to "Bail Confirmation" template...');
  await evaluate(`
    var sel = document.getElementById("quick-email-custom-template");
    sel.value = "builtin:bail";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    "dispatched"
  `);
  await sleep(200);

  const bailBody = await evaluate('document.getElementById("quick-email-body").value');
  check('Bail body mentions "police bail"', (bailBody || '').includes('police bail'));
  check('Bail body has updated officer "Williams"', (bailBody || '').includes('Williams'));

  // Step 9: Switch to None
  console.log('\n8. Switching to "None (compose freely)"...');
  await evaluate(`
    var sel = document.getElementById("quick-email-custom-template");
    sel.value = "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    "dispatched"
  `);
  await sleep(200);

  const clearedBody = await evaluate('document.getElementById("quick-email-body").value');
  check('Body is empty after "None"', clearedBody === '');

  // Close
  await evaluate('var m = document.getElementById("quick-email-modal"); if (m) m.remove(); "closed"');

  console.log('\n' + (pass ? '=== ALL TESTS PASSED ===' : '=== SOME TESTS FAILED ==='));
  ws.close();
  process.exit(pass ? 0 : 1);
}

run().catch(err => {
  console.error('Test error:', err);
  if (ws) ws.close();
  process.exit(1);
});
