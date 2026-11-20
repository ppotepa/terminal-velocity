package bootstrap

import (
	"crypto/sha256"
	"encoding/hex"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"strings"
)

func fixtureAircraftID(callsign string) shared.AircraftID {
	return fixtureAircraftIDFromICAO(string(fixtureICAO24(callsign)))
}
func fixtureAircraftIDFromICAO(icao string) shared.AircraftID {
	sum := sha256.Sum256([]byte("aircraft:" + icao))
	return shared.AircraftID("ac-fixture-" + hex.EncodeToString(sum[:8]))
}
func fixtureFlightID(callsign string) shared.FlightID {
	sum := sha256.Sum256([]byte("flight:" + callsign))
	return shared.FlightID("fl-fixture-" + hex.EncodeToString(sum[:8]))
}
func fixtureICAO24(callsign string) shared.ICAO24 {
	sum := sha256.Sum256([]byte("icao24:" + callsign))
	return shared.ICAO24(strings.ToUpper(hex.EncodeToString(sum[:3])))
}
func fixtureSourceObservationID(key string, minute int64) string {
	sum := sha256.Sum256([]byte(key))
	return "pos-" + hex.EncodeToString(sum[:8]) + "-" + hex.EncodeToString([]byte{byte(minute >> 24), byte(minute >> 16), byte(minute >> 8), byte(minute)})
}
