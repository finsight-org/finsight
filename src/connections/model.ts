import { z } from "zod";
export interface ConnectionRecord {
  id: string;
  providerId: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ConnectionCursor {
  createdAt: string;
  id: string;
}
export interface CreateConnectionInput {
  providerId: string;
  label: string | null;
}
export interface ListConnectionsInput {
  limit: number;
  after: ConnectionCursor | null;
}
export interface ConnectionPage {
  connections: ConnectionRecord[];
  nextCursor: string | null;
}
const errors = {
  CONNECTION_INPUT_INVALID: [400, "Invalid connection request."],
  UNAUTHENTICATED: [401, "Authentication required."],
  CONNECTION_NOT_FOUND: [404, "Connection not found."],
  CONNECTION_STORAGE_UNAVAILABLE: [
    503,
    "Connection storage is temporarily unavailable.",
  ],
} as const;
export class ConnectionError extends Error {
  readonly statusCode: number;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code][1]);
    this.statusCode = errors[code][0];
  }
}
const invalid = () => new ConnectionError("CONNECTION_INPUT_INVALID");
const uuid = z.uuid();
const timestamp = z.iso
  .datetime({ offset: true })
  .refine((v) => /(Z|\+00:00)$/.test(v));
const provider = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw invalid();
  return r.data;
}
function label(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.includes("\0")) throw invalid();
  const normalized = value.trim();
  if ([...normalized].length > 100) throw invalid();
  return normalized || null;
}
export function parseCreateInput(
  value: unknown,
  providerIds: ReadonlySet<string>,
): CreateConnectionInput {
  const v = parse(
    z.strictObject({ providerId: provider, label: z.unknown().optional() }),
    value,
  );
  if (!providerIds.has(v.providerId)) throw invalid();
  return { providerId: v.providerId, label: label(v.label) };
}
export function parseRenameInput(value: unknown): { label: string | null } {
  const v = parse(z.strictObject({ label: z.unknown() }), value);
  if (!Object.hasOwn(v, "label")) throw invalid();
  return { label: label(v.label) };
}
export function parseConnectionId(value: unknown): string {
  return parse(uuid, value);
}
const cursorSchema = z.strictObject({ createdAt: timestamp, id: uuid });
export function encodeConnectionCursor(value: ConnectionCursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function parseListInput(value: unknown): ListConnectionsInput {
  const v = parse(
    z.strictObject({
      limit: z
        .string()
        .regex(/^[0-9]+$/)
        .optional(),
      cursor: z
        .string()
        .max(512)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
    }),
    value,
  );
  const limit = v.limit === undefined ? 50 : Number(v.limit);
  if (limit < 1 || limit > 100) throw invalid();
  let after: ConnectionCursor | null = null;
  if (v.cursor) {
    try {
      after = parse(
        cursorSchema,
        JSON.parse(Buffer.from(v.cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw invalid();
    }
  }
  return { limit, after };
}
const rowSchema = z.object({
  id: uuid,
  user_id: uuid,
  provider_id: provider,
  label: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export function mapConnectionRow(
  value: unknown,
  ownerId: string,
): ConnectionRecord {
  const r = rowSchema.safeParse(value);
  if (
    !r.success ||
    r.data.user_id !== ownerId ||
    (r.data.label !== null &&
      (!r.data.label.trim() || [...r.data.label].length > 100))
  )
    throw new ConnectionError("CONNECTION_STORAGE_UNAVAILABLE");
  const v = r.data;
  return {
    id: v.id,
    providerId: v.provider_id,
    label: v.label,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  };
}
