// Package geojson loads the pinned Natural Earth country GeoJSON into validated
// application boundary records. Invalid features fail closed at load time.
package geojson

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/geography"
	core "github.com/ppotepa/terminal-velocity/backend/internal/core/geography"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

const (
	NaturalEarthVersion = "5.1.1"
	NaturalEarthSource  = "https://github.com/nvkelso/natural-earth-vector/tree/v5.1.1/geojson"
	NaturalEarthLicense = "Public domain (Natural Earth Terms of Use)"
)

type collection struct {
	Type     string    `json:"type"`
	Features []feature `json:"features"`
}
type feature struct {
	Type       string `json:"type"`
	Properties struct {
		ISOA2   string `json:"ISO_A2"`
		ISOA2EH string `json:"ISO_A2_EH"`
		Name    string `json:"NAME"`
	} `json:"properties"`
	Geometry *geometry `json:"geometry"`
}
type geometry struct {
	Type        string          `json:"type"`
	Coordinates json.RawMessage `json:"coordinates"`
}

// Load parses and validates all mappable country features. Features without a
// usable ISO alpha-2 code are skipped (for example disputed subnational areas).
func Load(reader io.Reader) (application.Dataset, error) {
	decoder := json.NewDecoder(reader)
	var doc collection
	if err := decoder.Decode(&doc); err != nil {
		return application.Dataset{}, fmt.Errorf("decode country GeoJSON: %w", err)
	}
	if doc.Type != "FeatureCollection" || len(doc.Features) == 0 {
		return application.Dataset{}, fmt.Errorf("country data must be a non-empty FeatureCollection")
	}
	byCode := map[core.CountryCode]*application.CountryBoundary{}
	for fi, f := range doc.Features {
		if f.Type != "Feature" {
			return application.Dataset{}, fmt.Errorf("feature %d has invalid type", fi)
		}
		codeText := f.Properties.ISOA2
		if _, err := core.NewCountryCode(codeText); err != nil {
			codeText = f.Properties.ISOA2EH
		}
		code, err := core.NewCountryCode(codeText)
		if err != nil {
			continue
		}
		if f.Geometry == nil {
			return application.Dataset{}, fmt.Errorf("feature %d (%s) is missing geometry", fi, f.Properties.Name)
		}
		if f.Properties.Name == "" {
			return application.Dataset{}, fmt.Errorf("feature %d (%s) is missing a name", fi, code)
		}
		polygons, err := parseGeometry(f.Geometry)
		if err != nil {
			return application.Dataset{}, fmt.Errorf("feature %d (%s): %w", fi, f.Properties.Name, err)
		}
		country := byCode[code]
		if country == nil {
			country = &application.CountryBoundary{Code: code, Name: f.Properties.Name, Areas: []core.GeoArea{}}
			byCode[code] = country
		}
		for pi, polygon := range polygons {
			if err := validateRing(polygon[0]); err != nil {
				return application.Dataset{}, fmt.Errorf("feature %d polygon %d outer ring: %w", fi, pi, err)
			}
			outer, err := core.NewPolygonArea(fmt.Sprintf("%s-%d-%d-outer", code, fi, pi), polygon[0], nil)
			if err != nil {
				return application.Dataset{}, fmt.Errorf("feature %d polygon %d outer ring: %w", fi, pi, err)
			}
			for hi, hole := range polygon[1:] {
				if err := validateRing(hole); err != nil {
					return application.Dataset{}, fmt.Errorf("feature %d polygon %d hole %d: %w", fi, pi, hi, err)
				}
				if core.MatchArea(outer, shared.Some(hole[0])) != core.SpatialInside {
					return application.Dataset{}, fmt.Errorf("feature %d polygon %d hole %d is outside its outer ring", fi, pi, hi)
				}
			}
			area, err := core.NewPolygonArea(fmt.Sprintf("%s-%d-%d", code, fi, pi), polygon[0], polygon[1:])
			if err != nil {
				return application.Dataset{}, fmt.Errorf("feature %d polygon %d: %w", fi, pi, err)
			}
			country.Areas = append(country.Areas, area)
		}
	}
	countries := make([]application.CountryBoundary, 0, len(byCode))
	for _, c := range byCode {
		countries = append(countries, *c)
	}
	sort.Slice(countries, func(i, j int) bool { return countries[i].Code < countries[j].Code })
	dataset := application.Dataset{Version: NaturalEarthVersion, Source: NaturalEarthSource, License: NaturalEarthLicense, Countries: countries}
	if err := dataset.Validate(); err != nil {
		return application.Dataset{}, fmt.Errorf("validate country dataset: %w", err)
	}
	return dataset, nil
}

func validateRing(ring []core.GeoPoint) error {
	if len(ring) < 4 || ring[0] != ring[len(ring)-1] {
		return fmt.Errorf("ring must contain at least three vertices and be closed")
	}
	area := 0.0
	previous := ring[0].Longitude
	longitudes := make([]float64, len(ring))
	longitudes[0] = previous
	for i := 1; i < len(ring); i++ {
		lon := ring[i].Longitude
		for lon-previous > 180 {
			lon -= 360
		}
		for lon-previous < -180 {
			lon += 360
		}
		longitudes[i] = lon
		previous = lon
		if ring[i] == ring[i-1] {
			return fmt.Errorf("ring has a zero-length edge")
		}
	}
	for i := 1; i < len(ring); i++ {
		area += longitudes[i-1]*ring[i].Latitude - longitudes[i]*ring[i-1].Latitude
	}
	if area == 0 {
		return fmt.Errorf("ring has zero area")
	}
	return nil
}

func parseGeometry(g *geometry) ([][][]core.GeoPoint, error) {
	var rawPolygons [][][][]float64
	switch g.Type {
	case "Polygon":
		var rings [][][]float64
		if err := json.Unmarshal(g.Coordinates, &rings); err != nil {
			return nil, fmt.Errorf("decode Polygon coordinates: %w", err)
		}
		rawPolygons = append(rawPolygons, rings)
	case "MultiPolygon":
		var raw [][][][]float64
		if err := json.Unmarshal(g.Coordinates, &raw); err != nil {
			return nil, fmt.Errorf("decode MultiPolygon coordinates: %w", err)
		}
		rawPolygons = raw
	default:
		return nil, fmt.Errorf("unsupported geometry type %q", g.Type)
	}
	if len(rawPolygons) == 0 {
		return nil, fmt.Errorf("geometry has no polygons")
	}
	result := make([][][]core.GeoPoint, 0, len(rawPolygons))
	for pi, rings := range rawPolygons {
		if len(rings) == 0 {
			return nil, fmt.Errorf("polygon %d has no rings", pi)
		}
		converted := make([][]core.GeoPoint, 0, len(rings))
		for ri, ring := range rings {
			points := make([]core.GeoPoint, 0, len(ring))
			for ci, coord := range ring {
				if len(coord) < 2 {
					return nil, fmt.Errorf("polygon %d ring %d coordinate %d needs longitude and latitude", pi, ri, ci)
				}
				point, err := core.NewGeoPoint(coord[1], coord[0])
				if err != nil {
					return nil, fmt.Errorf("polygon %d ring %d coordinate %d: %w", pi, ri, ci, err)
				}
				points = append(points, point)
			}
			converted = append(converted, points)
		}
		result = append(result, converted)
	}
	return result, nil
}
