import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticateRequest, RequestIdentity } from "../auth.js";
import type { Provider } from "../providers.js";
import {
  ConnectionError,
  parseConnectionId,
  parseCreateInput,
  parseListInput,
  parseRenameInput,
} from "./model.js";
import type { ConnectionStore, ConnectionStoreFactory } from "./store.js";
import { ownedSessionAccess, withConnectionCancellation } from "./session-routes.js";
import type { WealthsimpleSessionService } from "../sessions/wealthsimple-service.js";
import { SessionError } from "../sessions/model.js";
export function registerConnectionRoutes(
  app: FastifyInstance,
  options: {
    authenticate: AuthenticateRequest;
    registry: readonly Provider[];
    createStore?: ConnectionStoreFactory;
    sessions?: WealthsimpleSessionService;
  },
): void {
  app.register(async (routes) => {
    const providerIds = new Set(options.registry.map((p) => p.metadata.id));
    routes.setErrorHandler((error, _req, reply) => {
      const status =
        error && typeof error === "object" && "statusCode" in error
          ? Number(error.statusCode)
          : 500;
      const safe =
        error instanceof ConnectionError || error instanceof SessionError
          ? error
          : new ConnectionError(
              [400, 413, 415].includes(status)
                ? "CONNECTION_INPUT_INVALID"
                : "CONNECTION_STORAGE_UNAVAILABLE",
            );
      reply
        .code([413, 415].includes(status) ? status : safe.statusCode)
        .send({ error: { code: safe.code, message: safe.message } });
    });
    const collection = {
      browserApi: true as const,
      browserMethods: ["GET", "POST"],
      browserHeaders: ["Authorization", "Content-Type"],
    };
    const item = { ...collection, browserMethods: ["GET", "PATCH", "DELETE"] };
    async function handle(
      request: FastifyRequest,
      reply: FastifyReply,
      work: (store: () => ConnectionStore, identity: RequestIdentity, signal: AbortSignal) => Promise<unknown>,
    ) {
      return withConnectionCancellation(request, reply, async signal => {
        const identity = await options.authenticate(request, reply);
        if (!identity || signal.aborted || request.raw.aborted || reply.raw.destroyed) return;
        return work(() => {
          if (!options.createStore) throw new ConnectionError("CONNECTION_STORAGE_UNAVAILABLE");
          return options.createStore(identity, signal);
        }, identity, signal);
      });
    }

    const id = (request: FastifyRequest) =>
      parseConnectionId(
        (request.params as { connectionId: unknown }).connectionId,
      );
    for (const [url, config] of [
      ["/api/connections", collection],
      ["/api/connections/:connectionId", item],
    ] as const)
      routes.options(url, { config }, async (_req, reply) =>
        reply.code(204).send(),
      );
    routes.post(
      "/api/connections",
      { config: collection, bodyLimit: 16 * 1024 },
      async (req, reply) =>
        handle(req, reply, async (store) => {
          const input = parseCreateInput(req.body, providerIds),
            connection = await store().create(input);
          return reply
            .code(201)
            .header("Location", `/api/connections/${connection.id}`)
            .send({ connection });
        }),
    );
    routes.get(
      "/api/connections",
      { config: collection, exposeHeadRoute: false },
      async (req, reply) =>
        handle(req, reply, async (store) => {
          const input = parseListInput(req.query);
          return store().list(input);
        }),
    );
    routes.get(
      "/api/connections/:connectionId",
      { config: item, exposeHeadRoute: false },
      async (req, reply) =>
        handle(req, reply, async (store) => {
          const key = id(req),
            connection = await store().get(key);
          if (!connection) throw new ConnectionError("CONNECTION_NOT_FOUND");
          return { connection };
        }),
    );
    routes.patch(
      "/api/connections/:connectionId",
      { config: item, bodyLimit: 16 * 1024 },
      async (req, reply) =>
        handle(req, reply, async (store) => {
          const key = id(req),
            input = parseRenameInput(req.body),
            connection = await store().rename(key, input.label);
          if (!connection) throw new ConnectionError("CONNECTION_NOT_FOUND");
          return { connection };
        }),
    );
    routes.delete(
      "/api/connections/:connectionId",
      { config: item },
      async (req, reply) =>
        handle(req, reply, async (store, identity, signal) => {
          const key = id(req);
          let removed: boolean;
          if (options.sessions) {
            const access = await ownedSessionAccess(key, identity, options.createStore, signal);
            removed = await options.sessions.removeRecord(access,
              () => store().remove(access.binding.connectionId), signal);
          } else {
            removed = await store().remove(key);
          }
          if (!removed)
            throw new ConnectionError("CONNECTION_NOT_FOUND");
          return reply.code(204).send();
        }),
    );
  });
}
