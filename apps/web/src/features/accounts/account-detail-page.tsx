import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AccountTransactionRequestType,
  accountTransactionTypes,
  useAccountCashBalancesQuery,
  useAccountPositionsQuery,
  useAccountQuery,
  useAccountTransactionsQuery,
  useCreateAccountTransactionMutation,
  useDeleteAccountTransactionMutation,
  useUpdateAccountTransactionMutation,
  type AccountCashBalance,
  type AccountPosition,
  type AccountTransaction,
  type AccountTransactionAssetInput,
  type AccountTransactionRequest,
} from '@/api/accounts'
import { useAssetSearchQuery, type AssetSearchResult } from '@/api/assets'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type TransactionFormValues = {
  type: AccountTransactionRequest['type']
  tradeDate: string
  settlementDate: string
  description: string
  currency: string
  asset: AccountTransactionAssetInput | null
  assetSearch: string
  quantity: string
  price: string
  amount: string
  fees: string
}

const assetRequiredTypes = new Set<AccountTransactionRequest['type']>([
  AccountTransactionRequestType.BUY,
  AccountTransactionRequestType.SELL,
  AccountTransactionRequestType.DIVIDEND,
])
const quantityPriceTypes = new Set<AccountTransactionRequest['type']>([AccountTransactionRequestType.BUY, AccountTransactionRequestType.SELL])
const amountTypes = new Set<AccountTransactionRequest['type']>([
  AccountTransactionRequestType.DIVIDEND,
  AccountTransactionRequestType.DEPOSIT,
  AccountTransactionRequestType.WITHDRAWAL,
  AccountTransactionRequestType.FEE,
  AccountTransactionRequestType.INTEREST,
])

