package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func TestAccountRequestsAreValidatedByOpenAPI(t *testing.T) {
	portfolioID := uuid.NewString()
	path := "/api/portfolios/" + portfolioID + "/accounts"
	tests := []struct {
		name        string
		path        string
		body        string
		contentType string
	}{
		{name: "malformed JSON", path: path, body: `{"name":`, contentType: "application/json"},
		{name: "missing name", path: path, body: `{"type":"BROKERAGE","base_currency":"CAD"}`, contentType: "application/json"},
		{name: "empty name", path: path, body: `{"name":"","type":"BROKERAGE","base_currency":"CAD"}`, contentType: "application/json"},
		{name: "leading name whitespace", path: path, body: `{"name":" Margin","type":"BROKERAGE","base_currency":"CAD"}`, contentType: "application/json"},
		{name: "trailing name whitespace", path: path, body: `{"name":"Margin ","type":"BROKERAGE","base_currency":"CAD"}`, contentType: "application/json"},
		{name: "empty institution", path: path, body: `{"name":"Margin","institution_name":"","type":"BROKERAGE","base_currency":"CAD"}`, contentType: "application/json"},
		{name: "noncanonical institution", path: path, body: `{"name":"Margin","institution_name":" Questrade","type":"BROKERAGE","base_currency":"CAD"}`, contentType: "application/json"},
		{name: "empty external reference", path: path, body: `{"name":"Margin","type":"BROKERAGE","base_currency":"CAD","external_reference":""}`, contentType: "application/json"},
		{name: "noncanonical external reference", path: path, body: `{"name":"Margin","type":"BROKERAGE","base_currency":"CAD","external_reference":"margin-1 "}`, contentType: "application/json"},
		{name: "invalid type", path: path, body: `{"name":"Margin","type":"OTHER","base_currency":"CAD"}`, contentType: "application/json"},
		{name: "invalid currency", path: path, body: `{"name":"Margin","type":"BROKERAGE","base_currency":"cad"}`, contentType: "application/json"},
		{name: "missing content type", path: path, body: `{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`},
		{name: "wrong content type", path: path, body: `{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`, contentType: "text/plain"},
		{name: "invalid portfolio id", path: "/api/portfolios/not-a-uuid/accounts", body: `{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`, contentType: "application/json"},
	}

	router := NewRouter(Options{})
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			if test.contentType != "" {
				request.Header.Set("Content-Type", test.contentType)
			}
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			assertErrorCode(t, response, "invalid_request")
		})
	}
}

func TestInvalidAccountIDUsesGenericValidationError(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+uuid.NewString()+"/accounts/not-a-uuid", nil)
	response := httptest.NewRecorder()

	NewRouter(Options{}).ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
}

func assertErrorCode(t *testing.T, response *httptest.ResponseRecorder, code string) {
	t.Helper()
	var body generated.ErrorResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != code {
		t.Fatalf("error code = %q, want %q", body.Error.Code, code)
	}
}
