# OpenSky positions adapter

This adapter targets OpenSky's REST `GET /states/all` endpoint. It can issue a
single ICAO24 lookup, or a WGS84 bounding-box lookup when a caller supplies a
small `AreaResolver`. It never sends an empty/global query, and the bounding
box must cover at most 25 square degrees. Callsign and registration lookups
are not advertised because this endpoint does not provide those request
filters. Registration is not present in the state-vector response.

OpenSky's current REST documentation says its REST API does not provide MLAT
state vectors. This implementation maps the documented `position_source`
field when present, but an `mlat` value is not expected from this endpoint.
Use of REST in an operational automated system requires a written OpenSky
license. The adapter therefore refuses all provider calls unless
`LicenseConfirmed` is explicitly true and an OAuth token provider is
configured. That flag is an operator assertion; it is not evidence that a
license exists. Live use remains disabled until that external permission is
verified. No live API request was used to build or test this adapter.

The latest-state endpoint is a snapshot, not an incremental history feed. The
adapter therefore does not return a checkpoint token, and it uses
`time_position` only as the source observation timestamp. It never substitutes
`last_contact` or the response timestamp when a position timestamp is absent.

The default local budget is 100 requests per 24 hours, at least 10 seconds
apart, with a 500-result response cap. Area queries are bounded to 25 square
degrees and 100 observations. These are conservative adapter defaults, not a
provider guarantee. Provider quotas and credit costs can change; verify the
current API docs and configure source capabilities only after permission is
established. A 429 response honors one valid `Retry-After` delay of at most
five seconds, then returns a typed rate-limit error if still limited.

Credentials are supplied through the OAuth client-credentials provider or an
injected token provider. They and access tokens stay in memory, and are never
included in adapter errors. The HTTP client uses a timeout, refuses redirects,
and limits response bodies to 4 MiB by default.

## Official provider references

- [REST API request and state-vector fields](https://openskynetwork.github.io/opensky-api/rest.html)
- [Current API credit quotas and bounding-box costs](https://openskynetwork.github.io/opensky-api/rest.html#api-credits)
- [Terms of Use and Data License Agreement](https://opensky-network.org/about/terms-of-use)

Fixture data is synthetic and exists only to exercise wire parsing.
