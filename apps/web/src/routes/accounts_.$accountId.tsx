import { createFileRoute } from '@tanstack/react-router'

import { AccountDetailPage } from '@/features/accounts/account-detail-page'

export const Route = createFileRoute('/accounts_/$accountId')({
  component: AccountDetailRoute,
})

// oxlint-disable-next-line react/only-export-components -- TanStack route modules export both route metadata and their component.
function AccountDetailRoute() {
  const { accountId } = Route.useParams()

  return <AccountDetailPage key={accountId} accountId={accountId} />
}
