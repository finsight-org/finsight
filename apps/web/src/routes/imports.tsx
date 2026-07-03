import { createFileRoute } from '@tanstack/react-router'
import { Upload } from 'lucide-react'

import { PlaceholderPage } from '@/features/portfolio/placeholder-page'

export const Route = createFileRoute('/imports')({
  component: () => (
    <PlaceholderPage
      titleKey="placeholders.imports.title"
      descriptionKey="placeholders.imports.description"
      icon={Upload}
      actionKey="placeholders.imports.action"
    />
  ),
})
