import { useQuery } from '@tanstack/react-query'

import { apiClient, errorMessage } from '@/api/client'
import { PortfolioRange as GeneratedPortfolioRange, type components } from '@/api/generated/finsight'
import { i18n } from '@/i18n/i18n'

export type PortfolioRange = components['schemas']['PortfolioRange']
export type PortfolioOverview = components['schemas']['PortfolioOverviewResponse']
export type PortfolioValueHistory = components['schemas']['PortfolioValueHistoryResponse']
export type PortfolioAccountValues = components['schemas']['PortfolioAccountValuesResponse']

export const PortfolioRange = GeneratedPortfolioRange

export const timeRanges = [
  { value: PortfolioRange.Value1D, labelKey: 'portfolio.tabs.ranges.oneDay' },
  { value: PortfolioRange.Value1W, labelKey: 'portfolio.tabs.ranges.oneWeek' },
  { value: PortfolioRange.Value1M, labelKey: 'portfolio.tabs.ranges.oneMonth' },
  { value: PortfolioRange.Value3M, labelKey: 'portfolio.tabs.ranges.threeMonths' },
  { value: PortfolioRange.YTD, labelKey: 'portfolio.tabs.ranges.yearToDate' },
  { value: PortfolioRange.Value1Y, labelKey: 'portfolio.tabs.ranges.oneYear' },
  { value: PortfolioRange.ALL, labelKey: 'portfolio.tabs.ranges.all' },
] as const

export const portfolioOverviewQueryKey = (portfolioId: string) => ['portfolio', portfolioId, 'overview'] as const
export const portfolioValueHistoryQueryKey = (portfolioId: string, range: PortfolioRange) =>
  ['portfolio', portfolioId, 'value-history', range] as const
export const portfolioAccountValuesQueryKey = (portfolioId: string) => ['portfolio', portfolioId, 'account-values'] as const

export async function getPortfolioOverview(portfolioId: string) {
  const { data, error } = await apiClient.GET('/api/portfolios/{portfolio_id}/overview', {
    params: { path: { portfolio_id: portfolioId } },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.portfolioOverview')))
  }
  if (!data) {
    throw new Error(i18n.t('errors.portfolioOverviewNoData'))
  }

  return data
}

export async function getPortfolioValueHistory(portfolioId: string, range: PortfolioRange) {
  const { data, error } = await apiClient.GET('/api/portfolios/{portfolio_id}/value-history', {
    params: {
      path: { portfolio_id: portfolioId },
      query: { range },
    },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.portfolioValueHistory')))
  }
  if (!data) {
    throw new Error(i18n.t('errors.portfolioValueHistoryNoData'))
  }

  return data
}

export async function getPortfolioAccountValues(portfolioId: string) {
  const { data, error } = await apiClient.GET('/api/portfolios/{portfolio_id}/account-values', {
    params: { path: { portfolio_id: portfolioId } },
  })

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.portfolioAccountValues')))
  }
  if (!data) {
    throw new Error(i18n.t('errors.portfolioAccountValuesNoData'))
  }

  return data
}

export function usePortfolioOverviewQuery(portfolioId?: string) {
  return useQuery({
    queryKey: portfolioOverviewQueryKey(portfolioId ?? ''),
    queryFn: () => getPortfolioOverview(portfolioId!),
    enabled: Boolean(portfolioId),
  })
}

export function usePortfolioValueHistoryQuery(portfolioId: string | undefined, range: PortfolioRange) {
  return useQuery({
    queryKey: portfolioValueHistoryQueryKey(portfolioId ?? '', range),
    queryFn: () => getPortfolioValueHistory(portfolioId!, range),
    enabled: Boolean(portfolioId),
  })
}

export function usePortfolioAccountValuesQuery(portfolioId?: string) {
  return useQuery({
    queryKey: portfolioAccountValuesQueryKey(portfolioId ?? ''),
    queryFn: () => getPortfolioAccountValues(portfolioId!),
    enabled: Boolean(portfolioId),
  })
}
