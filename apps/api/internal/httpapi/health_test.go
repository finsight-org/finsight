package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func TestHealth(t *testing.T) {
	router := NewRouter(Options{
		ServiceName:  "finsight-api",
		Version:      "dev",
		ReadyTimeout: time.Second,
		Database:     fakePinger{},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}

	var body generated.HealthResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != generated.HealthResponseStatusOk {
		t.Fatalf("status field = %q, want ok", body.Status)
	}
	if body.Service != "finsight-api" {
		t.Fatalf("service field = %q, want finsight-api", body.Service)
	}
	if body.Version != "dev" {
		t.Fatalf("version field = %q, want dev", body.Version)
	}
}

func TestReadyWhenDatabasePingSucceeds(t *testing.T) {
	router := NewRouter(Options{
		ServiceName:  "finsight-api",
		Version:      "dev",
		ReadyTimeout: time.Second,
		Database:     fakePinger{},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}

	var body generated.ReadyResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != generated.Ready {
		t.Fatalf("status field = %q, want ready", body.Status)
	}
	if body.Checks["postgres"].Status != generated.CheckStateStatusOk {
		t.Fatalf("postgres status = %q, want ok", body.Checks["postgres"].Status)
	}
}

func TestReadyWhenDatabasePingFails(t *testing.T) {
	router := NewRouter(Options{
		ServiceName:  "finsight-api",
		Version:      "dev",
		ReadyTimeout: time.Second,
		Database:     fakePinger{err: errors.New("secret database details")},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}

	body := response.Body.String()
	if strings.Contains(body, "secret database details") {
		t.Fatalf("response body exposed database error: %s", body)
	}
	if !strings.Contains(body, `"status":"not_ready"`) {
		t.Fatalf("response body = %s, want not_ready status", body)
	}
	if !strings.Contains(body, `"postgres":{"status":"error"}`) {
		t.Fatalf("response body = %s, want postgres error status", body)
	}
}

type fakePinger struct {
	err error
}

func (p fakePinger) Ping(context.Context) error {
	return p.err
}
