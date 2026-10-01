package resolver

import (
	"context"
	"sync"

	"github.com/finsight-org/finsight/internal/wealthsimple"
)

type accountsKey struct{}
type accountsClient interface {
	Accounts(context.Context) (wealthsimple.AccountsResult, error)
}
type accountCache struct {
	client accountsClient
	once   sync.Once
	result wealthsimple.AccountsResult
	err    error
}

func WithClient(ctx context.Context, client accountsClient) context.Context {
	return context.WithValue(ctx, accountsKey{}, &accountCache{client: client})
}
