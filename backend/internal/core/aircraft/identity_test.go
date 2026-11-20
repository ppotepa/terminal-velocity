package aircraft

import (
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func at(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func assertion(kind IdentifierKind, value, source string, from time.Time, until shared.Optional[time.Time]) IdentifierAssertion {
	observed, _ := shared.NewObservationTime(from, time.Second, 0)
	return IdentifierAssertion{Kind: kind, Value: value, ValidFrom: from, ValidUntil: until, Evidence: shared.Evidence{Source: shared.SourceID(source), ObservedAt: observed}}
}

func input(at time.Time, hints ...IdentifierHint) ResolveInput {
	observed, _ := shared.NewObservationTime(at, time.Second, 0)
	return ResolveInput{Identifiers: hints, ObservedAt: shared.Some(observed)}
}

func TestHistoricalIdentifierChangeDoesNotRewriteResolution(t *testing.T) {
	cutover := at(2024, time.July, 1)
	aircraft, err := NewAircraft("aircraft-1", []IdentifierAssertion{
		assertion(IdentifierICAO24, "a1b2c3", "registry", at(2020, time.January, 1), shared.Some(cutover)),
		assertion(IdentifierICAO24, "d4e5f6", "registry", cutover, shared.None[time.Time]()),
		assertion(IdentifierRegistration, "N123AB", "registry", at(2020, time.January, 1), shared.None[time.Time]()),
	})
	if err != nil {
		t.Fatal(err)
	}
	old := ResolveAircraft([]Aircraft{aircraft}, input(at(2022, time.March, 1), IdentifierHint{Kind: IdentifierICAO24, Value: "A1B2C3"}))
	if old.Status != ResolutionMatched || old.AircraftID.Value != "aircraft-1" {
		t.Fatalf("old alias should resolve historically: %+v", old)
	}
	current := ResolveAircraft([]Aircraft{aircraft}, input(at(2025, time.March, 1), IdentifierHint{Kind: IdentifierICAO24, Value: "A1B2C3"}))
	if current.Status != ResolutionUnmatched {
		t.Fatalf("expired alias should not resolve now: %+v", current)
	}
	newID := ResolveAircraft([]Aircraft{aircraft}, input(at(2025, time.March, 1), IdentifierHint{Kind: IdentifierICAO24, Value: "D4E5F6"}))
	if newID.Status != ResolutionMatched {
		t.Fatalf("new alias should resolve: %+v", newID)
	}
}

func TestAmbiguousAliasNeverConfirmsAircraft(t *testing.T) {
	validFrom := at(2020, time.January, 1)
	a, _ := NewAircraft("aircraft-a", []IdentifierAssertion{assertion(IdentifierRegistration, "N123AB", "source-a", validFrom, shared.None[time.Time]())})
	b, _ := NewAircraft("aircraft-b", []IdentifierAssertion{assertion(IdentifierRegistration, "N123AB", "source-b", validFrom, shared.None[time.Time]())})
	got := ResolveAircraft([]Aircraft{b, a}, input(at(2025, time.March, 1), IdentifierHint{Kind: IdentifierRegistration, Value: "n123ab"}))
	if got.Status != ResolutionAmbiguous || got.AircraftID.Valid || len(got.Candidates) != 2 || got.Conflict == nil {
		t.Fatalf("collision must remain explicit: %+v", got)
	}
}

func TestDifferentIdentifiersConflictAndCallsSignDoesNotResolve(t *testing.T) {
	from := at(2020, time.January, 1)
	a, _ := NewAircraft("aircraft-a", []IdentifierAssertion{assertion(IdentifierICAO24, "A1B2C3", "source-a", from, shared.None[time.Time]())})
	b, _ := NewAircraft("aircraft-b", []IdentifierAssertion{assertion(IdentifierRegistration, "N456CD", "source-b", from, shared.None[time.Time]())})
	got := ResolveAircraft([]Aircraft{a, b}, input(at(2025, time.March, 1), IdentifierHint{Kind: IdentifierICAO24, Value: "A1B2C3"}, IdentifierHint{Kind: IdentifierRegistration, Value: "N456CD"}))
	if got.Status != ResolutionConflicted || got.AircraftID.Valid {
		t.Fatalf("contradictory identifiers must not resolve: %+v", got)
	}
	callsign, err := shared.NewCallsign("UAL123")
	if err != nil {
		t.Fatal(err)
	}
	callResult := ResolveAircraft([]Aircraft{a, b}, ResolveInput{Callsign: shared.Some(callsign)})
	if callResult.Status != ResolutionUnknown || callResult.AircraftID.Valid {
		t.Fatalf("callsign must not identify aircraft: %+v", callResult)
	}
}

func TestObservationUncertaintyAtValidityBoundaryIsUnknown(t *testing.T) {
	cutover := at(2024, time.July, 1)
	a, err := NewAircraft("aircraft-a", []IdentifierAssertion{assertion(IdentifierICAO24, "A1B2C3", "registry", at(2020, time.January, 1), shared.Some(cutover))})
	if err != nil {
		t.Fatal(err)
	}
	observed, _ := shared.NewObservationTime(cutover, time.Second, time.Second)
	got := ResolveAircraft([]Aircraft{a}, ResolveInput{Identifiers: []IdentifierHint{{Kind: IdentifierICAO24, Value: "A1B2C3"}}, ObservedAt: shared.Some(observed)})
	if got.Status != ResolutionUnknown {
		t.Fatalf("boundary uncertainty should be explicit: %+v", got)
	}
}

func TestInvalidAssertionsAreRejectedAndSortedCopyIsStable(t *testing.T) {
	valid := assertion(IdentifierICAO24, "A1B2C3", "registry", at(2020, time.January, 1), shared.None[time.Time]())
	bad := valid
	bad.ValidUntil = shared.Some(at(2019, time.January, 1))
	if _, err := NewAircraft("aircraft-a", []IdentifierAssertion{bad}); err == nil {
		t.Fatal("accepted reversed validity period")
	}
	inputAssertions := []IdentifierAssertion{valid}
	got, err := NewAircraft("aircraft-a", inputAssertions)
	if err != nil {
		t.Fatal(err)
	}
	inputAssertions[0].Value = "FFFFFF"
	if got.Assertions[0].Value != "A1B2C3" {
		t.Fatal("constructor retained caller-owned slice")
	}
}
