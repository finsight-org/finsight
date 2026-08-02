import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PortfolioRange,
  getPortfolioAccountValues,
  getPortfolioOverview,
  getPortfolioValueHistory,
  portfolioAccountValuesQueryKey,
  portfolioOverviewQueryKey,
  portfolioValueHistoryQueryKey,
} from '@/api/portfolio'
import { apiClient } from '@/api/client'

vi.mock('@/api/client', () => ({
  apiClient: {
    GET: vi.fn(),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}))

const portfolioId = '11111111-1111-1111-1111-111111111111'

describe('portfolio API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses portfolio-aware query keys', () => {
    expect(portfolioOverviewQueryKey(portfolioId)).toEqual(['portfolio', portfolioId, 'overview'])
    expect(portfolioValueHistoryQueryKey(portfolioId, PortfolioRange.Value1Y)).toEqual([
      'portfolio',
      portfolioId,
      'value-history',
      '1Y',
    ])
    expect(portfolioAccountValuesQueryKey(portfolioId)).toEqual(['portfolio', portfolioId, 'account-values'])
  })

  it('requests each valuation view through its scoped endpoint', async () => {
    vi.mocked(apiClient.GET)
      .mockResolvedValueOnce({
        data: { base_currency: 'CAD', total_value: '100.000000000000', valuation_date: '2026-08-02', warnings: [] },
        error: undefined,
        response: new Response(),
      } as never)
      .mockResolvedValueOnce({
        data: { base_currency: 'CAD', range: '1Y', points: [], warnings: [] },
        error: undefined,
        response: new Response(),
      } as never)
      .mockResolvedValueOnce({
        data: { base_currency: 'CAD', valuation_date: '2026-08-02', accounts: [], warnings: [] },
        error: undefined,
        response: new Response(),
      } as never)

    await getPortfolioOverview(portfolioId)
    await getPortfolioValueHistory(portfolioId, PortfolioRange.Value1Y)
    await getPortfolioAccountValues(portfolioId)

    expect(apiClient.GET).toHaveBeenNthCalledWith(1, '/api/portfolios/{portfolio_id}/overview', {
      params: { path: { portfolio_id: portfolioId } },
    })
    expect(apiClient.GET).toHaveBeenNthCalledWith(2, '/api/portfolios/{portfolio_id}/value-history', {
      params: { path: { portfolio_id: portfolioId }, query: { range: '1Y' } },
    })
    expect(apiClient.GET).toHaveBeenNthCalledWith(3, '/api/portfolios/{portfolio_id}/account-values', {
      params: { path: { portfolio_id: portfolioId } },
    })
  })

  it('maps scoped API errors to the overview fallback', async () => {
    vi.mocked(apiClient.GET).mockResolvedValue({
      data: undefined,
      error: { error: { message: 'unavailable' } },
      response: new Response(),
    } as never)

    await expect(getPortfolioOverview(portfolioId)).rejects.toThrow('Could not load portfolio value.')
  })
})
