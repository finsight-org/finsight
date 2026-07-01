import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'

import type { Account } from '@/api/accounts'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const columnHelper = createColumnHelper<Account>()

const columns = [
  columnHelper.accessor('name', {
    header: 'Account',
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor('institution_name', {
    header: 'Institution',
    cell: (info) => info.getValue() || 'None',
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    cell: (info) => info.getValue().replaceAll('_', ' ').toLowerCase(),
  }),
  columnHelper.accessor('base_currency', {
    header: 'Currency',
    cell: (info) => info.getValue(),
  }),
]

export function AccountsTable({ accounts }: { accounts: Account[] }) {
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
