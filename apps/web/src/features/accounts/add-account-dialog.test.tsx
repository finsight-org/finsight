import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { meQueryKey } from '@/api/me'
import { AddAccountDialog } from '@/features/accounts/add-account-dialog'

const accountMutation = vi.hoisted(() => ({
  error: null as Error | null,
  isPending: false,
  mutateAsync: vi.fn(),
}))

vi.mock('@/api/accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/accounts')>()
  return {
    ...actual,
    useCreateAccountMutation: () => accountMutation,
  }
})

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  queryClient.setQueryData(meQueryKey, { default_portfolio_id: '11111111-1111-1111-1111-111111111111' })

  return render(
    <QueryClientProvider client={queryClient}>
      <AddAccountDialog />
    </QueryClientProvider>,
  )
}

describe('AddAccountDialog', () => {
  beforeEach(() => {
    accountMutation.error = null
    accountMutation.isPending = false
    accountMutation.mutateAsync.mockReset()
  })

  it('renders account type options from the generated API enum', async () => {
    const user = userEvent.setup()
    renderWithQueryClient()

    await user.click(screen.getByRole('button', { name: /add an account/i }))
    await user.click(screen.getByRole('combobox', { name: /type/i }))

    expect(await screen.findByRole('option', { name: 'Brokerage' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bank' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Crypto exchange' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Retirement' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Manual' })).toBeInTheDocument()
  })

  it('validates required account fields', async () => {
    const user = userEvent.setup()
    renderWithQueryClient()

    await user.click(screen.getByRole('button', { name: /add an account/i }))
    await user.clear(screen.getByLabelText(/account name/i))
    await user.clear(screen.getByLabelText(/base currency/i))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/account name is required/i)).toBeInTheDocument()
    expect(screen.getByText(/use a 3-letter currency code/i)).toBeInTheDocument()
  })

  it('keeps API errors in the dialog without an unhandled rejection', async () => {
    const user = userEvent.setup()
    const unhandledRejection = vi.fn()
    const handleUnhandledRejection = (event: Event) => {
      event.preventDefault()
      unhandledRejection()
    }
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    accountMutation.mutateAsync.mockRejectedValue(new Error('account name already exists in the default portfolio'))

    try {
      renderWithQueryClient()
      await user.click(screen.getByRole('button', { name: /add an account/i }))
      await user.type(screen.getByLabelText(/account name/i), 'Existing account')
      await user.click(screen.getByRole('button', { name: /create account/i }))

      expect(screen.getByRole('dialog', { name: /add an account/i })).toBeInTheDocument()
      expect(accountMutation.mutateAsync).toHaveBeenCalledOnce()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  })
})
