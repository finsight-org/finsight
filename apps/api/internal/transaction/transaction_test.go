package transaction

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeCreateInputCanonicalizesText(t *testing.T) {
	externalID := "  external-1  "
	originalCurrency := " USD "
	input := normalizeCreateInput(CreateInput{
		Description: "  Opening balance  ",
		Source:      " demo ",
		ExternalID:  &externalID,
		LedgerEntries: []CreateLedgerEntryInput{{
			Currency:         " CAD ",
			OriginalCurrency: &originalCurrency,
		}},
	})

	if input.Description != "Opening balance" || input.Source != "DEMO" {
		t.Fatalf("normalized transaction = %#v", input)
	}
	if input.ExternalID == nil || *input.ExternalID != "external-1" {
		t.Fatalf("external ID = %#v, want external-1", input.ExternalID)
	}
	if input.LedgerEntries[0].Currency != "CAD" || input.LedgerEntries[0].OriginalCurrency == nil || *input.LedgerEntries[0].OriginalCurrency != "USD" {
		t.Fatalf("normalized ledger entry = %#v", input.LedgerEntries[0])
	}
}

func TestNormalizeCreateInputDropsBlankOptionalText(t *testing.T) {
	blank := "   "
	input := normalizeCreateInput(CreateInput{
		ExternalID: &blank,
		LedgerEntries: []CreateLedgerEntryInput{{
			OriginalCurrency: &blank,
		}},
	})
	if input.ExternalID != nil || input.LedgerEntries[0].OriginalCurrency != nil {
		t.Fatalf("normalized optional text = %#v / %#v, want nil", input.ExternalID, input.LedgerEntries[0].OriginalCurrency)
	}
}

func TestValidateCreateInput(t *testing.T) {
	valid := CreateInput{
		AccountID: uuid.New(),
		Type:      TypeOpeningBalance,
		TradeDate: time.Now(),
		Source:    "TEST",
		LedgerEntries: []CreateLedgerEntryInput{{
			AssetID:   uuid.New(),
			EntryType: EntryTypeCash,
			Currency:  "CAD",
			Direction: DirectionIncrease,
		}},
	}
	tests := []struct {
		name string
		edit func(*CreateInput)
		want error
	}{
		{name: "missing account", edit: func(input *CreateInput) { input.AccountID = uuid.Nil }, want: ErrInvalidAccount},
		{name: "invalid type", edit: func(input *CreateInput) { input.Type = Type("OTHER") }, want: ErrInvalidType},
		{name: "missing trade date", edit: func(input *CreateInput) { input.TradeDate = time.Time{} }, want: ErrInvalidTradeDate},
		{name: "missing source", edit: func(input *CreateInput) { input.Source = "" }, want: ErrInvalidSource},
		{name: "missing entries", edit: func(input *CreateInput) { input.LedgerEntries = nil }, want: ErrInvalidLedgerEntry},
		{name: "invalid asset", edit: func(input *CreateInput) { input.LedgerEntries[0].AssetID = uuid.Nil }, want: ErrInvalidEntryAsset},
		{name: "invalid entry type", edit: func(input *CreateInput) { input.LedgerEntries[0].EntryType = EntryType("OTHER") }, want: ErrInvalidEntryType},
		{name: "invalid currency", edit: func(input *CreateInput) { input.LedgerEntries[0].Currency = "cad" }, want: ErrInvalidEntryCurrency},
		{name: "invalid direction", edit: func(input *CreateInput) { input.LedgerEntries[0].Direction = Direction("OTHER") }, want: ErrInvalidLedgerEntry},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := valid
			input.LedgerEntries = append([]CreateLedgerEntryInput(nil), valid.LedgerEntries...)
			test.edit(&input)
			if err := validateCreateInput(input); !errors.Is(err, test.want) {
				t.Fatalf("validateCreateInput() error = %v, want %v", err, test.want)
			}
		})
	}
}
