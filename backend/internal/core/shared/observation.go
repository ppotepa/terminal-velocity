package shared

import (
	"fmt"
	"time"
)

// ObservationTime preserves the precision of a source timestamp and an optional
// uncertainty bound. Time is always normalized to UTC.
type ObservationTime struct {
	Time        time.Time
	Precision   time.Duration
	Uncertainty time.Duration
}

func NewObservationTime(at time.Time, precision, uncertainty time.Duration) (ObservationTime, error) {
	if at.IsZero() {
		return ObservationTime{}, NewDomainError(ErrInvalidInput, "observation time is required")
	}
	if precision < 0 || uncertainty < 0 {
		return ObservationTime{}, NewDomainError(ErrInvalidInput, "precision and uncertainty cannot be negative")
	}
	return ObservationTime{Time: at.UTC(), Precision: precision, Uncertainty: uncertainty}, nil
}

func (o ObservationTime) Bounds() (time.Time, time.Time) {
	return o.Time.Add(-o.Uncertainty), o.Time.Add(o.Uncertainty)
}

// Optional represents a value that may be absent without inventing a sentinel.
type Optional[T any] struct {
	Value T
	Valid bool
}

func Some[T any](value T) Optional[T] { return Optional[T]{Value: value, Valid: true} }
func None[T any]() Optional[T]        { return Optional[T]{} }

// Evidence records where an assertion came from and how certain it is.
type Evidence struct {
	Source      SourceID
	ObservedAt  ObservationTime
	Uncertainty string
}

func (e Evidence) Validate() error {
	if _, err := NewSourceID(string(e.Source)); err != nil {
		return fmt.Errorf("evidence source: %w", err)
	}
	if e.ObservedAt.Time.IsZero() {
		return NewDomainError(ErrInvalidInput, "evidence observation time is required")
	}
	return nil
}
