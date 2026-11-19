# Source observation contracts

## Source authorization status

The selected source is the rendered Airframes Live Messages website. The provider API strategy returns API_UNAVAILABLE without network access. Issue #6 remains blocked pending evidence for the intended website collection, retention and use of a redacted sample. The application FAQ covers general hobby use. See the [source decision](adr/0001-first-message-source.md) for the website evidence and exact outstanding questions.

### Private on-demand page transport

Run `npm run messages -- dry-run ABC123` for one synthetic ICAO24 lookup. Use an unprivileged account with a sandbox-capable Chromium executable (`CHROMIUM_PATH`, default `/usr/bin/chromium-headless-shell`). Chromium renders a fabricated JavaScript shell at the selected page URL via an offline intercepted navigation. The fixture also contains an unrelated aircraft. The CLI prints status, counters and transport health. A preview counts as inspected and has zero durable acknowledgments.

The existing `crawl ABC123` strategy is a private, one-shot preview. Its programmatic result holds matching cards in memory for the caller. The CLI prints the selected messages to standard output. Both preview commands use an inspector and expose only `start(signal?)`. Durable transport uses `start(onDelivery, signal?)` and requires a committed acceptance result for every delivery. A preview marker returned by a durable callback ends the batch with `ACCEPTANCE_FAILED`. The API runtime never starts a crawler. Selecting `api` reports `API_UNAVAILABLE` (exit 2) before opening a browser or requesting credentials. Unconfigured durable acquisition reports `RIGHTS_BLOCKED`. Owner verification under ADR 0001 is required for recurring collection, retention, a provider fixture and the live acceptance check.

| Per-connector policy | Behavior |
|---|---|
| Page and scope | One anonymous rendered live list, one explicit ICAO24, same-origin aircraft and message links. Each DOM sample checks its origin and pathname before reading cards. A main-frame route change outside the live path discards the entire window, including earlier matches. Query-only filter changes stay in scope. No archive submission, numbered pages or automatic recurring polls. |
| Observation | Up to 10 seconds from navigation, sampling the DOM at 500 ms intervals (500 ms window for the private fixture). Paths deduplicate cards within the window. |
| Browser request | One in-flight page read. Chromium checks the destination before each HTTP hop, including redirects. Only the selected document can navigate. Its anonymous HTTPS GET resources and browser-generated CORS preflights may use Airframes hosts, excluding analytics. The page may POST to `https://api.airframes.io/stream/visitor-token` by Fetch or XHR for anonymous stream bootstrap. This request shares the HTTP budget. The page may open one first-party secure WebSocket with up to 256 messages across both directions. Each HTTP hop and socket opening spends one of 96 requests per attempt, with at most 16 in flight. Declared or observed responses and individual socket messages are limited to 8 MiB. HTTP chunks and both directions of socket traffic share a 24 MiB budget. The document policy excludes worker, frame and popup targets. The page renders the stream. The connector reads only its DOM. Stop, failure and window completion close the socket and browser. |
| Pagination and queue | One page per attempt. At most 25 cards, 32 KiB serialized UTF-8 per delivery and 128 KiB per batch. A truncated window or mixed layout rejects the whole batch for durable delivery. The private CLI prints the validated subset with `TRUNCATED` for overflow or `PARTIAL_LAYOUT` for a mixed layout. Both exit with code 2 and zero durable acknowledgments. A retained batch that fails validation produces zero callbacks. |
| Retry budget | At most three page attempts per start. Starts on one connector are coalesced. Requests are spaced at least 1 second apart. After a successful socket upgrade, a disconnect uses full jitter in a 2/4/8 second exponential window. HTTP 5xx responses and ordinary HTTP 429 responses with a usable cooldown use the same backoff. A 429 without a usable cooldown ends the lookup. A later Retry-After (seconds or HTTP date) takes precedence. A wait over 10 seconds returns RATE_LIMITED and the same connector retains the cooldown. Other HTTP errors on the document, bootstrap fetch, XHR or script end the run. Chromium exposes a rejected upgrade status but can withhold its headers. An upgrade 429 ends the lookup as RATE_LIMITED and the connector retains any visible Retry-After. An unclassified refusal ends the lookup as TEMPORARY_FAILURE without reconnecting. A bootstrap or upgrade denial (401/403) ends the first attempt even if the live list is empty. These are local limits, not a provider quota. |
| Delivery and stop | One callback at a time. The handler can bind a source parser, verified scope and #8 transaction. Only its committed CREATED or DUPLICATE receipt increments accepted. An unavailable result or interrupted callback retries the identical envelope up to twice after 1 and 2 seconds. A conflict or invalid result ends the run. Stop cancels browser work and waits for an outstanding acceptance call. Unaccepted rows have no durable checkpoint. A subsequent start opens a fresh selected-aircraft window. |
| Health | DISCONNECTED between windows, DEGRADED during retry, HEALTHY while delivering a validated window. Last receipt time is the local retrieval clock. Coverage stays UNKNOWN. No timestamps are inferred for the aircraft message. |

