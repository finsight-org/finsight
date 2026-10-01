package resolver

import (
	"context"
	"github.com/finsight-org/finsight/internal/wealthsimple"
)

//
// It serves as dependency injection for your app, add any dependencies you require
// here.

type Resolver struct {
	Connected func() bool
	Client    func(context.Context) (AccountsClient, error)
}

type AccountsClient interface {
	Accounts(context.Context) (wealthsimple.AccountsResult, error)
}
