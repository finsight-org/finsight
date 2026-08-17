package portfoliovalue

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
	db "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

type valuationAccount struct {
	ID   uuid.UUID
	Name string
}

type valuationEntry struct {
	AccountID     uuid.UUID
	AccountName   string
	AssetID       uuid.UUID
	AssetName     string
	AssetType     string
	AssetCurrency string
	EntryType     string
	Quantity      decimal.Decimal
	Amount        decimal.Decimal
	EntryCurrency string
	TradeDate     time.Time
}

type marketPrice struct {
	AssetID       uuid.UUID
	Date          time.Time
	Price         decimal.Decimal
	Currency      string
	ProviderID    string
	SourceQuality string
}

type fxRate struct {
	FromCurrency  string
	ToCurrency    string
	Date          time.Time
	Rate          decimal.Decimal
	ProviderID    string
	SourceQuality string
}

type valuationData struct {
	BaseCurrency string
	Accounts     []valuationAccount
	Entries      []valuationEntry
	Prices       []marketPrice
	FXRates      []fxRate
}

type Service struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewService(pool *pgxpool.Pool) Service {
	return NewServiceWithClock(pool, time.Now)
}

func NewServiceWithClock(pool *pgxpool.Pool, now func() time.Time) Service {
	return Service{pool: pool, now: now}
}

func (s Service) GetOverview(ctx context.Context, portfolioID uuid.UUID) (portfolio.Overview, error) {
	loaded, err := s.loadData(ctx, portfolioID)
	if err != nil {
		return portfolio.Overview{}, err
	}
	return calculateOverview(loaded.data, loaded.valuationDate), nil
}

func (s Service) GetAccountValues(ctx context.Context, portfolioID uuid.UUID) (portfolio.AccountValues, error) {
	loaded, err := s.loadData(ctx, portfolioID)
	if err != nil {
		return portfolio.AccountValues{}, err
	}
	return calculateAccountValues(loaded.data, loaded.valuationDate), nil
}

func (s Service) GetValueHistory(ctx context.Context, portfolioID uuid.UUID, valueRange portfolio.Range) (portfolio.ValueHistory, error) {
	if !portfolio.ValidRange(valueRange) {
		return portfolio.ValueHistory{}, portfolio.ErrInvalidRange
	}

	loaded, err := s.loadData(ctx, portfolioID)
	if err != nil {
		return portfolio.ValueHistory{}, err
	}
	return calculateValueHistory(loaded.data, valueRange, loaded.valuationDate), nil
}

func calculateOverview(data valuationData, valuationDate time.Time) portfolio.Overview {
	snapshot := calculateSnapshot(data, data.BaseCurrency, valuationDate)
	return portfolio.Overview{
		BaseCurrency:  data.BaseCurrency,
		TotalValue:    snapshot.total,
		ValuationDate: valuationDate,
		Warnings:      snapshot.warnings.list(),
	}
}

func calculateAccountValues(data valuationData, valuationDate time.Time) portfolio.AccountValues {
	snapshot := calculateSnapshot(data, data.BaseCurrency, valuationDate)
	return portfolio.AccountValues{
		BaseCurrency:  data.BaseCurrency,
		ValuationDate: valuationDate,
		Accounts:      snapshot.accounts,
		Warnings:      snapshot.warnings.list(),
	}
}

func calculateValueHistory(data valuationData, valueRange portfolio.Range, valuationDate time.Time) portfolio.ValueHistory {
	baseCurrency := data.BaseCurrency
	startDate := historyStartDate(valueRange, valuationDate, data.Entries)
	if startDate.IsZero() {
		return portfolio.ValueHistory{BaseCurrency: baseCurrency, Range: valueRange, Points: []portfolio.ValuePoint{}}
	}

	warnings := newWarningSet()
	points := make([]portfolio.ValuePoint, 0, int(valuationDate.Sub(startDate).Hours()/24)+1)
	for current := startDate; !current.After(valuationDate); current = current.AddDate(0, 0, 1) {
		snapshot := calculateSnapshot(data, baseCurrency, current)
		warnings.merge(snapshot.warnings)
		points = append(points, portfolio.ValuePoint{Date: current, Value: snapshot.total})
	}

	return portfolio.ValueHistory{
		BaseCurrency: baseCurrency,
		Range:        valueRange,
		Points:       points,
		Warnings:     warnings.list(),
	}
}

