import { useCallback, useEffect, useState } from 'react';
import * as store from '../../../lib/booking/store';
import type { Block, Booking, DateKey } from '../../../lib/booking/types';

/** Bookings and blocks for one day, kept live. */
export function useDay(date: DateKey) {
  const [data, setData] = useState<{ bookings: Booking[]; blocks: Block[] } | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    store.getDay(date).then((d) => {
      setData(d);
      setTick((t) => t + 1);
    });
  }, [date]);

  useEffect(() => {
    load();
    return store.subscribe(load);
  }, [load]);

  return { data, tick, reload: load };
}

/** Bookings and blocks for a date range, kept live. */
export function useRange(from: DateKey, to: DateKey) {
  const [data, setData] = useState<{ bookings: Booking[]; blocks: Block[] } | null>(null);

  useEffect(() => {
    const load = () => store.getRange(from, to).then(setData);
    load();
    return store.subscribe(load);
  }, [from, to]);

  return data;
}

/** Re-renders once a second; used for countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
