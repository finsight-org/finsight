import { useTranslation } from 'react-i18next'

import { useAccountsQuery } from '@/api/accounts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { AccountsTable } from '@/features/accounts/accounts-table'
import { AddAccountDialog } from '@/features/accounts/add-account-dialog'

export function AccountsPage() {
  const accountsQuery = useAccountsQuery()
  const { t } = useTranslation()

  return (
    <section className="space-y-6 pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">{t('accounts.title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('accounts.description')}</p>
        </div>
        <AddAccountDialog />
      </div>

      {accountsQuery.isLoading ? <Skeleton className="h-64 rounded-2xl" /> : null}
      {accountsQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('accounts.loadErrorTitle')}</AlertTitle>
          <AlertDescription>{accountsQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {accountsQuery.data ? <AccountsTable accounts={accountsQuery.data} /> : null}
    </section>
  )
}
