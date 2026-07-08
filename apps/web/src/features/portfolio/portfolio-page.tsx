import { Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PortfolioRange,
  timeRanges,
  usePortfolioAccountValuesQuery,
  usePortfolioOverviewQuery,
  usePortfolioValueHistoryQuery,
  type PortfolioAccountValues,
} from '@/api/portfolio'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AddAccountDialog } from '@/features/accounts/add-account-dialog'
import { PortfolioChart } from '@/features/portfolio/portfolio-chart'

export function PortfolioPage() {
  const [range, setRange] = useState(PortfolioRange.Value1Y)
  const overviewQuery = usePortfolioOverviewQuery()
  const valueHistoryQuery = usePortfolioValueHistoryQuery(range)
  const accountValuesQuery = usePortfolioAccountValuesQuery()
  const { t } = useTranslation()
  const overview = overviewQuery.data
  const totalValue = overview ? formatMoney(overview.total_value, overview.base_currency) : null

  return (
    <div className="space-y-7">
      <section className="pt-4">
        <div className="flex items-start gap-2.5">
          <div>
            {overviewQuery.isLoading ? (
              <Skeleton className="h-10 w-56 sm:h-12" />
            ) : (
              <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                {totalValue ?? t('portfolio.summary.emptyValue')}
              </h1>
            )}
            <p className="mt-2 text-sm font-semibold text-muted-foreground sm:text-base">
              {overview
                ? t('portfolio.summary.valuationDate', { date: formatDate(overview.valuation_date) })
                : t('portfolio.summary.loading')}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="mt-1 h-8 w-8 rounded-full"
                aria-label={t('portfolio.valueNote')}
              >
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('portfolio.valueTooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {overviewQuery.error ? (
          <PortfolioError title={t('portfolio.summary.loadErrorTitle')} message={overviewQuery.error.message} />
        ) : null}

        <div className="relative">
          {valueHistoryQuery.isLoading ? <Skeleton className="mt-6 h-[300px] w-full sm:h-[360px]" /> : null}
          {valueHistoryQuery.error ? (
            <PortfolioError title={t('portfolio.chart.loadErrorTitle')} message={valueHistoryQuery.error.message} />
          ) : null}
          {valueHistoryQuery.data ? <PortfolioChart history={valueHistoryQuery.data} /> : null}
          {valueHistoryQuery.data && valueHistoryQuery.data.points.length === 0 ? (
            <p className="py-10 text-sm text-muted-foreground">{t('portfolio.chart.empty')}</p>
          ) : null}
        </div>

        <div className="border-t pt-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs value={range} onValueChange={(value) => setRange(value as PortfolioRange)}>
              <TabsList className="h-auto flex-wrap rounded-full bg-transparent p-0">
                {timeRanges.map((range) => (
                  <TabsTrigger
                    key={range.value}
                    value={range.value}
                    className="h-9 rounded-full px-4 text-sm text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    {t(range.labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold tracking-normal">{t('accounts.title')}</h2>
          <AddAccountDialog />
        </div>
        <AccountValuesList
          values={accountValuesQuery.data}
          isLoading={accountValuesQuery.isLoading}
          error={accountValuesQuery.error}
        />
      </section>
    </div>
  )
}

function AccountValuesList({
  values,
  isLoading,
  error,
}: {
  values?: PortfolioAccountValues
  isLoading: boolean
  error: Error | null
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label={t('portfolio.accounts.loading')}>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (error) {
    return <PortfolioError title={t('portfolio.accounts.loadErrorTitle')} message={error.message} />
  }

  if (!values || values.accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6">
        <h3 className="text-lg font-semibold">{t('portfolio.accounts.emptyTitle')}</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('portfolio.accounts.emptyDescription')}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {values.accounts.map((account) => (
        <div key={account.account_id} className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold">{account.account_name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('portfolio.accounts.allocation', {
                  value: formatPercent(account.allocation_percent),
                })}
              </p>
            </div>
            <p className="text-right text-base font-semibold">{formatMoney(account.value, values.base_currency)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function PortfolioError({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive" className="my-4">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatPercent(value: string) {
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  )
}
