package shared

import (
	"fmt"
	"regexp"
	"strings"
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

func validateID(kind, value string) error {
	if !idPattern.MatchString(value) {
		return NewDomainError(ErrInvalidInput, fmt.Sprintf("%s identifier must be 1-128 safe characters", kind))
	}
	return nil
}

type AircraftID string
type FlightID string
type WatchRuleID string
type MessageID string
type SourceID string
type AlertID string

func NewAircraftID(v string) (AircraftID, error) { return AircraftID(v), validateID("aircraft", v) }
func NewFlightID(v string) (FlightID, error)     { return FlightID(v), validateID("flight", v) }
func NewWatchRuleID(v string) (WatchRuleID, error) {
	return WatchRuleID(v), validateID("watch rule", v)
}
func NewMessageID(v string) (MessageID, error) { return MessageID(v), validateID("message", v) }
func NewSourceID(v string) (SourceID, error)   { return SourceID(v), validateID("source", v) }
func NewAlertID(v string) (AlertID, error)     { return AlertID(v), validateID("alert", v) }

type ICAO24 string
type Registration string
type Callsign string

var (
	icao24Pattern       = regexp.MustCompile(`^[0-9A-F]{6}$`)
	registrationPattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]{0,11}$`)
	callsignPattern     = regexp.MustCompile(`^[A-Z0-9][A-Z0-9 ]{0,7}$`)
)

func NewICAO24(v string) (ICAO24, error) {
	n := strings.ToUpper(strings.TrimSpace(v))
	if !icao24Pattern.MatchString(n) {
		return "", NewDomainError(ErrInvalidInput, "ICAO24 must contain exactly six hexadecimal characters")
	}
	return ICAO24(n), nil
}

func NewRegistration(v string) (Registration, error) {
	n := strings.ToUpper(strings.TrimSpace(v))
	if !registrationPattern.MatchString(n) {
		return "", NewDomainError(ErrInvalidInput, "registration must contain 1-12 letters, digits, or hyphens")
	}
	return Registration(n), nil
}

func NewCallsign(v string) (Callsign, error) {
	n := strings.ToUpper(strings.TrimSpace(v))
	if !callsignPattern.MatchString(n) {
		return "", NewDomainError(ErrInvalidInput, "callsign must contain 1-8 letters, digits, or spaces")
	}
	return Callsign(strings.TrimRight(n, " ")), nil
}
