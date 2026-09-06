package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func TestSearchAssetsUsesFinderAndPreservesResponse(t *testing.T) {
	usd := "USD"
	exchange := "NMS"
	provider := &fakeHTTPAssetProvider{results: []asset.AssetCandidate{{
		Name:           "Apple Inc.",
		Symbol:         "AAPL",
		Type:           asset.TypeEquity,
		Currency:       &usd,
		ProviderID:     asset.YahooProviderID,
		ProviderSymbol: "AAPL",
		Exchange:       &exchange,
	}}}
	router := NewRouter(Options{Assets: asset.NewFinder(provider)})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/assets/search?q=%20%20AAPL%20%20&limit=5", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var body generated.AssetSearchResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Assets) != 1 || body.Assets[0].Symbol != "AAPL" || body.Assets[0].ProviderId != asset.YahooProviderID {
		t.Fatalf("assets = %#v", body.Assets)
	}
	if provider.query != "AAPL" || provider.limit != 5 {
		t.Fatalf("provider input = %q/%d, want AAPL/5", provider.query, provider.limit)
	}
}

func TestSearchAssetsOpenAPIValidationPrecedesFinder(t *testing.T) {
	tests := []string{
		"/api/assets/search",
		"/api/assets/search?q=AAPL&limit=0",
		"/api/assets/search?q=AAPL&limit=abc",
	}
	for _, path := range tests {
		t.Run(path, func(t *testing.T) {
			provider := &fakeHTTPAssetProvider{}
			router := NewRouter(Options{Assets: asset.NewFinder(provider)})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
			}
			assertErrorCode(t, response, "invalid_request")
			if provider.called {
				t.Fatal("provider was called for invalid request")
			}
		})
	}
}

func TestSearchAssetsFeatureValidationHandlesTrimmedShortQuery(t *testing.T) {
	provider := &fakeHTTPAssetProvider{}
	router := NewRouter(Options{Assets: asset.NewFinder(provider)})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/assets/search?q=%20A%20", nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
	if provider.called {
		t.Fatal("provider was called for short normalized query")
	}
}

func TestSearchAssetsProviderFailureReturnsBadGateway(t *testing.T) {
	provider := &fakeHTTPAssetProvider{err: errors.New("provider down")}
	router := NewRouter(Options{Assets: asset.NewFinder(provider)})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/assets/search?q=AAPL", nil))

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
	}
	assertErrorCode(t, response, "asset_provider_unavailable")
}

func TestAssetErrorMappingHidesUnexpectedErrors(t *testing.T) {
	response := httptest.NewRecorder()
	writeAssetFinderError(response, errors.New("credentials"))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	assertErrorCode(t, response, "asset_search_failed")
}

type fakeHTTPAssetProvider struct {
	query   string
	limit   int
	results []asset.AssetCandidate
	err     error
	called  bool
}

func (p *fakeHTTPAssetProvider) SearchAssets(_ context.Context, query string, limit int) ([]asset.AssetCandidate, error) {
	p.called = true
	p.query = query
	p.limit = limit
	return p.results, p.err
}
