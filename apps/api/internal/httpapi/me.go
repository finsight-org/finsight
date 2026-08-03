package httpapi

import (
	"net/http"

	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func (s apiServer) GetMe(w http.ResponseWriter, r *http.Request) {
	portfolioID, err := s.localDefaultPortfolioID(r.Context())
	if err != nil {
		writeLocalContextError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, generated.MeResponse{DefaultPortfolioId: openapiUUID(portfolioID)})
}
