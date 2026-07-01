import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AddAccountDialog } from '@/features/accounts/add-account-dialog'

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AddAccountDialog />
    </QueryClientProvider>,
  )
}

describe('AddAccountDialog', () => {
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
})
