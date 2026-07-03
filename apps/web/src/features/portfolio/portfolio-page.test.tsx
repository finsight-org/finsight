import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { PortfolioPage } from '@/features/portfolio/portfolio-page'

vi.mock('@/api/accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/accounts')>()
  return {
    ...actual,
    useAccountsQuery: () => ({
      data: [],
      isLoading: false,
      error: null,
    }),
  }
})

describe('PortfolioPage', () => {
  it('renders portfolio summary and account empty state', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PortfolioPage />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: /\$2,000.00 CAD/i })).toBeInTheDocument()
    expect(screen.getByTestId('portfolio-chart')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /no accounts yet/i })).toBeInTheDocument()
  })
})
