package shared

import "errors"

// ErrorKind identifies a stable category of domain failure.
type ErrorKind string

const (
	ErrInvalidInput ErrorKind = "invalid_input"
	ErrNotFound     ErrorKind = "not_found"
	ErrConflict     ErrorKind = "conflict"
	ErrOutOfRange   ErrorKind = "out_of_range"
)

// DomainError carries a machine-readable category and a human-readable message.
type DomainError struct {
	Kind    ErrorKind
	Message string
}

func (e *DomainError) Error() string { return e.Message }

func NewDomainError(kind ErrorKind, message string) error {
	return &DomainError{Kind: kind, Message: message}
}

func ErrorIsKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}
