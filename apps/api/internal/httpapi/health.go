package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type healthHandler struct {
	serviceName  string
	version      string
	readyTimeout time.Duration
	database     DatabasePinger
}

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Version string `json:"version"`
}

type readyResponse struct {
	Status string                `json:"status"`
	Checks map[string]checkState `json:"checks"`
}

type checkState struct {
	Status string `json:"status"`
}

func (h healthHandler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{
		Status:  "ok",
		Service: h.serviceName,
		Version: h.version,
	})
}

func (h healthHandler) ready(w http.ResponseWriter, r *http.Request) {
	if h.database == nil {
		writeJSON(w, http.StatusServiceUnavailable, notReadyResponse())
		return
	}

	ctx := r.Context()
	if h.readyTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, h.readyTimeout)
		defer cancel()
	}

	if err := h.database.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, notReadyResponse())
		return
	}

	writeJSON(w, http.StatusOK, readyResponse{
		Status: "ready",
		Checks: map[string]checkState{
			"postgres": {Status: "ok"},
		},
	})
}

func notReadyResponse() readyResponse {
	return readyResponse{
		Status: "not_ready",
		Checks: map[string]checkState{
			"postgres": {Status: "error"},
		},
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
