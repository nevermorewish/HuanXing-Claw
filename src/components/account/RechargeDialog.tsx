import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, LoaderCircle, Wallet, X, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { useAccountStore } from '@/stores/account';
import type { CreditPackage, RechargePayment, RechargeStatus } from '@shared/host-api/contract';

type Method = 'alipay' | 'wechat';
type AmountChoice = '10' | '20' | '50' | '100' | '200' | 'custom';
const PRESET_AMOUNTS: readonly AmountChoice[] = ['10', '20', '50', '100', '200'];

function normalizeAmount(choice: AmountChoice, customAmount: string): string | null {
  const raw = choice === 'custom' ? customAmount.trim() : choice;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0.01 || value > 100000) return null;
  return value.toFixed(2);
}

export function RechargeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('common');
  const fetchBalance = useAccountStore((s) => s.fetchBalance);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [amountChoice, setAmountChoice] = useState<AmountChoice>('100');
  const [customAmount, setCustomAmount] = useState('');
  const [method, setMethod] = useState<Method>('alipay');
  const [payment, setPayment] = useState<RechargePayment | null>(null);
  const [status, setStatus] = useState<RechargeStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setLoadingPackages(true);
    void hostApi.account.creditPackages().then((result) => {
      if (cancelled) return;
      if (!result.success) throw new Error(result.error || t('ccwork.rechargePackagesFailed'));
      setPackages(result.packages ?? []);
    }).catch((e) => {
      if (!cancelled) { setPackages([]); setError(e instanceof Error ? e.message : t('ccwork.rechargePackagesFailed')); }
    }).finally(() => { if (!cancelled) setLoadingPackages(false); });
    return () => { cancelled = true; };
  }, [open, t]);

  useEffect(() => {
    if (!payment?.qr_code) { setQr(null); return; }
    if (payment.qr_code.startsWith('data:image/')) { setQr(payment.qr_code); return; }
    void QRCode.toDataURL(payment.qr_code, { width: 260, margin: 2 }).then(setQr).catch(() => setQr(null));
  }, [payment?.qr_code]);

  useEffect(() => {
    if (!open || !payment?.order_no || ['paid', 'completed', 'failed', 'expired', 'cancelled'].includes(status?.status ?? '')) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await hostApi.account.rechargeStatus(payment.order_no);
        if (!result.success) throw new Error(result.error || t('ccwork.rechargeStatusFailed'));
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

  const amountCny = normalizeAmount(amountChoice, customAmount);
  const selectedPackage = useMemo(() => {
    if (amountChoice === 'custom') return undefined;
    return packages.find((item) => Number(item.price) === Number(amountChoice));
  }, [amountChoice, packages]);
  const paid = status?.status === 'paid' || status?.status === 'completed';
  const selectAmount = (choice: AmountChoice) => { setAmountChoice(choice); if (choice !== 'custom') setCustomAmount(''); setError(''); };

  const startPayment = async () => {
    if (busy || loadingPackages) return;
    if (!amountCny) { setError(t('ccwork.rechargeAmountInvalid')); return; }
    setBusy(true); setError('');
    try {
      const result = await hostApi.account.createRecharge({
        paymentMethod: method,
        ...(selectedPackage ? { packageId: selectedPackage.id } : { amountCny }),
      });
      if (!result.success || !result.payment) throw new Error(result.error || t('ccwork.rechargeCreateFailed'));
      setPayment(result.payment); setStatus({ order_no: result.payment.order_no, status: 'paying' });
    } catch (e) { setError(e instanceof Error ? e.message : t('ccwork.rechargeCreateFailed')); }
    finally { setBusy(false); }
  };

  const close = async () => { onOpenChange(false); };
  const resetPayment = () => { setPayment(null); setStatus(null); setQr(null); setError(''); };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) void close(); }}>
    <DialogContent className="no-drag max-h-[min(760px,calc(100vh-2rem))] w-[calc(100%-2rem)] max-w-lg overflow-y-auto bg-surface-modal p-0">
      <div className="relative border-b border-border px-5 pb-4 pt-5 sm:px-6">
        <DialogTitle className="pr-8 text-lg font-semibold">{t('ccwork.rechargeTitle')}</DialogTitle>
        <DialogDescription className="mt-1 pr-8 text-sm leading-6 text-muted-foreground">{t('ccwork.rechargeDescription')}</DialogDescription>
        <Button variant="ghost" size="icon" aria-label={t('actions.close')} className="absolute right-3 top-3" onClick={() => void close()}><X className="h-4 w-4" /></Button>
      </div>
      <div className="space-y-5 px-5 py-5 sm:px-6">
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {paid ? <div className="flex flex-col items-center gap-3 py-10 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-600" /><strong>{t('ccwork.rechargeSuccess')}</strong><p className="text-sm text-muted-foreground">{t('ccwork.rechargeBalanceUpdated')}</p><Button onClick={() => void close()}>{t('actions.done')}</Button></div> : payment ? <div className="flex flex-col items-center gap-4 py-5 text-center"><div className="rounded-xl border border-border bg-white p-3 shadow-sm">{qr ? <img src={qr} alt={t('ccwork.paymentQrAlt')} className="h-60 w-60" /> : <LoaderCircle className="h-12 w-12 animate-spin" />}</div><p className="text-sm text-muted-foreground">{t('ccwork.rechargeScanHint')}</p><p className="text-sm">{t('ccwork.rechargeOrderStatus')}: {status?.status === 'expired' ? t('ccwork.rechargeExpired') : status?.status === 'failed' ? t('ccwork.rechargeFailed') : t('ccwork.rechargeWaiting')}</p><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={resetPayment}>{t('ccwork.rechargeChooseAgain')}</Button><Button variant="outline" onClick={() => void close()}><XCircle className="mr-2 h-4 w-4" />{t('actions.close')}</Button></div></div> : <>
          <section className="space-y-3" aria-labelledby="recharge-amount-heading">
            <div><h3 id="recharge-amount-heading" className="text-sm font-semibold">{t('ccwork.rechargeAmount')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('ccwork.rechargeAmountHint')}</p></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[...PRESET_AMOUNTS, 'custom' as const].map((amount) => <button type="button" key={amount} aria-pressed={amountChoice === amount} onClick={() => selectAmount(amount)} className={`min-h-12 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${amountChoice === amount ? 'border-primary bg-black/5 dark:bg-white/10 text-primary shadow-sm' : 'border-border hover:border-primary/60'}`}>{amount === 'custom' ? t('ccwork.rechargeCustomAmount') : `¥${amount}`}</button>)}</div>
            <label className={`block rounded-lg border px-3 py-2.5 transition-colors ${amountChoice === 'custom' ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('ccwork.rechargeCustomAmount')}</span>
              <span className="flex items-center gap-2"><b className="text-muted-foreground">¥</b><input aria-label={t('ccwork.rechargeCustomAmount')} aria-describedby="recharge-amount-hint" aria-invalid={amountChoice === 'custom' && !!customAmount && !amountCny} value={customAmount} inputMode="decimal" placeholder={t('ccwork.rechargeAmountPlaceholder')} onFocus={() => selectAmount('custom')} onChange={(event) => { setCustomAmount(event.target.value); setAmountChoice('custom'); setError(''); }} className="min-w-0 w-full flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/60" /></span>
            </label>
            <p id="recharge-amount-hint" className={`text-xs leading-5 ${amountChoice === 'custom' && !!customAmount && !amountCny ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}`}>{t('ccwork.rechargeAmountInvalid')}</p>
            {selectedPackage ? <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">{t('ccwork.rechargePackageCredits', { name: selectedPackage.name, credits: selectedPackage.total_credits.toLocaleString() })}{selectedPackage.bonus_credits ? ` ${t('ccwork.rechargeBonusCredits', { bonus: selectedPackage.bonus_credits.toLocaleString() })}` : ''}</p> : amountCny && <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">{t('ccwork.rechargeCustomCredits', { amount: amountCny })}</p>}
          </section>
          <section className="space-y-3" aria-labelledby="recharge-method-heading">
            <h3 id="recharge-method-heading" className="text-sm font-semibold">{t('ccwork.rechargePaymentMethod')}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Button type="button" className="h-11 justify-start" variant={method === 'alipay' ? 'default' : 'outline'} onClick={() => setMethod('alipay')}>{t('ccwork.alipay')}</Button><Button type="button" className="h-11 justify-start" variant={method === 'wechat' ? 'default' : 'outline'} onClick={() => setMethod('wechat')}>{t('ccwork.wechatPay')}</Button></div>
          </section>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3"><span className="text-sm text-muted-foreground">{t('ccwork.rechargeTotal')}</span><strong className="text-lg">{amountCny ? `¥${amountCny}` : '—'}</strong></div>
          <Button className="h-auto min-h-11 w-full whitespace-normal" disabled={!amountCny || busy || loadingPackages} onClick={() => void startPayment()}><Wallet className="mr-2 h-4 w-4 shrink-0" />{busy ? t('ccwork.rechargeCreating') : t('ccwork.rechargeConfirm')}</Button>
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
