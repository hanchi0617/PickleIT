import { useState } from 'react';
import type { DiscountCode } from '../../../lib/booking/types';
import { formatDate, formatMoney } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Badge, Field, Spinner } from '../ui';
import { act, EmptyState, type AdminCtx } from './shared';

const blank: DiscountCode = { code: '', kind: 'percent', value: 10, active: true, uses: 0 };

export default function DiscountsTab({ ctx }: { ctx: AdminCtx }) {
  const [list] = useLive((b) => b.listDiscounts(), []);
  const [form, setForm] = useState<DiscountCode>(blank);
  const sym = ctx.settings.currencySymbol;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="card p-4 sm:p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">Discount codes</h2>
        {!list ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState>No codes yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((d) => (
              <li key={d.code} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1">
                  <p className="font-mono font-semibold tracking-wider">{d.code}</p>
                  <p className="text-sm text-mist">
                    {d.kind === 'percent' ? `${d.value}% off` : `${formatMoney(d.value, sym)} off`} · used {d.uses}
                    {d.maxUses ? ` of ${d.maxUses}` : ''} {d.expiresOn ? `· until ${formatDate(d.expiresOn)}` : ''}
                  </p>
                </div>
                {d.active ? <Badge tone="green">Active</Badge> : <Badge tone="dim">Paused</Badge>}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(ctx, () => ctx.backend.saveDiscount({ ...d, active: !d.active }), d.active ? 'Code paused' : 'Code activated')}>
                  {d.active ? 'Pause' : 'Activate'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(d)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => window.confirm(`Delete ${d.code}?`) && act(ctx, () => ctx.backend.deleteDiscount(d.code), 'Code deleted')}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4 sm:p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">{list?.some((d) => d.code === form.code) ? 'Edit code' : 'New code'}</h2>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(ctx, () => ctx.backend.saveDiscount(form), 'Code saved')) setForm(blank);
          }}
        >
          <Field label="Code" hint="Letters, numbers and dashes, e.g. STUDENT or SUMMER-25">
            <input className="input font-mono uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as DiscountCode['kind'] })}>
                <option value="percent">Percent off</option>
                <option value="fixed">Amount off</option>
              </select>
            </Field>
            <Field label={form.kind === 'percent' ? 'Percent' : `Amount (${sym})`}>
              <input type="number" min={1} max={form.kind === 'percent' ? 100 : undefined} className="input" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expires (optional)">
              <input type="date" className="input" value={form.expiresOn ?? ''} onChange={(e) => setForm({ ...form, expiresOn: e.target.value || undefined })} />
            </Field>
            <Field label="Max uses (optional)">
              <input type="number" min={1} className="input" value={form.maxUses ?? ''} onChange={(e) => setForm({ ...form, maxUses: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
          </div>
          <div className="flex gap-2">
            {form !== blank && (
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setForm(blank)}>
                New
              </button>
            )}
            <button className="btn btn-primary flex-1">Save code</button>
          </div>
        </form>
      </section>
    </div>
  );
}