export function AccountDetailPage({ accountId }: { accountId: string }) {
	const { t } = useTranslation()
	const accountQuery = useAccountQuery(accountId)
	const transactionsQuery = useAccountTransactionsQuery(accountId)
	const positionsQuery = useAccountPositionsQuery(accountId)
	const cashQuery = useAccountCashBalancesQuery(accountId)
	const [activeTab, setActiveTab] = useState('transactions')
	const [assetFilter, setAssetFilter] = useState<string | null>(null)
	const transactions = transactionsQuery.data ?? []
	const filteredTransactions = assetFilter
    ? transactions.filter((transaction) => transaction.asset?.id === assetFilter)
    : transactions

  return (
    <div className="space-y-6 pt-4">
      {accountQuery.isLoading ? <Skeleton className="h-28 w-full" /> : null}
      {accountQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('accounts.detail.loadErrorTitle')}</AlertTitle>
          <AlertDescription>{accountQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {accountQuery.data ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-normal">{accountQuery.data.name}</h1>
                <Badge variant="secondary">{t(`accounts.type.${accountQuery.data.type}`)}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {(accountQuery.data.institution_name || t('accounts.noInstitution')) +
                  ' - ' +
                  accountQuery.data.base_currency}
              </p>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('accounts.detail.derivedNote')}</p>
            </div>
            <TransactionDialog accountId={accountId} triggerLabel={t('accounts.detail.addTransaction')} />
          </div>
        </section>
      ) : null}

			<Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="transactions">{t('accounts.detail.tabs.transactions')}</TabsTrigger>
          <TabsTrigger value="positions">{t('accounts.detail.tabs.positions')}</TabsTrigger>
          <TabsTrigger value="cash">{t('accounts.detail.tabs.cash')}</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions" className="space-y-4">
          {assetFilter ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm text-muted-foreground">{t('accounts.detail.assetFilterActive')}</p>
              <Button variant="outline" size="sm" onClick={() => setAssetFilter(null)}>
                {t('accounts.detail.clearFilter')}
              </Button>
            </div>
          ) : null}
          <TransactionsTable
            accountId={accountId}
            transactions={filteredTransactions}
            isLoading={transactionsQuery.isLoading}
            error={transactionsQuery.error}
          />
        </TabsContent>
				<TabsContent value="positions">
					<PositionsTable
						positions={positionsQuery.data ?? []}
						isLoading={positionsQuery.isLoading}
						error={positionsQuery.error}
						onViewTransactions={(assetId) => {
							setAssetFilter(assetId)
							setActiveTab('transactions')
						}}
					/>
				</TabsContent>
        <TabsContent value="cash">
          <CashBalancesTable balances={cashQuery.data ?? []} isLoading={cashQuery.isLoading} error={cashQuery.error} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TransactionsTable({
  accountId,
  transactions,
  isLoading,
  error,
}: {
  accountId: string
  transactions: AccountTransaction[]
  isLoading: boolean
  error: Error | null
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('accounts.detail.transactionsLoadErrorTitle')}</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
  if (transactions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6">
        <h2 className="text-lg font-semibold">{t('accounts.detail.noTransactionsTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('accounts.detail.noTransactionsDescription')}</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('accounts.detail.transactions.date')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.type')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.asset')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.description')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.quantity')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.price')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.fees')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.cashImpact')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.currency')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.source')}</TableHead>
            <TableHead>{t('accounts.detail.transactions.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id}>
              <TableCell>{formatDate(transaction.trade_date)}</TableCell>
              <TableCell>{t(`accounts.transactionType.${transaction.type}`)}</TableCell>
              <TableCell>{transaction.asset ? `${transaction.asset.symbol} - ${transaction.asset.name}` : '-'}</TableCell>
              <TableCell className="min-w-48">{transaction.description || '-'}</TableCell>
              <TableCell>{formatOptionalDecimal(transaction.quantity)}</TableCell>
              <TableCell>{formatOptionalMoney(transaction.price, transaction.currency)}</TableCell>
              <TableCell>{formatOptionalMoney(transaction.fees, transaction.currency)}</TableCell>
              <TableCell>{formatOptionalMoney(transaction.cash_impact, transaction.currency)}</TableCell>
              <TableCell>{transaction.currency}</TableCell>
              <TableCell>{transaction.source}</TableCell>
              <TableCell>
                {isManualTransaction(transaction) ? (
                  <div className="flex items-center gap-1">
                    <TransactionDialog accountId={accountId} transaction={transaction} triggerLabel={t('accounts.detail.edit')}>
                      <Pencil className="h-4 w-4" />
                    </TransactionDialog>
                    <DeleteTransactionDialog accountId={accountId} transaction={transaction} />
                  </div>
                ) : (
                  '-'
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function PositionsTable({
  positions,
  isLoading,
  error,
  onViewTransactions,
}: {
  positions: AccountPosition[]
  isLoading: boolean
  error: Error | null
  onViewTransactions: (assetId: string) => void
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('accounts.detail.positionsLoadErrorTitle')}</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
  if (positions.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{t('accounts.detail.noPositions')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('accounts.detail.positions.asset')}</TableHead>
            <TableHead>{t('accounts.detail.positions.quantity')}</TableHead>
            <TableHead>{t('accounts.detail.positions.currency')}</TableHead>
            <TableHead>{t('accounts.detail.positions.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((position) => (
            <TableRow key={position.asset.id}>
              <TableCell>{`${position.asset.symbol} - ${position.asset.name}`}</TableCell>
              <TableCell>{formatDecimal(position.quantity)}</TableCell>
              <TableCell>{position.currency}</TableCell>
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => onViewTransactions(position.asset.id)}>
                  {t('accounts.detail.viewTransactions')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CashBalancesTable({
  balances,
  isLoading,
  error,
}: {
  balances: AccountCashBalance[]
  isLoading: boolean
  error: Error | null
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('accounts.detail.cashLoadErrorTitle')}</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
  if (balances.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{t('accounts.detail.noCash')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('accounts.detail.cash.currency')}</TableHead>
            <TableHead>{t('accounts.detail.cash.balance')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {balances.map((balance) => (
            <TableRow key={balance.currency}>
              <TableCell>{balance.currency}</TableCell>
              <TableCell>{formatMoney(balance.balance, balance.currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function TransactionDialog({
  accountId,
  transaction,
  triggerLabel,
  children,
}: {
  accountId: string
  transaction?: AccountTransaction
  triggerLabel: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const createTransaction = useCreateAccountTransactionMutation(accountId)
  const updateTransaction = useUpdateAccountTransactionMutation(accountId)
  const [form, setForm] = useState<TransactionFormValues>(() => initialFormValues(transaction))
  const [formError, setFormError] = useState<string | null>(null)
  const assetSearchQuery = useAssetSearchQuery(form.assetSearch, 10, open)
  const preview = useMemo(() => ledgerPreview(form), [form])

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setForm(initialFormValues(transaction))
      setFormError(null)
    }
  }

  function update<K extends keyof TransactionFormValues>(key: K, value: TransactionFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const request = requestFromForm(form)
    if (!request) {
      setFormError(t('accounts.detail.form.validation'))
      return
    }
    setFormError(null)
    if (transaction) {
      await updateTransaction.mutateAsync({ transactionId: transaction.id, body: request })
    } else {
      await createTransaction.mutateAsync(request)
    }
    setOpen(false)
    if (!transaction) {
      setForm(initialFormValues(undefined))
    }
  }

  const isPending = createTransaction.isPending || updateTransaction.isPending
  const mutationError = createTransaction.error ?? updateTransaction.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={children ? 'ghost' : 'default'} size={children ? 'icon-sm' : 'default'} aria-label={triggerLabel}>
          {children ?? (
            <>
              <Plus className="h-4 w-4" />
              {triggerLabel}
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{transaction ? t('accounts.detail.form.editTitle') : t('accounts.detail.form.createTitle')}</DialogTitle>
          <DialogDescription>{t('accounts.detail.form.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          {formError || mutationError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError ?? mutationError?.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('accounts.detail.form.type')} id="transaction-type">
              <Select value={form.type} onValueChange={(value) => update('type', value as TransactionFormValues['type'])}>
                <SelectTrigger id="transaction-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountTransactionTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`accounts.transactionType.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('accounts.detail.form.tradeDate')} id="trade-date">
              <Input id="trade-date" type="date" value={form.tradeDate} onChange={(event) => update('tradeDate', event.target.value)} />
            </Field>
            <Field label={t('accounts.detail.form.settlementDate')} id="settlement-date">
              <Input
                id="settlement-date"
                type="date"
                value={form.settlementDate}
                onChange={(event) => update('settlementDate', event.target.value)}
              />
            </Field>
            <Field label={t('accounts.detail.form.currency')} id="transaction-currency">
              <Input
                id="transaction-currency"
                value={form.currency}
                maxLength={3}
                onChange={(event) => update('currency', event.target.value.toUpperCase())}
              />
            </Field>
          </div>

          {assetRequiredTypes.has(form.type) ? (
            <div className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="asset-search">{t('accounts.detail.form.asset')}</Label>
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="asset-search"
                  value={form.assetSearch}
                  placeholder={t('search.placeholder')}
                  onChange={(event) => update('assetSearch', event.target.value)}
                />
              </div>
              {form.asset ? (
                <p className="text-sm text-muted-foreground">
                  {t('accounts.detail.form.selectedAsset', { symbol: form.asset.symbol, name: form.asset.name })}
                </p>
              ) : null}
              {assetSearchQuery.data && assetSearchQuery.data.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {assetSearchQuery.data.map((asset) => (
                    <Button
                      key={`${asset.provider_id}:${asset.provider_symbol}`}
                      type="button"
                      variant="outline"
                      className="h-auto justify-start whitespace-normal text-left"
                      onClick={() => update('asset', assetInputFromSearchResult(asset, form.currency))}
                    >
                      {asset.symbol} - {asset.name}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {quantityPriceTypes.has(form.type) ? (
              <>
                <Field label={t('accounts.detail.form.quantity')} id="quantity">
                  <Input id="quantity" inputMode="decimal" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} />
                </Field>
                <Field label={t('accounts.detail.form.price')} id="price">
                  <Input id="price" inputMode="decimal" value={form.price} onChange={(event) => update('price', event.target.value)} />
                </Field>
                <Field label={t('accounts.detail.form.fees')} id="fees">
                  <Input id="fees" inputMode="decimal" value={form.fees} onChange={(event) => update('fees', event.target.value)} />
                </Field>
              </>
            ) : null}
            {amountTypes.has(form.type) ? (
              <Field label={t('accounts.detail.form.amount')} id="amount">
                <Input id="amount" inputMode="decimal" value={form.amount} onChange={(event) => update('amount', event.target.value)} />
              </Field>
            ) : null}
            <Field label={t('accounts.detail.form.descriptionLabel')} id="description">
              <Input id="description" value={form.description} onChange={(event) => update('description', event.target.value)} />
            </Field>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <h3 className="font-medium">{t('accounts.detail.form.preview')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{preview}</p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? t('accounts.detail.form.saving') : t('accounts.detail.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteTransactionDialog({ accountId, transaction }: { accountId: string; transaction: AccountTransaction }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const deleteTransaction = useDeleteAccountTransactionMutation(accountId)

  async function onDelete() {
    await deleteTransaction.mutateAsync(transaction.id)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('accounts.detail.delete')}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('accounts.detail.deleteTitle')}</DialogTitle>
          <DialogDescription>{t('accounts.detail.deleteDescription')}</DialogDescription>
        </DialogHeader>
        {deleteTransaction.error ? (
          <Alert variant="destructive">
            <AlertDescription>{deleteTransaction.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            {t('accounts.detail.cancel')}
          </Button>
          <Button variant="destructive" type="button" disabled={deleteTransaction.isPending} onClick={onDelete}>
            {deleteTransaction.isPending ? t('accounts.detail.deleting') : t('accounts.detail.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

function initialFormValues(transaction?: AccountTransaction): TransactionFormValues {
  const type = guidedTransactionType(transaction?.type) ?? AccountTransactionRequestType.BUY
  return {
    type,
    tradeDate: transaction?.trade_date ?? localDateInputValue(),
    settlementDate: transaction?.settlement_date ?? '',
    description: transaction?.description ?? '',
    currency: transaction?.currency ?? transaction?.asset?.currency ?? 'CAD',
    asset: transaction?.asset
      ? {
          name: transaction.asset.name,
          symbol: transaction.asset.symbol,
          asset_type: transaction.asset.asset_type,
          currency: transaction.asset.currency,
          provider_id: transaction.asset.provider_id,
          provider_symbol: transaction.asset.provider_symbol,
          exchange: transaction.asset.exchange,
        }
      : null,
    assetSearch: transaction?.asset?.symbol ?? '',
    quantity: transaction?.quantity ? trimDecimal(transaction.quantity) : '',
    price: transaction?.price ? trimDecimal(transaction.price) : '',
    amount: amountFromTransaction(transaction),
    fees: transaction?.fees ? trimDecimal(transaction.fees) : '',
  }
}

function requestFromForm(form: TransactionFormValues): AccountTransactionRequest | null {
  if (!form.tradeDate || !form.currency || (assetRequiredTypes.has(form.type) && !form.asset)) {
    return null
  }
  if (quantityPriceTypes.has(form.type) && (!positiveString(form.quantity) || !positiveString(form.price))) {
    return null
  }
  if (amountTypes.has(form.type) && !positiveString(form.amount)) {
    return null
  }
  return {
    type: form.type,
    trade_date: form.tradeDate,
    settlement_date: form.settlementDate || undefined,
    description: form.description,
    currency: form.currency.toUpperCase(),
    asset: assetRequiredTypes.has(form.type) ? form.asset ?? undefined : undefined,
    quantity: quantityPriceTypes.has(form.type) ? form.quantity : undefined,
    price: quantityPriceTypes.has(form.type) ? form.price : undefined,
    amount: amountTypes.has(form.type) ? form.amount : undefined,
    fees: quantityPriceTypes.has(form.type) && form.fees ? form.fees : undefined,
  }
}

function assetInputFromSearchResult(asset: AssetSearchResult, fallbackCurrency: string): AccountTransactionAssetInput {
  return {
    name: asset.name,
    symbol: asset.symbol,
    asset_type: asset.asset_type,
    currency: asset.currency ?? fallbackCurrency,
    provider_id: asset.provider_id,
    provider_symbol: asset.provider_symbol,
    exchange: asset.exchange,
  }
}

function ledgerPreview(form: TransactionFormValues) {
  const currency = form.currency.toUpperCase()
  const fees = Number(form.fees || 0)
  if (quantityPriceTypes.has(form.type)) {
    const quantity = Number(form.quantity || 0)
    const price = Number(form.price || 0)
    const gross = quantity * price
    const cash = form.type === AccountTransactionRequestType.BUY ? -(gross + fees) : gross - fees
    return `${form.type}: ${quantity || 0} units, cash impact ${formatPreviewMoney(cash, currency)}`
  }
  const amount = Number(form.amount || 0)
  const signed =
    form.type === AccountTransactionRequestType.WITHDRAWAL || form.type === AccountTransactionRequestType.FEE ? -amount : amount
  return `${form.type}: cash impact ${formatPreviewMoney(signed, currency)}`
}

function isManualTransaction(transaction: AccountTransaction) {
  return transaction.source === 'MANUAL'
}

function guidedTransactionType(type?: AccountTransaction['type']): AccountTransactionRequest['type'] | undefined {
  return accountTransactionTypes.find((value) => String(value) === type)
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function amountFromTransaction(transaction?: AccountTransaction) {
  if (!transaction?.cash_impact) {
    return ''
  }
  return trimDecimal(transaction.cash_impact.trim().replace(/^-/, ''))
}

function positiveString(value: string) {
  return Number(value) > 0
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function formatOptionalDecimal(value?: string | null) {
  return value ? formatDecimal(value) : '-'
}

function formatDecimal(value: string) {
  return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 6 }).format(Number(value))
}

function formatOptionalMoney(value: string | null | undefined, currency: string) {
  return value ? formatMoney(value, currency) : '-'
}

function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatPreviewMoney(value: number, currency: string) {
  if (/^[A-Z]{3}$/.test(currency)) {
    return formatMoney(String(value), currency)
  }
  const suffix = currency || '---'
  const amount = new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${amount} ${suffix}`
}

function trimDecimal(value: string) {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}
