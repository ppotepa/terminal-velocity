import { useSyncExternalStore } from 'react';
import { parseUrlState, urlForState, type UrlState } from './url-state.ts';

const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback);
  window.addEventListener('tv:navigate', callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener('tv:navigate', callback);
  };
};

export function useUrlState(): [UrlState, (next: UrlState) => void] {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  const state = parseUrlState(search);
  const navigate = (next: UrlState) => {
    const url = urlForState(new URL(window.location.href), next);
    window.history.pushState(null, '', url);
    window.dispatchEvent(new Event('tv:navigate'));
  };
  return [state, navigate];
}