Chromium owns the upstream socket and its TLS connection. The connector monitors the browser’s handshake failure event and reads matching messages from the rendered page.

The browser adapter reads the decoded document in bounded chunks before handing it to the renderer with the additional content security policy. The document spends its decoded size once against both the 8 MiB response limit and the 24 MiB window limit, including when HTTP/2 omits a reason phrase.

Run `npm run test:messages` for transport policy and budget checks. Run `npm run test:browser` for the offline rendered-browser suite. Its CLI fixture renders cards only after a first-party bootstrap response and a socket update. The loopback TLS suite exercises native 429, 401 and 403 upgrade refusals without Retry-After, plus a peer that drops the handshake. Each case requires exactly one bootstrap POST and one upgrade. The same fixture exercises selected-card rendering, reconnect after an accepted upgrade and SIGINT cancellation in the embedding process. The HTTP/2 regression uses OpenSSL to generate an ephemeral certificate and serves the synthetic document on loopback so Chromium processes its response headers. `npm run test:postgres:local` includes a synthetic delivery replay through the connector and #8 transaction.

The adsb.lol public API is a separate candidate for **positions**, not messages.
Its position source selection, ODbL obligations, quotas, and endpoint contract
must be recorded in a separate Stage 4 decision before implementation. Sending
contributor data to its ACARS/VDL2/HFDL endpoints is not an API for reading
messages back.

Synthetic fixtures exercise the transport and provider-neutral contract. They contain fabricated data and provide no evidence of live ingestion.

Stage 3 starts with provider-neutral contracts. These types do not connect to a provider, establish data rights, or authorize publication. Provider normalization and live operation require further source evidence.

## Schema v1

`@airframes/backend/source-connectors` exports a runtime parser for the canonical v1 envelope and the types and factories used by adapters. The parser accepts `unknown`, copies own data properties, rejects accessors and unknown fields, and returns `Result<SourceObservation, SourceParseError>`. `SourceTransport<Raw>` fetches raw deliveries; `SourceParser<Raw, Canonical, Failure>` validates and normalizes them as a separate boundary. A provider parser must identify its own input schema version; the exported contract parser does not claim to recognize any provider's wire format.

All observation variants share these fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Canonical observation schema version, currently `1`. |
| `sourceId` | Stable application-assigned source configuration ID (`src_…`). |
| `sourceDeliveryId` | Stable tuple of `provider`, `accountScope`, `sourceEpoch`, and `externalId`. It scopes external IDs so provider resets and separate accounts do not collide. Never put credentials in the tuple. |
| `receivedAt` | Required time evidence for when the source/provider received or emitted this delivery. |
| `observedAt` | Optional evidence for when the underlying message, frame, or reception was observed. It is never inferred from ingestion time. |
| `decoderVersion` | Optional version of the source's decoder, if known. |
| `payloadDigest` | Lowercase SHA-256 hex digest of the source delivery payload. |
| `capabilitiesRevision` | Positive revision of the source capability declaration used for this observation. |

The `dataLevel` union separates the content the provider actually supplied:

```ts
type SourceObservation =
  | ProviderMessageObservation // dataLevel: 'PROVIDER_MESSAGE'
  | ReceiverReceptionObservation // dataLevel: 'RECEPTION'
  | FrameObservation; // dataLevel: 'FRAME'
```

A provider-message example has decoded content and may include address hints, bearer, protocol stack, or direction. It does not have receiver, frequency, or frame fields, and a parser rejects attempts to add them:

