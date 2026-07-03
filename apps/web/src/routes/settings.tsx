import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'

import { PlaceholderPage } from '@/features/portfolio/placeholder-page'

export const Route = createFileRoute('/settings')({
  component: () => (
    <PlaceholderPage
      titleKey="placeholders.settings.title"
      descriptionKey="placeholders.settings.description"
      icon={Settings}
    />
  ),
})
