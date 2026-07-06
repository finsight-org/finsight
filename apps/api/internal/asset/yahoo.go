package asset

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const YahooProviderID = "yahoo"

const (
	defaultYahooSearchURL = "https://query2.finance.yahoo.com/v1/finance/search"
	yahooSearchTimeout    = 5 * time.Second
)

type YahooProvider struct {
	client yahooClient
}

type yahooClient interface {
	Search(context.Context, string, int) ([]yahooSearchResult, error)
}

type yahooSearchResult struct {
	Symbol   string
	Name     string
	Type     string
	Exchange string
}

func NewYahooProvider() YahooProvider {
	return YahooProvider{client: yahooFinanceClient{}}
}

func (p YahooProvider) SearchAssets(ctx context.Context, query string, limit int) ([]AssetCandidate, error) {
	client := p.client
	if client == nil {
		client = yahooFinanceClient{}
	}

	results, err := client.Search(ctx, query, limit)
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
		candidates = append(candidates, candidate)
	}

	return candidates, nil
}

type yahooFinanceClient struct {
	httpClient *http.Client
	searchURL  string
}

type yahooSearchResponse struct {
	Quotes []struct {
		Symbol    string `json:"symbol"`
		ShortName string `json:"shortname"`
		LongName  string `json:"longname"`
		QuoteType string `json:"quoteType"`
		Exchange  string `json:"exchange"`
	} `json:"quotes"`
}

func (c yahooFinanceClient) Search(ctx context.Context, query string, limit int) ([]yahooSearchResult, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint(), nil)
	if err != nil {
		return nil, fmt.Errorf("create yahoo search request: %w", err)
	}

	params := request.URL.Query()
	params.Set("q", query)
	params.Set("lang", "en-US")
	params.Set("quotesCount", fmt.Sprintf("%d", limit))
	params.Set("newsCount", "0")
	params.Set("listsCount", "0")
	request.URL.RawQuery = params.Encode()
	request.Header.Set("User-Agent", "Finsight/1.0")

	response, err := c.client().Do(request)
	if err != nil {
		return nil, fmt.Errorf("search yahoo assets: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("search yahoo assets: unexpected status %d", response.StatusCode)
	}

	var payload yahooSearchResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode yahoo search response: %w", err)
	}

	mapped := make([]yahooSearchResult, 0, len(payload.Quotes))
	for _, result := range payload.Quotes {
		name := result.ShortName
		if strings.TrimSpace(name) == "" {
			name = result.LongName
		}
		mapped = append(mapped, yahooSearchResult{
			Symbol:   result.Symbol,
			Name:     name,
			Type:     result.QuoteType,
			Exchange: result.Exchange,
		})
	}

	return mapped, nil
}

func (c yahooFinanceClient) client() *http.Client {
	if c.httpClient != nil {
		return c.httpClient
	}
	return &http.Client{Timeout: yahooSearchTimeout}
}

func (c yahooFinanceClient) endpoint() string {
	if c.searchURL != "" {
		return c.searchURL
	}
	return defaultYahooSearchURL
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
