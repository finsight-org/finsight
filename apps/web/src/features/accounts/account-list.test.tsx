import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Account } from '@/api/accounts'
import { AccountList } from '@/features/accounts/account-list'

const account: Account = {
  id: '11111111-1111-1111-1111-111111111111',
  portfolio_id: '22222222-2222-2222-2222-222222222222',
  name: 'Wealthsimple',
  institution_name: 'Wealthsimple',
  type: 'BROKERAGE',
  base_currency: 'CAD',
  external_reference: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

describe('AccountList', () => {
  it('renders the empty state', () => {
    render(<AccountList accounts={[]} />)

    expect(screen.getByRole('heading', { name: /no accounts yet/i })).toBeInTheDocument()
  })

  it('renders account rows from API data', () => {
    render(<AccountList accounts={[account]} />)

    expect(screen.getByRole('heading', { name: 'Wealthsimple' })).toBeInTheDocument()
    expect(screen.getByText(/CAD/)).toBeInTheDocument()
    expect(screen.getByText(/Value pending/i)).toBeInTheDocument()
  })
})
