import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

type PlaceholderPageProps = {
  titleKey: 'placeholders.imports.title' | 'placeholders.agents.title' | 'placeholders.settings.title'
  descriptionKey:
    | 'placeholders.imports.description'
    | 'placeholders.agents.description'
    | 'placeholders.settings.description'
  icon: LucideIcon
  actionKey?: 'placeholders.imports.action' | 'placeholders.agents.action'
}

export function PlaceholderPage({ titleKey, descriptionKey, icon: Icon, actionKey }: PlaceholderPageProps) {
  const { t } = useTranslation()

  return (
    <section className="flex min-h-[560px] items-center justify-center">
      <div className="w-full max-w-2xl rounded-3xl border bg-card p-8 text-card-foreground shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-normal">{t(titleKey)}</h1>
        <p className="mt-3 text-muted-foreground">{t(descriptionKey)}</p>
        {actionKey ? <Button className="mt-6">{t(actionKey)}</Button> : null}
      </div>
    </section>
  )
}
