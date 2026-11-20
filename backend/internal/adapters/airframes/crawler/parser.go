package crawler

import (
	"fmt"
	"strings"
	"time"
	"unicode"

	"golang.org/x/net/html"
)

type column int

const (
	colUnknown column = iota
	colID
	colTimestamp
	colFlight
	colTail
	colLabel
	colText
	colSource
	colProtocol
	colFromICAO
	colToICAO
	colMode
	colErrors
	colFrequency
	colChannel
	colDecoder
)

type parsedTable struct {
	headers map[column]int
	rows    []*html.Node
}

// ParseHTML reads only message rows from a rendered HTML table. Its selector-
// independent header mapping makes schema drift explicit when page labels move.
func ParseHTML(page string, target Target, maxRows int) (Result, error) {
	if maxRows < 1 || maxRows > 100 {
		return Result{}, fmt.Errorf("row limit must be within 1..100")
	}
	target, kind, err := target.normalized()
	if err != nil {
		return Result{}, err
	}
	root, err := html.Parse(strings.NewReader(page))
	if err != nil {
		return Result{}, fmt.Errorf("parse rendered Airframes page: %w", err)
	}
	table, err := findMessageTable(root, kind)
	if err != nil {
		return Result{}, err
	}
	out := Result{Messages: []Message{}}
	seen := map[string]bool{}
	for i, row := range table.rows {
		if i >= maxRows {
			out.Truncated = true
			break
		}
		message, err := parseRow(row, table.headers)
		if err != nil {
			return Result{}, fmt.Errorf("%w: row %d: %v", ErrSchemaDrift, i+1, err)
		}
		if !matches(message, target, kind) {
			continue
		}
		if seen[message.ID] {
			continue
		}
		seen[message.ID] = true
		out.Messages = append(out.Messages, message)
	}
	return out, nil
}

func findMessageTable(root *html.Node, kind targetKind) (parsedTable, error) {
	var tables []*html.Node
	walk(root, func(n *html.Node) {
		if n.Type == html.ElementNode && strings.EqualFold(n.Data, "table") {
			tables = append(tables, n)
		}
	})
	for _, table := range tables {
		headers := map[column]int{}
		var rows []*html.Node
		var headerSeen bool
		walk(table, func(n *html.Node) {
			if n.Type != html.ElementNode {
				return
			}
			switch strings.ToLower(n.Data) {
			case "th":
				c := labelColumn(nodeText(n))
				if c != colUnknown {
					headers[c] = len(headers)
				}
				headerSeen = true
			case "tr":
				if !hasDescendant(n, "th") {
					rows = append(rows, n)
				}
			}
		})
		if !headerSeen {
			continue
		}
		for _, row := range rows {
			cells := childrenByTag(row, "td")
			if len(cells) == 0 {
				continue
			}
			if len(headers) > len(cells) {
				continue
			}
			// Header order follows document order, not map insertion order; rebuild
			// positions from the thead and verify the target-specific identity field.
			ordered := tableHeaders(table)
			positioned := map[column]int{}
			for i, h := range ordered {
				if c := labelColumn(nodeText(h)); c != colUnknown {
					positioned[c] = i
				}
			}
			if _, ok := positioned[colID]; !ok && !hasAttr(row, "data-message-id") {
				continue
			}
			if _, ok := positioned[colTimestamp]; !ok {
				continue
			}
			if _, ok := positioned[colText]; !ok {
				continue
			}
			if _, ok := positioned[colProtocol]; !ok {
				if _, sourceOK := positioned[colSource]; !sourceOK {
					continue
				}
			}
			if kind == targetICAO {
				if _, a := positioned[colFromICAO]; !a {
					if _, b := positioned[colToICAO]; !b {
						continue
					}
				}
			}
			if kind == targetTail {
				if _, ok := positioned[colTail]; !ok {
					continue
				}
			}
			if kind == targetFlight {
				if _, ok := positioned[colFlight]; !ok {
					continue
				}
			}
			return parsedTable{headers: positioned, rows: rows}, nil
		}
	}
	return parsedTable{}, ErrSchemaDrift
}

