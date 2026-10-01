package gateway

import (
	"context"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/executor"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/finsight-org/finsight/internal/gateway/generated"
	"github.com/finsight-org/finsight/internal/gateway/resolver"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

type API struct{ exec *executor.Executor }

func New(r *resolver.Resolver, sdl string) (*API, error) {
	schema, err := gqlparser.LoadSchema(&ast.Source{Name: "gateway.graphqls", Input: sdl})
	if err != nil {
		return nil, err
	}
	e := executor.New(generated.NewExecutableSchema(generated.Config{Schema: schema, Resolvers: r}))
	e.Use(extension.FixedComplexityLimit(1000))
	e.Use(extension.Introspection{})
	e.SetParserTokenLimit(10000)
	e.SetDisableSuggestion(true)
	e.SetErrorPresenter(func(ctx context.Context, err error) *gqlerror.Error {
		if ge, ok := err.(*gqlerror.Error); ok && ge.Extensions["code"] != nil {
			return ge
		}
		return &gqlerror.Error{Message: "Invalid GraphQL request."}
	})
	return &API{exec: e}, nil
}

func (a *API) Execute(ctx context.Context, query string, variables map[string]any, operationName string) *graphql.Response {
	ctx = graphql.StartOperationTrace(ctx)
	params := &graphql.RawParams{Query: query, Variables: variables, OperationName: operationName}
	op, issues := a.exec.CreateOperationContext(ctx, params)
	if len(issues) > 0 {
		return a.exec.DispatchError(ctx, issues)
	}
	handler, ctx := a.exec.DispatchOperation(ctx, op)
	return handler(ctx)
}
