package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/portfoliovalue"
)

type apiServer struct {
	serviceName    string
	version        string
	readyTimeout   time.Duration
	deploymentMode config.DeploymentMode
	database       DatabasePinger
	localContext   *localcontext.Resolver
	accounts       *account.Store
	assets         *asset.Finder
	portfolio      *portfoliovalue.Calculator
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
