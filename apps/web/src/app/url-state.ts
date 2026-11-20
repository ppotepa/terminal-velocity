export type View = 'map' | 'flights' | 'stations';
export type PositionFilter = '' | 'CURRENT' | 'STALE' | 'UNKNOWN';
export type MessageFilter = '' | 'RECENT' | 'STALE' | 'NONE';
export type ProtocolFilter = '' | 'VHF_ACARS' | 'VDL2' | 'HFDL' | 'SATCOM';

export interface UrlState {
  readonly view: View;
  readonly aircraft: string;
  readonly positionStatus: PositionFilter;
  readonly messageStatus: MessageFilter;
  readonly protocol: ProtocolFilter;
}

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value !== null && allowed.includes(value as T) ? value as T : fallback;

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const id = params.get('aircraft') ?? '';
  return {
    view: oneOf(params.get('view'), ['map','flights','stations'], 'map'),
    aircraft: /^ac_[A-Za-z0-9-]{1,64}$/.test(id) ? id : '',
    positionStatus: oneOf(params.get('positionStatus'), ['', 'CURRENT','STALE','UNKNOWN'], ''),
    messageStatus: oneOf(params.get('messageStatus'), ['', 'RECENT','STALE','NONE'], ''),
    protocol: oneOf(params.get('protocol'), ['', 'VHF_ACARS','VDL2','HFDL','SATCOM'], ''),
  };
}

export function urlForState(current: URL, state: UrlState): URL {
  const url = new URL(current.href);
  url.search = '';
  if (state.view !== 'map') url.searchParams.set('view', state.view);
  if (state.aircraft) url.searchParams.set('aircraft', state.aircraft);
  if (state.positionStatus) url.searchParams.set('positionStatus', state.positionStatus);
  if (state.messageStatus) url.searchParams.set('messageStatus', state.messageStatus);
  if (state.protocol) url.searchParams.set('protocol', state.protocol);
  return url;
}
