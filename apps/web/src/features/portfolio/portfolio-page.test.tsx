import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { PortfolioPage } from '@/features/portfolio/portfolio-page'

const portfolioState = vi.hoisted(() => ({
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

vi.mock('@/api/portfolio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/portfolio')>()
  return {
    ...actual,
    usePortfolioOverviewQuery: () => portfolioState.overview,
    usePortfolioValueHistoryQuery: () => portfolioState.history,
    usePortfolioAccountValuesQuery: () => portfolioState.accountValues,
  }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
  }) => <a href={params?.accountId ? to.replace('$accountId', params.accountId) : to} {...props}>{children}</a>,
}))

describe('PortfolioPage', () => {
  beforeEach(() => {
    portfolioState.overview.isLoading = false
    portfolioState.overview.error = null
    portfolioState.history.isLoading = false
    portfolioState.history.error = null
    portfolioState.accountValues.isLoading = false
    portfolioState.accountValues.error = null
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
    expect(screen.getByRole('link', { name: /wealthsimple tfsa/i })).toHaveAttribute(
      'href',
      '/accounts/11111111-1111-1111-1111-111111111111',
    )
    expect(screen.getByText(/\$53,220.00/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /questrade margin/i })).toBeInTheDocument()
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
