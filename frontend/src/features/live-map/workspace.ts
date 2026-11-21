import type { components } from '../../shared/api/generated';
type Schema = components['schemas'];
export type Aircraft = Schema['MapAircraft'];
export type Mode = 'debug' | 'live';
export type Source = Schema['WorkspaceSource'];
export type Point = Schema['WorkspacePoint'];
export type Corridor = Schema['WorkspaceCorridor'];
export type Rule = Schema['WorkspaceRule'];
export type Kind = Rule['kind'];
export type Flight = Schema['WorkspaceFlight'];
export type Entry = Schema['WorkspaceEvent'];
export type Page = Schema['WorkspacePage'];

export async function request<T>(mode: Mode, path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch('/api/v1/workspace/' + mode + '/' + path, { cache: 'no-store', ...opts });
  if (!res.ok) throw Error('Request failed (' + res.status + ')');
  return res.json();
}

export const label = (english: string, polish: string) => navigator.language.startsWith('pl') ? polish : english;
