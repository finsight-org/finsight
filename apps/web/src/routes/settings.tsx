import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'

import { PlaceholderPage } from '@/features/portfolio/placeholder-page'

export const Route = createFileRoute('/settings')({
  component: () => (
    <PlaceholderPage
      title="Settings"
      description="Workspace, local mode, and deployment settings will live here as the product grows."
      icon={Settings}
    />
  ),
})
