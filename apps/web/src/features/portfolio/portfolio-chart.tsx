import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'

import { mockPortfolioPerformance, mockPortfolioSummary } from '@/features/portfolio/mock-portfolio'

export function PortfolioChart() {
  return (
    <div className="relative h-[300px] w-full sm:h-[360px]" data-testid="portfolio-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={mockPortfolioPerformance} margin={{ top: 24, right: 18, bottom: 14, left: 18 }}>
          <defs>
            <linearGradient id="portfolio-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="transparent" />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={2}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12, fontWeight: 600 }}
            dy={12}
          />
          <YAxis hide domain={[-320, 760]} />
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
      <div className="absolute right-3 top-1/2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
        {mockPortfolioSummary.baseline}
      </div>
    </div>
  )
}
