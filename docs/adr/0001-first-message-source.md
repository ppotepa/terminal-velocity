# ADR 0001: First real message source

- **Status:** BLOCKED_PENDING_RIGHTS
- **Decision date:** 2026-11-19
- **Review date:** 2026-11-19
- **Decision owner:** Repository owner (`ppotepa`)
- **Implementation branch:** `feature/s3-02-source-selection`
- **Approved use:** denied until a specific source, account, and permitted use are verified

## Current decision

The owner selected the rendered [Airframes Live Messages page](https://app.airframes.io/messages/live) for the first website adapter. The provider API is a deferred, disabled adapter. The page serves a JavaScript application shell. The [usage guide](https://docs.airframes.io/docs/using-airframes/) documents filters for registration, flight, label and text. A bounded anonymous browser check confirmed the ICAO filter, rendered message cards, aircraft links and a station link. A second check found one matching card among seven and extracted its displayed message. Only diagnostic counts were retained. The source probe exposes a single selected-aircraft lookup. Recurring collection, persistence and publication remain gated. Match a selected aircraft using corroborated identity evidence. Display reception time, station and direction only where the source provides them.

The [application FAQ](https://app.airframes.io/faq) generally permits hobby use and requires an agreement for commercial use, competing products or bulk redistribution. It directs research and bulk data inquiries to Airframes. The [crawler directives](https://app.airframes.io/robots.txt) allow the live path for the generic agent. These sources leave the scope of recurring collection, retention and reuse of a captured row as a fixture unresolved for this project.

**Decision: BLOCKED_PENDING_RIGHTS.** Target and transport are selected. Before live acquisition, record applicable terms or an Airframes response covering the intended cadence, fields, private display, retention and a redacted fixture; verify access and obtain a permitted sample. Public display requires its own later decision. The owner can ask hello@airframes.io about website use. Keep #7 queued until #6 is verified and merged.

## Earlier API and receiver investigation

The following record predates the owner's website selection. Its account and receiver options are historical.

### Original context

Stage 3 needs an authorized source of actual aviation messages. The Stage 3
observation contract distinguishes provider-decoded messages, receiver
receptions, and frames. A service that exposes aircraft positions, or a sample
that merely resembles a provider response, does not satisfy this requirement.
Access to an API is also separate from permission to retain or publish its data.

This review used the providers' first-party documentation available on
2026-11-19. It did not use an account, API key, receiver hardware, private
payload, or provider contact. No source payload or fixture was downloaded or
committed.

## Options reviewed

| Option | Access and data level | Quota and time/provenance evidence | Retention and use rights | Result |
|---|---|---|---|---|
| Airframes provider API | The documented messages endpoint is `GET https://api.airframes.io/v1/messages`. The API overview lists ACARS messages and other protocol data, but does not establish the response fields, stable delivery IDs, sampling, or observation-time evidence needed by this application. Authentication docs say API keys are required and describe early access; another part of the API overview says authentication is optional on public endpoints. These statements conflict. | A feeder key is described as 60 requests/minute for personal, non-commercial use after the station has contributed for at least seven days. Paid limits are not specified. Provider timestamp guarantees and backfill/replay behavior are not documented by the pages reviewed. | The API and licensing terms are explicitly under development. Bulk redistribution, resale, and commercial use beyond the access tier require prior arrangement. Retention limits and permission for this application's exact private storage or any later public display are not established. | **Not selected.** No Airframes feeder account, key, approved early access, source schema, or account-specific authorization is available. |
| Contributor-owned SDR / decoder | A locally owned receiver can produce locally decoded observations, but no receiver is attached to or owned for this project. No station, decoder configuration, or actual feed exists. Fields, observation timestamps, frame access, coverage, and completeness depend on the specific receiver and decoder configuration and have not been measured. | No provider API quota applies to local capture. Hardware coverage, sampling, decoder timestamp semantics, and recovery behavior are unknown until a real station is identified and characterized. | No receiver owner, account, consent, retention policy, or redistribution permission has been documented. A license for contributing data to a third-party network would not by itself establish rights for this application's independent ingestion and publication. | **Not selected.** There is no project-controlled receiver or verified feed to acquire. |
| adsb.lol open-data API | The public API provides ADS-B/MLAT aircraft positions, not an inbound provider-message or receiver-reception feed. Its separate ACARS/VDL2/HFDL instructions describe sending contributor data to the network, not querying those messages back. | The open API documents 500 requests/day per IP without a key; higher tiers have separate limits. It returns HTTP 429 with `Retry-After`. Position records and historical point fields are described, but they do not satisfy the S3-02 message-source need. | The API database is published under ODbL 1.0. The contributor-ingest page says data contributed to its feed is published under CC0. Neither fact grants this application an inbound message API or substitutes for rights to a locally owned RF feed. | **Not a Stage 3 message source.** Reconsider only for Stage 4 positions under a separate source ADR and ODbL compliance review. |

## Decision

Do not select or connect a real message source yet. The machine has no owned
receiver, and Airframes access, response shape, and use rights for this
application are not verified. Mark Stage 3 source selection
`BLOCKED_PENDING_RIGHTS`; `approvedUse` is `denied` for acquisition, storage,
derived indicators, and publication until this decision is amended with
account-specific evidence. Do not treat the Stage 3 contract's synthetic
examples as provider fixtures.

| Required decision field | Recorded value |
|---|---|
| `provider` | None selected |
| `transport` | None authorized; Airframes HTTPS API is a candidate only |
| `dataLevel` | Not verified for an acquired source |
| `approvedUse` | `denied` pending authorization |
| `contract/terms URL` | Links in the evidence section below |
| `verifiedOn` | 2026-11-19 |
| `quota` | Candidate limits are documented per option above; no quota is approved for this project |
| `fieldRights` | Unknown for Airframes account use; unknown for any future locally received payload; no redistribution/publication approval |
| `retention` | Not specified by the reviewed Airframes pages; no retention is approved |
| `credentialOwner` | None; repository owner must obtain and control any future credential |
| `redactedFixtureSource` | None. Use synthetic contract fixtures only until a source permits a sanitized sample |
| `goNoGo` | **NO-GO** for Stage 3 integration |

## Evidence reviewed

- [Airframes API overview](https://docs.airframes.io/api/) — endpoint families, access descriptions, and API conventions.
- [Airframes authentication](https://docs.airframes.io/api/authentication/) — under-development status, feeder eligibility, planned key and rate-limit details.
- [Airframes pricing](https://docs.airframes.io/api/pricing/) — under-development status and feeder tier summary.
- [Airframes data licensing](https://docs.airframes.io/api/licensing/) — under-development terms and prior-arrangement requirement for specified uses.
- [Airframes API contact](https://docs.airframes.io/api/contact/) — early-access request information. No contact was made.
- [adsb.lol open-data API](https://www.adsb.lol/docs/open-data/api) — position API description, ODbL 1.0, quotas, and 429 behavior.
- [adsb.lol contributor aircraft-data links](https://www.adsb.lol/docs/open-data/aircraft-data-links) — inbound TCP contribution instructions and stated CC0 terms for data submitted to that network.
- [adsb.lol privacy and license](https://www.adsb.lol/docs/privacy-license) — service disclaimer and contributor-data terms.

### Earlier unblock conditions

The repository owner must choose one of these paths and record evidence before
S3-03 starts:

1. Obtain Airframes account access and written/documented permission covering
   this application's precise private ingestion, storage, fields, quota,
   retention, fixture use, and any intended derived outputs; or
2. Provide a project-controlled receiver/feed and document the receiver owner,
   decoder output/schema, timestamp evidence, coverage, lawful retention, and
   permitted use of captured observations.

For either path, provide an authorized sanitized fixture or written confirmation
that only synthetic fixtures may be used. Re-review the current terms before
implementation. Public display remains prohibited until its separate rights
and Stage 5 publication controls are satisfied.

### Earlier consequences and limits

- S3-03 through S3-13 cannot claim or implement a live message acquisition path
  from this decision alone.
- Stage 4 position work can be considered independently; the adsb.lol API is a
  candidate position source, but it needs its own ADR, ODbL compliance decision,
  bounded transport, and offline fixtures.
- No production messages, keys, or provider credentials are in the repository.
- This is an engineering go/no-go record based on public documentation, not
  account-specific legal advice or provider approval.
