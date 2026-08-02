package portfoliovalue

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

type Repository interface {
	LoadValuationData(context.Context, uuid.UUID, time.Time) (valuationData, error)
}

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
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) Service {
	return Service{repository: repository, now: time.Now}
}

func NewServiceWithClock(repository Repository, now func() time.Time) Service {
	return Service{repository: repository, now: now}
}

func (s Service) GetOverview(ctx context.Context, portfolioID uuid.UUID) (portfolio.Overview, error) {
	loaded, err := s.loadData(ctx, portfolioID)
	if err != nil {
		return portfolio.Overview{}, err
	}
	baseCurrency := loaded.data.BaseCurrency
	snapshot := calculateSnapshot(loaded.data, baseCurrency, loaded.valuationDate)
	return portfolio.Overview{
		BaseCurrency:  baseCurrency,
		TotalValue:    snapshot.total,
		ValuationDate: loaded.valuationDate,
		Warnings:      snapshot.warnings.list(),
	}, nil
}

func (s Service) GetAccountValues(ctx context.Context, portfolioID uuid.UUID) (portfolio.AccountValues, error) {
	loaded, err := s.loadData(ctx, portfolioID)
	if err != nil {
		return portfolio.AccountValues{}, err
	}
	baseCurrency := loaded.data.BaseCurrency
	snapshot := calculateSnapshot(loaded.data, baseCurrency, loaded.valuationDate)
	return portfolio.AccountValues{
		BaseCurrency:  baseCurrency,
		ValuationDate: loaded.valuationDate,
		Accounts:      snapshot.accounts,
		Warnings:      snapshot.warnings.list(),
	}, nil
}

func (s Service) GetValueHistory(ctx context.Context, portfolioID uuid.UUID, valueRange portfolio.Range) (portfolio.ValueHistory, error) {
	if !portfolio.ValidRange(valueRange) {
		return portfolio.ValueHistory{}, portfolio.ErrInvalidRange
	}

	loaded, err := s.loadData(ctx, portfolioID)
	if err != nil {
		return portfolio.ValueHistory{}, err
	}
	baseCurrency := loaded.data.BaseCurrency

	startDate := historyStartDate(valueRange, loaded.valuationDate, loaded.data.Entries)
	if startDate.IsZero() {
		return portfolio.ValueHistory{BaseCurrency: baseCurrency, Range: valueRange, Points: []portfolio.ValuePoint{}}, nil
	}

	warnings := newWarningSet()
	points := make([]portfolio.ValuePoint, 0, int(loaded.valuationDate.Sub(startDate).Hours()/24)+1)
	for current := startDate; !current.After(loaded.valuationDate); current = current.AddDate(0, 0, 1) {
		snapshot := calculateSnapshot(loaded.data, baseCurrency, current)
		warnings.merge(snapshot.warnings)
		points = append(points, portfolio.ValuePoint{Date: current, Value: snapshot.total})
	}

	return portfolio.ValueHistory{
		BaseCurrency: baseCurrency,
		Range:        valueRange,
		Points:       points,
		Warnings:     warnings.list(),
	}, nil
}

type loadedData struct {
	data          valuationData
	valuationDate time.Time
}

func (s Service) loadData(ctx context.Context, portfolioID uuid.UUID) (loadedData, error) {
	if s.repository == nil {
		return loadedData{}, fmt.Errorf("portfolio repository is required")
	}
	now := time.Now
	if s.now != nil {
		now = s.now
	}
	valuationDate := dateutil.DateOnly(now().UTC())

	data, err := s.repository.LoadValuationData(ctx, portfolioID, valuationDate)
	if err != nil {
		return loadedData{}, fmt.Errorf("load portfolio valuation data: %w", err)
	}
	return loadedData{data: data, valuationDate: valuationDate}, nil
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
