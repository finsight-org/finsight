export const en = {
  app: {
    brand: 'FinSight',
  },
  nav: {
    portfolio: 'Portfolio',
    accounts: 'Accounts',
    imports: 'Imports',
    agents: 'Agents',
    settings: 'Settings',
  },
  search: {
    label: 'Search name or symbol',
    placeholder: 'Search name or symbol',
    loading: 'Loading asset search results',
    empty: 'No assets found',
    provider: '{{provider}} provider',
  },
  asset: {
    type: {
      EQUITY: 'Equity',
      ETF: 'ETF',
      MUTUAL_FUND: 'Mutual fund',
      CRYPTO: 'Crypto',
      CASH: 'Cash',
      OTHER: 'Other',
    },
  },
  accountMenu: {
    open: 'Open account menu',
    workspace: 'Local workspace',
  },
  portfolio: {
    summary: {
      value: '$2,000.00 CAD',
      dailyChange: '+$18.00 CAD (+0.90%) past day',
      baseline: '$0.00',
    },
    valueNote: 'Portfolio value note',
    valueTooltip: 'Temporary mock summary until portfolio endpoints are available.',
    tabs: {
      accountValue: 'Account value',
      returns: 'Returns',
      ranges: {
        oneDay: '1D',
        oneWeek: '1W',
        oneMonth: '1M',
        threeMonths: '3M',
        yearToDate: 'YTD',
        oneYear: '1Y',
        all: 'ALL',
      },
    },
  },
  accounts: {
    title: 'Accounts',
    description: 'Where investment data and imported transactions are grouped.',
    loading: 'Loading accounts',
    loadErrorTitle: 'Accounts could not load',
    emptyTitle: 'No accounts yet',
    emptyDescription:
      'Create the first account before importing investment data. Portfolio insights will appear after confirmed imports create transactions.',
    noInstitution: 'No institution',
    updatedAt: 'Updated {{date}}',
    valuePending: 'Value pending',
    valuePendingDescription: 'Import transactions to calculate value',
    table: {
      account: 'Account',
      institution: 'Institution',
      none: 'None',
      type: 'Type',
      currency: 'Currency',
    },
    type: {
      BROKERAGE: 'Brokerage',
      BANK: 'Bank',
      CRYPTO_EXCHANGE: 'Crypto exchange',
      RETIREMENT: 'Retirement',
      MANUAL: 'Manual',
    },
    form: {
      add: 'Add an account',
      title: 'Add an account',
      description: 'Create an account where imported transactions will be stored.',
      name: 'Account name',
      namePlaceholder: 'Wealthsimple',
      institutionName: 'Institution name',
      institutionPlaceholder: 'Wealthsimple',
      type: 'Type',
      baseCurrency: 'Base currency',
      baseCurrencyPlaceholder: 'CAD',
      creating: 'Creating...',
      create: 'Create account',
      validation: {
        nameRequired: 'Account name is required.',
        currencyCode: 'Use a 3-letter currency code.',
      },
    },
  },
  placeholders: {
    imports: {
      title: 'Imports',
      description:
        'Upload, review, and confirm investment data. This skeleton leaves extraction and review workflows for the next MVP feature pass.',
      action: 'Start import',
    },
    agents: {
      title: 'Connected agents',
      description: 'Manage read-only MCP agent access, connection status, and available portfolio tools.',
      action: 'Connect agent',
    },
    settings: {
      title: 'Settings',
      description: 'Workspace, local mode, and deployment settings will live here as the product grows.',
    },
  },
  errors: {
    accountsLoad: 'Could not load accounts.',
    accountCreate: 'Could not create the account.',
    accountCreateNoData: 'The account was created, but the API returned no account data.',
    assetSearch: 'Could not search assets.',
  },
} as const
