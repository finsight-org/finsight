package portfolio

import "errors"

var (
	ErrInvalidRange = errors.New("invalid portfolio range")
	ErrNotFound     = errors.New("portfolio not found")
)
