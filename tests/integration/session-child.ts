// Test-only entrypoint: production has no synthetic provider endpoint env vars.
import type { AuthConfig } from '../../src/auth.js';
import type { WealthsimpleOptions } from '../../src/providers/wealthsimple/index.js';

export interface SessionChildConfig {
  auth: AuthConfig;
  secretKey: string;
  encryptionKey: string;
  wealthsimple: WealthsimpleOptions;
}

// File-URL imports exercise emitted JavaScript without requiring dist .d.ts files.
async function boot(config: SessionChildConfig) {
  const { createApp } = await import(new URL('../../dist/app.js', import.meta.url).href) as typeof import('../../src/app.js');
  const { wealthsimpleProvider } = await import(new URL('../../dist/providers/wealthsimple/index.js', import.meta.url).href) as typeof import('../../src/providers/wealthsimple/index.js');
  const { WealthsimpleClient } = await import(new URL('../../dist/providers/wealthsimple/client.js', import.meta.url).href) as typeof import('../../src/providers/wealthsimple/client.js');
  const { readSessionConfig } = await import(new URL('../../dist/sessions/config.js', import.meta.url).href) as typeof import('../../src/sessions/config.js');
  const { createSessionCipher } = await import(new URL('../../dist/sessions/crypto.js', import.meta.url).href) as typeof import('../../src/sessions/crypto.js');
  const { createSupabaseSessionStore } = await import(new URL('../../dist/sessions/supabase-store.js', import.meta.url).href) as typeof import('../../src/sessions/supabase-store.js');
  const { WealthsimpleSessionService } = await import(new URL('../../dist/sessions/wealthsimple-service.js', import.meta.url).href) as typeof import('../../src/sessions/wealthsimple-service.js');
  const session = await readSessionConfig({ SUPABASE_SECRET_KEY: config.secretKey, FINSIGHT_SESSION_ENCRYPTION_KEY: config.encryptionKey }, true);
  const app = createApp([wealthsimpleProvider(config.wealthsimple)], {
    auth: config.auth,
    connectionSessions: new WealthsimpleSessionService({
      cipher: createSessionCipher(session!.encryptionKey),
      store: createSupabaseSessionStore({ supabaseUrl: config.auth.supabaseUrl, secretKey: session!.supabaseSecretKey }),
      createClient: () => new WealthsimpleClient(config.wealthsimple),
    }),
  });
  process.once('SIGTERM', async () => {
    // Parent observes the actual signal handler before accepting a graceful exit.
    process.send?.({ type: 'shutdown-started' });
    try { await app.close(); process.exitCode = 0; }
    catch { process.exitCode = 1; }
    finally { process.disconnect(); }
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  process.send?.({ type: 'ready', url });
}

process.once('message', (config: SessionChildConfig) => {
  void boot(config).catch(() => { process.send?.({ type: 'fatal' }); process.exitCode = 1; process.disconnect(); });
});
