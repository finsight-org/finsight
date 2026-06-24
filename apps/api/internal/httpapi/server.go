package httpapi

import (
	"encoding/json"
	"net/http"
	"time"
)

type apiServer struct {
	serviceName  string
	version      string
	readyTimeout time.Duration
	database     DatabasePinger
	bootstrap    LocalBootstrapper
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
