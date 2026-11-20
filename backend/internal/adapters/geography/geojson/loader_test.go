package geojson

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	core "github.com/ppotepa/terminal-velocity/backend/internal/core/geography"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func TestLoadPolygonAndMultipolygonCountriesAndSkipNoISOCode(t *testing.T) {
	input := `{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"ISO_A2":"AA","ISO_A2_EH":"AA","NAME":"Alpha"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}},{"type":"Feature","properties":{"ISO_A2":"BB","ISO_A2_EH":"BB","NAME":"Beta"},"geometry":{"type":"MultiPolygon","coordinates":[[[[2,0],[3,0],[3,1],[2,1],[2,0]]],[[[4,0],[5,0],[5,1],[4,1],[4,0]]]]}},{"type":"Feature","properties":{"ISO_A2":"-99","ISO_A2_EH":"-99","NAME":"Uncoded area"},"geometry":{"type":"Polygon","coordinates":[]}}]}`
	dataset, err := Load(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(dataset.Countries) != 2 || dataset.Version != NaturalEarthVersion {
		t.Fatalf("dataset=%+v", dataset)
	}
	if len(dataset.Countries[1].Areas) != 2 {
		t.Fatalf("multipolygon areas=%d", len(dataset.Countries[1].Areas))
	}
	if core.MatchArea(dataset.Countries[0].Areas[0], mustPoint(t, 0.5, 0.5)) != core.SpatialInside {
		t.Fatal("polygon point should be inside")
	}
}

func mustPoint(t *testing.T, lon, lat float64) shared.Optional[core.GeoPoint] {
	t.Helper()
	point, err := core.NewGeoPoint(lat, lon)
	if err != nil {
		t.Fatal(err)
	}
	return shared.Some(point)
}
func openNaturalEarthForTest() (*os.File, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return nil, os.ErrNotExist
	}
	return os.Open(filepath.Clean(filepath.Join(filepath.Dir(file), "../../../../data/geography/countries.geojson")))
}

func TestLoadPinnedNaturalEarthDataset(t *testing.T) {
	f, err := openNaturalEarthForTest()
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	dataset, err := Load(f)
	if err != nil {
		t.Fatal(err)
	}
	if len(dataset.Countries) < 200 {
		t.Fatalf("loaded only %d countries", len(dataset.Countries))
	}
	foundFrance, foundFiji := false, false
	for _, c := range dataset.Countries {
		if c.Code == "FR" {
			foundFrance = true
		}
		if c.Code == "FJ" {
			foundFiji = true
		}
	}
	if !foundFrance || !foundFiji {
		t.Fatalf("expected FR and FJ in dataset (FR=%v FJ=%v)", foundFrance, foundFiji)
	}
}

func TestInvalidCountryPolygonFailsClosed(t *testing.T) {
	input := `{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"ISO_A2":"AA","ISO_A2_EH":"AA","NAME":"Alpha"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}}]}`
	if _, err := Load(strings.NewReader(input)); err == nil {
		t.Fatal("open ring was accepted")
	}
}
