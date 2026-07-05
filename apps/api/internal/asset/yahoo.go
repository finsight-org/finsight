package asset

import (
	"context"
	"strings"

	yahoo "github.com/oscarli916/yahoo-finance-api"
)

const YahooProviderID = "yahoo"

type YahooProvider struct {
	client yahooClient
}

type yahooClient interface {
	Search(query string, limit int) ([]yahooSearchResult, error)
	Info(symbol string) (yahooInfo, error)
}

type yahooSearchResult struct {
	Symbol   string
	Name     string
	Type     string
	Exchange string
}

type yahooInfo struct {
	Currency string
}

func NewYahooProvider() YahooProvider {
	return YahooProvider{client: yahooFinanceClient{}}
}

func (p YahooProvider) SearchAssets(_ context.Context, query string, limit int) ([]AssetCandidate, error) {
	client := p.client
	if client == nil {
		client = yahooFinanceClient{}
	}

	results, err := client.Search(query, limit)
	if err != nil {
		return nil, err
	}

	candidates := make([]AssetCandidate, 0, len(results))
	for _, result := range results {
		symbol := strings.TrimSpace(result.Symbol)
		if symbol == "" {
			continue
		}

		name := strings.TrimSpace(result.Name)
		if name == "" {
			name = symbol
		}

		candidate := AssetCandidate{
			Name:           name,
			Symbol:         symbol,
			Type:           yahooQuoteType(result.Type),
			ProviderID:     YahooProviderID,
			ProviderSymbol: symbol,
			Exchange:       normalizedOptional(result.Exchange),
		}

		info, err := client.Info(symbol)
		if err == nil {
			candidate.Currency = normalizedOptional(info.Currency)
		}

		candidates = append(candidates, candidate)
	}

	return candidates, nil
}

type yahooFinanceClient struct{}

func (c yahooFinanceClient) Search(query string, limit int) ([]yahooSearchResult, error) {
	results, err := yahoo.NewTicker("").Search(query, limit)
	if err != nil {
		return nil, err
	}

	mapped := make([]yahooSearchResult, 0, len(results))
	for _, result := range results {
		mapped = append(mapped, yahooSearchResult{
			Symbol:   result.Symbol,
			Name:     result.Name,
			Type:     result.Type,
			Exchange: result.Exchange,
		})
	}

	return mapped, nil
}

func (c yahooFinanceClient) Info(symbol string) (yahooInfo, error) {
	info, err := yahoo.NewTicker(symbol).Info()
	if err != nil {
		return yahooInfo{}, err
	}
	return yahooInfo{Currency: info.Currency}, nil
}

func yahooQuoteType(value string) Type {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "EQUITY":
		return TypeEquity
	case "ETF":
		return TypeETF
	case "MUTUALFUND":
		return TypeMutualFund
	case "CRYPTOCURRENCY":
		return TypeCrypto
	default:
		return TypeOther
	}
}
