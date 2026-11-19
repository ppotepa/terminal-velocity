# Synthetic extracted-record v1 fixtures

All content, identifiers, times and station labels here were authored for this
repository. No provider row, RF capture, private data or third-party sample was
used. These fixtures may be used under the repository's terms. They are NOT
redacted real records and do not prove an Airframes wire contract or rights.

`synthetic-rendered-record-v1` is our extracted-record contract, not a provider API
version. The browser fixtures use the existing card/link shape plus fabricated
semantic `dt`/`dd` labels and `time[datetime]` elements. New labels must be checked
against a permitted source sample before live deployment. Missing optional labels
are omitted; missing receipt/publication time or explicit uncertainty rejects
canonical normalization, without inventing a source clock.

Reception/frame fixtures exercise provider-neutral level selection with synthetic
measurements/bytes only. The rendered adapter always emits PROVIDER_MESSAGE,
including when a displayed feeder is present. No reception or station row is
created from that label. The API adapter remains inactive.
