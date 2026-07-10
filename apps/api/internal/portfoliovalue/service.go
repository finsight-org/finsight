package portfoliovalue

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

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

type valuationData struct {
	Accounts []valuationAccount
	Entries  []valuationEntry
	Prices   []marketPrice
}

type Service struct {
	bootstrap  LocalBootstrapper
	repository Repository
	now        func() time.Time
}

func NewService(bootstrap LocalBootstrapper, repository Repository) Service {
	return Service{bootstrap: bootstrap, repository: repository, now: time.Now}
}

func NewServiceWithClock(bootstrap LocalBootstrapper, repository Repository, now func() time.Time) Service {
	return Service{bootstrap: bootstrap, repository: repository, now: now}
}

func (s Service) GetOverview(ctx context.Context) (portfolio.Overview, error) {
	data, valuationDate, err := s.loadData(ctx)
	if err != nil {
		return portfolio.Overview{}, err
	}
	snapshot := calculateSnapshot(data, valuationDate)
	return portfolio.Overview{
		BaseCurrency:  portfolio.BaseCurrencyCAD,
		TotalValue:    snapshot.total,
		ValuationDate: valuationDate,
		Warnings:      snapshot.warnings.list(),
	}, nil
}

func (s Service) GetAccountValues(ctx context.Context) (portfolio.AccountValues, error) {
	data, valuationDate, err := s.loadData(ctx)
	if err != nil {
		return portfolio.AccountValues{}, err
	}
	snapshot := calculateSnapshot(data, valuationDate)
	return portfolio.AccountValues{
		BaseCurrency:  portfolio.BaseCurrencyCAD,
		ValuationDate: valuationDate,
		Accounts:      snapshot.accounts,
		Warnings:      snapshot.warnings.list(),
	}, nil
}

func (s Service) GetValueHistory(ctx context.Context, valueRange portfolio.Range) (portfolio.ValueHistory, error) {
	if !portfolio.ValidRange(valueRange) {
		return portfolio.ValueHistory{}, portfolio.ErrInvalidRange
	}

	data, valuationDate, err := s.loadData(ctx)
	if err != nil {
		return portfolio.ValueHistory{}, err
	}

	startDate := historyStartDate(valueRange, valuationDate, data.Entries)
	if startDate.IsZero() {
		return portfolio.ValueHistory{BaseCurrency: portfolio.BaseCurrencyCAD, Range: valueRange, Points: []portfolio.ValuePoint{}}, nil
	}

	warnings := newWarningSet()
	points := make([]portfolio.ValuePoint, 0, int(valuationDate.Sub(startDate).Hours()/24)+1)
	for current := startDate; !current.After(valuationDate); current = current.AddDate(0, 0, 1) {
		snapshot := calculateSnapshot(data, current)
		warnings.merge(snapshot.warnings)
		points = append(points, portfolio.ValuePoint{Date: current, Value: snapshot.total})
	}

	return portfolio.ValueHistory{
		BaseCurrency: portfolio.BaseCurrencyCAD,
		Range:        valueRange,
		Points:       points,
		Warnings:     warnings.list(),
	}, nil
}

func (s Service) loadData(ctx context.Context) (valuationData, time.Time, error) {
	if s.bootstrap == nil {
		return valuationData{}, time.Time{}, fmt.Errorf("portfolio bootstrapper is required")
	}
	if s.repository == nil {
		return valuationData{}, time.Time{}, fmt.Errorf("portfolio repository is required")
	}
	now := time.Now
	if s.now != nil {
		now = s.now
	}
	valuationDate := dateutil.DateOnly(now().UTC())

	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return valuationData{}, time.Time{}, fmt.Errorf("resolve local portfolio context: %w", err)
	}

	data, err := s.repository.LoadValuationData(ctx, localContext.Portfolio.ID, valuationDate)
	if err != nil {
		return valuationData{}, time.Time{}, fmt.Errorf("load portfolio valuation data: %w", err)
	}
	return data, valuationDate, nil
}

type accountAssetKey struct {
	accountID uuid.UUID
	assetID   uuid.UUID
}

type snapshot struct {
	total    decimal.Decimal
	accounts []portfolio.AccountValue
	warnings warningSet
}

func calculateSnapshot(data valuationData, valuationDate time.Time) snapshot {
	accountValues := make(map[uuid.UUID]decimal.Decimal, len(data.Accounts))
	accountNames := make(map[uuid.UUID]string, len(data.Accounts))
	for _, account := range data.Accounts {
		accountValues[account.ID] = decimal.Zero
		accountNames[account.ID] = account.Name
	}

	positions := map[accountAssetKey]decimal.Decimal{}
	assetNames := map[uuid.UUID]string{}
	warnings := newWarningSet()

	for _, entry := range data.Entries {
		if entry.TradeDate.After(valuationDate) {
			continue
		}
		if entry.EntryCurrency != portfolio.BaseCurrencyCAD || entry.AssetCurrency != portfolio.BaseCurrencyCAD {
			warnings.add("unsupported_currency", fmt.Sprintf("Only CAD records are included in this portfolio value slice; %s was excluded.", entry.AssetName))
			continue
		}

		accountNames[entry.AccountID] = entry.AccountName
		if _, ok := accountValues[entry.AccountID]; !ok {
			accountValues[entry.AccountID] = decimal.Zero
		}

		switch entry.EntryType {
		case "CASH":
			accountValues[entry.AccountID] = accountValues[entry.AccountID].Add(entry.Amount)
		case "ASSET_QUANTITY":
			key := accountAssetKey{accountID: entry.AccountID, assetID: entry.AssetID}
			positions[key] = positions[key].Add(entry.Quantity)
			assetNames[entry.AssetID] = entry.AssetName
		}
	}

	prices := latestPrices(data.Prices, valuationDate, warnings)
	for key, quantity := range positions {
		if quantity.IsZero() {
			continue
		}
		price, ok := prices[key.assetID]
		if !ok {
			warnings.add("missing_price", fmt.Sprintf("Missing CAD market price for %s.", assetNames[key.assetID]))
			continue
		}
		accountValues[key.accountID] = accountValues[key.accountID].Add(quantity.Mul(price))
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

func latestPrices(prices []marketPrice, valuationDate time.Time, warnings warningSet) map[uuid.UUID]decimal.Decimal {
	latest := map[uuid.UUID]marketPrice{}
	for _, price := range prices {
		if price.Date.After(valuationDate) {
			continue
		}
		if price.Currency != portfolio.BaseCurrencyCAD {
			warnings.add("unsupported_currency", "Only CAD market prices are included in this portfolio value slice.")
			continue
		}
		current, ok := latest[price.AssetID]
		if !ok || preferredPrice(price, current) {
			latest[price.AssetID] = price
		}
	}

	result := make(map[uuid.UUID]decimal.Decimal, len(latest))
	for assetID, price := range latest {
		result[assetID] = price.Price
	}
	return result
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
