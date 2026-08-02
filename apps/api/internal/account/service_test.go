package account

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCreateAccountUsesProvidedPortfolioAndNormalizesInput(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	repository := &fakeRepository{}
	service := NewService(repository)

	institution := "  Questrade  "
	externalReference := "  margin-1  "
	created, err := service.CreateAccount(context.Background(), portfolioID, CreateInput{
		Name:              "  Margin  ",
		InstitutionName:   &institution,
		Type:              TypeBrokerage,
		BaseCurrency:      "CAD",
		ExternalReference: &externalReference,
	})
	if err != nil {
		t.Fatalf("CreateAccount() error = %v", err)
	}
	if repository.createInput.PortfolioID != portfolioID {
		t.Fatalf("portfolio id = %s, want %s", repository.createInput.PortfolioID, portfolioID)
	}
	if repository.createInput.Name != "Margin" {
		t.Fatalf("name = %q, want Margin", repository.createInput.Name)
	}
	if repository.createInput.InstitutionName == nil || *repository.createInput.InstitutionName != "Questrade" {
		t.Fatalf("institution name = %#v, want Questrade", repository.createInput.InstitutionName)
	}
	if repository.createInput.ExternalReference == nil || *repository.createInput.ExternalReference != "margin-1" {
		t.Fatalf("external reference = %#v, want margin-1", repository.createInput.ExternalReference)
	}
	if created.PortfolioID != portfolioID {
		t.Fatalf("created portfolio id = %s, want %s", created.PortfolioID, portfolioID)
	}
}

func TestCreateAccountValidation(t *testing.T) {
	tests := []struct {
		name  string
		input CreateInput
		want  error
	}{
		{
			name:  "blank name",
			input: CreateInput{Name: "   ", Type: TypeBrokerage, BaseCurrency: "CAD"},
			want:  ErrInvalidName,
		},
		{
			name:  "invalid type",
			input: CreateInput{Name: "Margin", Type: Type("OTHER"), BaseCurrency: "CAD"},
			want:  ErrInvalidType,
		},
		{
			name:  "invalid currency",
			input: CreateInput{Name: "Margin", Type: TypeBrokerage, BaseCurrency: "cad"},
			want:  ErrInvalidCurrency,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := NewService(&fakeRepository{})
			_, err := service.CreateAccount(context.Background(), uuid.New(), tt.input)
			if !errors.Is(err, tt.want) {
				t.Fatalf("CreateAccount() error = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestListAccountsUsesProvidedPortfolio(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	repository := &fakeRepository{}
	service := NewService(repository)

	_, err := service.ListAccounts(context.Background(), portfolioID)
	if err != nil {
		t.Fatalf("ListAccounts() error = %v", err)
	}
	if repository.listPortfolioID != portfolioID {
		t.Fatalf("portfolio id = %s, want %s", repository.listPortfolioID, portfolioID)
	}
}

func TestGetAccountUsesProvidedPortfolio(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeRepository{}
	service := NewService(repository)

	_, err := service.GetAccount(context.Background(), portfolioID, accountID)
	if err != nil {
		t.Fatalf("GetAccount() error = %v", err)
	}
	if repository.getPortfolioID != portfolioID {
		t.Fatalf("portfolio id = %s, want %s", repository.getPortfolioID, portfolioID)
	}
	if repository.getAccountID != accountID {
		t.Fatalf("account id = %s, want %s", repository.getAccountID, accountID)
	}
}

type fakeRepository struct {
	createInput     createRepositoryInput
	listPortfolioID uuid.UUID
	getPortfolioID  uuid.UUID
	getAccountID    uuid.UUID
	err             error
}

func (r *fakeRepository) Create(_ context.Context, input createRepositoryInput) (Account, error) {
	r.createInput = input
	if r.err != nil {
		return Account{}, r.err
	}
	now := time.Now()
	return Account{ID: uuid.New(), PortfolioID: input.PortfolioID, Name: input.Name, Type: input.Type, BaseCurrency: input.BaseCurrency, CreatedAt: now, UpdatedAt: now}, nil
}

func (r *fakeRepository) ListByPortfolio(_ context.Context, portfolioID uuid.UUID) ([]Account, error) {
	r.listPortfolioID = portfolioID
	return []Account{}, r.err
}

func (r *fakeRepository) GetByPortfolioAndID(_ context.Context, portfolioID uuid.UUID, id uuid.UUID) (Account, error) {
	r.getPortfolioID = portfolioID
	r.getAccountID = id
	if r.err != nil {
		return Account{}, r.err
	}
	now := time.Now()
	return Account{ID: id, PortfolioID: portfolioID, Name: "Margin", Type: TypeBrokerage, BaseCurrency: "CAD", CreatedAt: now, UpdatedAt: now}, nil
}
