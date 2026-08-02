import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { AccountType, accountTypes, useCreateAccountMutation, type AccountType as AccountTypeValue } from '@/api/accounts'
import { useMeQuery } from '@/api/me'
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

type AccountFormValues = {
  name: string
  institutionName?: string
  type: AccountTypeValue
  baseCurrency: string
}

const defaultValues: AccountFormValues = {
  name: '',
  institutionName: '',
  type: AccountType.BROKERAGE,
  baseCurrency: 'CAD',
}

export function AddAccountDialog() {
  const [open, setOpen] = useState(false)
  const meQuery = useMeQuery()
  const createAccount = useCreateAccountMutation()
  const { t } = useTranslation()
  const accountSchema = z.object({
    name: z.string().trim().min(1, t('accounts.form.validation.nameRequired')),
    institutionName: z.string().trim().optional(),
    type: z.enum(AccountType),
    baseCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, t('accounts.form.validation.currencyCode')),
  })
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues,
  })

  const portfolioId = meQuery.data?.default_portfolio_id ?? ''
  if (!portfolioId) {
    return null
  }

  async function onSubmit(values: AccountFormValues) {
    await createAccount.mutateAsync({
      portfolioId,
      body: {
        name: values.name.trim(),
        institution_name: values.institutionName?.trim() || null,
        type: values.type,
        base_currency: values.baseCurrency.trim().toUpperCase(),
      },
    })
    form.reset(defaultValues)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 rounded-full px-4 text-sm shadow-sm">
          <Plus className="h-4 w-4" />
          {t('accounts.form.add')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('accounts.form.title')}</DialogTitle>
          <DialogDescription>{t('accounts.form.description')}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          {createAccount.error ? (
            <Alert variant="destructive">
              <AlertDescription>{createAccount.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="account-name">{t('accounts.form.name')}</Label>
            <Input id="account-name" placeholder={t('accounts.form.namePlaceholder')} {...form.register('name')} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="institution-name">{t('accounts.form.institutionName')}</Label>
            <Input
              id="institution-name"
              placeholder={t('accounts.form.institutionPlaceholder')}
              {...form.register('institutionName')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-type">{t('accounts.form.type')}</Label>
              <Select
                value={form.watch('type')}
                onValueChange={(value) => form.setValue('type', value as AccountFormValues['type'])}
              >
                <SelectTrigger id="account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`accounts.type.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="base-currency">{t('accounts.form.baseCurrency')}</Label>
              <Input
                id="base-currency"
                maxLength={3}
                placeholder={t('accounts.form.baseCurrencyPlaceholder')}
                {...form.register('baseCurrency')}
              />
              {form.formState.errors.baseCurrency ? (
                <p className="text-sm text-destructive">{form.formState.errors.baseCurrency.message}</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={createAccount.isPending}>
              {createAccount.isPending ? t('accounts.form.creating') : t('accounts.form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
