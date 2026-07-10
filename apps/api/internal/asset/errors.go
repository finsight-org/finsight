package asset

import "errors"

var (
	ErrInvalidSearchQuery  = errors.New("invalid asset search query")
	ErrProviderUnavailable = errors.New("asset provider unavailable")
	ErrInvalidName         = errors.New("invalid asset name")
	ErrInvalidType         = errors.New("invalid asset type")
	ErrInvalidCurrency     = errors.New("invalid asset currency")
	ErrInvalidSymbol       = errors.New("invalid asset symbol")
	ErrInvalidProvider     = errors.New("invalid asset provider")
	ErrNotFound            = errors.New("asset not found")
)
