import { createFileRoute } from '@tanstack/react-router'
import { Upload } from 'lucide-react'

import { PlaceholderPage } from '@/features/portfolio/placeholder-page'

export const Route = createFileRoute('/imports')({
  component: () => (
    <PlaceholderPage
      title="Imports"
      description="Upload, review, and confirm investment data. This skeleton leaves extraction and review workflows for the next MVP feature pass."
      icon={Upload}
      action="Start import"
    />
  ),
})
