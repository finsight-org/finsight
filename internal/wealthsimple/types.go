// Package wealthsimple provides experimental read access to Wealthsimple.
// Each Client owns one connection. Authentication and financial data stay in memory.
package wealthsimple

import (
	"encoding/json"
	"errors"
	"regexp"
)

var (
	ErrMFARequired       = errors.New("Wealthsimple requires an MFA code; retry login with the code")
	ErrLoginFailed       = errors.New("Wealthsimple login failed; check your credentials and MFA code")
	ErrNotConnected      = errors.New("connect to Wealthsimple before requesting accounts")
	ErrReconnectRequired = errors.New("the Wealthsimple session can no longer be refreshed; reconnect")
	ErrRateLimited       = errors.New("Wealthsimple is limiting requests; try again later")
	ErrNetwork           = errors.New("could not reach Wealthsimple")
	ErrInvalidResponse   = errors.New("Wealthsimple returned an unexpected response; its API may have changed")
	ErrUpstream          = errors.New("Wealthsimple could not complete the request")
	ErrPartialResponse   = errors.New("some account information is unavailable; see the warnings")
	ErrPagination        = errors.New("could not complete account pagination")
	errUnauthenticated   = errors.New("upstream session expired")
)

// Decimal preserves the original precision of an upstream monetary amount.
// It accepts JSON strings or numbers and always marshals as a JSON string.
type Decimal string

var decimalPattern = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$`)

func (d *Decimal) UnmarshalJSON(b []byte) error {
	s := string(b)
	if len(b) > 0 && b[0] == '"' {
		if err := json.Unmarshal(b, &s); err != nil {
			return ErrInvalidResponse
		}
	}
	if !decimalPattern.MatchString(s) {
		return ErrInvalidResponse
	}
	*d = Decimal(s)
	return nil
}

type Money struct {
	Amount   Decimal `json:"amount"`
	Currency string  `json:"currency"`
}

type Account struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Currency    string `json:"currency"`
	Balance     *Money `json:"balance"`
	BalanceKind string `json:"balanceKind"` // account_value or amount_owed
}

type Warning struct {
	AccountID string `json:"accountId,omitempty"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}

type AccountsResult struct {
	Accounts []Account `json:"accounts"`
	Warnings []Warning `json:"warnings"`
}
