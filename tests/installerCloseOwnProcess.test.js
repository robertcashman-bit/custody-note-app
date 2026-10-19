'use strict';

/**
 * Static guard for build/installer.nsh: the NSIS installer/uninstaller must
 * close ONLY the Custody Note process running from the install directory being
 * replaced. Never by image name alone (kills the Microsoft Store copy mid-save),
 * never by window title (kills unrelated programs such as a Word document or
 * browser tab titled "Custody Note ..."). Graceful close first; force only last.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
const code = nsh
  .split(/\r?\n/)
  .filter((l) => !/^\s*;/.test(l))
  .join('\n');

function macroBody(name) {
  const m = code.match(new RegExp('!macro ' + name + '\\b([\\s\\S]*?)!macroend'));
  assert.ok(m, 'macro ' + name + ' must exist');
  return m[1];
}

describe('installer.nsh process handling', () => {
  it('never uses taskkill (image-name or window-title matching)', () => {
    assert.doesNotMatch(code, /taskkill/i);
    assert.doesNotMatch(code, /WINDOWTITLE/i);
    assert.doesNotMatch(code, /\/IM\s+"?Custody Note/i);
  });

  it('customInit and customUnInit both use the INSTDIR-scoped close macro', () => {
    assert.match(macroBody('customInit'), /!insertmacro CN_CloseOwnInstance/);
    assert.match(macroBody('customUnInit'), /!insertmacro CN_CloseOwnInstance/);
  });

  it('close macro filters by the install directory path and closes gracefully before forcing', () => {
    const body = macroBody('CN_CloseOwnInstance');
    assert.match(body, /SetEnvironmentVariable\(t "CN_INSTDIR", t "\$INSTDIR"\)/);
    assert.match(body, /\$\$env:CN_INSTDIR/);
    assert.match(body, /\$\$_\.Path\.StartsWith\(\$\$d,'OrdinalIgnoreCase'\)/);
    const graceful = body.indexOf('CloseMainWindow');
    const force = body.indexOf('Stop-Process -Force');
    assert.ok(graceful > 0, 'must attempt CloseMainWindow');
    assert.ok(force > graceful, 'force-kill only after graceful close');
    assert.match(body, /AddSeconds\(15\)/, 'must wait for graceful exit');
    // Force applies only to the INSTDIR-filtered set ($l from &$f), never by name.
    assert.match(body, /\$\$l=&\$\$f;if\(\$\$l\.Count\)\{\$\$l\|Stop-Process -Force/);
  });
});
