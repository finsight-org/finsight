package httpapi

import (
	"errors"
	"net/http"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func (s apiServer) SearchAssets(w http.ResponseWriter, r *http.Request, params generated.SearchAssetsParams) {
	if s.assets == nil {
		writeAssetError(w, http.StatusInternalServerError, "assets_unavailable", "asset finder is unavailable")
		return
	}

	results, err := s.assets.SearchAssets(r.Context(), asset.SearchInput{
		Query: params.Q,
		Limit: params.Limit,
	})
	if err != nil {
		writeAssetFinderError(w, err)
		return
	}

	response := generated.AssetSearchResponse{Assets: make([]generated.AssetSearchResult, 0, len(results))}
	for _, result := range results {
		response.Assets = append(response.Assets, assetSearchResultResponse(result))
	}
	writeJSON(w, http.StatusOK, response)
}

func assetSearchResultResponse(value asset.AssetCandidate) generated.AssetSearchResult {
	return generated.AssetSearchResult{
		Name:           value.Name,
		Symbol:         value.Symbol,
		AssetType:      generated.AssetType(value.Type),
		Currency:       value.Currency,
		ProviderId:     value.ProviderID,
		ProviderSymbol: value.ProviderSymbol,
		Exchange:       value.Exchange,
	}
}

func writeAssetFinderError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, asset.ErrInvalidSearchQuery):
		writeAssetError(w, http.StatusBadRequest, "invalid_asset_search_query", "asset search query is invalid")
	case errors.Is(err, asset.ErrProviderUnavailable):
		writeAssetError(w, http.StatusBadGateway, "asset_provider_unavailable", "asset provider is unavailable")
	default:
		writeAssetError(w, http.StatusInternalServerError, "asset_search_failed", "asset search failed")
	}
}

func writeAssetError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, generated.ErrorResponse{
		Error: generated.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}
