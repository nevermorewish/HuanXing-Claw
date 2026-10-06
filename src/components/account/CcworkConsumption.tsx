import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccountTransaction } from '@shared/host-api/contract';
import { useAccountStore } from '@/stores/account';
import { hostApi } from '@/lib/host-api';
import { Button } from '@/components/ui/button';

export function CcworkConsumption() {
  const loggedIn = useAccountStore((s) => s.loggedIn);
  const userId = useAccountStore((s) => s.user?.id);
  const baseUrl = useAccountStore((s) => s.baseUrl);
  return loggedIn ? <Consumption key={`${baseUrl}/${userId}`} /> : null;
}

function Consumption() {
  const { t } = useTranslation('common');
  const balance = useAccountStore((s) => s.balance);
  const [rows, setRows] = useState<AccountTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void useAccountStore.getState().fetchBalance();
    void hostApi.account.transactions({ limit: 20, offset: page * 20 }).then((result) => {
      if (cancelled) return;
      if (!result.success) { setRows([]); setError(result.error || t('ccwork.loadFailed')); return; }
      setRows(result.transactions ?? []); setTotal(result.total ?? 0);
    }).catch(() => { if (!cancelled) { setRows([]); setError(t('ccwork.loadFailed')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, refresh, t]);
  return <section data-testid="ccwork-consumption" className="mb-8 space-y-3 rounded-xl border border-border bg-surface-modal p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-xl font-normal tracking-tight">{t('ccwork.consumption')}</h2><Button variant="outline" disabled={loading} onClick={() => { setLoading(true); setError(''); setRefresh((v) => v + 1); }}>{t('ccwork.refresh')}</Button></div>
    <p className="text-sm text-muted-foreground">{t('ccwork.consumptionDescription')}</p>
    <p>{t('ccwork.credits')}: {balance ? balance.quota.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}</p>
    {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
    {loading ? <p>{t('ccwork.loading')}</p> : rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">{t('ccwork.date')}</th><th>{t('ccwork.transactionDescription')}</th><th>{t('ccwork.amount')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-2">{new Date(row.created_at).toLocaleString()}</td><td>{row.description}</td><td>{Math.abs(Number(row.amount_precise)).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td></tr>)}</tbody></table></div> : !error && <p>{t('ccwork.noConsumption')}</p>}
    <div className="flex justify-end gap-2"><Button variant="ghost" disabled={page === 0 || loading} onClick={() => { setLoading(true); setError(''); setPage((v) => v - 1); }}>{t('ccwork.previous')}</Button><Button variant="ghost" disabled={(page + 1) * 20 >= total || loading} onClick={() => { setLoading(true); setError(''); setPage((v) => v + 1); }}>{t('ccwork.next')}</Button></div>
  </section>;
}
