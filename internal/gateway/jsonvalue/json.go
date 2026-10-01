package jsonvalue

import (
	"encoding/json"
	"io"

	"github.com/99designs/gqlgen/graphql"
)

type JSON struct{ Value any }

func (j JSON) MarshalGQL(w io.Writer)        { graphql.MarshalAny(j.Value).MarshalGQL(w) }
func (j *JSON) UnmarshalGQL(value any) error { j.Value = value; return nil }

func (j JSON) MarshalJSON() ([]byte, error) { return json.Marshal(j.Value) }
