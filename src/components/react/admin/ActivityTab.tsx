import { useState } from 'react';
import { formatDateTime } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Spinner } from '../ui';
import { EmptyState, type AdminCtx } from './shared';

// Audit log: who did what, and when.
export default function ActivityTab({ ctx }: { ctx: AdminCtx }) {
  const [log] = useLive((b) => b.listAudit(300), []);
  const [q, setQ] = useState('');
  void ctx;

  if (!log) return <Spinner />;
  const needle = q.trim().toLowerCase();
  const list = log.filter((e) => !needle || [e.actor, e.action, e.detail, e.reference ?? ''].some((v) => v.toLowerCase().includes(needle)));

  return (
    <section className="card p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Activity</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by person, action or reference" className="input sm:!w-72" />
      </div>
      {list.length === 0 ? (
        <EmptyState>No activity yet.</EmptyState>
      ) : (
        <ol className="divide-y divide-line">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs tabular-nums text-mist">{formatDateTime(e.at)}</span>
              <span className="w-28 shrink-0 font-medium">{e.actor}</span>
              <span className="flex-1">
                {e.action}
                {e.detail && <span className="text-mist"> · {e.detail}</span>}
              </span>
              {e.reference && <span className="font-mono text-xs text-mist">{e.reference}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
