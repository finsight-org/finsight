import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/api/client'
import { AssetType } from '@/api/generated/finsight'
import { AssetSearch } from '@/components/layout/asset-search'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    apiClient: {
      GET: vi.fn(),
    },
  }
})

function renderAssetSearch() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AssetSearch />
    </QueryClientProvider>,
  )
}

describe('AssetSearch', () => {
  beforeEach(() => {
    vi.mocked(apiClient.GET).mockResolvedValue({ data: { assets: [] }, error: undefined })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('waits for a valid debounced query before searching', async () => {
    renderAssetSearch()
    const input = screen.getByRole('combobox', { name: /search name or symbol/i })

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'A' } })
    await waitForDebounce()

    expect(apiClient.GET).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'AP' } })
    await waitForDebounce()

    await waitFor(() => expect(apiClient.GET).toHaveBeenCalledTimes(1))
    expect(apiClient.GET).toHaveBeenCalledWith('/api/assets/search', {
      params: {
        query: {
          q: 'AP',
          limit: 10,
        },
      },
    })
  })

  it('renders empty results', async () => {
    renderAssetSearch()

    const input = screen.getByRole('combobox', { name: /search name or symbol/i })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ZZ' } })
    await waitForDebounce()

    expect(await screen.findByText(/no assets found/i)).toBeInTheDocument()
  })

  it('renders asset search results', async () => {
    vi.mocked(apiClient.GET).mockResolvedValue({
      data: {
        assets: [
          {
            name: 'Apple Inc.',
            symbol: 'AAPL',
            asset_type: AssetType.EQUITY,
            currency: 'USD',
            provider_id: 'yahoo',
            provider_symbol: 'AAPL',
            exchange: 'NMS',
          },
        ],
      },
      error: undefined,
    })
    renderAssetSearch()

    const input = screen.getByRole('combobox', { name: /search name or symbol/i })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AP' } })
    await waitForDebounce()

    expect(await screen.findByRole('option', { name: /aapl/i })).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
    expect(screen.getByText('NMS')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(screen.getByText('yahoo provider')).toBeInTheDocument()
    expect(screen.getByText('Equity')).toBeInTheDocument()
  })

  it('renders provider errors', async () => {
    vi.mocked(apiClient.GET).mockResolvedValue({
      data: undefined,
      error: {
        error: {
          code: 'asset_provider_unavailable',
          message: 'asset provider is unavailable',
        },
      },
    })
    renderAssetSearch()

    const input = screen.getByRole('combobox', { name: /search name or symbol/i })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AP' } })
    await waitForDebounce()

    expect(await screen.findByText(/asset provider is unavailable/i)).toBeInTheDocument()
  })

  it('updates the visible input when a result is selected', async () => {
    vi.mocked(apiClient.GET).mockResolvedValue({
      data: {
        assets: [
          {
            name: 'Apple Inc.',
            symbol: 'AAPL',
            asset_type: AssetType.EQUITY,
            currency: 'USD',
            provider_id: 'yahoo',
            provider_symbol: 'AAPL',
            exchange: 'NMS',
          },
        ],
      },
      error: undefined,
    })
    renderAssetSearch()

    const input = screen.getByRole('combobox', { name: /search name or symbol/i })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AP' } })
    await waitForDebounce()
    fireEvent.click(await screen.findByRole('option', { name: /aapl/i }))

    expect(input).toHaveValue('AAPL')
  })
})

async function waitForDebounce() {
  await new Promise((resolve) => window.setTimeout(resolve, 350))
}
