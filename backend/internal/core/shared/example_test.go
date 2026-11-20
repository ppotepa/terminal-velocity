package shared_test

import (
	"fmt"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func ExampleNewICAO24() {
	id, err := shared.NewICAO24("a1b2c3")
	if err != nil {
		panic(err)
	}
	fmt.Println(id)
	// Output: A1B2C3
}

func ExampleObservationTime_Bounds() {
	observed, _ := shared.NewObservationTime(time.Date(2025, 1, 1, 12, 0, 0, 0, time.FixedZone("source", 3600)), time.Second, 2*time.Second)
	start, end := observed.Bounds()
	fmt.Println(start.Format(time.RFC3339), end.Format(time.RFC3339))
	// Output: 2025-01-01T10:59:58Z 2025-01-01T11:00:02Z
}
