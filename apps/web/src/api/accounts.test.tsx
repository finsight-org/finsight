import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AccountTransactionRequestType,
  AccountTransactionType,
  AccountType,
  accountCashBalancesQueryKey,
  accountPositionsQueryKey,
  accountTransactionsQueryKey,
  accountsQueryKey,
  useCreateAccountMutation,
  useCreateAccountTransactionMutation,
} from '@/api/accounts'
import { apiClient } from '@/api/client'
import { portfolioAccountValuesQueryKey, portfolioOverviewQueryKey, portfolioValueHistoryQueryRootKey } from '@/api/portfolio'

vi.mock('@/api/client', () => ({
  apiClient: {
    POST: vi.fn(),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useCreateAccountMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useCreateAccountMutation(), { wrapper: createWrapper(queryClient) })
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

  it('invalidates account detail and portfolio value queries after transaction create', async () => {
    const accountId = '11111111-1111-1111-1111-111111111111'
    vi.mocked(apiClient.POST).mockResolvedValue({
      data: {
        id: '33333333-3333-3333-3333-333333333333',
        account_id: accountId,
        type: AccountTransactionType.DEPOSIT,
        trade_date: '2026-07-14',
        settlement_date: null,
        description: 'Deposit',
        quantity: null,
        price: null,
        fees: null,
        cash_impact: '100.000000000000',
        currency: 'CAD',
        source: 'MANUAL',
        status: 'CONFIRMED',
        ledger_entries: [],
        created_at: '2026-07-14T00:00:00Z',
        updated_at: '2026-07-14T00:00:00Z',
      },
      error: undefined,
      response: new Response(),
    })
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useCreateAccountTransactionMutation(accountId), { wrapper: createWrapper(queryClient) })
    result.current.mutate({
      type: AccountTransactionRequestType.DEPOSIT,
      trade_date: '2026-07-14',
      description: 'Deposit',
      currency: 'CAD',
      amount: '100',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: accountTransactionsQueryKey(accountId) })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: accountPositionsQueryKey(accountId) })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: accountCashBalancesQueryKey(accountId) })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: portfolioOverviewQueryKey })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: portfolioValueHistoryQueryRootKey })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: portfolioAccountValuesQueryKey })
  })
})
