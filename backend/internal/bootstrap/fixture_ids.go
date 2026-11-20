package bootstrap

import (
	"crypto/sha256"
	"encoding/hex"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"strconv"
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

func fixtureCallsignForPrefix(prefix string) (string, error) {
	prefix = strings.ToUpper(strings.TrimSpace(prefix))
	if prefix == "" || strings.ContainsAny(prefix, "*?/") {
		return "", shared.NewDomainError(shared.ErrInvalidInput, "synthetic callsign prefix is invalid")
	}
	suffix := "42"
	if len(prefix) == 7 {
		suffix = "2"
	} else if len(prefix) >= 8 {
		suffix = ""
	}
	value := prefix + suffix
	callsign, err := shared.NewCallsign(value)
	return string(callsign), err
}
func fixtureICAO24(callsign string) shared.ICAO24 {
	sum := sha256.Sum256([]byte("icao24:" + callsign))
	return shared.ICAO24(strings.ToUpper(hex.EncodeToString(sum[:3])))
}
func fixtureSourceObservationID(key string, instant int64) string {
	sum := sha256.Sum256([]byte(key + ":" + strconv.FormatInt(instant, 10)))
	return "pos-" + hex.EncodeToString(sum[:12])
}
