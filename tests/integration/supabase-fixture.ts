import { once } from "node:events";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TestContext } from "node:test";
import type { AuthConfig } from "../../src/auth.js";
export interface LocalUser {
  id: string;
  accessToken: string;
  client: SupabaseClient;
  signOut(): Promise<void>;
  signIn(): Promise<string>;
}
export async function createLocalFixture(t: TestContext) {
  const url = process.env.FINSIGHT_TEST_SUPABASE_URL;
  const key = process.env.FINSIGHT_TEST_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.FINSIGHT_TEST_SUPABASE_SECRET_KEY;
  if (
    !url ||
    !key ||
    !secret ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
  )
    throw new Error(
      "Configure the three FINSIGHT_TEST_SUPABASE_* variables for local integration tests.",
    );
  const config: AuthConfig = {
    supabaseUrl: url,
    publishableKey: key,
    webOrigins: ["http://127.0.0.1:5173"],
  };
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { retry: false },
  };
  const admin = createClient(url, secret, options);
  const ids: string[] = [];
  t.after(async () => {
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });
  async function user(): Promise<LocalUser> {
    const email = `pr2-${crypto.randomUUID()}@example.test`,
      password = `A!${crypto.randomUUID()}`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user)
      throw new Error("Local test user creation failed.");
    ids.push(created.data.user.id);
    const client = createClient(url!, key!, options);
    const result: LocalUser = {
      id: created.data.user.id,
      accessToken: "",
      client,
      async signIn() {
        const r = await client.auth.signInWithPassword({ email, password });
        if (r.error || !r.data.session)
          throw new Error("Local sign-in failed.");
        result.accessToken = r.data.session.access_token;
        return result.accessToken;
      },
      async signOut() {
        await client.auth.signOut({ scope: "local" });
      },
    };
    await result.signIn();
    return result;
  }
  return {
    config,
    a: await user(),
    b: await user(),
    async seedCreatedAt(ids: string[], timestamp: string) {
      const r = await admin
        .from("provider_connections")
        .update({ created_at: timestamp })
        .in("id", ids);
      if (r.error) throw new Error("Timestamp setup failed.");
    },
  };
}

export async function startCompiledBackend(t: TestContext, config: AuthConfig) {
  const { spawn } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = (reserve.address() as import("node:net").AddressInfo).port;
  await new Promise<void>((r) => reserve.close(() => r()));
  let child: ReturnType<typeof spawn>;
  async function start() {
    child = spawn(process.execPath, ["dist/main.js"], {
      stdio: "ignore",
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        SUPABASE_URL: config.supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
        WEB_ORIGINS: config.webOrigins.join(","),
      },
    });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error("Compiled backend exited.");
      try {
        if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Compiled backend did not become ready.");
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
  t.after(stop);
  await start();
  return {
    url: `http://127.0.0.1:${port}`,
    async restart() {
      await stop();
      await start();
    },
  };
}
