import { useCallback, useEffect, useState } from 'react';
import { api, type Backend } from '../../../lib/booking/api';
import type { Block, DateKey, Occupancy, Settings } from '../../../lib/booking/types';

/** The data backend (demo or Supabase), once loaded. */
export function useBackend(): Backend | null {
  const [b, setB] = useState<Backend | null>(null);
  useEffect(() => {
    api().then(setB);
  }, []);
  return b;
}

/** Booking settings (courts, prices, hours), kept live. */
export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    let off = () => {};
    api().then((b) => {
      const load = () => b.getSettings().then(setS);
      load();
      off = b.subscribe(load);
    });
    return () => off();
  }, []);
  return s;
}

/** Which slots are taken and which are closed off, kept live. */
export function useAvailability(from: DateKey, to: DateKey) {
  const [data, setData] = useState<{ occupancy: Occupancy[]; blocks: Block[] } | null>(null);
  useEffect(() => {
    let off = () => {};
    let alive = true;
    api().then((b) => {
      const load = () => b.getAvailability(from, to).then((d) => alive && setData(d));
      load();
      off = b.subscribe(load);
    });
    return () => {
      alive = false;
      off();
    };
  }, [from, to]);
  return data;
}

/**
 * Loads data with `fn` and reloads it whenever the backend reports a change.
 * Returns [data, reload].
 */
export function useLive<T>(fn: (b: Backend) => Promise<T>, deps: unknown[]): [T | null, () => void, unknown] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    let off = () => {};
    let alive = true;
    api().then((b) => {
      const load = () =>
        fn(b).then(
          (d) => alive && (setData(d), setError(null)),
          (e) => alive && setError(e),
        );
      load();
      off = b.subscribe(load);
    });
    return () => {
      alive = false;
      off();
    };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps

  return [data, reload, error];
}

/** Re-renders on an interval; used for countdowns and "now" markers. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
