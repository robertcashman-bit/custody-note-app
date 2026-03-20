/**
 * Live test: saved/custom templates in Quick Email
 * Tests the full round-trip: compose → save as template → reload → apply with new values
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
    .then(r => {
      if (r.result?.exceptionDetails) {
        console.error('   JS error:', r.result.exceptionDetails.text, 
          r.result.exceptionDetails.exception?.description || '');
      }
      return r.result?.result?.value;
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('--- Quick Email Custom/Saved Template Live Test ---\n');

  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.error('No page target found'); process.exit(1); }
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable', {});

  let pass = true;
  function check(label, condition) {
    const status = condition ? 'PASS' : 'FAIL';
    console.log('   [' + status + '] ' + label);
    if (!condition) pass = false;
  }

  // Step 1: Check what custom templates currently exist
  console.log('1. Checking existing custom templates...');
  const existingTpls = await evaluate(`
    (function() {
      try { return JSON.parse(localStorage.getItem("cn-custom-email-templates") || "[]"); }
      catch(_) { return []; }
    })()
  `);
  console.log('   Existing templates:', JSON.stringify(existingTpls));

  // Step 2: Create a test custom template with placeholders directly in localStorage
  console.log('\n2. Creating test custom template with placeholders...');
  await evaluate(`
    (function() {
      var tpls = [];
      try { tpls = JSON.parse(localStorage.getItem("cn-custom-email-templates") || "[]"); } catch(_) {}
      tpls.push({
        name: "TEST: Disclosure with placeholders",
        subject: "{{clientName}} - {{station}} - Test Disclosure",
        body: "Dear {{oicName}},\\n\\nRe: {{clientName}} at {{station}} on {{date}}.\\n\\nAttendance type: {{attendanceType}}.\\nOffence: {{offenceType}}.\\n\\nRegards,\\n{{feeEarnerName}}",
        scope: "officer"
      });
      localStorage.setItem("cn-custom-email-templates", JSON.stringify(tpls));
      return tpls.length;
    })()
  `);

  // Step 3: Check _getCustomEmailTemplates
  console.log('\n3. Checking _getCustomEmailTemplates function...');
  const getCustomExists = await evaluate('typeof window._getCustomEmailTemplates');
  console.log('   window._getCustomEmailTemplates type:', getCustomExists);
  
  if (getCustomExists === 'function') {
    const customList = await evaluate(`
      JSON.stringify(window._getCustomEmailTemplates())
    `);
    console.log('   Returns:', customList ? customList.substring(0, 200) : 'null/undefined');
  }

  // Step 4: Open Quick Email modal — this time should see custom template
  console.log('\n4. Opening Quick Email modal with custom template...');
  await evaluate('openQuickEmailModal()');
  await sleep(500);

  const optionValues = await evaluate(`
    Array.from(document.getElementById("quick-email-custom-template")?.options || [])
      .map(o => o.value + " => " + o.textContent.trim()).join("\\n")
  `);
  console.log('   Dropdown options:');
  console.log('   ' + (optionValues || '').split('\n').join('\n   '));

  // Step 5: Fill in fields
  console.log('\n5. Filling in form fields...');
  await evaluate('document.getElementById("quick-email-officer-name").value = "DC Taylor"');
  await evaluate('document.getElementById("quick-email-client-name").value = "Jane Adams"');
  await evaluate('document.getElementById("quick-email-station").value = "Camden"');
  await evaluate('document.getElementById("quick-email-date").value = "2026-03-19"');
  await evaluate(`
    var sel = document.getElementById("quick-email-attendance-type");
    sel.value = "custody";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  await evaluate('document.getElementById("quick-email-offence").value = "ABH"');
  
  // Step 6: Find and select the custom template
  console.log('\n6. Selecting custom template...');
  const customIdx = await evaluate(`
    (function() {
      var opts = document.getElementById("quick-email-custom-template")?.options || [];
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value.indexOf("custom:") === 0 && opts[i].textContent.includes("TEST")) return opts[i].value;
      }
      return null;
    })()
  `);
  console.log('   Custom template option value:', customIdx);
  
  if (customIdx) {
    await evaluate(`
      var sel = document.getElementById("quick-email-custom-template");
      sel.value = "${customIdx}";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      "dispatched"
    `);
    await sleep(300);

    const subject = await evaluate('document.getElementById("quick-email-subject").value');
    const body = await evaluate('document.getElementById("quick-email-body").value');
    
    console.log('   Subject:', JSON.stringify(subject));
    console.log('   Body:', JSON.stringify(body));

    check('Custom subject has "Jane Adams"', (subject || '').includes('Jane Adams'));
    check('Custom subject has "Camden"', (subject || '').includes('Camden'));
    check('Custom body has "Dear DC Taylor"', (body || '').includes('Dear DC Taylor'));
    check('Custom body has "Jane Adams"', (body || '').includes('Jane Adams'));
    check('Custom body has "Camden"', (body || '').includes('Camden'));
    check('Custom body has "19/03/2026"', (body || '').includes('19/03/2026'));
    check('Custom body has "attendance"', (body || '').includes('attendance'));
    check('Custom body has "ABH"', (body || '').includes('ABH'));

    // Step 7: Test live update with custom template
    console.log('\n7. Testing live update with custom template...');
    await evaluate(`
      var el = document.getElementById("quick-email-officer-name");
      el.value = "DC Morgan";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    `);
    await sleep(200);

    const updatedBody = await evaluate('document.getElementById("quick-email-body").value');
    check('Custom body updated to "Dear DC Morgan"', (updatedBody || '').includes('Dear DC Morgan'));
    check('No longer contains "DC Taylor"', !(updatedBody || '').includes('DC Taylor'));
  } else {
    console.log('   WARNING: Custom template not found in dropdown!');
    pass = false;
  }

  // Step 8: Test the SAVE flow — compose an email and save it
  console.log('\n8. Testing save-as-template flow...');
  await evaluate(`
    var sel = document.getElementById("quick-email-custom-template");
    sel.value = "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  await sleep(200);

  await evaluate('document.getElementById("quick-email-officer-name").value = "DC Brown"');
  await evaluate('document.getElementById("quick-email-client-name").value = "Mike Wilson"');
  await evaluate('document.getElementById("quick-email-station").value = "Brixton"');
  await evaluate('document.getElementById("quick-email-subject").value = "Mike Wilson - Brixton - My Custom Subject"');
  await evaluate('document.getElementById("quick-email-body").value = "Dear DC Brown,\\n\\nRegarding Mike Wilson at Brixton.\\n\\nThanks"');

  // Simulate save-as-template
  const savedTpl = await evaluate(`
    (function() {
      var modal = document.getElementById("quick-email-modal");
      var getMap = modal.getPlaceholderMap;
      var map = typeof getMap === "function" ? getMap() : {};
      var subjectRaw = document.getElementById("quick-email-subject").value;
      var bodyRaw = document.getElementById("quick-email-body").value;
      var subjectTpl = _valuesToPlaceholders(subjectRaw, map);
      var bodyTpl = _valuesToPlaceholders(bodyRaw, map);
      return JSON.stringify({ subject: subjectTpl, body: bodyTpl, map: map });
    })()
  `);
  
  const saved = JSON.parse(savedTpl || '{}');
  console.log('   Saved subject:', saved.subject);
  console.log('   Saved body:', saved.body);
  console.log('   Map used:', JSON.stringify(saved.map).substring(0, 200));

  check('Saved subject has {{clientName}} placeholder', (saved.subject || '').includes('{{clientName}}'));
  check('Saved subject has {{station}} placeholder', (saved.subject || '').includes('{{station}}'));
  check('Saved body has {{oicName}} placeholder', (saved.body || '').includes('{{oicName}}'));
  check('Saved body has {{clientName}} placeholder', (saved.body || '').includes('{{clientName}}'));
  check('Saved body has {{station}} placeholder', (saved.body || '').includes('{{station}}'));

  // Cleanup
  await evaluate('var m = document.getElementById("quick-email-modal"); if (m) m.remove();');
  
  // Remove test template from localStorage
  await evaluate(`
    (function() {
      var tpls = JSON.parse(localStorage.getItem("cn-custom-email-templates") || "[]");
      tpls = tpls.filter(function(t) { return !t.name.startsWith("TEST:"); });
      localStorage.setItem("cn-custom-email-templates", JSON.stringify(tpls));
    })()
  `);

  console.log('\n' + (pass ? '=== ALL TESTS PASSED ===' : '=== SOME TESTS FAILED ==='));
  ws.close();
  process.exit(pass ? 0 : 1);
}

run().catch(err => {
  console.error('Test error:', err);
  if (ws) ws.close();
  process.exit(1);
});
