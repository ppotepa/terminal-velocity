# Airframes crawler fixtures

`messages.html` is a synthetic rendered table using the visible fields
documented by Airframes (timestamp, flight, tail, label, text and source), plus
synthetic identifiers and decoder/protocol metadata for parser coverage. It is
not a captured Airframes page and contains no provider data.

Airframes' [web application guide](https://docs.airframes.io/docs/using-airframes/)
describes message filters by text, flight and tail, and aircraft lookup by tail
or ICAO hex. The [API overview](https://docs.airframes.io/api/) and its
[authentication page](https://docs.airframes.io/api/authentication/) describe
API access; authentication details are under development and early access
requires contacting the provider. Its [data licensing page](https://docs.airframes.io/api/licensing/)
also says terms are still being finalized and bulk redistribution or commercial
use requires prior arrangement. These pages do not authorize a browser crawler.

The documentation does not specify a stable rendered-page DOM or canonical message-page filter URL. The
crawler therefore requires an operator-supplied per-target URL template and
ready selector; it rejects URLs without a recognized exact-target path or
query filter.

Live acquisition defaults off. The API's authentication and data licensing are
still described as under development by Airframes, and early access requires
contact with the provider. A live crawl requires both `PermissionConfirmed` and
`PageSchemaConfirmed`; the latter covers current selectors and verified
per-target filtering. Until permission, data-retention terms and page behavior
are confirmed for this use, do not enable it. Tests use synthetic fixtures and
a fake renderer.
