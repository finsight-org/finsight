import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

type PlaceholderPageProps = {
  title: string
  description: string
  icon: LucideIcon
  action?: string
}

export function PlaceholderPage({ title, description, icon: Icon, action }: PlaceholderPageProps) {
  return (
    <section className="flex min-h-[560px] items-center justify-center">
      <div className="w-full max-w-2xl rounded-3xl border bg-card p-8 text-card-foreground shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-3 text-muted-foreground">{description}</p>
        {action ? <Button className="mt-6">{action}</Button> : null}
      </div>
    </section>
  )
}
