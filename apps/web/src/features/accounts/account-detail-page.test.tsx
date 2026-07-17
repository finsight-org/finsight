import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/api/accounts'
import { AccountDetailPage } from '@/features/accounts/account-detail-page'

const accountState = vi.hoisted(() => ({
  assetSearchQuery: vi.fn(),
  deleteTransaction: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  resetMutation: vi.fn(),
  account: {
    data: {
      id: '11111111-1111-1111-1111-111111111111',
      portfolio_id: '22222222-2222-2222-2222-222222222222',
      name: 'Wealthsimple',
      institution_name: 'Wealthsimple',
      type: 'BROKERAGE',
      base_currency: 'CAD',
      external_reference: null,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    } as Account | undefined,
    isLoading: false,
    isSuccess: true,
    error: null as Error | null,
  },
  transactions: {
    data: [
      {
        id: '33333333-3333-3333-3333-333333333333',
        account_id: '11111111-1111-1111-1111-111111111111',
        type: 'BUY',
        trade_date: '2026-07-08',
        settlement_date: null,
        description: 'Buy CRCL',
        asset: {
          id: '44444444-4444-4444-4444-444444444444',
          name: 'Circle Internet Group Inc.',
          symbol: 'CRCL',
          asset_type: 'EQUITY',
          currency: 'CAD',
          provider_id: 'manual',
          provider_symbol: 'crcl',
          exchange: null,
        },
        quantity: '2.000000000000',
        price: '10.000000000000',
        fees: '1.250000000000',
        cash_impact: '-21.250000000000',
        currency: 'CAD',
        source: 'MANUAL',
        status: 'CONFIRMED',
        editable: true,
        ledger_entries: [],
        created_at: '2026-07-08T00:00:00Z',
        updated_at: '2026-07-08T00:00:00Z',
      },
    ],
    isLoading: false,
    error: null as Error | null,
  },
  positions: {
    data: [
      {
        asset: {
          id: '44444444-4444-4444-4444-444444444444',
          name: 'Circle Internet Group Inc.',
          symbol: 'CRCL',
          asset_type: 'EQUITY',
          currency: 'CAD',
          provider_id: 'manual',
          provider_symbol: 'crcl',
          exchange: null,
        },
        quantity: '2.000000000000',
        market_value: null,
        currency: 'CAD',
        warnings: [],
      },
    ],
    isLoading: false,
    error: null as Error | null,
  },
  cash: {
    data: [{ currency: 'CAD', balance: '978.750000000000' }],
    isLoading: false,
    error: null as Error | null,
  },
}))

const baseTransaction = accountState.transactions.data[0]
const baseAccount = accountState.account.data
const basePosition = accountState.positions.data[0]
const baseCashBalance = accountState.cash.data[0]

vi.mock('@/api/accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/accounts')>()
  return {
    ...actual,
    useAccountQuery: () => accountState.account,
    useAccountTransactionsQuery: () => accountState.transactions,
    useAccountPositionsQuery: () => accountState.positions,
    useAccountCashBalancesQuery: () => accountState.cash,
    useCreateAccountTransactionMutation: () => ({
      mutateAsync: accountState.createTransaction,
      isPending: false,
      error: null,
      reset: accountState.resetMutation,
    }),
    useUpdateAccountTransactionMutation: () => ({
      mutateAsync: accountState.updateTransaction,
      isPending: false,
      error: null,
      reset: accountState.resetMutation,
    }),
    useDeleteAccountTransactionMutation: () => ({
      mutateAsync: accountState.deleteTransaction,
      isPending: false,
      error: null,
      reset: accountState.resetMutation,
    }),
  }
})

vi.mock('@/api/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/assets')>()
  return {
    ...actual,
    useAssetSearchQuery: accountState.assetSearchQuery,
  }
})

