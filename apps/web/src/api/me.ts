import { queryOptions, useQuery } from '@tanstack/react-query'

import { apiClient, errorMessage } from '@/api/client'
import type { components } from '@/api/generated/finsight'
import { i18n } from '@/i18n/i18n'

export type Me = components['schemas']['MeResponse']

export const meQueryKey = ['me'] as const

export async function getMe() {
  const { data, error } = await apiClient.GET('/api/me')

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.me')))
  }
  if (!data) {
    throw new Error(i18n.t('errors.meNoData'))
  }

  return data
}

export function meQueryOptions() {
  return queryOptions({
    queryKey: meQueryKey,
    queryFn: getMe,
  })
}

export function useMeQuery() {
  return useQuery(meQueryOptions())
}
