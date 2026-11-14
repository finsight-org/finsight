import { createClient } from "@supabase/supabase-js";

export interface VerifiedUser {
  id: string;
  email: string | null;
}
export interface AuthConfig {
  supabaseUrl: string;
  publishableKey: string;
  webOrigins: readonly string[];
}
export type AuthVerification =
  | { status: "authenticated"; user: VerifiedUser; claims?: Readonly<Record<string, unknown>> }
  | { status: "unauthenticated" }
  | { status: "unavailable" };
export type VerifyAccessToken = (token: string) => Promise<AuthVerification>;

function origin(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== value ||
      url.username ||
      url.password ||
      value.includes("*")
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      "Auth URLs must be exact HTTP(S) origins without credentials, paths, or wildcards.",
    );
  }
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig | undefined {
  const values = [
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    env.WEB_ORIGINS,
  ].map((value) => value?.trim() ?? "");
  if (values.every((value) => !value)) return undefined;
  const [url, key, origins] = values;
  if (!url || !key || !origins)
    throw new Error(
      "Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and WEB_ORIGINS together.",
    );
  if (!key.startsWith("sb_publishable_"))
    throw new Error("Auth requires a Supabase publishable key.");
  return {
    supabaseUrl: origin(url),
    publishableKey: key,
    webOrigins: [
      ...new Set(origins.split(",").map((value) => origin(value.trim()))),
    ],
  };
}

// Read claims only after GoTrue verifies the exact token and its live session.
function verifiedClaims(token: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (payload && typeof payload === "object" && !Array.isArray(payload))
      return payload as Record<string, unknown>;
  } catch { /* GoTrue rejects malformed JWTs before this point. */ }
}

export function bearerToken(header: unknown): string | undefined {
  return typeof header === "string" ? /^Bearer ([^\s,]+)$/i.exec(header)?.[1] : undefined;
}

export function createSupabaseVerifier(
  config: AuthConfig,
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): VerifyAccessToken {
  const upstream = options.fetch ?? globalThis.fetch;
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        try {
          return await upstream(input, {
            ...init,
            redirect: "error",
            signal: AbortSignal.any([
              AbortSignal.timeout(options.timeoutMs ?? 5000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
        } catch {
          // Keep fetch diagnostics out of the SDK's network-error logging path.
          return Response.json(
            { message: "Authentication is temporarily unavailable." },
            { status: 503 },
          );
        }
      },
    },
  });
  return async (token) => {
    try {
      const { data, error } = await client.auth.getUser(token);
      if (error)
        return {
          status: [400, 401, 403, 422].includes(error.status ?? 0)
            ? "unauthenticated"
            : "unavailable",
        };
      if (!data.user?.id || data.user.is_anonymous)
        return { status: "unauthenticated" };
      const claims = verifiedClaims(token);
      return {
        ...(claims ? { claims } : {}),
        status: "authenticated",
        user: { id: data.user.id, email: data.user.email ?? null },
      };
    } catch {
      return { status: "unavailable" };
    }
  };
}

export function createSupabaseOAuthVerifier(
  config: AuthConfig,
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): VerifyAccessToken {
  const upstream = options.fetch ?? globalThis.fetch;
  return async token => {
    try {
      const response = await upstream(config.supabaseUrl + "/auth/v1/oauth/userinfo", {
        headers: { apikey: config.publishableKey, Authorization: "Bearer " + token },
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      });
      if ([400, 401, 403, 422].includes(response.status)) return { status: "unauthenticated" };
      if (!response.ok) return { status: "unavailable" };
      const data = await response.json() as { sub?: unknown };
      const claims = verifiedClaims(token);
      if (typeof data?.sub !== "string" || claims?.sub !== data.sub || claims.is_anonymous !== false)
        return { status: "unauthenticated" };
      return { status: "authenticated", user: { id: data.sub, email: null }, claims };
    } catch {
      return { status: "unavailable" };
    }
  };
}

export interface RequestIdentity {
  user: VerifiedUser;
  accessToken: string;
}
export interface AuthOptions {
  auth?: AuthConfig;
  verifyAccessToken?: VerifyAccessToken;
}
export type AuthenticateRequest = (
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
) => Promise<RequestIdentity | undefined>;
export function createRequestAuthenticator(
  options: AuthOptions,
): AuthenticateRequest {
  const verify = options.auth
    ? (options.verifyAccessToken ?? createSupabaseVerifier(options.auth))
    : undefined;
  return async (request, reply) => {
    const fail = (status: number, code: string, message: string) => {
      reply.code(status).send({ error: { code, message } });
      return undefined;
    };
    if (!verify)
      return fail(
        503,
        "AUTH_NOT_CONFIGURED",
        "Authentication is not configured.",
      );
    const token = bearerToken(request.headers.authorization);
    if (!token) return fail(401, "UNAUTHENTICATED", "Authentication required.");
    let result: AuthVerification;
    try {
      result = await verify(token);
    } catch {
      result = { status: "unavailable" };
    }
    if (result.status === "unauthenticated" ||
      (result.status === "authenticated" &&
        (result.claims?.client_id != null || result.claims?.finsight_mcp_read === true)))
      return fail(401, "UNAUTHENTICATED", "Authentication required.");
    if (result.status === "unavailable")
      return fail(
        503,
        "AUTH_UNAVAILABLE",
        "Authentication is temporarily unavailable.",
      );
    return { user: result.user, accessToken: token };
  };
}
