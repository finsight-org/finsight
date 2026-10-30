import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

export interface ConnectionIO {
  prompt: (label: string, hidden: boolean) => Promise<string>;
  write: (message: string) => void;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

const usage = 'Usage: npm run wealthsimple -- <login|status|disconnect> [--url http://127.0.0.1:4000]';

export async function runWealthsimple(args: string[], io: ConnectionIO): Promise<number> {
  try {
    const [command, flag, value, ...extra] = args;
    if (!['login', 'status', 'disconnect'].includes(command ?? '') || extra.length ||
        (flag !== undefined && (flag !== '--url' || !value)) || (flag === undefined && value !== undefined)) {
      io.write(usage);
      return 1;
    }
    const base = new URL(value ?? 'http://127.0.0.1:4000');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
        base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid URL');
    const url = new URL('/providers/wealthsimple/connection', base);
    async function request(method: string, body?: object) {
      const response = await (io.fetch ?? fetch)(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(95_000), ...(io.signal ? [io.signal] : [])]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Connection request failed');
      }
      if (method === 'DELETE') { await response.body?.cancel(); return 'disconnected'; }
      const status: unknown = (await response.json()).status;
      if (!['connected', 'disconnected', 'mfa_required'].includes(String(status))) throw new Error('Invalid status');
      return status;
    }
    if (command === 'login') {
      const input = {
        email: (await io.prompt('Email: ', false)).trim(),
        password: await io.prompt('Password: ', true),
        otp: undefined as string | undefined,
      };
      try {
        let status = await request('POST', input);
        if (status === 'mfa_required') {
          input.otp = await io.prompt('OTP: ', true);
          status = await request('POST', input);
        }
        if (status !== 'connected') throw new Error('Login incomplete');
        io.write('Wealthsimple: connected.');
      } finally { input.password = ''; input.otp = undefined; }
    } else {
      io.write(`Wealthsimple: ${await request(command === 'status' ? 'GET' : 'DELETE')}.`);
    }
    return 0;
  } catch {
    const interrupted = io.signal?.aborted;
    io.write(interrupted ? 'Cancelled.' : 'Connection command failed. Check the server URL, credentials, and OTP, then try again.');
    return interrupted ? 130 : 1;
  }
}

async function main() {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    process.exitCode = await runWealthsimple(process.argv.slice(2), {
      signal: controller.signal,
      write: message => process.stdout.write(message + '\n'),
      prompt: async (label, hidden) => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Login needs an interactive terminal');
        const wasRaw = process.stdin.isRaw;
        const output = new Writable({ write(chunk, _encoding, callback) {
          if (!hidden) process.stdout.write(chunk);
          callback();
        } });
        const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
        const closed = () => controller.abort();
        terminal.once('SIGINT', interrupt);
        terminal.once('close', closed);
        // Readline must own visible labels so input redraws preserve the prompt.
        if (hidden) process.stdout.write(label);
        try { return await terminal.question(hidden ? '' : label, { signal: controller.signal }); }
        finally {
          terminal.removeListener('close', closed);
          terminal.removeListener('SIGINT', interrupt);
          terminal.close();
          process.stdin.setRawMode(wasRaw);
          output.destroy();
          if (hidden) process.stdout.write('\n');
        }
      },
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
