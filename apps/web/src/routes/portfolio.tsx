import { createFileRoute } from '@tanstack/react-router'

import { PortfolioPage } from '@/features/portfolio/portfolio-page'

export const Route = createFileRoute('/portfolio')({
  component: PortfolioPage,
})
