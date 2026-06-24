package httpapi

import (
	"context"
	"net/http"

	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func (s apiServer) GetHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, generated.HealthResponse{
		Status:  generated.HealthResponseStatusOk,
		Service: s.serviceName,
		Version: s.version,
	})
}

func (s apiServer) GetReady(w http.ResponseWriter, r *http.Request) {
	if s.database == nil {
		writeJSON(w, http.StatusServiceUnavailable, notReadyResponse())
		return
	}

	ctx := r.Context()
	if s.readyTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.readyTimeout)
		defer cancel()
	}

	if err := s.database.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, notReadyResponse())
		return
	}

	writeJSON(w, http.StatusOK, generated.ReadyResponse{
		Status: generated.Ready,
		Checks: map[string]generated.CheckState{
			"postgres": {Status: generated.CheckStateStatusOk},
		},
	})
}

func notReadyResponse() generated.ReadyResponse {
	return generated.ReadyResponse{
		Status: generated.NotReady,
		Checks: map[string]generated.CheckState{
			"postgres": {Status: generated.CheckStateStatusError},
		},
	}
}
