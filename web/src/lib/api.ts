export interface VerifiedUser { id: string; email: string | null }
export class ApiError extends Error {
  constructor(public kind: 'unauthenticated' | 'unavailable') {
    super(kind === 'unauthenticated' ? 'Please sign in again.' : 'Unable to verify your session. Please try again.');
  }
}
export async function getCurrentUser(apiUrl: string, token: string, signal: AbortSignal): Promise<VerifiedUser> {
  try {
    const response = await fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store', signal,
    });
    if (response.status === 401) throw new ApiError('unauthenticated');
    if (!response.ok) throw new ApiError('unavailable');
    const { user } = await response.json();
    if (!user || typeof user.id !== 'string' || !user.id || !(user.email === null || typeof user.email === 'string')) throw new ApiError('unavailable');
    return { id: user.id, email: user.email };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error instanceof ApiError ? error : new ApiError('unavailable');
  }
}
