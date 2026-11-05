import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import type { AuthConfig } from '../../src/auth.js';
import type { WealthsimpleOptions } from '../../src/providers/wealthsimple/index.js';
import type { SessionChildConfig } from './session-child.js';

export async function startSessionBackend(t: TestContext, config: AuthConfig, options: {
  secretKey: string; encryptionKey: string; wealthsimple: WealthsimpleOptions;
}) {
  if (options.wealthsimple.fetch) throw new Error('Child acceptance requires real synthetic HTTP endpoints.');
  let child: ChildProcess | undefined, url = '', exitCode: number | null = null;
  let shutdownStarted = false;
  let exited: Promise<void>;
  async function start() {
    shutdownStarted = false; exitCode = null;
    child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./session-child.ts', import.meta.url))], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      // Configuration and credentials travel only through private IPC.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' },
    });
    const running = child;
    exited = new Promise(resolve => running.once('exit', code => { exitCode = code; resolve(); }));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Session child readiness timed out; build first.')); }, 10_000);
      const fail = () => { cleanup(); reject(new Error('Session child failed to start; build first.')); };
      const message = (value: unknown) => {
        const data = value as { type?: string; url?: string };
        if (data.type === 'ready' && data.url) { url = data.url; cleanup(); resolve(); }
        else if (data.type === 'fatal') fail();
      };
      const cleanup = () => { clearTimeout(timeout); running.off('message', message); running.off('exit', fail); running.off('error', fail); };
      running.on('message', message); running.once('exit', fail); running.once('error', fail);
      running.on('message', (value: unknown) => { if ((value as { type?: string }).type === 'shutdown-started') shutdownStarted = true; });
      running.send({ auth: config, ...options } satisfies SessionChildConfig);
    }).catch(async error => { running.kill('SIGKILL'); await exited; throw error; });
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { child?.kill('SIGKILL'); reject(new Error('Session child exceeded graceful shutdown budget.')); }, 9_000);
      })]);
      if (!shutdownStarted || exitCode !== 0) throw new Error('Session child did not shut down through its SIGTERM IPC barrier.');
    } finally { clearTimeout(timer); }
  }
  t.after(stop);
  await start();
  return { get url() { return url; }, get exitCode() { return exitCode; },
    async restart() { await stop(); await start(); }, stop };
}
