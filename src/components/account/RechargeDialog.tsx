import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, LoaderCircle, Wallet, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { useAccountStore } from '@/stores/account';
import type { CreditPackage, RechargePayment, RechargeStatus } from '@shared/host-api/contract';

type Method = 'alipay' | 'wechat';

export function RechargeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('common');
  const fetchBalance = useAccountStore((s) => s.fetchBalance);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [method, setMethod] = useState<Method>('alipay');
  const [payment, setPayment] = useState<RechargePayment | null>(null);
  const [status, setStatus] = useState<RechargeStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(''); setQr(null);
    void hostApi.account.creditPackages().then((result) => {
      if (!result.success) throw new Error(result.error || t('ccwork.rechargePackagesFailed'));
      const next = result.packages ?? [];
      setPackages(next); setSelected(next[0]?.id ?? '');
    }).catch((e) => setError(e instanceof Error ? e.message : t('ccwork.rechargePackagesFailed')));
  }, [open, t]);

  useEffect(() => {
    if (!payment?.qr_code) { setQr(null); return; }
    if (payment.qr_code.startsWith('data:image/')) { setQr(payment.qr_code); return; }
    void QRCode.toDataURL(payment.qr_code, { width: 260, margin: 1 }).then(setQr).catch(() => setQr(null));
  }, [payment?.qr_code]);

  useEffect(() => {
    if (!open || !payment?.order_no || status?.status === 'paid' || status?.status === 'completed' || status?.status === 'failed' || status?.status === 'expired' || status?.status === 'cancelled') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await hostApi.account.rechargeStatus(payment.order_no);
        if (!cancelled && result.success) setStatus(result.order ?? null);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : t('ccwork.rechargeStatusFailed')); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open, payment?.order_no, status?.status, t]);

  useEffect(() => {
    if (status?.status === 'paid' || status?.status === 'completed') void fetchBalance();
  }, [status?.status, fetchBalance]);

  const selectedPackage = useMemo(() => packages.find((item) => item.id === selected), [packages, selected]);
  const startPayment = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await hostApi.account.createRecharge({ packageId: selected, paymentMethod: method });
      if (!result.success || !result.payment) throw new Error(result.error || t('ccwork.rechargeCreateFailed'));
      setPayment(result.payment); setStatus({ order_no: result.payment.order_no, status: 'paying' });
    } catch (e) { setError(e instanceof Error ? e.message : t('ccwork.rechargeCreateFailed')); }
    finally { setBusy(false); }
  };
  const close = async () => {
    onOpenChange(false);
  };
  const resetPayment = () => { setPayment(null); setStatus(null); setQr(null); setError(''); };
  const paid = status?.status === 'paid' || status?.status === 'completed';
  return <Dialog open={open} onOpenChange={(next) => { if (!next) void close(); }}>
    <DialogContent className="max-w-lg">
      <DialogTitle>{t('ccwork.rechargeTitle')}</DialogTitle>
      <DialogDescription>{t('ccwork.rechargeDescription')}</DialogDescription>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {paid ? <div className="flex flex-col items-center gap-3 py-8 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-600" /><strong>{t('ccwork.rechargeSuccess')}</strong><p className="text-sm text-muted-foreground">{t('ccwork.rechargeBalanceUpdated')}</p><Button onClick={() => void close()}>{t('actions.done')}</Button></div> : payment ? <div className="flex flex-col items-center gap-4 py-4"><div className="rounded-lg border border-border bg-white p-3">{qr ? <img src={qr} alt={t('ccwork.paymentQrAlt')} className="h-60 w-60" /> : <LoaderCircle className="h-12 w-12 animate-spin" />}</div><p className="text-sm text-muted-foreground">{t('ccwork.rechargeScanHint')}</p><p className="text-sm">{t('ccwork.rechargeOrderStatus')}: {status?.status === 'expired' ? t('ccwork.rechargeExpired') : status?.status === 'failed' ? t('ccwork.rechargeFailed') : t('ccwork.rechargeWaiting')}</p><div className="flex gap-2"><Button variant="outline" onClick={resetPayment}>{t('ccwork.rechargeChooseAgain')}</Button><Button variant="outline" onClick={() => void close()}><XCircle className="mr-2 h-4 w-4" />{t('actions.close')}</Button></div></div> : <div className="space-y-5 py-4"><div className="grid gap-2 sm:grid-cols-2">{packages.map((item) => <button type="button" key={item.id} onClick={() => setSelected(item.id)} className={`rounded-lg border p-3 text-left ${selected === item.id ? 'border-primary bg-primary/5' : 'border-border'}`}><strong>{item.name}</strong><p className="text-sm text-muted-foreground">{item.description}</p><p className="mt-2 text-sm">¥{item.price} · {item.total_credits} {t('ccwork.credits')}</p></button>)}</div><div className="flex gap-2"><Button type="button" variant={method === 'alipay' ? 'default' : 'outline'} onClick={() => setMethod('alipay')}>{t('ccwork.alipay')}</Button><Button type="button" variant={method === 'wechat' ? 'default' : 'outline'} onClick={() => setMethod('wechat')}>{t('ccwork.wechatPay')}</Button></div><Button className="w-full" disabled={!selectedPackage || busy} onClick={() => void startPayment()}><Wallet className="mr-2 h-4 w-4" />{busy ? t('ccwork.rechargeCreating') : t('ccwork.rechargeConfirm')}</Button></div>}
    </DialogContent>
  </Dialog>;
}
