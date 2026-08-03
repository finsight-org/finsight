package localcontext

import "errors"

var (
	ErrNotFound            = errors.New("local default portfolio not found")
	ErrPortfolioNotAllowed = errors.New("portfolio is not the local default portfolio")
)
