import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getMe, meQueryKey, meQueryOptions } from '@/api/me'
import { apiClient } from '@/api/client'

vi.mock('@/api/client', () => ({
  apiClient: {
    GET: vi.fn(),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}))

describe('getMe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the local default portfolio context', async () => {
    const response = { default_portfolio_id: '11111111-1111-1111-1111-111111111111' }
    vi.mocked(apiClient.GET).mockResolvedValue({ data: response, error: undefined, response: new Response() })

    await expect(getMe()).resolves.toEqual(response)
    expect(meQueryOptions().queryKey).toEqual(meQueryKey)
  })

  it('maps API errors to the application-context fallback', async () => {
    vi.mocked(apiClient.GET).mockResolvedValue({ data: undefined, error: { error: { message: 'unavailable' } }, response: new Response() })

    await expect(getMe()).rejects.toThrow('Could not load the application context.')
  })

  it('rejects an empty successful response', async () => {
    vi.mocked(apiClient.GET).mockResolvedValue({ data: undefined, error: undefined, response: new Response() })

    await expect(getMe()).rejects.toThrow('The application context API returned no data.')
  })
})
