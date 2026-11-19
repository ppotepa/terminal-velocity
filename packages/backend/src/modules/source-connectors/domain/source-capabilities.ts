import { revision, type Revision } from '../../../contracts/identity/index.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { hasOnlyKeys, hasOwn, isToken, plainRecord } from './input-validation.ts';
import { receiverId, type ReceiverId } from './receiver-id.ts';

export const OBSERVATION_DATA_LEVELS = ['PROVIDER_MESSAGE', 'RECEPTION', 'FRAME'] as const;
export type ObservationDataLevel = typeof OBSERVATION_DATA_LEVELS[number];

export const MESSAGE_DIRECTIONS = ['UPLINK', 'DOWNLINK', 'BIDIRECTIONAL', 'UNKNOWN'] as const;
export type MessageDirection = typeof MESSAGE_DIRECTIONS[number];
export const RECEIVER_COVERAGE_COMPLETENESS = ['COMPLETE', 'INCOMPLETE', 'UNKNOWN'] as const;
export type ReceiverCoverageCompleteness = typeof RECEIVER_COVERAGE_COMPLETENESS[number];

export type CoverageDescriptor =
  | { readonly kind: 'UNKNOWN' }
  | { readonly kind: 'SAMPLED'; readonly description: string }
  | { readonly kind: 'STATION_SCOPED'; readonly receiverIds: readonly ReceiverId[] };

export type SamplingDeclaration =
  | { readonly kind: 'NOT_DECLARED' }
  | { readonly kind: 'COMPLETE' }
  | { readonly kind: 'SAMPLED'; readonly method: string; readonly fraction?: number };

export interface SourceCapabilities {
  readonly revision: Revision;
  readonly supportedDataLevels: readonly ObservationDataLevel[];
  /** Scope/extent only; source health is a separate concern. */
  readonly coverage: CoverageDescriptor;
  /** Completeness of the receiver set within the declared source scope. */
  readonly receiverCoverageCompleteness: ReceiverCoverageCompleteness;
  readonly sampling: SamplingDeclaration;
  readonly messageDirection: MessageDirection;
  /** Bearer and decoded protocol stack are separate facts. */
  readonly bearer: string | null;
  readonly protocolStack: readonly string[];
}

export type InvalidSourceCapabilities = {
  readonly code: 'INVALID_SOURCE_CAPABILITIES';
  readonly field: string;
};

function uniqueTokens(input: unknown, field: string, maximum: number): Result<readonly string[], InvalidSourceCapabilities> {
  if (!Array.isArray(input) || input.length > maximum)
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field });
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (!isToken(value) || seen.has(value)) return err({ code: 'INVALID_SOURCE_CAPABILITIES', field });
    seen.add(value);
    values.push(value);
  }
  return ok(Object.freeze(values));
}

function parseCoverage(input: unknown): Result<CoverageDescriptor, InvalidSourceCapabilities> {
  const record = plainRecord(input);
  if (!record || typeof record['kind'] !== 'string')
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'coverage' });
  if (record['kind'] === 'UNKNOWN') {
    return hasOnlyKeys(record, ['kind'])
      ? ok(Object.freeze({ kind: 'UNKNOWN' }))
      : err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'coverage' });
  }
  if (record['kind'] === 'SAMPLED') {
    if (!hasOnlyKeys(record, ['kind', 'description']) || typeof record['description'] !== 'string'
      || record['description'].trim().length === 0 || record['description'].length > 512)
      return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'coverage.description' });
    return ok(Object.freeze({ kind: 'SAMPLED', description: record['description'] }));
  }
  if (record['kind'] === 'STATION_SCOPED') {
    if (!hasOnlyKeys(record, ['kind', 'receiverIds']) || !Array.isArray(record['receiverIds'])
      || record['receiverIds'].length === 0 || record['receiverIds'].length > 1024)
      return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'coverage.receiverIds' });
    const ids: ReceiverId[] = [];
    const seen = new Set<string>();
    for (const value of record['receiverIds']) {
      if (typeof value !== 'string') return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'coverage.receiverIds' });
      const parsed = receiverId(value);
      if (!parsed.ok || seen.has(parsed.value))
        return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'coverage.receiverIds' });
      seen.add(parsed.value);
      ids.push(parsed.value);
    }
    return ok(Object.freeze({ kind: 'STATION_SCOPED', receiverIds: Object.freeze(ids) }));
  }
  return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'coverage.kind' });
}

