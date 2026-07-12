import { createFileRoute } from '@tanstack/react-router'

import { AccountDetailPage } from '@/features/accounts/account-detail-page'

export const Route = createFileRoute('/accounts_/$accountId')({
  component: AccountDetailRoute,
})

function AccountDetailRoute() {
  const { accountId } = Route.useParams()

  return <AccountDetailPage accountId={accountId} />
}
