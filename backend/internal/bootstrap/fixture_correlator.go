package bootstrap

import (
	"context"
	"time"

	coreaircraft "github.com/ppotepa/terminal-velocity/backend/internal/core/aircraft"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	shared "github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type fixtureCorrelator struct{}

func (fixtureCorrelator) AircraftCandidates(_ context.Context, hints []coreaircraft.IdentifierHint, at shared.Optional[shared.ObservationTime], limit int) ([]coreaircraft.Aircraft, error) {
	if !at.Valid || limit < 1 {
		return []coreaircraft.Aircraft{}, nil
	}
	out := []coreaircraft.Aircraft{}
	seen := map[shared.AircraftID]bool{}
	for _, hint := range hints {
		if hint.Kind != coreaircraft.IdentifierICAO24 {
			continue
		}
		id := fixtureAircraftIDFromICAO(hint.Value)
		if seen[id] {
			continue
		}
		seen[id] = true
		validFrom := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
		assertion := coreaircraft.IdentifierAssertion{Kind: coreaircraft.IdentifierICAO24, Value: hint.Value, ValidFrom: validFrom, Evidence: shared.Evidence{Source: "synthetic-fixture", ObservedAt: shared.ObservationTime{Time: validFrom}}}
		item, err := coreaircraft.NewAircraft(id, []coreaircraft.IdentifierAssertion{assertion})
		if err != nil {
			return nil, err
		}
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}
func (fixtureCorrelator) FlightCandidates(_ context.Context, id shared.AircraftID, callsign shared.Optional[shared.Callsign], at shared.ObservationTime, limit int) ([]flight.Flight, error) {
	if limit < 1 || !callsign.Valid {
		return []flight.Flight{}, nil
	}
	if fixtureAircraftID(string(callsign.Value)) != id {
		return []flight.Flight{}, nil
	}
	item, err := flight.NewFlight(fixtureFlightID(string(callsign.Value)), shared.Some(id), callsign)
	if err != nil {
		return nil, err
	}
	item.StartedAt = shared.Some(flight.BoundaryEvidence{At: shared.ObservationTime{Time: at.Time.Add(-30 * time.Minute), Precision: time.Minute}, Source: "synthetic-fixture", Reason: "deterministic_synthetic_fixture_start"})
	return []flight.Flight{item}, nil
}