function parseSampling(input: unknown): Result<SamplingDeclaration, InvalidSourceCapabilities> {
  const record = plainRecord(input);
  if (!record || typeof record['kind'] !== 'string')
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'sampling' });
  if (record['kind'] === 'NOT_DECLARED') {
    return hasOnlyKeys(record, ['kind'])
      ? ok(Object.freeze({ kind: 'NOT_DECLARED' }))
      : err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'sampling' });
  }
  if (record['kind'] === 'COMPLETE') {
    return hasOnlyKeys(record, ['kind'])
      ? ok(Object.freeze({ kind: 'COMPLETE' }))
      : err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'sampling' });
  }
  if (record['kind'] === 'SAMPLED') {
    const allowed = hasOnlyKeys(record, ['kind', 'method', 'fraction']);
    const method = record['method'];
    const fraction = record['fraction'];
    if (!allowed || typeof method !== 'string' || method.trim().length === 0 || method.length > 256
      || (hasOwn(record, 'fraction')
        && (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1)))
      return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'sampling' });
    return ok(Object.freeze({
      kind: 'SAMPLED', method,
      ...(!hasOwn(record, 'fraction') ? {} : { fraction: fraction as number }),
    }));
  }
  return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'sampling.kind' });
}

export function sourceCapabilities(input: unknown): Result<SourceCapabilities, InvalidSourceCapabilities> {
  const record = plainRecord(input);
  const allowed = [
    'revision', 'supportedDataLevels', 'coverage', 'receiverCoverageCompleteness', 'sampling',
    'messageDirection', 'bearer', 'protocolStack',
  ];
  if (!record || !hasOnlyKeys(record, allowed))
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'object' });
  const parsedRevision = revision(typeof record['revision'] === 'number' ? record['revision'] : NaN);
  if (!parsedRevision.ok) return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'revision' });
  if (!Array.isArray(record['supportedDataLevels']) || record['supportedDataLevels'].length === 0)
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'supportedDataLevels' });
  const levels: ObservationDataLevel[] = [];
  const seenLevels = new Set<string>();
  for (const value of record['supportedDataLevels']) {
    if (typeof value !== 'string' || !OBSERVATION_DATA_LEVELS.some(level => level === value) || seenLevels.has(value))
      return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'supportedDataLevels' });
    seenLevels.add(value);
    levels.push(value as ObservationDataLevel);
  }
  const coverage = parseCoverage(record['coverage']);
  if (!coverage.ok) return coverage;
  if (typeof record['receiverCoverageCompleteness'] !== 'string'
    || !RECEIVER_COVERAGE_COMPLETENESS.some(value => value === record['receiverCoverageCompleteness']))
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'receiverCoverageCompleteness' });
  if (coverage.value.kind === 'UNKNOWN' && record['receiverCoverageCompleteness'] !== 'UNKNOWN')
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'receiverCoverageCompleteness' });
  const sampling = parseSampling(record['sampling']);
  if (!sampling.ok) return sampling;
  if (typeof record['messageDirection'] !== 'string'
    || !MESSAGE_DIRECTIONS.some(direction => direction === record['messageDirection']))
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'messageDirection' });
  const bearer = record['bearer'];
  if (bearer !== null && !isToken(bearer))
    return err({ code: 'INVALID_SOURCE_CAPABILITIES', field: 'bearer' });
  const protocolStack = uniqueTokens(record['protocolStack'], 'protocolStack', 32);
  if (!protocolStack.ok) return protocolStack;
  return ok(Object.freeze({
    revision: parsedRevision.value,
    supportedDataLevels: Object.freeze(levels),
    coverage: coverage.value,
    receiverCoverageCompleteness: record['receiverCoverageCompleteness'] as ReceiverCoverageCompleteness,
    sampling: sampling.value,
    messageDirection: record['messageDirection'] as MessageDirection,
    bearer,
    protocolStack: protocolStack.value,
  }));
}
