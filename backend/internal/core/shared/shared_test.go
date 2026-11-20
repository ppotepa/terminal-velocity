package shared

import (
	"errors"
	"testing"
	"time"
)

func TestOpaqueIDsValidateBoundaries(t *testing.T) {
	if _, err := NewAircraftID("a_1:abc"); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"", " space", "a/b", string(make([]byte, 129))} {
		if _, err := NewAircraftID(value); !ErrorIsKind(err, ErrInvalidInput) {
			t.Errorf("%q: want invalid-input error, got %v", value, err)
		}
	}
}

func TestNormalizedIdentifiers(t *testing.T) {
	if got, err := NewICAO24(" a1b2c3 "); err != nil || got != "A1B2C3" {
		t.Fatalf("got %q, %v", got, err)
	}
	if got, err := NewRegistration(" n123ab "); err != nil || got != "N123AB" {
		t.Fatalf("got %q, %v", got, err)
	}
	if got, err := NewCallsign(" ual123 "); err != nil || got != "UAL123" {
		t.Fatalf("got %q, %v", got, err)
	}
	for _, bad := range []string{"abc", "GGGGGG", "A/B"} {
		if _, err := NewICAO24(bad); err == nil {
			t.Errorf("accepted invalid ICAO24 %q", bad)
		}
	}
}

func TestObservationTimeUTCAndUncertaintyBounds(t *testing.T) {
	local := time.Date(2025, 4, 2, 12, 0, 0, 0, time.FixedZone("source", 2*60*60))
	got, err := NewObservationTime(local, time.Second, 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if got.Time.Location() != time.UTC || got.Time.Hour() != 10 {
		t.Fatalf("not normalized to UTC: %v", got.Time)
	}
	start, end := got.Bounds()
	if end.Sub(start) != 6*time.Second {
		t.Fatalf("unexpected uncertainty bounds: %v to %v", start, end)
	}
	if _, err := NewObservationTime(time.Time{}, 0, 0); err == nil {
		t.Fatal("accepted zero time")
	}
	if _, err := NewObservationTime(local, -1, 0); err == nil {
		t.Fatal("accepted negative precision")
	}
}

func TestOptionalAndTypedErrors(t *testing.T) {
	if None[string]().Valid || !Some("x").Valid {
		t.Fatal("optional validity is incorrect")
	}
	err := NewDomainError(ErrConflict, "conflict")
	var typed *DomainError
	if !errors.As(err, &typed) || typed.Kind != ErrConflict {
		t.Fatalf("typed error lost: %v", err)
	}
}

func TestEvidenceRequiresSourceAndTime(t *testing.T) {
	e := Evidence{Source: "src-1"}
	if err := e.Validate(); err == nil {
		t.Fatal("accepted missing observation time")
	}
	e.ObservedAt, _ = NewObservationTime(time.Now(), time.Second, 0)
	if err := e.Validate(); err != nil {
		t.Fatal(err)
	}
}
