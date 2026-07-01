import { Info } from 'lucide-react'

import { useAccountsQuery } from '@/api/accounts'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AccountList } from '@/features/accounts/account-list'
import { AddAccountDialog } from '@/features/accounts/add-account-dialog'
import { mockPortfolioSummary, timeRanges } from '@/features/portfolio/mock-portfolio'
import { PortfolioChart } from '@/features/portfolio/portfolio-chart'

export function PortfolioPage() {
  const accountsQuery = useAccountsQuery()

  return (
    <div className="space-y-7">
      <section className="pt-4">
        <div className="flex items-start gap-2.5">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">{mockPortfolioSummary.value}</h1>
            <p className="mt-2 text-sm font-semibold text-emerald-500 sm:text-base">{mockPortfolioSummary.dailyChange}</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="mt-1 h-8 w-8 rounded-full" aria-label="Portfolio value note">
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Temporary mock summary until portfolio endpoints are available.</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <PortfolioChart />

        <div className="border-t pt-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs defaultValue="1D">
              <TabsList className="h-auto flex-wrap rounded-full bg-transparent p-0">
                {timeRanges.map((range) => (
                  <TabsTrigger
                    key={range}
                    value={range}
                    className="h-9 rounded-full px-4 text-sm text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    {range}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Tabs defaultValue="returns">
              <TabsList className="rounded-full bg-transparent p-0">
                <TabsTrigger value="account-value" className="h-9 rounded-full px-4 text-sm">
                  Account value
                </TabsTrigger>
                <TabsTrigger value="returns" className="h-9 rounded-full px-4 text-sm">
                  Returns
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold tracking-normal">Accounts</h2>
          <AddAccountDialog />
        </div>
        <AccountList
          accounts={accountsQuery.data ?? []}
          isLoading={accountsQuery.isLoading}
          error={accountsQuery.error}
        />
      </section>
    </div>
  )
}
