/**
 * Launch Microsoft Edge with --remote-debugging-port so Playwright can
 * chromium.connectOverCDP — mirrors msedge candidate paths from main/openOutlookWebEmail.js.
 */
import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';
import { spawn, execSync, type ChildProcess } from 'child_process';

export function resolveWindowsMsEdgeExecutable(): string | null {
  const candidates: string[] = [];
  if (process.env['PROGRAMFILES(X86)']) {
    candidates.push(
      path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  }
  if (process.env.PROGRAMFILES) {
    candidates.push(path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* continue */
    }
  }
  return null;
}

export function getEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : 0;
      s.close(err => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    s.on('error', reject);
  });
}

/** Poll until Edge exposes DevTools HTTP (/json/version). */
export async function waitForCdpHttp(port: number, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, res => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else reject(new Error('bad status ' + res.statusCode));
        });
        req.on('error', reject);
        req.setTimeout(1500, () => {
          req.destroy();
          reject(new Error('socket timeout'));
        });
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error(`CDP HTTP not ready on port ${port} within ${timeoutMs}ms`);
}

export function launchEdgeRemoteDebugging(edgeExe: string, port: number, userDataDir: string): ChildProcess {
  return spawn(
    edgeExe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );
}

export async function killEdgeProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.killed) return;
  const pid = proc.pid;
  try {
    if (process.platform === 'win32' && pid) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else if (pid) {
      proc.kill('SIGTERM');
      await new Promise<void>(resolve => setTimeout(resolve, 1500));
      try {
        if (!proc.killed) process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
  } catch {
    try {
      if (pid) process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
}
