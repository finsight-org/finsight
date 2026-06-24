package migrations

import "embed"

// Files contains Finsight database migrations.
//
//go:embed *.sql
var Files embed.FS
