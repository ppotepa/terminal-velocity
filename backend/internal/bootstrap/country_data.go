package bootstrap

import (
	"fmt"
	"os"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/adapters/geography/geojson"
	geoapp "github.com/ppotepa/terminal-velocity/backend/internal/application/geography"
)

func loadFixtureCountryService() (*geoapp.Service, error) {
	path := os.Getenv("TV_COUNTRY_GEOJSON")
	if path == "" {
		path = "data/geography/countries.geojson"
		if _, err := os.Stat(path); err != nil {
			path = "backend/data/geography/countries.geojson"
		}
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open country boundary data: %w", err)
	}
	defer file.Close()
	dataset, err := geojson.Load(file)
	if err != nil {
		return nil, fmt.Errorf("load country boundary data: %w", err)
	}
	service, err := geoapp.NewService(dataset, 15*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("initialize country boundary service: %w", err)
	}
	return service, nil
}
