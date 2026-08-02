import { RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '@/app/providers'
import { router } from '@/app/router'

const meQueryState = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
}))

vi.mock('@/api/me', () => ({
  useMeQuery: () => meQueryState,
}))

describe('AppShell', () => {
  beforeEach(() => {
    meQueryState.isPending = false
    meQueryState.isError = false
    meQueryState.isFetching = false
    meQueryState.error = null
    meQueryState.refetch.mockReset()
  })

  it('hides the shell and route outlet while application context loads', async () => {
    meQueryState.isPending = true

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Loading application context…')
    expect(screen.queryByRole('link', { name: 'FinSight' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Accounts' })).not.toBeInTheDocument()
  })

  it('shows one retryable application-context error', async () => {
    const user = userEvent.setup()
    meQueryState.isError = true
    meQueryState.error = new Error('Context lookup failed')

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Context lookup failed')
    expect(screen.queryByRole('link', { name: 'FinSight' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(meQueryState.refetch).toHaveBeenCalledTimes(1)
  })

  it('renders translated navigation and account menu controls', async () => {
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    )

    expect(await screen.findByRole('link', { name: 'FinSight' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Portfolio' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Accounts' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Imports' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Agents' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search name or symbol')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
  })
})
