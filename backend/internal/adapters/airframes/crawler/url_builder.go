package crawler

import (
	"fmt"
	"net/url"
	"strings"
)

// TemplateURLBuilder makes the provider's target-filter URL format explicit.
// There is no guessed default because Airframes documents filter behavior but
// does not promise stable rendered-page URL parameter names.
type TemplateURLBuilder struct{ Templates URLTemplates }

func (b TemplateURLBuilder) Build(raw Target) (string, error) {
	target, kind, err := raw.normalized()
	if err != nil {
		return "", err
	}
	template, value, token := b.Templates.ICAO24, target.ICAO24, "{icao24}"
	if kind == targetTail {
		template, value, token = b.Templates.Tail, target.Tail, "{tail}"
	}
	if kind == targetFlight {
		template, value, token = b.Templates.Flight, target.Flight, "{flight}"
	}
	if template == "" || !strings.Contains(template, token) {
		return "", fmt.Errorf("a per-target Airframes URL template containing %s is required", token)
	}
	return strings.ReplaceAll(template, token, url.QueryEscape(value)), nil
}

var _ URLBuilder = TemplateURLBuilder{}
