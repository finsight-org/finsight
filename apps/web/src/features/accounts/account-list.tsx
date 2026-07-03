import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label={t('accounts.loading')}>
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('accounts.loadErrorTitle')}</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
        <h3 className="text-lg font-semibold">{t('accounts.emptyTitle')}</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {t('accounts.emptyDescription')}
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
              <Badge variant="secondary">{t(`accounts.type.${account.type}`)}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {account.institution_name || t('accounts.noInstitution')} - {account.base_currency} -{' '}
              {t('accounts.updatedAt', { date: formatUpdatedAt(account.updated_at) })}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-base font-semibold">{t('accounts.valuePending')}</p>
            <p className="text-xs text-muted-foreground">{t('accounts.valuePendingDescription')}</p>
          </div>
        </article>
      ))}
    </div>
  )
}
