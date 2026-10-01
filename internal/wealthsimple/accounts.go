package wealthsimple

import (
	"context"
	_ "embed"
	"encoding/json"
	"math/big"
	"strings"
)

//go:embed queries/accounts.graphql
var accountsQuery string

type upstreamAccount struct {
	ID         string  `json:"id"`
	Nickname   string  `json:"nickname"`
	Type       string  `json:"unifiedAccountType"`
	Currency   string  `json:"currency"`
	Archived   *string `json:"archivedAt"`
	Closed     *string `json:"closedAt"`
	Financials *struct {
		Current *struct {
			Value *struct {
				Amount   *Decimal `json:"amount"`
				Currency string   `json:"currency"`
			} `json:"netLiquidationValueV2"`
			CreditCard *struct {
				Current *struct {
					Cents    *Decimal `json:"cents"`
					Currency string   `json:"currency"`
				} `json:"current"`
			} `json:"creditCard"`
		} `json:"currentCombined"`
	} `json:"financials"`
}

type accountPage struct {
	Edges []struct {
		Node *upstreamAccount `json:"node"`
	} `json:"edges"`
	PageInfo *struct {
		HasNext *bool   `json:"hasNextPage"`
		Cursor  *string `json:"endCursor"`
	} `json:"pageInfo"`
}

// Accounts reads all open accounts afresh. On partial failure it returns the
// available results along with a non-nil error. Callers must inspect both.
func (c *Client) Accounts(ctx context.Context) (AccountsResult, error) {
	result := AccountsResult{Accounts: []Account{}, Warnings: []Warning{}}
	identity, err := c.identity(ctx)
	if err != nil {
		return result, err
	}
	var cursor *string
	cursors := map[string]bool{}
	seen := map[string]bool{}
	for pageNumber := 0; pageNumber < 100; pageNumber++ {
		if err := ctx.Err(); err != nil {
			return incomplete(result, err)
		}
		envelope, err := c.graphql(ctx, accountsQuery, map[string]any{"identityId": identity, "cursor": cursor})
		if err != nil {
			return incomplete(result, err)
		}
		if len(envelope.Errors) > 0 {
			result.Warnings = append(result.Warnings, Warning{Code: "upstream_partial", Message: "Wealthsimple reported errors for some requested fields."})
		}
		var data struct {
			Identity *struct {
				NetWorth *struct {
					Accounts *accountPage `json:"accounts"`
				} `json:"netWorth"`
			} `json:"identity"`
		}
		if json.Unmarshal(envelope.Data, &data) != nil || data.Identity == nil || data.Identity.NetWorth == nil || data.Identity.NetWorth.Accounts == nil {
			return incomplete(result, ErrInvalidResponse)
		}
		page := data.Identity.NetWorth.Accounts
		if page.Edges == nil {
			return incomplete(result, ErrInvalidResponse)
		}
		for _, edge := range page.Edges {
			if edge.Node == nil || edge.Node.ID == "" {
				result.Warnings = append(result.Warnings, Warning{Code: "missing_account", Message: "Wealthsimple returned an incomplete account entry."})
				continue
			}
			node := edge.Node
			if node.Closed != nil || node.Archived != nil || seen[node.ID] {
				continue
			}
			seen[node.ID] = true
			account := node.account()
			result.Accounts = append(result.Accounts, account)
			if account.Balance == nil {
				result.Warnings = append(result.Warnings, Warning{AccountID: account.ID, Code: "balance_unavailable", Message: "The current balance is unavailable."})
			}
		}
		if page.PageInfo == nil || page.PageInfo.HasNext == nil {
			return incomplete(result, ErrPagination)
		}
		if !*page.PageInfo.HasNext {
			if len(result.Warnings) > 0 {
				return result, ErrPartialResponse
			}
			return result, nil
		}
		cursor = page.PageInfo.Cursor
		if cursor == nil || *cursor == "" || cursors[*cursor] {
			return incomplete(result, ErrPagination)
		}
		cursors[*cursor] = true
	}
	return incomplete(result, ErrPagination)
}

func incomplete(result AccountsResult, err error) (AccountsResult, error) {
	result.Warnings = append(result.Warnings, Warning{Code: "incomplete_accounts", Message: "The account retrieval could not be completed."})
	return result, err
}

func (u upstreamAccount) account() Account {
	a := Account{ID: u.ID, Name: u.Nickname, Type: u.Type, Currency: u.Currency, BalanceKind: "account_value"}
	if a.Name == "" {
		a.Name = a.Type
	}
	if a.Name == "" {
		a.Name = a.ID
	}
	card := strings.Contains(strings.NewReplacer("-", "", "_", "").Replace(strings.ToLower(u.Type)), "creditcard")
	if card {
		a.BalanceKind = "amount_owed"
	}
	if u.Financials == nil || u.Financials.Current == nil {
		return a
	}
	f := u.Financials.Current
	if card || f.CreditCard != nil {
		a.BalanceKind = "amount_owed"
		if f.CreditCard != nil && f.CreditCard.Current != nil {
			v := f.CreditCard.Current
			if v.Cents != nil && v.Currency != "" {
				if amount, ok := centsToAmount(*v.Cents); ok {
					a.Balance = &Money{Amount: amount, Currency: v.Currency}
				}
			}
		}
	} else if f.Value != nil && f.Value.Amount != nil && f.Value.Currency != "" {
		a.Balance = &Money{Amount: *f.Value.Amount, Currency: f.Value.Currency}
	}
	return a
}

func centsToAmount(cents Decimal) (Decimal, bool) {
	n, ok := new(big.Int).SetString(string(cents), 10)
	if !ok {
		return "", false
	}
	negative := n.Sign() < 0
	n.Abs(n)
	digits := n.String()
	for len(digits) < 3 {
		digits = "0" + digits
	}
	amount := digits[:len(digits)-2] + "." + digits[len(digits)-2:]
	if negative {
		amount = "-" + amount
	}
	return Decimal(amount), true
}
