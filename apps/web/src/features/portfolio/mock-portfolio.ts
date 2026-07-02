export const mockPortfolioSummary = {
  value: '$2,000.00 CAD',
  dailyChange: '+$18.00 CAD (+0.90%) past day',
  baseline: '$0.00',
}

// Temporary data until portfolio summary/performance endpoints exist.
export const mockPortfolioPerformance = [
  { label: '09:30', value: 0 },
  { label: '10:00', value: 160 },
  { label: '10:30', value: 260 },
  { label: '11:00', value: 120 },
  { label: '11:30', value: 180 },
  { label: '12:00', value: 360 },
  { label: '12:30', value: 270 },
  { label: '13:00', value: 460 },
  { label: '13:30', value: 400 },
  { label: '14:00', value: 440 },
  { label: '14:30', value: 160 },
  { label: '15:00', value: -20 },
  { label: '15:30', value: 320 },
  { label: '16:00', value: 520 },
  { label: '16:30', value: 680 },
  { label: '17:00', value: 520 },
]

export const timeRanges = ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'] as const
