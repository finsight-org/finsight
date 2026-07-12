package transaction

import "errors"

var (
	ErrInvalidAccount       = errors.New("invalid transaction account")
	ErrNotFound             = errors.New("transaction not found")
	ErrInvalidType          = errors.New("invalid transaction type")
	ErrInvalidTradeDate     = errors.New("invalid transaction trade date")
	ErrInvalidSource        = errors.New("invalid transaction source")
	ErrInvalidAmount        = errors.New("invalid transaction amount")
	ErrInvalidAsset         = errors.New("invalid transaction asset")
	ErrInvalidLedgerEntry   = errors.New("invalid ledger entry")
	ErrInvalidEntryType     = errors.New("invalid ledger entry type")
	ErrInvalidEntryAsset    = errors.New("invalid ledger entry asset")
	ErrInvalidEntryCurrency = errors.New("invalid ledger entry currency")
)
