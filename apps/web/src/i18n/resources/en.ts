export const en = {
  app: {
    brand: 'FinSight',
  },
  nav: {
    portfolio: 'Portfolio',
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
      emptyValue: '$0.00',
      loading: 'Loading portfolio value',
      valuationDate: 'Value as of {{date}}',
      baseline: '{{value}}',
      loadErrorTitle: 'Portfolio value could not load',
    },
    valueNote: 'Portfolio value note',
    valueTooltip: 'Portfolio values are derived from confirmed transactions, ledger entries, and market prices.',
    chart: {
      loadErrorTitle: 'Portfolio history could not load',
      empty: 'No portfolio value history is available yet.',
    },
    accounts: {
      loading: 'Loading account values',
      loadErrorTitle: 'Account values could not load',
      emptyTitle: 'No account values yet',
      emptyDescription: 'Seed demo data or import transactions to calculate account values.',
      allocation: '{{value}}% allocation',
    },
    tabs: {
      accountValue: 'Account value',
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
    accountCreate: 'Could not create the account.',
    accountCreateNoData: 'The account was created, but the API returned no account data.',
    assetSearch: 'Could not search assets.',
    portfolioOverview: 'Could not load portfolio value.',
    portfolioOverviewNoData: 'The portfolio value API returned no data.',
    portfolioValueHistory: 'Could not load portfolio value history.',
    portfolioValueHistoryNoData: 'The portfolio value history API returned no data.',
    portfolioAccountValues: 'Could not load account values.',
    portfolioAccountValuesNoData: 'The account values API returned no data.',
  },
} as const
