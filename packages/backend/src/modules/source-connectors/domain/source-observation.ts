import { revision, type Revision } from '../../../contracts/identity/index.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { hasOnlyKeys, hasOwn, isToken, plainRecord, uniqueTokenList } from './input-validation.ts';
import { receiverId, type ReceiverId } from './receiver-id.ts';
import { sourceDeliveryIdentity, type SourceDeliveryIdentity } from './source-delivery-identity.ts';
import { sourceId, type SourceId } from './source-id.ts';
import { MESSAGE_DIRECTIONS, type MessageDirection, type ObservationDataLevel } from './source-capabilities.ts';
import { observationTimeEvidence, type ObservationTimeEvidence } from './time-evidence.ts';

export const SOURCE_OBSERVATION_SCHEMA_VERSION = 1 as const;

export interface SourceObservationBase {
  readonly schemaVersion: typeof SOURCE_OBSERVATION_SCHEMA_VERSION;
  readonly sourceId: SourceId;
  readonly sourceDeliveryId: SourceDeliveryIdentity;
  readonly receivedAt: ObservationTimeEvidence;
  readonly observedAt?: ObservationTimeEvidence;
  readonly decoderVersion?: string;
  readonly payloadDigest: string;
  readonly capabilitiesRevision: Revision;
}

export interface AddressHints {
  readonly icao24?: string;
  readonly callsign?: string;
}

export interface ProviderMessageObservation extends SourceObservationBase {
  readonly dataLevel: 'PROVIDER_MESSAGE';
  readonly decodedText: string;
  readonly bearer?: string;
  readonly protocolStack?: readonly string[];
  readonly direction?: MessageDirection;
  readonly addressHints?: AddressHints;
}

export interface ReceiverReceptionObservation extends SourceObservationBase {
  readonly dataLevel: 'RECEPTION';
  readonly receiverId: ReceiverId;
  readonly frequencyHz?: number;
  readonly signalStrengthDbm?: number;
}

export interface FrameObservation extends SourceObservationBase {
  readonly dataLevel: 'FRAME';
  /** Canonical standard Base64; the source must supply actual frame bytes. */
  readonly frameBytesBase64: string;
  readonly bearer?: string;
  readonly protocolStack?: readonly string[];
  readonly direction?: MessageDirection;
  readonly frequencyHz?: number;
}

export type SourceObservation =
  | ProviderMessageObservation
  | ReceiverReceptionObservation
  | FrameObservation;

export type SourceParseError =
  | { readonly code: 'INVALID_INPUT'; readonly field: string }
  | { readonly code: 'UNSUPPORTED_VERSION' }
  | { readonly code: 'MISSING_TIME'; readonly field: 'receivedAt' }
  | { readonly code: 'MISSING_REQUIRED_EVIDENCE'; readonly field: string }
  | { readonly code: 'UNSUPPORTED_LEVEL'; readonly dataLevel: string }
  | { readonly code: 'CONFLICTING_TIME_EVIDENCE'; readonly field: string }
  | { readonly code: 'FUTURE_OBSERVATION'; readonly observedAt: string; readonly receivedAt: string };

const digestPattern = /^[a-f0-9]{64}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const commonKeys = [
  'schemaVersion', 'dataLevel', 'sourceId', 'sourceDeliveryId', 'receivedAt', 'observedAt',
  'decoderVersion', 'payloadDigest', 'capabilitiesRevision',
] as const;

function invalid(field: string): Result<never, SourceParseError> {
  return err({ code: 'INVALID_INPUT', field });
}

function parseTime(value: unknown, field: string): Result<ObservationTimeEvidence, SourceParseError> {
  const parsed = observationTimeEvidence(value);
  if (!parsed.ok) return invalid(field);
  return ok(parsed.value);
}

function parseAddressHints(input: unknown): Result<AddressHints, SourceParseError> {
  const record = plainRecord(input);
  if (!record || !hasOnlyKeys(record, ['icao24', 'callsign']) || Object.keys(record).length === 0)
    return invalid('addressHints');
  const result: { icao24?: string; callsign?: string } = {};
  if (hasOwn(record, 'icao24')) {
    const value = record['icao24'];
    if (typeof value !== 'string' || !/^[0-9A-Fa-f]{6}$/u.test(value)) return invalid('addressHints.icao24');
    result.icao24 = value.toUpperCase();
  }
  if (hasOwn(record, 'callsign')) {
    const value = record['callsign'];
    if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,16}$/u.test(value)) return invalid('addressHints.callsign');
    result.callsign = value.toUpperCase();
  }
  return ok(Object.freeze(result));
}

function parseFrequency(value: unknown, field: string): Result<number, SourceParseError> {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000_000
    ? ok(value)
    : invalid(field);
}

