# Architectural decisions v2

All decisions below are **proposed for implementation**. The reference implementation demonstrates selected rules; it is not a completed application monorepo.

## ADR-201 — Granularity within a context

**Context:** v1 used the same micro-domain concept for business rules, projections and transport mechanisms.

**Decision:** eight owners of business models; integrations, reads, delivery and the platform remain separate. Small SRP modules sit within these boundaries. The responsibility catalog is a design map, not a list of separate deployments.

**Consequences:** substantial code decomposition while retaining local transactions and reducing hidden dependencies. Extracting a service follows data ownership, not an individual function.

## ADR-202 — Communication facts are separate from interpretation

**Decision:** SourceDelivery, Reception, FrameOccurrence, AssemblySession and MessageRevision are distinct concepts. Importing a complete message does not create an artificial frame or station.

**Consequences:** more precise models, with the ability to reprocess or decode again without changing the facts. Deduplication does not remove provenance.

## ADR-203 — Two correlation stages

**Decision:** Message→Aircraft and Message→FlightSession have separate models, ports and policies. Aircraft identity can be confirmed without a session.

**Consequences:** the panel distinguishes aircraft messages from messages assigned to a specific flight segment. An absent session is not an aircraft identification error. A callsign alone does not confirm the physical aircraft.

## ADR-204 — Versioned, reversible decisions

**Decision:** links and published contributions retain history and revisions. A higher full-state revision replaces the locally retained state; a retraction leaves a tombstone.

**Consequences:** an A→B correction updates both ends, and `max(lastSeen)` is no longer the only retained information. Storing contributions deliberately costs more than storing a single timestamp.

## ADR-205 — Four availability dimensions

**Decision:** freshness, match outcome, coverage and feed health are independent. Public status is calculated only from permitted contributions. Position data has its own freshness.

**Consequences:** no single “partial” label with multiple meanings. The UI can explain missing frames without asserting that the aircraft is not transmitting.

## ADR-206 — Commit port with atomicity and concurrency guarantees

**Decision:** a use case receives a narrow capability set for writing the local decision and outbox entry. The adapter must guarantee serialization or CAS per key, including the first INSERT.

**Consequences:** the domain does not know SQL, but the port says more than “save.” The test double has a limited scope; the database implementation must pass separate concurrency and failure tests.

## ADR-207 — Durable delivery from the first deployment

**Decision:** start with an outbox plus durable deliveries/inbox in PostgreSQL, or use an outbox plus a durable broker immediately. A plain EventEmitter does not confirm that every consumer has completed its work.

**Consequences:** retry, leasing, quarantine and independent consumer IDs are part of the design, not accidental additions after the first incident. Full event sourcing is unnecessary; domain state and a history of significant decisions are sufficient.

## ADR-208 — Snapshot and deltas from the same projection

**Decision:** the read model has a generation and an ordered change stream; its snapshot carries a checkpoint in that order. The gateway establishes replay or buffering before returning the snapshot.

**Consequences:** REST and WS do not operate as two independent sources of truth. The contract handles removals, restarts, filter changes and expired cursors.

## ADR-209 — Abstractions through composition

**Decision:** use generics for stable technical mechanisms and concrete names for aviation rules. Use a manual composition root; no global dependency container in the domain.

**Consequences:** small functions are a natural SRP unit. Classes are introduced where state and lifecycle require them. Adding an adapter does not require inheritance from a universal BaseService.

## ADR-210 — Staged implementation and explicit readiness

**Decision:** implementation starts with one complete flow using two data sources. We do not generate dozens of empty services with TODO methods merely to make the directory tree appear complete.

**Consequences:** the target catalog can be extensive, but each delivered code slice has executable behavior and documented limitations. Production requires adapters, data usage rights, durability tests and measurements.
