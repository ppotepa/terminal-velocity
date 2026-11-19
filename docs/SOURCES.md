# Source observation contracts

Stage 3 starts with provider-neutral contracts. These types do not connect to a provider, establish data rights, or authorize publication. Provider transport and normalization belong in later issues after a source and its permitted uses have been verified.

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
