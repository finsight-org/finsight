package wealthsimple

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestPaginatedAccountsPreserveValuesAndCurrencies(t *testing.T) {
	large := accountNode("large", json.Number("12345678901234567890.0123456789"), "USD")
	zero := accountNode("zero", "0.00", "CAD")
	closed := accountNode("closed", "4.00", "CAD")
	closed["closedAt"] = "2026-01-01"
	archived := accountNode("archived", "4.00", "CAD")
	archived["archivedAt"] = "2026-01-01"
	var cursors []any
	c := fixture(t, map[string]http.HandlerFunc{"/graphql": func(w http.ResponseWriter, r *http.Request) {
		var payload struct{ Variables map[string]any }
		_ = json.NewDecoder(r.Body).Decode(&payload)
		cursor := payload.Variables["cursor"]
		cursors = append(cursors, cursor)
		if cursor == nil {
			writeJSON(w, accountResponse([]any{large, closed, archived}, true, "page-2"))
			return
		}
		if cursor != "page-2" {
			t.Error("incorrect cursor")
		}
		writeJSON(w, accountResponse([]any{large, zero}, false, nil))
	}})
	login(t, c)
	result, err := c.Accounts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Accounts) != 2 || len(cursors) != 2 {
		t.Fatalf("wrong account/page count: %d/%d", len(result.Accounts), len(cursors))
	}
	a := result.Accounts[0]
	if a.Currency != "CAD" || a.Balance.Currency != "USD" || a.Balance.Amount != "12345678901234567890.0123456789" {
		t.Fatal("currency or precision was changed")
	}
	if result.Accounts[1].Balance == nil || result.Accounts[1].Balance.Amount != "0.00" {
		t.Fatal("zero is not an unavailable balance")
	}
	encoded, _ := json.Marshal(result)
	if !strings.Contains(string(encoded), `"amount":"12345678901234567890.0123456789"`) {
		t.Fatal("JSON did not preserve the decimal as a string")
	}
}

func TestPartialValuesAndCreditCardAmounts(t *testing.T) {
	card := map[string]any{"id": "card", "unifiedAccountType": "CREDIT_CARD", "currency": "CAD", "financials": map[string]any{"currentCombined": map[string]any{
		"creditCard": map[string]any{"current": map[string]any{"cents": json.Number("-15"), "currency": "CAD"}},
	}}}
	missing := map[string]any{"id": "missing", "unifiedAccountType": "UNKNOWN", "currency": "CAD", "financials": nil}
	c := fixture(t, map[string]http.HandlerFunc{"/graphql": func(w http.ResponseWriter, r *http.Request) {
		response := accountResponse([]any{card, missing, nil}, false, nil)
		response["errors"] = []any{map[string]any{"message": "SECRET: do not expose this body"}}
		writeJSON(w, response)
	}})
	login(t, c)
	result, err := c.Accounts(context.Background())
	if !errors.Is(err, ErrPartialResponse) || len(result.Accounts) != 2 {
		t.Fatalf("got %d accounts, %v", len(result.Accounts), err)
	}
	if a := result.Accounts[0]; a.BalanceKind != "amount_owed" || a.Balance.Amount != "-0.15" {
		t.Fatal("credit card amount was misrepresented")
	}
	if result.Accounts[1].Balance != nil || result.Accounts[1].Name != "UNKNOWN" {
		t.Fatal("missing value was fabricated")
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "SECRET") || len(result.Warnings) != 3 {
		t.Fatal("partial failure was not safely reported")
	}
}

func TestEmptyAccounts(t *testing.T) {
	c := fixture(t, map[string]http.HandlerFunc{"/graphql": func(w http.ResponseWriter, r *http.Request) { writeJSON(w, accountResponse([]any{}, false, nil)) }})
	login(t, c)
	result, err := c.Accounts(context.Background())
	if err != nil || result.Accounts == nil || len(result.Accounts) != 0 || len(result.Warnings) != 0 {
		t.Fatalf("empty result: %#v %v", result, err)
	}
}

func TestPaginationFailurePreservesEarlierAccounts(t *testing.T) {
	for _, repeat := range []bool{true, false} {
		t.Run(fmt.Sprint(repeat), func(t *testing.T) {
			calls := 0
			c := fixture(t, map[string]http.HandlerFunc{"/graphql": func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 2 && !repeat {
					w.WriteHeader(503)
					return
				}
				writeJSON(w, accountResponse([]any{accountNode(fmt.Sprint(calls), "1.00", "CAD")}, true, "same-cursor"))
			}})
			login(t, c)
			result, err := c.Accounts(context.Background())
			want := ErrUpstream
			if repeat {
				want = ErrPagination
			}
			if !errors.Is(err, want) || len(result.Accounts) == 0 || len(result.Warnings) == 0 || calls != 2 {
				t.Fatalf("result=%#v error=%v calls=%d", result, err, calls)
			}
		})
	}
}

func TestMalformedAccountData(t *testing.T) {
	for _, body := range []string{`{"data":{"identity":null}}`, `{"data":{"identity":{"netWorth":{"accounts":{}}}}}`, `{"data":{"identity":{"netWorth":{"accounts":{"edges":[],"pageInfo":null}}}}}`} {
		t.Run(body, func(t *testing.T) {
			c := fixture(t, map[string]http.HandlerFunc{"/graphql": func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }})
			login(t, c)
			if _, err := c.Accounts(context.Background()); err == nil {
				t.Fatal("malformed data succeeded")
			}
		})
	}
}

func TestDecimalValidation(t *testing.T) {
	for _, input := range []string{`"NaN"`, `"1,000"`, `true`, `null`, `{}`, `"001"`} {
		var amount Decimal
		if json.Unmarshal([]byte(input), &amount) == nil {
			t.Fatalf("accepted %s", input)
		}
	}
	for _, input := range []string{`"0"`, `"-10.125"`, `12345678901234567890.123456789`, `1e-9`} {
		var amount Decimal
		if err := json.Unmarshal([]byte(input), &amount); err != nil {
			t.Fatalf("rejected %s", input)
		}
	}
}
