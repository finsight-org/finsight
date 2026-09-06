package account

import "errors"

var (
	ErrInvalidInput  = errors.New("account input is invalid")
	ErrDuplicateName = errors.New("account name already exists")
	ErrNotFound      = errors.New("account not found")
)
