package identity

import "github.com/google/uuid"

type User struct {
	ID          uuid.UUID
	Email       string
	DisplayName string
}

type Workspace struct {
	ID           uuid.UUID
	Name         string
	BaseCurrency string
	AuthMode     string
}

type WorkspaceMembership struct {
	ID          uuid.UUID
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Role        string
}