type loadedData struct {
	data          valuationData
	valuationDate time.Time
}

func (s Service) loadData(ctx context.Context, portfolioID uuid.UUID) (loadedData, error) {
	if s.pool == nil {
		return loadedData{}, fmt.Errorf("postgres pool is required")
	}
	now := time.Now
	if s.now != nil {
		now = s.now
	}
	valuationDate := dateutil.DateOnly(now().UTC())

	data, err := s.loadValuationData(ctx, portfolioID, valuationDate)
	if err != nil {
		return loadedData{}, fmt.Errorf("load portfolio valuation data: %w", err)
	}
	return loadedData{data: data, valuationDate: valuationDate}, nil
}

func (s Service) loadValuationData(ctx context.Context, portfolioID uuid.UUID, endDate time.Time) (valuationData, error) {
	queries := db.New(s.pool)
	portfolioContext, err := queries.GetPortfolioValuationContext(ctx, pgconv.UUID(portfolioID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return valuationData{}, portfolio.ErrNotFound
		}
		return valuationData{}, fmt.Errorf("select portfolio valuation context: %w", err)
	}
	workspaceID, err := pgconv.DomainUUID(portfolioContext.WorkspaceID)
	if err != nil {
		return valuationData{}, fmt.Errorf("map portfolio workspace id: %w", err)
	}

	accountRows, err := queries.ListPortfolioAccountsForValuation(ctx, pgconv.UUID(portfolioID))
	if err != nil {
		return valuationData{}, fmt.Errorf("select portfolio accounts: %w", err)
	}
	entryRows, err := queries.ListPortfolioLedgerEntriesForValuation(ctx, db.ListPortfolioLedgerEntriesForValuationParams{
		PortfolioID: pgconv.UUID(portfolioID),
		EndDate:     pgconv.Date(endDate),
	})
	if err != nil {
		return valuationData{}, fmt.Errorf("select portfolio ledger entries: %w", err)
	}
	priceRows, err := queries.ListPortfolioMarketPricesForValuation(ctx, db.ListPortfolioMarketPricesForValuationParams{
		EndDate:     pgconv.Date(endDate),
		PortfolioID: pgconv.UUID(portfolioID),
	})
	if err != nil {
		return valuationData{}, fmt.Errorf("select portfolio market prices: %w", err)
	}
	fxRateRows, err := queries.ListPortfolioFxRatesForValuation(ctx, db.ListPortfolioFxRatesForValuationParams{
		WorkspaceID:  pgconv.UUID(workspaceID),
		PortfolioID:  pgconv.UUID(portfolioID),
		BaseCurrency: portfolioContext.BaseCurrency,
		EndDate:      pgconv.Date(endDate),
	})
	if err != nil {
		return valuationData{}, fmt.Errorf("select portfolio fx rates: %w", err)
	}

	data := valuationData{
		BaseCurrency: portfolioContext.BaseCurrency,
		Accounts:     make([]valuationAccount, 0, len(accountRows)),
		Entries:      make([]valuationEntry, 0, len(entryRows)),
		Prices:       make([]marketPrice, 0, len(priceRows)),
		FXRates:      make([]fxRate, 0, len(fxRateRows)),
	}
	for _, row := range accountRows {
		id, err := pgconv.DomainUUID(row.ID)
		if err != nil {
			return valuationData{}, fmt.Errorf("map account id: %w", err)
		}
		data.Accounts = append(data.Accounts, valuationAccount{ID: id, Name: row.Name})
	}
	for _, row := range entryRows {
		entry, err := mapValuationEntry(row)
		if err != nil {
			return valuationData{}, fmt.Errorf("map ledger entry: %w", err)
		}
		data.Entries = append(data.Entries, entry)
	}
	for _, row := range priceRows {
		price, err := mapMarketPrice(row)
		if err != nil {
			return valuationData{}, fmt.Errorf("map market price: %w", err)
		}
		data.Prices = append(data.Prices, price)
	}
	for _, row := range fxRateRows {
		rate, err := mapFXRate(row)
		if err != nil {
			return valuationData{}, fmt.Errorf("map fx rate: %w", err)
		}
		data.FXRates = append(data.FXRates, rate)
	}
	return data, nil
}

