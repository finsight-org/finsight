package providergraphql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/finsight-org/finsight/internal/wealthsimple"
)

type mockAccounts struct {
	calls  int
	result wealthsimple.AccountsResult
	err    error
}

func (m *mockAccounts) Accounts(context.Context) (wealthsimple.AccountsResult, error) {
	m.calls++
	return m.result, m.err
}

func TestPartialDataAndErrorPathSurvive(t *testing.T) {
	client := &mockAccounts{result: wealthsimple.AccountsResult{Accounts: []wealthsimple.Account{{ID: "acct", Name: "Main", Type: "TFSA", Currency: "CAD", BalanceKind: "account_value"}}, Warnings: []wealthsimple.Warning{{AccountID: "acct", Code: "balance_unavailable", Message: "The current balance is unavailable."}}}, err: wealthsimple.ErrPartialResponse}
	data, issues, err := Execute(context.Background(), client, `query Read { accounts { accounts { id } warnings { code } } }`, nil, "Read")
	if err != nil {
		t.Fatal(err)
	}
	if client.calls != 1 || len(issues) != 1 {
		t.Fatalf("calls=%d errors=%v", client.calls, issues)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	accounts := payload["accounts"].(map[string]any)["accounts"].([]any)
	if len(accounts) != 1 {
		t.Fatalf("partial account data lost: %s", data)
	}
	if issues[0]["path"] == nil {
		t.Fatalf("GraphQL resolver error path missing: %#v", issues[0])
	}
	if issues[0]["extensions"].(map[string]any)["code"] != "PARTIAL_RESPONSE" {
		t.Fatalf("partial error code missing: %#v", issues[0])
	}
}

func TestProviderValidationComplexityAndQuerySizeAvoidUpstream(t *testing.T) {
	client := &mockAccounts{}
	parts := make([]string, 0, 510)
	for i := 0; i < 510; i++ {
		parts = append(parts, fmt.Sprintf("a%d: accounts { accounts { id } }", i))
	}
	_, issues, err := Execute(context.Background(), client, "{ "+strings.Join(parts, " ")+" }", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) == 0 || client.calls != 0 {
		t.Fatalf("complex query reached provider: errors=%v calls=%d", issues, client.calls)
	}
	_, issues, err = Execute(context.Background(), client, strings.Repeat(" ", (64<<10)+1), nil, "")
	if err != nil || len(issues) == 0 || client.calls != 0 {
		t.Fatalf("oversized query: errors=%v err=%v calls=%d", issues, err, client.calls)
	}
	_, issues, err = Execute(context.Background(), client, `mutation { accounts { accounts { id } } }`, nil, "")
	if err != nil || len(issues) == 0 || client.calls != 0 {
		t.Fatalf("mutation was not rejected: errors=%v err=%v calls=%d", issues, err, client.calls)
	}
}

func TestUnknownExecutionErrorIsSanitized(t *testing.T) {
	client := &mockAccounts{err: errors.New("SECRET upstream response body")}
	_, issues, err := Execute(context.Background(), client, `{ accounts { accounts { id } } }`, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(issues)
	if strings.Contains(string(encoded), "SECRET") || !strings.Contains(string(encoded), "Provider query could not be completed.") {
		t.Fatalf("unsafe provider error: %s", encoded)
	}
}

func TestAuthenticatedIntrospectionSchemaHasDescriptions(t *testing.T) {
	client := &mockAccounts{}
	data, issues, err := Execute(context.Background(), client, `{ __type(name:"Query") { fields { name description } } }`, nil, "")
	if err != nil || len(issues) > 0 {
		t.Fatalf("introspection failed: %v %v", issues, err)
	}
	if !strings.Contains(string(data), "net liquidation value") && !strings.Contains(wealthsimple.ProviderSchema, "net liquidation value") {
		t.Fatalf("expected schema description; data=%s", data)
	}
	if client.calls != 0 {
		t.Fatal("introspection contacted provider")
	}
}
