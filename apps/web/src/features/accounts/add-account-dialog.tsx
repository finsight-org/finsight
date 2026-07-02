import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { accountTypes, useCreateAccountMutation } from '@/api/accounts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const accountSchema = z.object({
  name: z.string().trim().min(1, 'Account name is required.'),
  institutionName: z.string().trim().optional(),
  type: z.enum(accountTypes),
  baseCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code.'),
})

type AccountFormValues = z.infer<typeof accountSchema>

const defaultValues: AccountFormValues = {
  name: '',
  institutionName: '',
  type: 'BROKERAGE',
  baseCurrency: 'CAD',
}

export function AddAccountDialog() {
  const [open, setOpen] = useState(false)
  const createAccount = useCreateAccountMutation()
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues,
  })

  async function onSubmit(values: AccountFormValues) {
    await createAccount.mutateAsync({
      name: values.name.trim(),
      institution_name: values.institutionName?.trim() || null,
      type: values.type,
      base_currency: values.baseCurrency.trim().toUpperCase(),
    })
    form.reset(defaultValues)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 rounded-full px-4 text-sm shadow-sm">
          <Plus className="h-4 w-4" />
          Add an account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an account</DialogTitle>
          <DialogDescription>Create an account where imported transactions will be stored.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          {createAccount.error ? (
            <Alert variant="destructive">
              <AlertDescription>{createAccount.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="account-name">Account name</Label>
            <Input id="account-name" placeholder="Wealthsimple" {...form.register('name')} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="institution-name">Institution name</Label>
            <Input id="institution-name" placeholder="Wealthsimple" {...form.register('institutionName')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-type">Type</Label>
              <Select value={form.watch('type')} onValueChange={(value) => form.setValue('type', value as AccountFormValues['type'])}>
                <SelectTrigger id="account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.replaceAll('_', ' ').toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="base-currency">Base currency</Label>
              <Input id="base-currency" maxLength={3} placeholder="CAD" {...form.register('baseCurrency')} />
              {form.formState.errors.baseCurrency ? (
                <p className="text-sm text-destructive">{form.formState.errors.baseCurrency.message}</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={createAccount.isPending}>
              {createAccount.isPending ? 'Creating...' : 'Create account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
