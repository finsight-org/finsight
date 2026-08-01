import { Link, Outlet } from '@tanstack/react-router'
import { ChevronDown, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { AssetSearch } from '@/components/layout/asset-search'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const navItems = [
  { labelKey: 'nav.portfolio', to: '/portfolio' },
  { labelKey: 'nav.imports', to: '/imports' },
  { labelKey: 'nav.agents', to: '/agents' },
] as const

export function AppShell() {
  const { t } = useTranslation()

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Link to="/portfolio" className="text-3xl font-semibold tracking-normal text-foreground">
            {t('app.brand')}
          </Link>
          <nav className="flex flex-wrap items-center gap-5 text-[13px] font-medium text-muted-foreground">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={item.to === '/portfolio' ? { exact: false } : { exact: true }}
                className="border-b-2 border-transparent pb-1 transition-colors hover:text-foreground"
                activeProps={{
                  className: 'border-foreground text-foreground',
                }}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex w-full items-center gap-2.5 lg:w-auto">
          <AssetSearch />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-10 rounded-full px-3.5 shadow-sm"
                aria-label={t('accountMenu.open')}
              >
                <UserRound className="h-4 w-4" />
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t('accountMenu.workspace')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">{t('nav.settings')}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className={cn('mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-6')}>
        <Outlet />
      </main>
    </div>
  )
}
