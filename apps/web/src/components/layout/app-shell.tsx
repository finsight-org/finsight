import { Link, Outlet } from '@tanstack/react-router'
import { ChevronDown, Search, UserRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Portfolio', to: '/portfolio' },
  { label: 'Accounts', to: '/accounts' },
  { label: 'Imports', to: '/imports' },
  { label: 'Agents', to: '/agents' },
]

export function AppShell() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Link to="/portfolio" className="text-3xl font-semibold tracking-normal text-foreground">
            FinSight
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
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex w-full items-center gap-2.5 lg:w-auto">
          <div className="relative min-w-0 flex-1 lg:w-[320px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search name or symbol"
              placeholder="Search name or symbol"
              className="h-10 rounded-full pl-10 text-sm shadow-sm"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10 rounded-full px-3.5 shadow-sm" aria-label="Open account menu">
                <UserRound className="h-4 w-4" />
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Local workspace</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">Settings</Link>
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
