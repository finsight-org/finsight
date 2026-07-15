import { useQuery } from '@tanstack/react-query'

import { apiClient, errorMessage } from '@/api/client'
import type { components } from '@/api/generated/finsight'
import { i18n } from '@/i18n/i18n'

export type AssetSearchResult = components['schemas']['AssetSearchResult']
export type AssetType = components['schemas']['AssetType']

export const assetSearchQueryKey = (query: string, limit: number) => ['assets', 'search', query.trim(), limit] as const

export async function searchAssets(query: string, limit = 10) {
  const trimmedQuery = query.trim()
  const { data, error } = await apiClient.GET('/api/assets/search', {
    params: {
      query: {
        q: trimmedQuery,
        limit,
      },
    },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.assetSearch')))
  }

  return data?.assets ?? []
}

export function useAssetSearchQuery(query: string, limit = 10, enabled = true) {
  const trimmedQuery = query.trim()

  return useQuery({
    queryKey: assetSearchQueryKey(trimmedQuery, limit),
    queryFn: () => searchAssets(trimmedQuery, limit),
    enabled: enabled && trimmedQuery.length >= 2,
    staleTime: 60_000,
  })
}
