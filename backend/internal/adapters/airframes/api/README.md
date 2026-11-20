# Inactive Airframes API adapter

This package implements the provider-neutral `sources.Source` contract and is
safe to register locally. It does not create an HTTP client, read a credential,
or make outbound requests. `Fetch` returns an empty result and a typed
`disabled` or `not_configured` error; it never returns placeholder rows.

## Configuration boundary

- `TV_AIRFRAMES_API_ENABLED` defaults to `false` and selects the inactive source.
- `TV_AIRFRAMES_API_KEY` is the reserved future credential name. This package
  does not read it; a future secret-backed `CredentialProvider` will supply a
  token to the transport without putting it in source logs or query records.

The current capability declaration is an inactive planner contract only. The
request budget is deliberately conservative and is not a provider quota or an
authorization claim. Current Airframes API authentication/licensing terms are
still being finalized, so enabling this stub never enables a network call.

## Future authorized implementation point

After provider authorization, retention terms and access credentials are
confirmed, add the HTTPS client in `Fetch`: build an exact-target `/v1/messages`
query from `sources.Query`, enforce the provider's current rate and result
bounds, pass the API key from `CredentialProvider`, and map the documented
response into `sources.Record`. Decode the provider response there only to the
extent permitted by the applicable terms. Never collect an unbounded global
feed or fabricate RF reception data. The API spec/auth/licensing pages are
version-sensitive; re-verify them before enabling transport.

Selecting this disabled/not-configured source does not modify or replace the
separate crawler adapter. The scheduler reports the failed API source outcome
and continues other source queries.
