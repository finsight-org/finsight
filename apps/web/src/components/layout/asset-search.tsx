import { Search } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssetSearchQuery, type AssetSearchResult } from '@/api/assets'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const debounceMs = 300
const searchLimit = 10

export function AssetSearch() {
  const [value, setValue] = useState('')
  const [debouncedValue, setDebouncedValue] = useState('')
  const [open, setOpen] = useState(false)
  const listboxID = useId()
  const { t } = useTranslation()

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value)
    }, debounceMs)

    return () => window.clearTimeout(timeout)
  }, [value])

  const trimmedValue = value.trim()
  const showPanel = open && trimmedValue.length >= 2
  const searchQuery = useAssetSearchQuery(showPanel ? debouncedValue : '', searchLimit)

  function selectAsset(asset: AssetSearchResult) {
    setValue(asset.symbol)
    setDebouncedValue(asset.symbol)
    setOpen(false)
  }

  return (
    <div className="relative min-w-0 flex-1 lg:w-[320px]">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-controls={showPanel ? listboxID : undefined}
        aria-expanded={showPanel}
        aria-label={t('search.label')}
        autoComplete="off"
        className="h-10 rounded-full pl-10 text-sm shadow-sm"
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onChange={(event) => {
          setValue(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('search.placeholder')}
        role="combobox"
        value={value}
      />

      {showPanel ? (
        <div
          id={listboxID}
          role="listbox"
          className="absolute left-0 right-0 top-12 z-50 max-h-96 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-md"
        >
          {searchQuery.isLoading || searchQuery.isFetching ? <AssetSearchLoading /> : null}
          {searchQuery.error ? (
            <p className="px-3 py-2 text-sm text-destructive">{searchQuery.error.message}</p>
          ) : null}
          {!searchQuery.isLoading && !searchQuery.isFetching && !searchQuery.error && searchQuery.data?.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('search.empty')}</p>
          ) : null}
          {!searchQuery.isLoading && !searchQuery.isFetching && !searchQuery.error && searchQuery.data?.length ? (
            <div className="space-y-1">
              {searchQuery.data.map((asset) => (
                <AssetSearchOption key={`${asset.provider_id}:${asset.provider_symbol}`} asset={asset} onSelect={selectAsset} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AssetSearchLoading() {
  const { t } = useTranslation()

  return (
    <div className="space-y-2 p-2" aria-label={t('search.loading')}>
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </div>
  )
}

function AssetSearchOption({
  asset,
  onSelect,
}: {
  asset: AssetSearchResult
  onSelect: (asset: AssetSearchResult) => void
}) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      role="option"
      className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(asset)}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{asset.symbol}</span>
        <span className="block truncate text-xs text-muted-foreground">{asset.name}</span>
        <span className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
          {asset.exchange ? <span>{asset.exchange}</span> : null}
          {asset.currency ? <span>{asset.currency}</span> : null}
          <span>{t('search.provider', { provider: asset.provider_id })}</span>
        </span>
      </span>
      <Badge variant="secondary">{t(`asset.type.${asset.asset_type}`)}</Badge>
    </button>
  )
}
