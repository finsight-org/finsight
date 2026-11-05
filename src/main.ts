import { createApp } from './app.js';
import { wealthsimpleProvider } from './providers/wealthsimple/index.js';
import { readAuthConfig } from './auth.js';
import { readSessionConfig } from './sessions/config.js';
import { createSessionCipher } from './sessions/crypto.js';
import { createSupabaseSessionStore } from './sessions/supabase-store.js';
import { WealthsimpleSessionService } from './sessions/wealthsimple-service.js';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const auth = readAuthConfig(process.env);
const sessionConfig = await readSessionConfig(process.env, Boolean(auth));
const connectionSessions = sessionConfig && auth ? new WealthsimpleSessionService({
  cipher: createSessionCipher(sessionConfig.encryptionKey),
  store: createSupabaseSessionStore({ supabaseUrl: auth.supabaseUrl, secretKey: sessionConfig.supabaseSecretKey }),
}) : undefined;
const app = createApp([wealthsimpleProvider()], { auth, connectionSessions });

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
