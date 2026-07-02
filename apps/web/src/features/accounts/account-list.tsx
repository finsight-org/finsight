import type { Account } from '@/api/accounts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const updatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

function formatUpdatedAt(updatedAt: string) {
  return updatedAtFormatter.format(new Date(updatedAt))
}

type AccountListProps = {
  accounts: Account[]
  isLoading?: boolean
  error?: Error | null
}

export function AccountList({ accounts, isLoading = false, error = null }: AccountListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3" aria-label="Loading accounts">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Accounts could not load</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
        <h3 className="text-lg font-semibold">No accounts yet</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Create the first account before importing investment data. Portfolio insights will appear after confirmed
          imports create transactions.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <article
          key={account.id}
          className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-card-foreground shadow-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{account.name}</h3>
              <Badge variant="secondary">{account.type.replaceAll('_', ' ').toLowerCase()}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {account.institution_name || 'No institution'} - {account.base_currency} - Updated {formatUpdatedAt(account.updated_at)}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-base font-semibold">Value pending</p>
            <p className="text-xs text-muted-foreground">Import transactions to calculate value</p>
          </div>
        </article>
      ))}
    </div>
  )
}
