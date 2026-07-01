package account

import "errors"

var (
	ErrInvalidName     = errors.New("account name is required")
	ErrInvalidType     = errors.New("account type is invalid")
	ErrInvalidCurrency = errors.New("account base currency is invalid")
	ErrDuplicateName   = errors.New("account name already exists")
	ErrNotFound        = errors.New("account not found")
)
