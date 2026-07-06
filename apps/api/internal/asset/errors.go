package asset

import "errors"

var (
	ErrInvalidSearchQuery  = errors.New("invalid asset search query")
	ErrProviderUnavailable = errors.New("asset provider unavailable")
)
