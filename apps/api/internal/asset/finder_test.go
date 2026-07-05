package asset

import (
	"context"
	"errors"
	"testing"
)

func TestSearchAssetsValidation(t *testing.T) {
	service := NewFinder(&fakeProvider{})

	tests := []struct {
		name  string
		input SearchInput
	}{
		{name: "blank query", input: SearchInput{Query: "   ", Limit: intPtr(10)}},
		{name: "short query", input: SearchInput{Query: "A", Limit: intPtr(10)}},
		{name: "zero limit", input: SearchInput{Query: "AAPL", Limit: intPtr(0)}},
		{name: "negative limit", input: SearchInput{Query: "AAPL", Limit: intPtr(-1)}},
		{name: "limit above max", input: SearchInput{Query: "AAPL", Limit: intPtr(MaxSearchLimit + 1)}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := service.SearchAssets(context.Background(), tt.input)
			if !errors.Is(err, ErrInvalidSearchQuery) {
				t.Fatalf("SearchAssets() error = %v, want %v", err, ErrInvalidSearchQuery)
			}
		})
	}
}

func TestSearchAssetsNormalizesInputAndAppliesDefaultLimit(t *testing.T) {
	provider := &fakeProvider{}
	service := NewFinder(provider)

	_, err := service.SearchAssets(context.Background(), SearchInput{Query: "  AAPL  "})
	if err != nil {
		t.Fatalf("SearchAssets() error = %v", err)
	}

	if provider.query != "AAPL" {
		t.Fatalf("query = %q, want AAPL", provider.query)
	}
	if provider.limit != DefaultSearchLimit {
		t.Fatalf("limit = %d, want %d", provider.limit, DefaultSearchLimit)
	}
}

func TestSearchAssetsReturnsProviderResults(t *testing.T) {
	usd := "USD"
	provider := &fakeProvider{
		results: []AssetCandidate{
			{
				Name:           "Apple Inc.",
				Symbol:         "AAPL",
				Type:           TypeEquity,
				Currency:       &usd,
				ProviderID:     YahooProviderID,
				ProviderSymbol: "AAPL",
				Exchange:       normalizedOptional("NMS"),
			},
		},
	}
	service := NewFinder(provider)

	results, err := service.SearchAssets(context.Background(), SearchInput{Query: "AAPL", Limit: intPtr(5)})
	if err != nil {
		t.Fatalf("SearchAssets() error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results length = %d, want 1", len(results))
	}
	result := results[0]
	if result.Name != "Apple Inc." || result.Symbol != "AAPL" || result.Type != TypeEquity || result.ProviderID != YahooProviderID || result.ProviderSymbol != "AAPL" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Currency == nil || *result.Currency != "USD" {
		t.Fatalf("currency = %#v, want USD", result.Currency)
	}
	if result.Exchange == nil || *result.Exchange != "NMS" {
		t.Fatalf("exchange = %#v, want NMS", result.Exchange)
	}
}

func TestSearchAssetsProviderError(t *testing.T) {
	service := NewFinder(&fakeProvider{searchErr: errors.New("boom")})

	_, err := service.SearchAssets(context.Background(), SearchInput{Query: "AAPL", Limit: intPtr(5)})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("SearchAssets() error = %v, want %v", err, ErrProviderUnavailable)
	}
}

func TestYahooProviderSearchAssetsMapsResults(t *testing.T) {
	provider := YahooProvider{
		client: fakeYahooClient{
			results: []yahooSearchResult{
				{Symbol: " AAPL ", Name: " Apple Inc. ", Type: "EQUITY", Exchange: "NMS"},
			},
		},
	}

	results, err := provider.SearchAssets(context.Background(), "AAPL", 5)
	if err != nil {
		t.Fatalf("SearchAssets() error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results length = %d, want 1", len(results))
	}
	result := results[0]
	if result.Name != "Apple Inc." || result.Symbol != "AAPL" || result.Type != TypeEquity || result.ProviderID != YahooProviderID || result.ProviderSymbol != "AAPL" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Currency != nil {
		t.Fatalf("currency = %#v, want nil", result.Currency)
	}
	if result.Exchange == nil || *result.Exchange != "NMS" {
		t.Fatalf("exchange = %#v, want NMS", result.Exchange)
	}
}

func TestYahooProviderSearchAssetsSkipsBlankSymbols(t *testing.T) {
	provider := YahooProvider{
		client: fakeYahooClient{
			results: []yahooSearchResult{
				{Symbol: "   ", Name: "Blank Inc.", Type: "EQUITY"},
				{Symbol: "AAPL", Name: "Apple Inc.", Type: "EQUITY"},
			},
		},
	}

	results, err := provider.SearchAssets(context.Background(), "AAPL", 5)
	if err != nil {
		t.Fatalf("SearchAssets() error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results length = %d, want 1", len(results))
	}
	if results[0].Symbol != "AAPL" {
		t.Fatalf("symbol = %q, want AAPL", results[0].Symbol)
	}
}

func TestYahooProviderSearchAssetsFailsWhenSearchFails(t *testing.T) {
	provider := YahooProvider{
		client: fakeYahooClient{searchErr: errors.New("boom")},
	}

	_, err := provider.SearchAssets(context.Background(), "AAPL", 5)
	if err == nil {
		t.Fatal("SearchAssets() error = nil, want error")
	}
}

func TestYahooQuoteTypeMapping(t *testing.T) {
	tests := []struct {
		value string
		want  Type
	}{
		{value: "EQUITY", want: TypeEquity},
		{value: "ETF", want: TypeETF},
		{value: "MUTUALFUND", want: TypeMutualFund},
		{value: "CRYPTOCURRENCY", want: TypeCrypto},
		{value: "INDEX", want: TypeOther},
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			if got := yahooQuoteType(tt.value); got != tt.want {
				t.Fatalf("yahooQuoteType(%q) = %q, want %q", tt.value, got, tt.want)
			}
		})
	}
}

type fakeProvider struct {
	query     string
	limit     int
	results   []AssetCandidate
	searchErr error
}

func (p *fakeProvider) SearchAssets(_ context.Context, query string, limit int) ([]AssetCandidate, error) {
	p.query = query
	p.limit = limit
	return p.results, p.searchErr
}

type fakeYahooClient struct {
	results   []yahooSearchResult
	searchErr error
}

func (c fakeYahooClient) Search(string, int) ([]yahooSearchResult, error) {
	return c.results, c.searchErr
}

func intPtr(value int) *int {
	return &value
}