describe('AccountDetailPage', () => {
  beforeEach(() => {
    accountState.assetSearchQuery.mockReset()
    accountState.assetSearchQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    })
    accountState.deleteTransaction.mockReset()
    accountState.createTransaction.mockReset()
    accountState.updateTransaction.mockReset()
    accountState.resetMutation.mockReset()
    accountState.account.data = baseAccount
    accountState.account.isLoading = false
    accountState.account.isSuccess = true
    accountState.account.error = null
    accountState.transactions.data = [{ ...baseTransaction, asset: { ...baseTransaction.asset }, ledger_entries: [] }]
    accountState.transactions.isLoading = false
    accountState.transactions.error = null
    accountState.positions.data = [{ ...basePosition, asset: { ...basePosition.asset }, warnings: [] }]
    accountState.positions.isLoading = false
    accountState.positions.error = null
    accountState.cash.data = [{ ...baseCashBalance }]
    accountState.cash.isLoading = false
    accountState.cash.error = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders account metadata and transactions', () => {
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    expect(screen.getByRole('heading', { name: 'Wealthsimple' })).toBeInTheDocument()
    expect(screen.getByText(/positions and cash are calculated/i)).toBeInTheDocument()
    expect(screen.getByText('Buy CRCL')).toBeInTheDocument()
    expect(screen.getByText(/CRCL - Circle Internet Group Inc./)).toBeInTheDocument()
    expect(screen.getByText('-$21.25')).toBeInTheDocument()
  })

  it('shows only the account error when the account cannot load', () => {
    accountState.account.data = undefined
    accountState.account.isSuccess = false
    accountState.account.error = new Error('Account not found')

    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    expect(screen.getByText('Account not found')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add transaction/i })).not.toBeInTheDocument()
  })

  it('renders empty states for transactions, positions, and cash', async () => {
    accountState.transactions.data = []
    accountState.positions.data = []
    accountState.cash.data = []
    const user = userEvent.setup()

    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /positions/i }))
    expect(screen.getByText(/no positions yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /^cash$/i }))
    expect(screen.getByText(/no cash balances yet/i)).toBeInTheDocument()
  })

  it('validates required fields in the create dialog', async () => {
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    await user.clear(screen.getByLabelText(/trade date/i))
    await user.click(screen.getByRole('button', { name: /save transaction/i }))

    expect(await screen.findByText(/check required fields/i)).toBeInTheDocument()
    expect(accountState.createTransaction).not.toHaveBeenCalled()
  })

  it('keeps the ledger preview stable while currency input is partial', async () => {
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    await user.clear(screen.getByLabelText(/currency/i))
    await user.type(screen.getByLabelText(/currency/i), 'C')

    expect(screen.getByText(/cash impact -?0\.00 C/i)).toBeInTheDocument()
  })

  it('keeps the selected asset and transaction currencies coherent', async () => {
    accountState.assetSearchQuery.mockReturnValue({
      data: [
        {
          name: 'Circle Internet Group Inc.',
          symbol: 'CRCL',
          asset_type: 'EQUITY',
          currency: 'USD',
          provider_id: 'yahoo',
          provider_symbol: 'CRCL',
          exchange: 'NYSE',
        },
      ],
      isLoading: false,
      error: null,
    })
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    await user.type(screen.getByLabelText(/asset/i), 'CR')
    await user.click(screen.getByRole('button', { name: /CRCL - Circle Internet Group/i }))

    expect(screen.getByLabelText(/currency/i)).toHaveValue('USD')
    expect(screen.getByText(/selected: CRCL/i)).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/currency/i))
    await user.type(screen.getByLabelText(/currency/i), 'CAD')
    expect(screen.queryByText(/selected: CRCL/i)).not.toBeInTheDocument()
  })

  it('rejects computed ledger values outside database precision', async () => {
    accountState.assetSearchQuery.mockReturnValue({
      data: [
        {
          name: 'Circle Internet Group Inc.',
          symbol: 'CRCL',
          asset_type: 'EQUITY',
          currency: 'CAD',
          provider_id: 'yahoo',
          provider_symbol: 'CRCL',
          exchange: 'NYSE',
        },
      ],
      isLoading: false,
      error: null,
    })
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    await user.type(screen.getByLabelText(/asset/i), 'CR')
    await user.click(screen.getByRole('button', { name: /CRCL - Circle Internet Group/i }))
    await user.type(screen.getByLabelText(/quantity/i), '99999999999999999999999999')
    await user.type(screen.getByLabelText(/price/i), '10')
    await user.click(screen.getByRole('button', { name: /save transaction/i }))

    expect(await screen.findByText(/check required fields/i)).toBeInTheDocument()
    expect(accountState.createTransaction).not.toHaveBeenCalled()
  })

  it('does not enable asset search for closed edit dialogs', async () => {
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    expect(accountState.assetSearchQuery).toHaveBeenCalledWith('CRCL', 10, false)
    expect(accountState.assetSearchQuery).not.toHaveBeenCalledWith('CRCL', 10, true)

    await user.click(screen.getByRole('button', { name: /edit/i }))

    expect(accountState.assetSearchQuery).toHaveBeenCalledWith('CRCL', 10, true)
  })

  it('defaults new transactions to the local calendar date', async () => {
    vi.useFakeTimers({ now: new Date(2026, 6, 14, 22, 30) })
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))

    expect(screen.getByLabelText(/trade date/i)).toHaveValue('2026-07-14')
  })

  it('rehydrates edit dialogs from the transaction when reopened after save', async () => {
    accountState.updateTransaction.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText(/^description$/i))
    await user.type(screen.getByLabelText(/^description$/i), 'Edited description')
    await user.click(screen.getByRole('button', { name: /save transaction/i }))

    await waitFor(() => expect(accountState.updateTransaction).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /edit/i }))

    expect(screen.getByLabelText(/^description$/i)).toHaveValue('Buy CRCL')
  })

  it('preserves large decimal amount strings when editing cash transactions', async () => {
    accountState.transactions.data = [
      {
        ...baseTransaction,
        type: 'DEPOSIT',
        description: 'Large cash deposit',
        asset: undefined,
        quantity: null,
        price: null,
        fees: null,
        cash_impact: '12345678901234567890.123400000000',
        ledger_entries: [],
      } as unknown as typeof baseTransaction,
    ] as unknown as typeof accountState.transactions.data
    accountState.updateTransaction.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText(/^description$/i))
    await user.type(screen.getByLabelText(/^description$/i), 'Updated deposit')
    await user.click(screen.getByRole('button', { name: /save transaction/i }))

    await waitFor(() =>
      expect(accountState.updateTransaction).toHaveBeenCalledWith({
        transactionId: '33333333-3333-3333-3333-333333333333',
        body: expect.objectContaining({
          amount: '12345678901234567890.1234',
          description: 'Updated deposit',
        }),
      }),
    )
  })

  it('uses server-provided editability for transaction actions', () => {
    accountState.transactions.data = [
      { ...baseTransaction, asset: { ...baseTransaction.asset }, ledger_entries: [] },
      {
        ...baseTransaction,
        id: '55555555-5555-5555-5555-555555555555',
        description: 'Read-only opening balance',
        source: 'MANUAL',
        editable: false,
        ledger_entries: [],
      },
    ] as unknown as typeof accountState.transactions.data

    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    expect(screen.getByText('Read-only opening balance')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(1)
  })

  it('deletes a transaction after confirmation', async () => {
    accountState.deleteTransaction.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(accountState.deleteTransaction).toHaveBeenCalledWith('33333333-3333-3333-3333-333333333333'))
  })

  it('switches to filtered transactions from a position', async () => {
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('tab', { name: /positions/i }))
    await user.click(screen.getByRole('button', { name: /view transactions/i }))

    expect(screen.getByRole('tab', { name: /transactions/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/transactions are filtered/i)).toBeInTheDocument()
    expect(screen.getByText('Buy CRCL')).toBeInTheDocument()
  })

  it('switches to transactions affecting a cash currency', async () => {
    accountState.transactions.data = [
      {
        ...baseTransaction,
        ledger_entries: [
          {
            id: '66666666-6666-6666-6666-666666666666',
            entry_type: 'CASH_BALANCE',
            asset: {
              id: '77777777-7777-7777-7777-777777777777',
              name: 'Canadian Dollar',
              symbol: 'CAD',
              asset_type: 'CASH',
              currency: 'CAD',
              provider_id: 'system',
              provider_symbol: 'CAD',
              exchange: null,
            },
            quantity: '0',
            amount: '-21.25',
            currency: 'CAD',
            direction: 'CREDIT',
          },
        ],
      },
    ] as unknown as typeof accountState.transactions.data
    const user = userEvent.setup()
    render(<AccountDetailPage accountId="11111111-1111-1111-1111-111111111111" />)

    await user.click(screen.getByRole('tab', { name: /^cash$/i }))
    await user.click(screen.getByRole('button', { name: /view transactions/i }))

    expect(screen.getByText(/filtered to CAD cash activity/i)).toBeInTheDocument()
    expect(screen.getByText('Buy CRCL')).toBeInTheDocument()
  })
})
