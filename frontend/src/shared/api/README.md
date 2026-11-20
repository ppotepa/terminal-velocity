# Typed API client

`generated.ts` is generated from the backend-owned `../contracts/openapi.yaml`; edit the contract only through BE-09. Regenerate from `frontend/` with:

```sh
npm run generate:api
```

Feature modules should use `createApiClient()` and generated OpenAPI path/component types. Pass an `AbortSignal` in `openapi-fetch` request options to cancel in-flight reads. The client does not retry. `normalizeApiFailure` handles offline, contract-shaped HTTP, and unknown failures; source `not_configured` and `blocked` states come from `/sources` and are mapped with `sourceAvailability`.

For deterministic UI work, pass `createFixtureFetch(fixtures)` to `createApiClient({ fetch })`. Fixture response types come directly from generated schemas, and every fixture response is labeled `x-data-mode: synthetic-fixture`.
