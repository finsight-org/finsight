package resolver

import "github.com/vektah/gqlparser/v2/gqlerror"

func gatewayError(code, message string) error {
	return &gqlerror.Error{Message: message, Extensions: map[string]any{"code": code}}
}
