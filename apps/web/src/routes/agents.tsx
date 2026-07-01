import { createFileRoute } from '@tanstack/react-router'
import { Bot } from 'lucide-react'

import { PlaceholderPage } from '@/features/portfolio/placeholder-page'

export const Route = createFileRoute('/agents')({
  component: () => (
    <PlaceholderPage
      title="Connected agents"
      description="Manage read-only MCP agent access, connection status, and available portfolio tools."
      icon={Bot}
      action="Connect agent"
    />
  ),
})