function isCanonicalBase64(input: string): boolean {
  if (!base64Pattern.test(input)) return false;
  if (input.endsWith('==')) {
    const lastDataCharacter = base64Alphabet.indexOf(input[input.length - 3] ?? '');
    return lastDataCharacter >= 0 && (lastDataCharacter & 0b1111) === 0;
  }
  if (input.endsWith('=')) {
    const lastDataCharacter = base64Alphabet.indexOf(input[input.length - 2] ?? '');
    return lastDataCharacter >= 0 && (lastDataCharacter & 0b11) === 0;
  }
  return true;
}

function parseCommon(record: Record<string, unknown>): Result<SourceObservationBase, SourceParseError> {
  if (!hasOwn(record, 'sourceId')) return err({ code: 'MISSING_REQUIRED_EVIDENCE', field: 'sourceId' });
  if (typeof record['sourceId'] !== 'string') return invalid('sourceId');
  const id = sourceId(record['sourceId']);
  if (!id.ok) return invalid('sourceId');
  if (!hasOwn(record, 'sourceDeliveryId'))
    return err({ code: 'MISSING_REQUIRED_EVIDENCE', field: 'sourceDeliveryId' });
  const deliveryId = sourceDeliveryIdentity(record['sourceDeliveryId']);
  if (!deliveryId.ok) return invalid('sourceDeliveryId');
  if (!hasOwn(record, 'receivedAt')) return err({ code: 'MISSING_TIME', field: 'receivedAt' });
  const receivedAt = parseTime(record['receivedAt'], 'receivedAt');
  if (!receivedAt.ok) return receivedAt;
  if (!['RECEIVED', 'PROVIDER'].includes(receivedAt.value.basis))
    return err({ code: 'CONFLICTING_TIME_EVIDENCE', field: 'receivedAt.basis' });
  let observedAt: ObservationTimeEvidence | undefined;
  if (hasOwn(record, 'observedAt')) {
    const parsed = parseTime(record['observedAt'], 'observedAt');
    if (!parsed.ok) return parsed;
    if (!['OBSERVED', 'PROVIDER'].includes(parsed.value.basis))
      return err({ code: 'CONFLICTING_TIME_EVIDENCE', field: 'observedAt.basis' });
    observedAt = parsed.value;
    const observedEarliest = observedAt.at - observedAt.uncertaintyMs;
    const receivedLatest = receivedAt.value.at + receivedAt.value.uncertaintyMs;
    if (observedEarliest > receivedLatest)
      return err({ code: 'FUTURE_OBSERVATION', observedAt: observedAt.iso, receivedAt: receivedAt.value.iso });
  }
  if (!hasOwn(record, 'payloadDigest')) return err({ code: 'MISSING_REQUIRED_EVIDENCE', field: 'payloadDigest' });
  if (typeof record['payloadDigest'] !== 'string' || !digestPattern.test(record['payloadDigest']))
    return invalid('payloadDigest');
  const parsedRevision = revision(typeof record['capabilitiesRevision'] === 'number' ? record['capabilitiesRevision'] : NaN);
  if (!parsedRevision.ok) return invalid('capabilitiesRevision');
  let decoderVersion: string | undefined;
  if (hasOwn(record, 'decoderVersion')) {
    if (!isToken(record['decoderVersion'])) return invalid('decoderVersion');
    decoderVersion = record['decoderVersion'];
  }
  return ok(Object.freeze({
    schemaVersion: SOURCE_OBSERVATION_SCHEMA_VERSION,
    sourceId: id.value,
    sourceDeliveryId: deliveryId.value,
    receivedAt: receivedAt.value,
    ...(observedAt === undefined ? {} : { observedAt }),
    ...(decoderVersion === undefined ? {} : { decoderVersion }),
    payloadDigest: record['payloadDigest'],
    capabilitiesRevision: parsedRevision.value,
  }));
}

