package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/finsight-org/finsight/apps/api/internal/config"
)

type apiServer struct {
	serviceName    string
	version        string
	readyTimeout   time.Duration
	deploymentMode config.DeploymentMode
	database       DatabasePinger
	localContext   LocalContextService
	accounts       AccountService
	assets         AssetFinder
	portfolio      PortfolioService
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
