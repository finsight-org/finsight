import { useMutation, useQueryClient } from '@tanstack/react-query'

import { apiClient, errorMessage } from '@/api/client'
import { AccountType as GeneratedAccountType, type components } from '@/api/generated/finsight'
import { portfolioAccountValuesQueryKey } from '@/api/portfolio'
import { i18n } from '@/i18n/i18n'

export type Account = components['schemas']['Account']
export type AccountType = components['schemas']['AccountType']
export type CreateAccountRequest = components['schemas']['CreateAccountRequest']

type CreateAccountMutationInput = {
  portfolioId: string
  body: CreateAccountRequest
}

export const AccountType = GeneratedAccountType
export const accountTypes = Object.values(AccountType)

export async function createAccount(portfolioId: string, body: CreateAccountRequest) {
  const { data, error } = await apiClient.POST('/api/portfolios/{portfolio_id}/accounts', {
    params: {
      path: { portfolio_id: portfolioId },
    },
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

export function useCreateAccountMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ portfolioId, body }: CreateAccountMutationInput) => createAccount(portfolioId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: portfolioAccountValuesQueryKey }),
  })
}
