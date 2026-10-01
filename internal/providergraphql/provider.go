package providergraphql

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/executor"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/finsight-org/finsight/internal/wealthsimple"
	"github.com/finsight-org/finsight/internal/wealthsimple/generated"
	"github.com/finsight-org/finsight/internal/wealthsimple/resolver"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

var (
	initOnce sync.Once
	server   *executor.Executor
	initErr  error
)

func schema() (*ast.Schema, error) {
	return gqlparser.LoadSchema(&ast.Source{Name: "wealthsimple.graphqls", Input: wealthsimple.ProviderSchema})
}

type AccountsClient interface {
	Accounts(context.Context) (wealthsimple.AccountsResult, error)
}

func Execute(ctx context.Context, client AccountsClient, query string, variables map[string]any, operationName string) (json.RawMessage, []map[string]any, error) {
	if len(query) > 64<<10 {
		return json.RawMessage("null"), []map[string]any{{"message": "Provider GraphQL query is too large.", "extensions": map[string]any{"code": "QUERY_TOO_LARGE"}}}, nil
	}
	initOnce.Do(func() {
		s, err := schema()
		if err != nil {
			initErr = err
			return
		}
		server = executor.New(generated.NewExecutableSchema(generated.Config{Schema: s, Resolvers: &resolver.Resolver{}}))
		server.Use(extension.FixedComplexityLimit(1000))
		server.Use(extension.Introspection{})
		server.SetParserTokenLimit(10000)
		server.SetDisableSuggestion(true)
		server.SetErrorPresenter(func(ctx context.Context, err error) *gqlerror.Error {
			original := graphql.DefaultErrorPresenter(ctx, err)
			if original != nil {
				validationMessage := ""
				if original.Rule != "" || original.Err == nil {
					validationMessage = original.Message
				}
				message, code := safeError(original.Err, validationMessage)
				ext := map[string]any{}
				for k, v := range original.Extensions {
					ext[k] = v
				}
				if code != "" {
					ext["code"] = code
				}
				return &gqlerror.Error{Message: message, Path: original.Path, Locations: original.Locations, Extensions: ext}
			}
			message, code := safeError(err, "")
			ext := map[string]any{}
			if code != "" {
				ext["code"] = code
			}
			return &gqlerror.Error{Message: message, Extensions: ext}
		})
	})
	if initErr != nil {
		return nil, nil, initErr
	}
	ctx = resolver.WithClient(ctx, client)
	ctx = graphql.StartOperationTrace(ctx)
	params := &graphql.RawParams{Query: query, Variables: variables, OperationName: operationName}
	op, errs := server.CreateOperationContext(ctx, params)
	if len(errs) > 0 {
		return json.RawMessage("null"), errorMaps(errs), nil
	}
	fn, ctx := server.DispatchOperation(ctx, op)
	response := fn(ctx)
	var out json.RawMessage
	if len(response.Data) > 0 {
		out = append([]byte(nil), response.Data...)
	}
	return out, errorMaps(response.Errors), nil
}

func errorMaps(list gqlerror.List) []map[string]any {
	if len(list) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		entry := map[string]any{"message": item.Message}
		if item.Path != nil {
			entry["path"] = item.Path
		}
		if len(item.Extensions) > 0 {
			entry["extensions"] = item.Extensions
		}
		out = append(out, entry)
	}
	return out
}

func safeError(err error, validationMessage string) (string, string) {
	if err == nil {
		if validationMessage != "" {
			return validationMessage, ""
		}
		return "Provider query could not be completed.", "PROVIDER_QUERY_FAILED"
	}
	switch {
	case errors.Is(err, wealthsimple.ErrReconnectRequired), errors.Is(err, wealthsimple.ErrNotConnected):
		return "Wealthsimple session expired; reconnect is required.", "RECONNECT_REQUIRED"
	case errors.Is(err, wealthsimple.ErrRateLimited):
		return "Wealthsimple is limiting requests; try again later.", "RATE_LIMITED"
	case errors.Is(err, wealthsimple.ErrPartialResponse):
		return "Some account information is unavailable.", "PARTIAL_RESPONSE"
	case errors.Is(err, context.DeadlineExceeded):
		return "The request deadline expired.", "DEADLINE_EXCEEDED"
	case errors.Is(err, wealthsimple.ErrNetwork):
		return "Could not reach Wealthsimple.", "UPSTREAM_ERROR"
	case errors.Is(err, wealthsimple.ErrInvalidResponse):
		return "Wealthsimple returned an unexpected response.", "UPSTREAM_ERROR"
	case errors.Is(err, wealthsimple.ErrPagination):
		return "Could not complete account pagination.", "UPSTREAM_ERROR"
	case errors.Is(err, wealthsimple.ErrUpstream):
		return "Wealthsimple could not complete the request.", "UPSTREAM_ERROR"
	default:
		return "Provider query could not be completed.", "PROVIDER_QUERY_FAILED"
	}
}
