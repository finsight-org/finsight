import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, errorMessage } from '@/api/client'
import { AccountType as GeneratedAccountType, type components } from '@/api/generated/finsight'
import { portfolioAccountValuesQueryKey } from '@/api/portfolio'
import { i18n } from '@/i18n/i18n'

export type Account = components['schemas']['Account']
export type AccountType = components['schemas']['AccountType']
export type CreateAccountRequest = components['schemas']['CreateAccountRequest']

export const AccountType = GeneratedAccountType
export const accountTypes = Object.values(AccountType)

export const accountsQueryKey = ['accounts'] as const

export async function listAccounts() {
  const { data, error } = await apiClient.GET('/api/accounts')

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountsLoad')))
  }

  return data?.accounts ?? []
}

export async function createAccount(body: CreateAccountRequest) {
  const { data, error } = await apiClient.POST('/api/accounts', {
    body,
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountCreate')))
  }

  if (!data) {
    throw new Error(i18n.t('errors.accountCreateNoData'))
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsQueryKey }),
        queryClient.invalidateQueries({ queryKey: portfolioAccountValuesQueryKey }),
      ])
    },
  })
}
