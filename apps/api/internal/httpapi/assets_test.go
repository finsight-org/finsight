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

func TestSearchAssets(t *testing.T) {
	usd := "USD"
	exchange := "NMS"
	finder := &fakeAssetService{
		results: []asset.AssetCandidate{
			{
				Name:           "Apple Inc.",
				Symbol:         "AAPL",
				Type:           asset.TypeEquity,
				Currency:       &usd,
				ProviderID:     asset.YahooProviderID,
				ProviderSymbol: "AAPL",
				Exchange:       &exchange,
			},
		},
	}
	router := NewRouter(Options{
		Assets: finder,
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/search?q=AAPL&limit=5", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.AssetSearchResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Assets) != 1 {
		t.Fatalf("assets length = %d, want 1", len(body.Assets))
	}
	if body.Assets[0].Symbol != "AAPL" || body.Assets[0].ProviderId != asset.YahooProviderID {
		t.Fatalf("unexpected asset result: %#v", body.Assets[0])
	}
	if finder.input.Limit == nil || *finder.input.Limit != 5 {
		t.Fatalf("limit = %#v, want 5", finder.input.Limit)
	}
}

func TestSearchAssetsInvalidQuery(t *testing.T) {
	router := NewRouter(Options{Assets: &fakeAssetService{err: asset.ErrInvalidSearchQuery}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/search?q=AAPL", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
}

func TestSearchAssetsMissingQuery(t *testing.T) {
	finder := &fakeAssetService{}
	router := NewRouter(Options{Assets: finder})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/search", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
	if finder.called {
		t.Fatal("asset finder was called for missing query")
	}
}

func TestSearchAssetsInvalidLimit(t *testing.T) {
	finder := &fakeAssetService{err: asset.ErrInvalidSearchQuery}
	router := NewRouter(Options{Assets: finder})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/search?q=AAPL&limit=0", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
	if finder.called {
		t.Fatal("asset finder was called for invalid limit")
	}
}

func TestSearchAssetsMalformedLimit(t *testing.T) {
	finder := &fakeAssetService{}
	router := NewRouter(Options{Assets: finder})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/search?q=AAPL&limit=abc", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
	if finder.called {
		t.Fatal("asset finder was called for malformed limit")
	}
}

func TestSearchAssetsProviderUnavailable(t *testing.T) {
	router := NewRouter(Options{Assets: &fakeAssetService{err: asset.ErrProviderUnavailable}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/search?q=AAPL", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
	}
	assertErrorCode(t, response, "asset_provider_unavailable")
}

func TestSearchAssetsUnexpectedError(t *testing.T) {
	router := NewRouter(Options{Assets: &fakeAssetService{err: errors.New("boom")}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/assets/search?q=AAPL", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	assertErrorCode(t, response, "asset_search_failed")
}

type fakeAssetService struct {
	results []asset.AssetCandidate
	input   asset.SearchInput
	err     error
	called  bool
}

func (s *fakeAssetService) SearchAssets(_ context.Context, input asset.SearchInput) ([]asset.AssetCandidate, error) {
	s.called = true
	s.input = input
	return s.results, s.err
}