```ts
{
  schemaVersion: 1,
  dataLevel: 'PROVIDER_MESSAGE',
  sourceId: 'src_example',
  sourceDeliveryId: {
    provider: 'example-provider', accountScope: 'account-1',
    sourceEpoch: 'epoch-1', externalId: 'delivery-42'
  },
  receivedAt: {
    at: '2026-11-19T11:00:00.000Z', basis: 'RECEIVED',
    precision: 'MILLISECOND', uncertaintyMs: 0
  },
  observedAt: {
    at: '2026-11-19T10:59:59.000Z', basis: 'PROVIDER',
    precision: 'SECOND', uncertaintyMs: 500
  },
  payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  capabilitiesRevision: 1,
  decodedText: 'Illustrative synthetic content',
  addressHints: { icao24: 'A0B1C2' },
  bearer: 'VDL2',
  protocolStack: ['ACARS'],
  direction: 'UPLINK'
}
```

A reception requires an actual `receiverId`; frequency and signal strength are optional measurements. A frame requires actual frame bytes, represented as standard Base64. Neither level is synthesized from decoded message text. The short frame value used in tests (`AQID`) is arbitrary synthetic test data, not a captured RF payload.

## Time evidence

Time evidence uses a strict UTC timestamp ending in `Z`, a basis (`OBSERVED`, `RECEIVED`, `PROVIDER`, or `INGESTED`), a stated precision, and a non-negative uncertainty in milliseconds. Zero uncertainty is explicit; an omitted uncertainty is invalid. Source observations require received evidence with `RECEIVED` or `PROVIDER` basis. Optional observed evidence must use `OBSERVED` or `PROVIDER` basis. An observation whose earliest possible time is later than the latest possible receipt time is rejected as `FUTURE_OBSERVATION`; overlapping uncertainty intervals are retained.

Ingestion time is assigned by the ingestion layer and must remain separate from observation and receipt time. The canonical source parser does not accept an untrusted `ingestedAt` field.

## Identity, direction, bearer, and coverage

The delivery identity tuple is an idempotency scope, not a flight or aircraft identity. `provider` is a normalized provider namespace; `accountScope` distinguishes accounts or feed scopes without carrying secrets; `sourceEpoch` changes when a provider can reuse external IDs; `externalId` preserves the provider's opaque ID. Different delivery IDs remain distinct even when their associated decoded text is identical.

Direction (`UPLINK`, `DOWNLINK`, `BIDIRECTIONAL`, `UNKNOWN`) describes message direction. `bearer` describes the access medium or link (for example `VDL2`); `protocolStack` lists decoded protocol layers (for example `ACARS`). A bearer value does not prove that an application protocol was decoded. The model does not infer ACARS decoding from `VDL2`.

`SourceCapabilities` declares supported observation levels, message direction, bearer, protocol stack, sampling, and receiver-set completeness. Its coverage descriptor is one of `UNKNOWN`, `SAMPLED`, or `STATION_SCOPED`; station-scoped coverage requires real receiver IDs. `receiverCoverageCompleteness` states whether the receiver set is complete within that declared source scope (`COMPLETE`, `INCOMPLETE`, or `UNKNOWN`). Unknown coverage must have unknown completeness. Coverage is independent from source health. A sampling declaration (`NOT_DECLARED`, `COMPLETE`, or `SAMPLED`) describes whether deliveries are sampled; it is separate from receiver coverage. These fields are declarations, not verified service guarantees.

Examples below use `common` to mean the shared v1 fields shown above:

```ts
const reception = {
  ...common,
  dataLevel: 'RECEPTION',
  receiverId: 'receiver-17',
  frequencyHz: 131_550_000
};

const frame = {
  ...common,
  dataLevel: 'FRAME',
  frameBytesBase64: 'AQID',
  bearer: 'VDL2'
};
```

The parser error types are deterministic for the same input: malformed input, missing evidence, unsupported versions/levels, invalid time, and impossible future observations are non-retryable parser failures. Transport timeouts and connection failures are outside this port and may be retried under the provider adapter's bounded policy. S3-02 selects a provider only after recording verified access and permitted use; S3-01 does not select or contact a source.

## Parser errors and limits

The canonical parser distinguishes invalid input, unsupported schema versions, missing time or other required evidence, unsupported observation levels, conflicting time bases, and impossible future observations. It validates timestamp syntax and shape; it cannot independently prove that a provider's clock, receiver identity, digest, decoder label, or source rights are truthful. Provider contract fixtures must be anonymized and licensed before they are added in later issues.

No network connection, database schema, real provider fixture, publication decision, or live-data claim is part of S3-01.
