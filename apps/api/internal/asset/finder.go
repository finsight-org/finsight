package asset

import (
	"context"
	"fmt"
)

type Provider interface {
	SearchAssets(context.Context, string, int) ([]AssetCandidate, error)
}

type Finder struct {
	provider Provider
}

func NewFinder(provider Provider) *Finder {
	return &Finder{provider: provider}
}

func (f *Finder) SearchAssets(ctx context.Context, input SearchInput) ([]AssetCandidate, error) {
	if f == nil || f.provider == nil {
		return nil, fmt.Errorf("asset provider is required")
	}

	input = normalizeSearchInput(input)
	if len(input.Query) < MinSearchQueryLen || input.Limit == nil || *input.Limit < 1 || *input.Limit > MaxSearchLimit {
		return nil, ErrInvalidSearchQuery
	}

	candidates, err := f.provider.SearchAssets(ctx, input.Query, *input.Limit)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProviderUnavailable, err)
	}

	return candidates, nil
}