func tableHeaders(table *html.Node) []*html.Node {
	var heads []*html.Node
	walk(table, func(n *html.Node) {
		if n.Type == html.ElementNode && strings.EqualFold(n.Data, "th") {
			heads = append(heads, n)
		}
	})
	return heads
}
func parseRow(row *html.Node, headers map[column]int) (Message, error) {
	cells := childrenByTag(row, "td")
	value := func(c column) string {
		idx, ok := headers[c]
		if !ok || idx >= len(cells) {
			return ""
		}
		cell := cells[idx]
		if c == colTimestamp {
			var stamp string
			walk(cell, func(n *html.Node) {
				if n.Type == html.ElementNode && strings.EqualFold(n.Data, "time") {
					if attr, ok := attribute(n, "datetime"); ok && stamp == "" {
						stamp = attr
					}
				}
			})
			if stamp != "" {
				return stamp
			}
		}
		if c == colID {
			if id, ok := attribute(row, "data-message-id"); ok && id != "" {
				return id
			}
		}
		return strings.TrimSpace(nodeText(cell))
	}
	id := value(colID)
	if id == "" {
		if rowID, ok := attribute(row, "data-message-id"); ok {
			id = rowID
		} else {
			return Message{}, fmt.Errorf("message ID is missing")
		}
	}
	timestamp, err := parseTimestamp(value(colTimestamp))
	if err != nil {
		return Message{}, fmt.Errorf("timestamp: %w", err)
	}
	text := value(colText)
	if text == "" {
		return Message{}, fmt.Errorf("message text is missing")
	}
	protocol := value(colProtocol)
	source := value(colSource)
	if protocol == "" {
		protocol = protocolFromSource(source)
	}
	if protocol == "" {
		return Message{}, fmt.Errorf("protocol/medium is missing")
	}
	return Message{ID: id, ObservedAt: timestamp, Flight: value(colFlight), Tail: strings.ToUpper(value(colTail)), Label: value(colLabel), Text: text, Source: source, Protocol: protocol, FromICAO24: normalizeHex(value(colFromICAO)), ToICAO24: normalizeHex(value(colToICAO)), Mode: value(colMode), DecodeErrors: value(colErrors), Frequency: value(colFrequency), Channel: value(colChannel), Decoder: value(colDecoder)}, nil
}

func matches(m Message, target Target, kind targetKind) bool {
	switch kind {
	case targetICAO:
		return strings.EqualFold(m.FromICAO24, target.ICAO24) || strings.EqualFold(m.ToICAO24, target.ICAO24)
	case targetTail:
		return strings.EqualFold(m.Tail, target.Tail)
	case targetFlight:
		return strings.EqualFold(strings.TrimSpace(m.Flight), target.Flight)
	}
	return false
}
func labelColumn(text string) column {
	normalized := normalizeLabel(text)
	switch normalized {
	case "id", "messageid", "msgid":
		return colID
	case "timestamp", "time", "received", "receivedat":
		return colTimestamp
	case "flight", "flightnumber", "callsign":
		return colFlight
	case "tail", "registration", "aircrafttail":
		return colTail
	case "label", "messagelabel":
		return colLabel
	case "text", "message", "messagetext", "content":
		return colText
	case "source", "station", "feeder":
		return colSource
	case "protocol", "medium", "sourcetype", "linktype":
		return colProtocol
	case "fromhex", "fromicao", "originhex":
		return colFromICAO
	case "tohex", "toicao", "destinationhex":
		return colToICAO
	case "mode", "acarsmode":
		return colMode
	case "error", "errors", "decodeerrors":
		return colErrors
	case "frequency", "freq":
		return colFrequency
	case "channel":
		return colChannel
	case "decoder", "decodername":
		return colDecoder
	}
	return colUnknown
}
func parseTimestamp(v string) (time.Time, error) {
	v = strings.TrimSpace(v)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05Z07:00", "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, v); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported or missing timestamp %q", v)
}
func protocolFromSource(s string) string {
	upper := strings.ToUpper(s)
	for _, protocol := range []string{"ACARS", "VDL2", "HFDL", "SATCOM", "IRIDIUM"} {
		if strings.Contains(upper, protocol) {
			return protocol
		}
	}
	return ""
}
func normalizeHex(v string) string {
	v = strings.ToUpper(strings.TrimSpace(v))
	v = strings.TrimPrefix(v, "0X")
	return v
}
func normalizeLabel(v string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(v) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
func nodeText(n *html.Node) string {
	var b strings.Builder
	var collect func(*html.Node)
	collect = func(current *html.Node) {
		if current.Type == html.TextNode {
			b.WriteString(current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			collect(child)
		}
	}
	collect(n)
	return b.String()
}
func walk(n *html.Node, fn func(*html.Node)) {
	fn(n)
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		walk(child, fn)
	}
}
func hasDescendant(n *html.Node, tag string) bool {
	found := false
	walk(n, func(x *html.Node) {
		if x.Type == html.ElementNode && strings.EqualFold(x.Data, tag) {
			found = true
		}
	})
	return found
}
func childrenByTag(n *html.Node, tag string) []*html.Node {
	var out []*html.Node
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.ElementNode && strings.EqualFold(child.Data, tag) {
			out = append(out, child)
		}
	}
	return out
}
func attribute(n *html.Node, key string) (string, bool) {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return a.Val, true
		}
	}
	return "", false
}
func hasAttr(n *html.Node, key string) bool { _, ok := attribute(n, key); return ok }