func mapValuationEntry(row db.ListPortfolioLedgerEntriesForValuationRow) (valuationEntry, error) {
	accountID, err := pgconv.DomainUUID(row.AccountID)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("account id: %w", err)
	}
	assetID, err := pgconv.DomainUUID(row.AssetID)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("asset id: %w", err)
	}
	quantity, err := pgconv.DomainNumeric(row.Quantity)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("quantity: %w", err)
	}
	amount, err := pgconv.DomainNumeric(row.Amount)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("amount: %w", err)
	}
	tradeDate, err := pgconv.DomainDate(row.TradeDate)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("trade date: %w", err)
	}
	return valuationEntry{AccountID: accountID, AccountName: row.AccountName, AssetID: assetID, AssetName: row.AssetName, AssetType: row.AssetType, AssetCurrency: row.AssetCurrency, EntryType: row.EntryType, Quantity: quantity, Amount: amount, EntryCurrency: row.EntryCurrency, TradeDate: tradeDate}, nil
}

func mapMarketPrice(row db.ListPortfolioMarketPricesForValuationRow) (marketPrice, error) {
	assetID, err := pgconv.DomainUUID(row.AssetID)
	if err != nil {
		return marketPrice{}, fmt.Errorf("asset id: %w", err)
	}
	date, err := pgconv.DomainDate(row.Date)
	if err != nil {
		return marketPrice{}, fmt.Errorf("date: %w", err)
	}
	price, err := pgconv.DomainNumeric(row.Price)
	if err != nil {
		return marketPrice{}, fmt.Errorf("price: %w", err)
	}
	return marketPrice{AssetID: assetID, Date: date, Price: price, Currency: row.Currency, ProviderID: row.ProviderID, SourceQuality: row.SourceQuality}, nil
}

func mapFXRate(row db.ListPortfolioFxRatesForValuationRow) (fxRate, error) {
	date, err := pgconv.DomainDate(row.Date)
	if err != nil {
		return fxRate{}, fmt.Errorf("date: %w", err)
	}
	rate, err := pgconv.DomainNumeric(row.Rate)
	if err != nil {
		return fxRate{}, fmt.Errorf("rate: %w", err)
	}
	return fxRate{FromCurrency: row.FromCurrency, ToCurrency: row.ToCurrency, Date: date, Rate: rate, ProviderID: row.ProviderID, SourceQuality: row.SourceQuality}, nil
}

type accountAssetKey struct {
	accountID uuid.UUID
	assetID   uuid.UUID
}

type fxRateKey struct {
	fromCurrency string
	toCurrency   string
}

type selectedPrice struct {
	price       marketPrice
	convertible bool
}

type snapshot struct {
	total    decimal.Decimal
	accounts []portfolio.AccountValue
	warnings warningSet
}

