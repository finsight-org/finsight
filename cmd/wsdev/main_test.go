package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/finsight-org/finsight/internal/wealthsimple"
)

type fakeProvider struct {
	loginCalls int
	needMFA    bool
	loginError error
	fetchError error
	result     wealthsimple.AccountsResult
}

func (f *fakeProvider) Login(ctx context.Context, email, password, code string) error {
	f.loginCalls++
	if email != "person@example.test" || password != "secret-password" {
		return errors.New("bad test credentials")
	}
	if f.needMFA && code == "" {
		return wealthsimple.ErrMFARequired
	}
	if f.needMFA && code != "123456" {
		return errors.New("bad test MFA")
	}
	return f.loginError
}
func (f *fakeProvider) Accounts(context.Context) (wealthsimple.AccountsResult, error) {
	return f.result, f.fetchError
}

func testResult() wealthsimple.AccountsResult {
	return wealthsimple.AccountsResult{Accounts: []wealthsimple.Account{{ID: "account", Name: "TFSA", Type: "TFSA", Currency: "CAD", Balance: &wealthsimple.Money{Amount: "123.45000", Currency: "USD"}, BalanceKind: "account_value"}}, Warnings: []wealthsimple.Warning{}}
}

func execute(t *testing.T, args []string, p *fakeProvider) (int, string, string) {
	t.Helper()
	var output, diagnostics bytes.Buffer
	reads := 0
	code := run(context.Background(), args, command{
		input: strings.NewReader("person@example.test\n"), output: &output, diagnostic: &diagnostics,
		secret: func() (string, error) {
			reads++
			if reads == 1 {
				return "secret-password", nil
			}
			return "123456", nil
		},
		newClient: func() (provider, error) { return p, nil },
	})
	return code, output.String(), diagnostics.String()
}

func TestJSONOutputAndMFA(t *testing.T) {
	fake := &fakeProvider{needMFA: true, result: testResult()}
	code, output, diagnostic := execute(t, []string{"accounts", "--json"}, fake)
	if code != 0 || fake.loginCalls != 2 {
		t.Fatalf("code=%d logins=%d: %s", code, fake.loginCalls, diagnostic)
	}
	var result wealthsimple.AccountsResult
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		t.Fatal("stdout is not exclusively JSON")
	}
	if result.Accounts[0].Balance.Amount != "123.45000" || result.Accounts[0].Balance.Currency != "USD" {
		t.Fatal("monetary value changed")
	}
	for _, secret := range []string{"secret-password", "123456"} {
		if strings.Contains(output+diagnostic, secret) {
			t.Fatal("secret in CLI output")
		}
	}
	if !strings.Contains(diagnostic, "MFA code:") {
		t.Fatal("missing MFA prompt")
	}
}

func TestPartialResultPrintedWithFailureExit(t *testing.T) {
	result := testResult()
	result.Accounts[0].Balance = nil
	result.Warnings = []wealthsimple.Warning{{Code: "balance_unavailable", Message: "Balance unavailable."}}
	code, output, diagnostic := execute(t, []string{"accounts"}, &fakeProvider{result: result, fetchError: wealthsimple.ErrPartialResponse})
	if code != 1 || !strings.Contains(output, "unavailable") || !strings.Contains(diagnostic, "Warning:") {
		t.Fatalf("code=%d output=%q diagnostic=%q", code, output, diagnostic)
	}
}

func TestLoginFailureSanitizesErrorAndStops(t *testing.T) {
	code, output, diagnostic := execute(t, []string{"accounts"}, &fakeProvider{loginError: errors.New("SECRET upstream failure")})
	if code != 1 || output != "" || strings.Contains(diagnostic, "SECRET") {
		t.Fatal("login error was exposed or did not stop the command")
	}
}

func TestUsageDoesNotAuthenticate(t *testing.T) {
	for _, args := range [][]string{nil, {"connect"}, {"accounts", "unexpected"}, {"accounts", "--invalid"}, {"--help"}, {"accounts", "--help"}} {
		fake := &fakeProvider{}
		code, _, _ := execute(t, args, fake)
		want := 2
		if len(args) > 0 && args[len(args)-1] == "--help" {
			want = 0
		}
		if code != want || fake.loginCalls != 0 {
			t.Fatalf("args=%v exit=%d", args, code)
		}
	}
}

func TestTableSanitizesProviderText(t *testing.T) {
	result := testResult()
	result.Accounts[0].Name = "TFSA\x1b[31m\n\t\u202e"
	var out bytes.Buffer
	if err := writeAccounts(&out, result, false); err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(out.String(), "\x1b\u202e") {
		t.Fatal("terminal control sequence emitted")
	}
	if !strings.Contains(out.String(), "USD") {
		t.Fatal("wrong balance currency")
	}
}
