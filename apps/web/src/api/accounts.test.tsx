import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AccountType, accountsQueryKey, useCreateAccountMutation } from '@/api/accounts'
import { apiClient } from '@/api/client'
import { portfolioAccountValuesQueryKey } from '@/api/portfolio'

vi.mock('@/api/client', () => ({
  apiClient: {
    POST: vi.fn(),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}))

describe('useCreateAccountMutation', () => {
  it('invalidates account and portfolio account-value queries after create', async () => {
    vi.mocked(apiClient.POST).mockResolvedValue({
      data: {
        id: '11111111-1111-1111-1111-111111111111',
        portfolio_id: '22222222-2222-2222-2222-222222222222',
        name: 'Margin',
        type: AccountType.BROKERAGE,
        base_currency: 'CAD',
        created_at: '2026-07-08T00:00:00Z',
        updated_at: '2026-07-08T00:00:00Z',
      },
      error: undefined,
      response: new Response(),
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    const { result } = renderHook(() => useCreateAccountMutation(), { wrapper: Wrapper })
    result.current.mutate({
      name: 'Margin',
      type: AccountType.BROKERAGE,
      base_currency: 'CAD',
      institution_name: null,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: accountsQueryKey })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: portfolioAccountValuesQueryKey })
  })
})
