# Target architecture v2 documentation

The documents in this directory preserve decisions from the design stage. References to `reference/` refer to the previous package; its working core has been moved to `packages/backend`. Test counts and tooling limitations described in the historical v2 documents reflect the state of that iteration.

**Current implementation scope:** [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md). **Working API:** [API.md](../API.md).

Stage 2 implements a durable synthetic flow. Its operational contract is in [POSTGRES.md](../POSTGRES.md), and its executable SQL is under [db/migrations](../../db/migrations). These current artifacts take precedence over historical DDL and proposed event-envelope names for the implemented slice.

- [Architecture and rationale](ARCHITECTURE_V2.md)
- [Responsibility catalog](docs/MODULE_CATALOG.md)
- [Architectural decisions](docs/DECISIONS.md)
- [Target events and API](docs/EVENTS_AND_API.md)
- [Failure scenarios](docs/FAILURE_MODES.md)
- [DDL design](persistence/REFERENCE_DDL.sql)
- [Transaction recipes](persistence/TRANSACTION_RECIPES.md)

The DDL design is not a migration run by the application. The event schema in `contracts/` describes planned contracts, rather than the demonstrator's current REST DTOs.
