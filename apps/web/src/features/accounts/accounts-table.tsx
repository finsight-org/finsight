import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { Account } from '@/api/accounts'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const columnHelper = createColumnHelper<Account>()

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation()
  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: t('accounts.table.account'),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('institution_name', {
        header: t('accounts.table.institution'),
        cell: (info) => info.getValue() || t('accounts.table.none'),
      }),
      columnHelper.accessor('type', {
        header: t('accounts.table.type'),
        cell: (info) => t(`accounts.type.${info.getValue()}`),
      }),
      columnHelper.accessor('base_currency', {
        header: t('accounts.table.currency'),
        cell: (info) => info.getValue(),
      }),
    ],
    [t],
  )
  const table = useReactTable({
    data: accounts,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
