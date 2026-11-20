package bootstrap

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"time"

	decodeapp "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	messageapp "github.com/ppotepa/terminal-velocity/backend/internal/application/messages"
	watchapp "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	coredecode "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	httpmessages "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/messages"
)

const maxMessageHistoryRules = 1000
const maxMessageLookupPages = 50

var errMessageLookupBound = errors.New("message lookup exceeded bounded history scan")

type messageReader struct {
	messages *messageapp.Service
	decoders *decodeapp.Service
	rules    *watchapp.Service
}
type readerCursor struct {
	SortAt time.Time `json:"sortAt"`
	ID     string    `json:"id"`
}

func encodeMessageCursor(c messageapp.Cursor) string {
	raw, _ := json.Marshal(readerCursor{SortAt: c.SortAt, ID: c.ID})
	return base64.RawURLEncoding.EncodeToString(raw)
}
func decodeMessageCursor(raw string) (shared.Optional[messageapp.Cursor], error) {
	if raw == "" {
		return shared.None[messageapp.Cursor](), nil
	}
	bytes, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return shared.None[messageapp.Cursor](), err
	}
	var c readerCursor
	if err = json.Unmarshal(bytes, &c); err != nil || c.SortAt.IsZero() || c.ID == "" {
		return shared.None[messageapp.Cursor](), errors.New("invalid message cursor")
	}
	return shared.Some(messageapp.Cursor{SortAt: c.SortAt, ID: c.ID}), nil
}
func (r messageReader) ruleIDs(ctx context.Context) ([]shared.WatchRuleID, error) {
	out := []shared.WatchRuleID{}
	cursor := ""
	for page := 0; page < 5; page++ {
		items, next, err := r.rules.List(ctx, cursor, 200)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			out = append(out, item.Rule.ID)
		}
		if next == "" {
			return out, nil
		}
		cursor = next
	}
	return nil, errMessageLookupBound
}
func (r messageReader) list(ctx context.Context, q httpmessages.Query) (httpmessages.Page, error) {
	after, err := decodeMessageCursor(q.Cursor)
	if err != nil {
		return httpmessages.Page{}, errors.Join(errors.New("invalid message cursor"), err)
	}
	ruleIDs, err := r.ruleIDs(ctx)
	if err != nil {
		return httpmessages.Page{}, err
	}
	if len(ruleIDs) > maxMessageHistoryRules {
		return httpmessages.Page{}, errMessageLookupBound
	}
	found := []messageapp.Record{}
	for _, ruleID := range ruleIDs {
		cursor := after
		for pageNo := 0; pageNo < maxMessageLookupPages; pageNo++ {
			page, historyErr := r.messages.History(ctx, messageapp.Query{WatchRuleID: shared.Some(ruleID), After: cursor, Limit: 200})
			if historyErr != nil {
				return httpmessages.Page{}, historyErr
			}
			for _, record := range page.Items {
				if q.Protocol != "" && record.Message.Protocol != q.Protocol {
					continue
				}
				if q.AircraftID.Valid && (!record.Association.AircraftID.Valid || record.Association.AircraftID.Value != q.AircraftID.Value) {
					continue
				}
				if q.FlightID.Valid && (!record.Association.FlightID.Valid || record.Association.FlightID.Value != q.FlightID.Value) {
					continue
				}
				found = append(found, record)
			}
			if len(found) >= q.Limit+1 || !page.Next.Valid {
				break
			}
			cursor = page.Next
			if pageNo == maxMessageLookupPages-1 {
				return httpmessages.Page{}, errMessageLookupBound
			}
		}
	}
	sort.Slice(found, func(i, j int) bool {
		if found[i].SortAt.Equal(found[j].SortAt) {
			return found[i].Message.ID > found[j].Message.ID
		}
		return found[i].SortAt.After(found[j].SortAt)
	})
	dedup := found[:0]
	seen := map[shared.MessageID]bool{}
	for _, v := range found {
		if !seen[v.Message.ID] {
			seen[v.Message.ID] = true
			dedup = append(dedup, v)
		}
	}
	more := len(dedup) > q.Limit
	if more {
		dedup = dedup[:q.Limit]
	}
	items := make([]httpmessages.Message, 0, len(dedup))
	for _, record := range dedup {
		item, e := r.toDTO(ctx, record)
		if e != nil {
			return httpmessages.Page{}, e
		}
		items = append(items, item)
	}
	page := httpmessages.Page{Items: items}
	if more && len(dedup) > 0 {
		last := dedup[len(dedup)-1]
		next := encodeMessageCursor(messageapp.Cursor{SortAt: last.SortAt, ID: string(last.Message.ID)})
		page.NextCursor = &next
	}
	return page, nil
}
func (r messageReader) ListMessages(ctx context.Context, q httpmessages.Query) (httpmessages.Page, error) {
	return r.list(ctx, q)
}
func (r messageReader) GetMessage(ctx context.Context, id shared.MessageID) (httpmessages.Message, error) {
	cursor := ""
	for pageNo := 0; pageNo < maxMessageLookupPages; pageNo++ {
		page, err := r.list(ctx, httpmessages.Query{Cursor: cursor, Limit: 200})
		if err != nil {
			return httpmessages.Message{}, err
		}
		for _, item := range page.Items {
			if item.ID == string(id) {
				return item, nil
			}
		}
		if page.NextCursor == nil {
			return httpmessages.Message{}, httpmessages.ErrNotFound
		}
		cursor = *page.NextCursor
	}
	return httpmessages.Message{}, errMessageLookupBound
}
func (r messageReader) toDTO(ctx context.Context, record messageapp.Record) (httpmessages.Message, error) {
	m := record.Message
	item := httpmessages.Message{ID: string(m.ID), Source: string(m.Source), CollectedAt: m.CollectedAt, Direction: string(m.Direction), Bearer: string(m.Bearer), Protocol: m.Protocol, ContentStatus: string(m.ContentStatus), OriginalText: nil, Hints: map[string]httpmessages.EvidenceValue{}, Association: toAssociationDTO(record.Association), Reception: nil, DecoderResults: []httpmessages.DecodeResult{}, TextPermitted: m.ContentStatus != communications.ContentUnavailable && m.ContentStatus != communications.ContentEncrypted, DecodeFieldsPermitted: m.ContentStatus != communications.ContentUnavailable && m.ContentStatus != communications.ContentEncrypted}
	if m.SourceMessageRef.Valid {
		v := m.SourceMessageRef.Value
		item.SourceMessageRef = &v
	}
	if m.ObservedAt.Valid {
		v := m.ObservedAt.Value.Time
		item.ObservedAt = &v
	}
	if item.TextPermitted {
		v := m.OriginalText
		item.OriginalText = &v
	}
	if m.Hints.ICAO24.Valid {
		item.Hints["icao24"] = hintValue(string(m.Hints.ICAO24.Value), m.Source, m.ObservedAt)
	}
	if m.Hints.Registration.Valid {
		item.Hints["registration"] = hintValue(string(m.Hints.Registration.Value), m.Source, m.ObservedAt)
	}
	if m.Hints.Callsign.Valid {
		item.Hints["callsign"] = hintValue(string(m.Hints.Callsign.Value), m.Source, m.ObservedAt)
	}
	if m.Reception.Valid {
		v := m.Reception.Value
		item.Reception = &httpmessages.Reception{ReceiverID: v.ReceiverID, FrameBase64: base64.StdEncoding.EncodeToString(v.Frame), ReceivedAt: v.ReceivedAt.Time, FrequencyHz: optionalUint(v.FrequencyHz)}
	}
	page, err := r.decoders.History(ctx, m.ID, "", decodeapp.DefaultResultPage)
	if err != nil {
		return httpmessages.Message{}, err
	}
	for _, stored := range page.Items {
		item.DecoderResults = append(item.DecoderResults, toDecodeDTO(stored.Result))
	}
	return item, nil
}
func hintValue(value string, source shared.SourceID, at shared.Optional[shared.ObservationTime]) httpmessages.EvidenceValue {
	var src *string
	v := string(source)
	src = &v
	var observed *time.Time
	var uncertainty *float64
	if at.Valid {
		t := at.Value.Time
		observed = &t
		u := at.Value.Uncertainty.Seconds()
		uncertainty = &u
	}
	return httpmessages.EvidenceValue{Value: value, Certainty: "observed", Source: src, ObservedAt: observed, UncertaintySeconds: uncertainty}
}
func toAssociationDTO(a communications.Association) httpmessages.Association {
	out := httpmessages.Association{Outcome: string(a.Outcome), Candidates: []string{}, Evidence: []httpmessages.AssociationEvidence{}}
	if a.AircraftID.Valid {
		v := string(a.AircraftID.Value)
		out.AircraftID = &v
	}
	if a.FlightID.Valid {
		v := string(a.FlightID.Value)
		out.FlightID = &v
	}
	for _, id := range a.Candidates {
		out.Candidates = append(out.Candidates, string(id))
	}
	for _, e := range a.Evidence {
		var src *string
		if e.Source != "" {
			v := string(e.Source)
			src = &v
		}
		value := e.Value
		out.Evidence = append(out.Evidence, httpmessages.AssociationEvidence{Kind: e.Kind, Value: value, Source: src, Reason: e.Reason})
	}
	return out
}
func optionalUint(value shared.Optional[uint64]) *uint64 {
	if !value.Valid {
		return nil
	}
	v := value.Value
	return &v
}
func toDecodeDTO(v coredecode.DecodeResult) httpmessages.DecodeResult {
	out := httpmessages.DecodeResult{Status: string(v.Status), Fields: []httpmessages.DecodeField{}, Reason: v.Reason}
	if v.DecoderID != "" {
		id := string(v.DecoderID)
		out.DecoderID = &id
	}
	if v.DecoderVersion != "" {
		version := v.DecoderVersion
		out.DecoderVersion = &version
	}
	if v.Original != "" {
		original := v.Original
		out.Original = &original
	}
	for _, f := range v.Fields {
		field := httpmessages.DecodeField{Name: f.Name, Type: string(f.Type), Value: f.Value}
		if f.Unit != "" {
			unit := f.Unit
			field.Unit = &unit
		}
		out.Fields = append(out.Fields, field)
	}
	return out
}
