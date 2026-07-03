import { createFileRoute } from '@tanstack/react-router'
import { Bot } from 'lucide-react'

import { PlaceholderPage } from '@/features/portfolio/placeholder-page'

export const Route = createFileRoute('/agents')({
  component: () => (
    <PlaceholderPage
      titleKey="placeholders.agents.title"
      descriptionKey="placeholders.agents.description"
      icon={Bot}
      actionKey="placeholders.agents.action"
    />
  ),
})
