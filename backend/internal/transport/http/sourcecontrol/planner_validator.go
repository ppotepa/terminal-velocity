package sourcecontrol

import (
	"context"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/acquisition"
	"github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
	httpwatch "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/watchlist"
)

// PlannerValidator applies the same bounded source planner used by acquisition before a rule is stored.
type PlannerValidator struct {
	Capabilities []sources.Capabilities
	Planner      acquisition.QueryPlanner
}

func (v PlannerValidator) Validate(_ context.Context, rule watch.WatchRule) ([]httpwatch.ValidationIssue, error) {
	// Validate what the rule would request if activated, even when the submitted state is paused.
	rule.Status = watch.StatusActive
	result, err := v.Planner.Plan([]watchlist.StoredRule{{Rule: rule}}, v.Capabilities)
	if err != nil {
		return nil, err
	}
	issues := make([]httpwatch.ValidationIssue, 0, len(result.Rejections))
	for _, rejection := range result.Rejections {
		issues = append(issues, httpwatch.ValidationIssue{Code: rejection.Reason, Message: rejection.Message, SourceID: rejection.SourceID})
	}
	return issues, nil
}
