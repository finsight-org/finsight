import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { PortfolioRange, type PortfolioValueHistory } from '@/api/portfolio'

type PortfolioChartProps = {
  history?: PortfolioValueHistory
}

export function PortfolioChart({ history }: PortfolioChartProps) {
  const currency = history?.base_currency ?? 'CAD'
  const range = history?.range ?? PortfolioRange.Value1Y
  const data =
    history?.points.map((point) => ({
      date: point.date,
      value: Number(point.value),
    })) ?? []
  const ticks = selectDateTicks(
    data.map((point) => point.date),
    maxTicksForRange(range),
  )

  return (
    <div className="relative h-[300px] w-full sm:h-[360px]" data-testid="portfolio-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 24, right: 18, bottom: 14, left: 18 }}>
          <defs>
            <linearGradient id="portfolio-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            interval={0}
            ticks={ticks}
            tickFormatter={(value) => formatTickDate(String(value), range)}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12, fontWeight: 600 }}
            dy={12}
            minTickGap={24}
          />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            content={<PortfolioTooltip currency={currency} />}
            cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '4 4', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#22c55e"
            strokeWidth={3}
            fill="url(#portfolio-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function PortfolioTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: Array<{ value?: number | string }>
  label?: string
  currency: string
}) {
  const rawValue = payload?.[0]?.value
  if (!active || rawValue == null || !label) {
    return null
  }

  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-semibold">{formatMoney(Number(rawValue), currency)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{formatFullDate(label)}</p>
    </div>
  )
}

function maxTicksForRange(range: PortfolioValueHistory['range']) {
  switch (range) {
    case PortfolioRange.Value1D:
      return 1
    case PortfolioRange.Value1W:
      return 4
    case PortfolioRange.Value1M:
      return 5
    default:
      return 6
  }
}

function selectDateTicks(dates: string[], maxTicks: number) {
  if (dates.length <= maxTicks) {
    return dates
  }

  const lastIndex = dates.length - 1
  const step = lastIndex / (maxTicks - 1)
  const indexes = new Set<number>()
  for (let index = 0; index < maxTicks; index += 1) {
    indexes.add(Math.round(index * step))
  }
  indexes.add(lastIndex)

  return [...indexes].sort((first, second) => first - second).map((index) => dates[index]).filter(Boolean)
}

function formatTickDate(value: string, range: PortfolioValueHistory['range']) {
  const date = parseDate(value)
  if (range === PortfolioRange.ALL) {
    return new Intl.DateTimeFormat('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
  }
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(parseDate(value))
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`)
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