func calculateSnapshot(data valuationData, baseCurrency string, valuationDate time.Time) snapshot {
	accountValues := make(map[uuid.UUID]decimal.Decimal, len(data.Accounts))
	accountNames := make(map[uuid.UUID]string, len(data.Accounts))
	for _, account := range data.Accounts {
		accountValues[account.ID] = decimal.Zero
		accountNames[account.ID] = account.Name
	}

	positions := map[accountAssetKey]decimal.Decimal{}
	assetNames := map[uuid.UUID]string{}
	warnings := newWarningSet()
	fxRates := latestFXRates(data.FXRates, baseCurrency, valuationDate)

	for _, entry := range data.Entries {
		if entry.TradeDate.After(valuationDate) {
			continue
		}

		accountNames[entry.AccountID] = entry.AccountName
		if _, ok := accountValues[entry.AccountID]; !ok {
			accountValues[entry.AccountID] = decimal.Zero
		}

		switch entry.EntryType {
		case "CASH":
			converted, ok := convertMoney(entry.Amount, entry.EntryCurrency, baseCurrency, fxRates, warnings, entry.AssetName)
			if ok {
				accountValues[entry.AccountID] = accountValues[entry.AccountID].Add(converted)
			}
		case "ASSET_QUANTITY":
			key := accountAssetKey{accountID: entry.AccountID, assetID: entry.AssetID}
			positions[key] = positions[key].Add(entry.Quantity)
			assetNames[entry.AssetID] = entry.AssetName
		}
	}

	prices := latestPrices(data.Prices, baseCurrency, valuationDate, fxRates)
	for key, quantity := range positions {
		if quantity.IsZero() {
			continue
		}
		selected, ok := prices[key.assetID]
		if !ok {
			warnings.add("missing_price", fmt.Sprintf("Missing market price for %s.", assetNames[key.assetID]))
			continue
		}
		price := selected.price
		marketValue := quantity.Mul(price.Price)
		converted, ok := convertMoney(marketValue, price.Currency, baseCurrency, fxRates, warnings, assetNames[key.assetID])
		if ok {
			accountValues[key.accountID] = accountValues[key.accountID].Add(converted)
		}
	}

	total := decimal.Zero
	for _, value := range accountValues {
		total = total.Add(value)
	}

	accounts := make([]portfolio.AccountValue, 0, len(accountValues))
	for accountID, value := range accountValues {
		allocation := decimal.Zero
		if !total.IsZero() {
			allocation = value.Div(total).Mul(decimal.NewFromInt(100))
		}
		accounts = append(accounts, portfolio.AccountValue{
			AccountID:         accountID,
			AccountName:       accountNames[accountID],
			Value:             value,
			AllocationPercent: allocation,
		})
	}
	sort.Slice(accounts, func(i, j int) bool {
		return accounts[i].AccountName < accounts[j].AccountName
	})

	return snapshot{total: total, accounts: accounts, warnings: warnings}
}

func latestPrices(prices []marketPrice, baseCurrency string, valuationDate time.Time, rates map[fxRateKey]fxRate) map[uuid.UUID]selectedPrice {
	latest := map[uuid.UUID]selectedPrice{}
	for _, price := range prices {
		if price.Date.After(valuationDate) {
			continue
		}
		candidate := selectedPrice{
			price:       price,
			convertible: canConvertCurrency(price.Currency, baseCurrency, rates),
		}
		current, ok := latest[price.AssetID]
		if !ok || preferredPriceSelection(candidate, current) {
			latest[price.AssetID] = candidate
		}
	}

	return latest
}

func latestFXRates(rates []fxRate, baseCurrency string, valuationDate time.Time) map[fxRateKey]fxRate {
	latest := map[fxRateKey]fxRate{}
	for _, rate := range rates {
		if rate.Date.After(valuationDate) || rate.ToCurrency != baseCurrency {
			continue
		}
		key := fxRateKey{fromCurrency: rate.FromCurrency, toCurrency: rate.ToCurrency}
		current, ok := latest[key]
		if !ok || preferredFXRate(rate, current) {
			latest[key] = rate
		}
	}
	return latest
}

func canConvertCurrency(currency string, baseCurrency string, rates map[fxRateKey]fxRate) bool {
	if currency == baseCurrency {
		return true
	}
	_, ok := rates[fxRateKey{fromCurrency: currency, toCurrency: baseCurrency}]
	return ok
}

