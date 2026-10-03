const messages = {
  INVALID_REQUEST: 'Invalid Wealthsimple connection request.',
  INVALID_PAGINATION: 'Wealthsimple account page size must be between 1 and 100.',
  LOGIN_FAILED: 'Wealthsimple login failed. Check your credentials and OTP.',
  CONNECTION_CONFLICT: 'The connection or pending attempt changed. Disconnect or start a new attempt.',
  NOT_CONNECTED: 'Connect to Wealthsimple before requesting accounts.',
  RECONNECT_REQUIRED: 'The Wealthsimple session expired. Connect again.',
  RATE_LIMITED: 'Wealthsimple is limiting requests. Try again later.',
  TIMEOUT: 'The Wealthsimple request timed out.',
  CANCELLED: 'The Wealthsimple request was cancelled.',
  INVALID_RESPONSE: 'Wealthsimple returned an unexpected response. Its API may have changed.',
  UPSTREAM_FAILURE: 'Wealthsimple could not complete the request.',
} as const;

export type ErrorCode = keyof typeof messages;

/** Safe provider errors; public HTTP/GraphQL formatting belongs to the adapter. */
export class WealthsimpleError extends Error {
  readonly code: string;
  constructor(readonly kind: ErrorCode) {
    super(messages[kind]);
    this.code = `WEALTHSIMPLE_${kind}`;
  }
}

export class RequestAborted extends WealthsimpleError {
  constructor(reason: unknown) {
    super(reason instanceof Error && reason.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED');
  }
}

/** Internal protocol outcomes, handled by the client before reaching the adapter. */
export class Unauthorized extends Error {}
export class OTPRequired extends Error {}
