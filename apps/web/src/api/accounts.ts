import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, errorMessage } from '@/api/client'
import type { components } from '@/api/generated/finsight'

export type Account = components['schemas']['Account']
export type AccountType = components['schemas']['AccountType']
export type CreateAccountRequest = components['schemas']['CreateAccountRequest']

export const accountTypes: AccountType[] = [
  'BROKERAGE',
  'BANK',
  'CRYPTO_EXCHANGE',
  'RETIREMENT',
  'MANUAL',
]

export const accountsQueryKey = ['accounts'] as const

export async function listAccounts() {
  const { data, error } = await apiClient.GET('/api/accounts')

  if (error) {
    throw new Error(errorMessage(error, 'Could not load accounts.'))
  }

  return data?.accounts ?? []
}

export async function createAccount(body: CreateAccountRequest) {
  const { data, error } = await apiClient.POST('/api/accounts', {
    body,
  })

  if (error) {
    throw new Error(errorMessage(error, 'Could not create the account.'))
  }

  if (!data) {
    throw new Error('The account was created, but the API returned no account data.')
  }

  return data
}

export function useAccountsQuery() {
  return useQuery({
    queryKey: accountsQueryKey,
    queryFn: listAccounts,
  })
}

export function useCreateAccountMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
    },
  })
}
