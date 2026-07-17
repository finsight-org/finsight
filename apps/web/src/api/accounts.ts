import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient, errorMessage } from '@/api/client'
import {
  AccountTransactionAssetType as GeneratedAccountTransactionAssetType,
  AccountTransactionRequestType as GeneratedAccountTransactionRequestType,
  AccountTransactionType as GeneratedAccountTransactionType,
  AccountType as GeneratedAccountType,
  type components,
} from '@/api/generated/finsight'
import { portfolioAccountValuesQueryKey, portfolioOverviewQueryKey, portfolioValueHistoryQueryRootKey } from '@/api/portfolio'
import { i18n } from '@/i18n/i18n'

export type Account = components['schemas']['Account']
export type AccountType = components['schemas']['AccountType']
export type CreateAccountRequest = components['schemas']['CreateAccountRequest']
export type AccountTransaction = components['schemas']['AccountTransaction']
export type AccountTransactionRequest = components['schemas']['AccountTransactionRequest']
export type AccountTransactionRequestType = components['schemas']['AccountTransactionRequestType']
export type AccountTransactionType = components['schemas']['AccountTransactionType']
export type AccountTransactionAssetInput = components['schemas']['AccountTransactionAssetInput']
export type AccountPosition = components['schemas']['AccountPosition']
export type AccountCashBalance = components['schemas']['AccountCashBalance']

export const AccountType = GeneratedAccountType
export const AccountTransactionType = GeneratedAccountTransactionType
export const AccountTransactionRequestType = GeneratedAccountTransactionRequestType
export const AccountTransactionAssetType = GeneratedAccountTransactionAssetType
export const accountTypes = Object.values(AccountType)
export const accountTransactionTypes = Object.values(AccountTransactionRequestType)

export const accountsQueryKey = ['accounts'] as const
export const accountQueryKey = (accountId: string) => ['accounts', accountId] as const
export const accountTransactionsQueryKey = (accountId: string) => ['accounts', accountId, 'transactions'] as const
export const accountPositionsQueryKey = (accountId: string) => ['accounts', accountId, 'positions'] as const
export const accountCashBalancesQueryKey = (accountId: string) => ['accounts', accountId, 'cash-balances'] as const

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

export async function getAccount(accountId: string) {
  const { data, error } = await apiClient.GET('/api/accounts/{id}', {
    params: {
      path: { id: accountId },
    },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountLoad')))
  }

  if (!data) {
    throw new Error(i18n.t('errors.accountLoadNoData'))
  }

  return data
}

export async function listAccountTransactions(accountId: string) {
  const { data, error } = await apiClient.GET('/api/accounts/{id}/transactions', {
    params: {
      path: { id: accountId },
    },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountTransactionsLoad')))
  }

  return data?.transactions ?? []
}

export async function createAccountTransaction(accountId: string, body: AccountTransactionRequest) {
  const { data, error } = await apiClient.POST('/api/accounts/{id}/transactions', {
    params: {
      path: { id: accountId },
    },
    body,
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountTransactionSave')))
  }

  if (!data) {
    throw new Error(i18n.t('errors.accountTransactionSaveNoData'))
  }

  return data
}

export async function updateAccountTransaction(accountId: string, transactionId: string, body: AccountTransactionRequest) {
  const { data, error } = await apiClient.PUT('/api/accounts/{id}/transactions/{transactionId}', {
    params: {
      path: { id: accountId, transactionId },
    },
    body,
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountTransactionSave')))
  }

  if (!data) {
    throw new Error(i18n.t('errors.accountTransactionSaveNoData'))
  }

  return data
}

export async function deleteAccountTransaction(accountId: string, transactionId: string) {
  const { error } = await apiClient.DELETE('/api/accounts/{id}/transactions/{transactionId}', {
    params: {
      path: { id: accountId, transactionId },
    },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountTransactionDelete')))
  }
}

export async function listAccountPositions(accountId: string) {
  const { data, error } = await apiClient.GET('/api/accounts/{id}/positions', {
    params: {
      path: { id: accountId },
    },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountPositionsLoad')))
  }

  return data?.positions ?? []
}

export async function listAccountCashBalances(accountId: string) {
  const { data, error } = await apiClient.GET('/api/accounts/{id}/cash-balances', {
    params: {
      path: { id: accountId },
    },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.accountCashBalancesLoad')))
  }

  return data?.cash_balances ?? []
}

export function useAccountsQuery() {
  return useQuery({
    queryKey: accountsQueryKey,
    queryFn: listAccounts,
  })
}

export function useAccountQuery(accountId: string) {
  return useQuery({
    queryKey: accountQueryKey(accountId),
    queryFn: () => getAccount(accountId),
  })
}

export function useAccountTransactionsQuery(accountId: string, enabled = true) {
  return useQuery({
    queryKey: accountTransactionsQueryKey(accountId),
    queryFn: () => listAccountTransactions(accountId),
    enabled,
  })
}

export function useAccountPositionsQuery(accountId: string, enabled = true) {
  return useQuery({
    queryKey: accountPositionsQueryKey(accountId),
    queryFn: () => listAccountPositions(accountId),
    enabled,
  })
}

export function useAccountCashBalancesQuery(accountId: string, enabled = true) {
  return useQuery({
    queryKey: accountCashBalancesQueryKey(accountId),
    queryFn: () => listAccountCashBalances(accountId),
    enabled,
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

export function useCreateAccountTransactionMutation(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: AccountTransactionRequest) => createAccountTransaction(accountId, body),
    onSuccess: async () => {
      await invalidateAccountDetail(queryClient, accountId)
    },
  })
}

export function useUpdateAccountTransactionMutation(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ transactionId, body }: { transactionId: string; body: AccountTransactionRequest }) =>
      updateAccountTransaction(accountId, transactionId, body),
    onSuccess: async () => {
      await invalidateAccountDetail(queryClient, accountId)
    },
  })
}

export function useDeleteAccountTransactionMutation(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (transactionId: string) => deleteAccountTransaction(accountId, transactionId),
    onSuccess: async () => {
      await invalidateAccountDetail(queryClient, accountId)
    },
  })
}

async function invalidateAccountDetail(queryClient: ReturnType<typeof useQueryClient>, accountId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: accountTransactionsQueryKey(accountId) }),
    queryClient.invalidateQueries({ queryKey: accountPositionsQueryKey(accountId) }),
    queryClient.invalidateQueries({ queryKey: accountCashBalancesQueryKey(accountId) }),
    queryClient.invalidateQueries({ queryKey: portfolioOverviewQueryKey }),
    queryClient.invalidateQueries({ queryKey: portfolioValueHistoryQueryRootKey }),
    queryClient.invalidateQueries({ queryKey: portfolioAccountValuesQueryKey }),
  ])
}
