import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { PortfolioPage } from '@/features/portfolio/portfolio-page'

const portfolioState = vi.hoisted(() => ({
  portfolioId: '33333333-3333-3333-3333-333333333333',
  overview: {
    data: {
      base_currency: 'CAD',
      total_value: '79720.000000000000',
      valuation_date: '2026-07-08',
      warnings: [],
    },
    isLoading: false,
    error: null as Error | null,
  },
  history: {
    data: {
      base_currency: 'CAD',
      range: '1Y' as const,
      points: [
        { date: '2026-07-06', value: '78000.000000000000' },
        { date: '2026-07-07', value: '79720.000000000000' },
      ],
      warnings: [],
    },
    isLoading: false,
    error: null as Error | null,
  },
  accountValues: {
    data: {
      base_currency: 'CAD',
      valuation_date: '2026-07-08',
      accounts: [
        {
          account_id: '11111111-1111-1111-1111-111111111111',
          account_name: 'Wealthsimple TFSA',
          value: '53220.000000000000',
          allocation_percent: '66.758655293527',
        },
        {
          account_id: '22222222-2222-2222-2222-222222222222',
          account_name: 'Questrade Margin',
          value: '26500.000000000000',
          allocation_percent: '33.241344706473',
        },
      ],
      warnings: [],
    },
    isLoading: false,
    error: null as Error | null,
  },
}))

const portfolioHooks = vi.hoisted(() => ({
  usePortfolioOverviewQuery: vi.fn(() => portfolioState.overview),
  usePortfolioValueHistoryQuery: vi.fn(() => portfolioState.history),
  usePortfolioAccountValuesQuery: vi.fn(() => portfolioState.accountValues),
}))

vi.mock('@/api/portfolio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/portfolio')>()
  return {
    ...actual,
    ...portfolioHooks,
  }
})

vi.mock('@/api/me', () => ({
  useMeQuery: () => ({ data: { default_portfolio_id: portfolioState.portfolioId } }),
}))

describe('PortfolioPage', () => {
  beforeEach(() => {
    portfolioState.overview.isLoading = false
    portfolioState.overview.error = null
    portfolioState.history.isLoading = false
    portfolioState.history.error = null
    portfolioState.accountValues.isLoading = false
    portfolioState.accountValues.error = null
    portfolioHooks.usePortfolioOverviewQuery.mockClear()
    portfolioHooks.usePortfolioValueHistoryQuery.mockClear()
    portfolioHooks.usePortfolioAccountValuesQuery.mockClear()
  })

  it('renders API-backed portfolio value, chart, and account values', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PortfolioPage />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: /\$79,720.00/i })).toBeInTheDocument()
    expect(screen.getByText(/jul 8, 2026/i)).toBeInTheDocument()
    expect(screen.getByTestId('portfolio-chart')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /wealthsimple tfsa/i })).toBeInTheDocument()
    expect(screen.getByText(/\$53,220.00/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /questrade margin/i })).toBeInTheDocument()
    expect(portfolioHooks.usePortfolioOverviewQuery).toHaveBeenCalledWith(portfolioState.portfolioId)
    expect(portfolioHooks.usePortfolioValueHistoryQuery).toHaveBeenCalledWith(portfolioState.portfolioId, '1Y')
    expect(portfolioHooks.usePortfolioAccountValuesQuery).toHaveBeenCalledWith(portfolioState.portfolioId)
  })

  it('renders independent loading and error states', () => {
    portfolioState.overview.isLoading = true
    portfolioState.history.error = new Error('History failed')
    portfolioState.accountValues.error = new Error('Accounts failed')
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PortfolioPage />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText(/history failed/i)).toBeInTheDocument()
    expect(screen.getByText(/accounts failed/i)).toBeInTheDocument()
  })
})
