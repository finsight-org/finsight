package portfolio

import "github.com/google/uuid"

type Portfolio struct {
	ID           uuid.UUID
	WorkspaceID  uuid.UUID
	Name         string
	BaseCurrency string
	IsDefault    bool
}