/** Validates and copies the canonical v1 observation envelope. Provider formats belong in adapters. */
export function parseSourceObservation(input: unknown): Result<SourceObservation, SourceParseError> {
  const record = plainRecord(input);
  if (!record) return invalid('$');
  if (!hasOwn(record, 'schemaVersion')) return invalid('schemaVersion');
  if (record['schemaVersion'] !== SOURCE_OBSERVATION_SCHEMA_VERSION)
    return err({ code: 'UNSUPPORTED_VERSION' });
  if (!hasOwn(record, 'dataLevel')) return invalid('dataLevel');
  const dataLevel = record['dataLevel'];
  if (typeof dataLevel !== 'string' || !['PROVIDER_MESSAGE', 'RECEPTION', 'FRAME'].includes(dataLevel))
    return err({ code: 'UNSUPPORTED_LEVEL', dataLevel: typeof dataLevel === 'string' ? dataLevel : '' });

  const specificKeys = dataLevel === 'PROVIDER_MESSAGE'
    ? ['decodedText', 'bearer', 'protocolStack', 'direction', 'addressHints']
    : dataLevel === 'RECEPTION'
      ? ['receiverId', 'frequencyHz', 'signalStrengthDbm']
      : ['frameBytesBase64', 'bearer', 'protocolStack', 'direction', 'frequencyHz'];
  if (!hasOnlyKeys(record, [...commonKeys, ...specificKeys])) return invalid('$');
  const common = parseCommon(record);
  if (!common.ok) return common;

  let observation: SourceObservation;
  if (dataLevel === 'PROVIDER_MESSAGE') {
    const decodedText = record['decodedText'];
    if (!hasOwn(record, 'decodedText')) return err({ code: 'MISSING_REQUIRED_EVIDENCE', field: 'decodedText' });
    if (typeof decodedText !== 'string' || decodedText.trim().length === 0 || decodedText.length > 65_536)
      return invalid('decodedText');
    let bearer: string | undefined;
    if (hasOwn(record, 'bearer')) {
      if (!isToken(record['bearer'])) return invalid('bearer');
      bearer = record['bearer'];
    }
    let protocolStack: readonly string[] | undefined;
    if (hasOwn(record, 'protocolStack')) {
      const parsed = uniqueTokenList(record['protocolStack'], 32);
      if (!parsed) return invalid('protocolStack');
      protocolStack = parsed;
    }
    let direction: MessageDirection | undefined;
    if (hasOwn(record, 'direction')) {
      if (typeof record['direction'] !== 'string' || !MESSAGE_DIRECTIONS.some(value => value === record['direction']))
        return invalid('direction');
      direction = record['direction'] as MessageDirection;
    }
    let addressHints: AddressHints | undefined;
    if (hasOwn(record, 'addressHints')) {
      const parsed = parseAddressHints(record['addressHints']);
      if (!parsed.ok) return parsed;
      addressHints = parsed.value;
    }
    observation = Object.freeze({
      ...common.value,
      dataLevel,
      decodedText,
      ...(bearer === undefined ? {} : { bearer }),
      ...(protocolStack === undefined ? {} : { protocolStack }),
      ...(direction === undefined ? {} : { direction }),
      ...(addressHints === undefined ? {} : { addressHints }),
    });
  } else if (dataLevel === 'RECEPTION') {
    if (!hasOwn(record, 'receiverId')) return err({ code: 'MISSING_REQUIRED_EVIDENCE', field: 'receiverId' });
    if (typeof record['receiverId'] !== 'string') return invalid('receiverId');
    const parsedReceiver = receiverId(record['receiverId']);
    if (!parsedReceiver.ok) return invalid('receiverId');
    let frequencyHz: number | undefined;
    if (hasOwn(record, 'frequencyHz')) {
      const parsed = parseFrequency(record['frequencyHz'], 'frequencyHz');
      if (!parsed.ok) return parsed;
      frequencyHz = parsed.value;
    }
    let signalStrengthDbm: number | undefined;
    if (hasOwn(record, 'signalStrengthDbm')) {
      const value = record['signalStrengthDbm'];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < -200 || value > 100)
        return invalid('signalStrengthDbm');
      signalStrengthDbm = value;
    }
    observation = Object.freeze({
      ...common.value,
      dataLevel,
      receiverId: parsedReceiver.value,
      ...(frequencyHz === undefined ? {} : { frequencyHz }),
      ...(signalStrengthDbm === undefined ? {} : { signalStrengthDbm }),
    });
  } else {
    const bytes = record['frameBytesBase64'];
    if (!hasOwn(record, 'frameBytesBase64'))
      return err({ code: 'MISSING_REQUIRED_EVIDENCE', field: 'frameBytesBase64' });
    if (typeof bytes !== 'string' || bytes.length === 0 || bytes.length > 1_398_104 || !isCanonicalBase64(bytes))
      return invalid('frameBytesBase64');
    let bearer: string | undefined;
    if (hasOwn(record, 'bearer')) {
      if (!isToken(record['bearer'])) return invalid('bearer');
      bearer = record['bearer'];
    }
    let protocolStack: readonly string[] | undefined;
    if (hasOwn(record, 'protocolStack')) {
      const parsed = uniqueTokenList(record['protocolStack'], 32);
      if (!parsed) return invalid('protocolStack');
      protocolStack = parsed;
    }
    let direction: MessageDirection | undefined;
    if (hasOwn(record, 'direction')) {
      if (typeof record['direction'] !== 'string' || !MESSAGE_DIRECTIONS.some(value => value === record['direction']))
        return invalid('direction');
      direction = record['direction'] as MessageDirection;
    }
    let frequencyHz: number | undefined;
    if (hasOwn(record, 'frequencyHz')) {
      const parsed = parseFrequency(record['frequencyHz'], 'frequencyHz');
      if (!parsed.ok) return parsed;
      frequencyHz = parsed.value;
    }
    observation = Object.freeze({
      ...common.value,
      dataLevel: 'FRAME',
      frameBytesBase64: bytes,
      ...(bearer === undefined ? {} : { bearer }),
      ...(protocolStack === undefined ? {} : { protocolStack }),
      ...(direction === undefined ? {} : { direction }),
      ...(frequencyHz === undefined ? {} : { frequencyHz }),
    });
  }
  return ok(observation);
}