func convertMoney(amount decimal.Decimal, currency string, baseCurrency string, rates map[fxRateKey]fxRate, warnings warningSet, label string) (decimal.Decimal, bool) {
	if currency == baseCurrency {
		return amount, true
	}
	rate, ok := rates[fxRateKey{fromCurrency: currency, toCurrency: baseCurrency}]
	if !ok {
		warnings.add("missing_fx_rate", fmt.Sprintf("Missing %s to %s FX rate for %s.", currency, baseCurrency, label))
		return decimal.Zero, false
	}
	return amount.Mul(rate.Rate), true
}

func preferredPriceSelection(candidate selectedPrice, current selectedPrice) bool {
	if candidate.convertible != current.convertible {
		return candidate.convertible
	}
	return preferredPrice(candidate.price, current.price)
}

func preferredPrice(candidate marketPrice, current marketPrice) bool {
	if candidate.Date.After(current.Date) {
		return true
	}
	if !candidate.Date.Equal(current.Date) {
		return false
	}
	candidateRank := sourceQualityRank(candidate.SourceQuality)
	currentRank := sourceQualityRank(current.SourceQuality)
	if candidateRank != currentRank {
		return candidateRank > currentRank
	}
	if candidate.ProviderID != current.ProviderID {
		return candidate.ProviderID < current.ProviderID
	}
	return candidate.Price.String() < current.Price.String()
}

func preferredFXRate(candidate fxRate, current fxRate) bool {
	if candidate.Date.After(current.Date) {
		return true
	}
	if !candidate.Date.Equal(current.Date) {
		return false
	}
	candidateRank := sourceQualityRank(candidate.SourceQuality)
	currentRank := sourceQualityRank(current.SourceQuality)
	if candidateRank != currentRank {
		return candidateRank > currentRank
	}
	if candidate.ProviderID != current.ProviderID {
		return candidate.ProviderID < current.ProviderID
	}
	return candidate.Rate.String() < current.Rate.String()
}

func sourceQualityRank(value string) int {
	switch value {
	case "DEMO":
		return 3
	case "PROVIDER":
		return 2
	case "MANUAL":
		return 1
	default:
		return 0
	}
}

func historyStartDate(valueRange portfolio.Range, valuationDate time.Time, entries []valuationEntry) time.Time {
	switch valueRange {
	case portfolio.RangeOneDay:
		return valuationDate
	case portfolio.RangeOneWeek:
		return valuationDate.AddDate(0, 0, -6)
	case portfolio.RangeOneMonth:
		return valuationDate.AddDate(0, -1, 0)
	case portfolio.RangeThreeMonths:
		return valuationDate.AddDate(0, -3, 0)
	case portfolio.RangeYearToDate:
		return time.Date(valuationDate.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	case portfolio.RangeOneYear:
		return valuationDate.AddDate(-1, 0, 0)
	case portfolio.RangeAll:
		return earliestEntryDate(entries)
	default:
		return time.Time{}
	}
}

func earliestEntryDate(entries []valuationEntry) time.Time {
	var earliest time.Time
	for _, entry := range entries {
		if earliest.IsZero() || entry.TradeDate.Before(earliest) {
			earliest = entry.TradeDate
		}
	}
	return earliest
}

type warningSet map[string]portfolio.Warning

func newWarningSet() warningSet {
	return warningSet{}
}

func (w warningSet) add(code string, message string) {
	key := code + ":" + message
	w[key] = portfolio.Warning{Code: code, Message: message}
}

func (w warningSet) merge(other warningSet) {
	for key, value := range other {
		w[key] = value
	}
}

func (w warningSet) list() []portfolio.Warning {
	warnings := make([]portfolio.Warning, 0, len(w))
	for _, warning := range w {
		warnings = append(warnings, warning)
	}
	sort.Slice(warnings, func(i, j int) bool {
		if warnings[i].Code == warnings[j].Code {
			return warnings[i].Message < warnings[j].Message
		}
		return warnings[i].Code < warnings[j].Code
	})
	return warnings
}
