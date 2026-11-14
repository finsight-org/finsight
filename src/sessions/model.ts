export interface SessionBinding {
  userId: string;
  connectionId: string;
  providerId: string;
}

export interface EncryptedSessionEnvelope {
  version: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export type DurableSession =
  | { state: "connected"; envelope: EncryptedSessionEnvelope }
  | { state: "expired"; envelope: null };

export type SessionStatus =
  | "disconnected"
  | "mfa_required"
  | "connected"
  | "expired";

const errors = {
  SESSION_NOT_CONFIGURED: [503, "Provider sessions are not configured."],
  SESSION_STORAGE_UNAVAILABLE: [503, "Session storage is temporarily unavailable."],
  SESSION_STATE_UNAVAILABLE: [503, "Session state is temporarily unavailable."],
  SESSION_SERVICE_CLOSED: [503, "Session service is unavailable."],
  CONNECTION_ALREADY_CONNECTED: [409, "Connection is already connected."],
  CONNECTION_PROVIDER_UNSUPPORTED: [409, "Connection provider is unsupported."],
} as const;

export class SessionError extends Error {
  readonly statusCode: number;

  constructor(readonly code: keyof typeof errors) {
    super(errors[code][1]);
    this.statusCode = errors[code][0];
  }
}
