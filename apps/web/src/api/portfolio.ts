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

export const portfolioOverviewQueryKey = ['portfolio', 'overview'] as const
export const portfolioValueHistoryQueryKey = (range: PortfolioRange) => ['portfolio', 'value-history', range] as const
export const portfolioAccountValuesQueryKey = ['portfolio', 'account-values'] as const

export async function getPortfolioOverview() {
  const { data, error } = await apiClient.GET('/api/portfolio/overview')

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.portfolioOverview')))
  }
  if (!data) {
    throw new Error(i18n.t('errors.portfolioOverviewNoData'))
  }

  return data
}

export async function getPortfolioValueHistory(range: PortfolioRange) {
  const { data, error } = await apiClient.GET('/api/portfolio/value-history', {
    params: {
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

export async function getPortfolioAccountValues() {
  const { data, error } = await apiClient.GET('/api/portfolio/account-values')

  if (error) {
    throw new Error(errorMessage(error, i18n.t('errors.portfolioAccountValues')))
  }
  if (!data) {
    throw new Error(i18n.t('errors.portfolioAccountValuesNoData'))
  }

  return data
}

export function usePortfolioOverviewQuery() {
  return useQuery({
    queryKey: portfolioOverviewQueryKey,
    queryFn: getPortfolioOverview,
  })
}

export function usePortfolioValueHistoryQuery(range: PortfolioRange) {
  return useQuery({
    queryKey: portfolioValueHistoryQueryKey(range),
    queryFn: () => getPortfolioValueHistory(range),
  })
}

export function usePortfolioAccountValuesQuery() {
  return useQuery({
    queryKey: portfolioAccountValuesQueryKey,
    queryFn: getPortfolioAccountValues,
  })
}
