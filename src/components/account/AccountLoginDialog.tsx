import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hostApi } from '@/lib/host-api';
import { useAccountStore, DEFAULT_ACCOUNT_URL, type AccountModelEntry } from '@/stores/account';

export function AccountLoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('common');
  const login = useAccountStore((s) => s.login);
  const saveModels = useAccountStore((s) => s.saveModels);
  const [register, setRegister] = useState(false);
  const [url, setUrl] = useState(DEFAULT_ACCOUNT_URL);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<AccountModelEntry[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!open) return;
    const state = useAccountStore.getState();
    setUrl(state.baseUrl || DEFAULT_ACCOUNT_URL); setUsername(state.lastUsername);
    setPassword(''); setCode(''); setRegister(false); setError(''); setModels(null); setBusy(false);
    let cancelled = false;
    void state.savedCredentials().then((saved) => {
      if (!cancelled && saved) { setUrl(saved.baseUrl || DEFAULT_ACCOUNT_URL); setUsername(saved.username); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const chooseModels = async () => {
    const state = useAccountStore.getState();
    const entries = state.modelEntries;
    const configured = await state.loadModelConfig();
    const ids = entries.filter((m) => configured?.models.some((c) => c.id === m.id)).map((m) => m.id);
    setModels(entries); setSelected(ids.length ? ids : entries.slice(0, 1).map((m) => m.id));
  };
  const submit = async () => {
    if (!url.trim() || !username.trim() || !password || (register && !/^\d{6}$/.test(code))) { setError(t('ccwork.required')); return; }
    setBusy(true); setError('');
    try {
      await login(url.trim(), username.trim(), password, register ? code : undefined);
      setPassword(''); await chooseModels();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const sendCode = async () => {
    if (!username.trim()) { setError(t('ccwork.identifierRequired')); return; }
    setBusy(true); setError('');
    try {
      const result = await hostApi.account.sendVerificationCode({ baseUrl: url.trim(), username: username.trim() });
      if (!result.success) throw new Error(result.error);
      setCooldown(60); toast.success(t('ccwork.codeSent'));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError('');
    try {
      await saveModels((models ?? []).filter((m) => selected.includes(m.id)), selected[0]);
      toast.success(t('ccwork.modelsSaved')); onOpenChange(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="w-[460px] max-w-[90vw] bg-surface-modal p-6">
      <DialogTitle className="font-serif font-normal tracking-tight">{t(models ? 'ccwork.selectModels' : register ? 'ccwork.register' : 'ccwork.login')}</DialogTitle>
      <DialogDescription>{t(models ? 'ccwork.modelsDescription' : 'ccwork.description')}</DialogDescription>
      {models ? <>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {models.length === 0 && <p>{t('ccwork.noModels')}</p>}
          {models.map((m) => <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md bg-surface-input p-2">
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => setSelected((ids) => ids.includes(m.id) ? ids.filter((id) => id !== m.id) : [...ids, m.id])} disabled={busy} />
            <span className="min-w-0"><span className="block">{m.name}</span><span className="block truncate text-xs text-muted-foreground">{m.id}</span></span>
          </label>)}
        </div>
        <Button onClick={() => void confirm()} disabled={busy || !selected.length}>{t('ccwork.saveModels')}</Button>
      </> : <>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="hx-url">{t('ccwork.server')}</Label><Input id="hx-url" className="bg-surface-input" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} /></div>
          <div className="space-y-1"><Label htmlFor="hx-username">{t(register ? 'ccwork.registerIdentifier' : 'ccwork.identifier')}</Label><Input id="hx-username" className="bg-surface-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" disabled={busy} /></div>
          <div className="space-y-1"><Label htmlFor="hx-password">{t('ccwork.password')}</Label><Input id="hx-password" className="bg-surface-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register ? 'new-password' : 'current-password'} disabled={busy} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit(); }} /></div>
          {register && <div className="space-y-1"><Label htmlFor="ccwork-code">{t('ccwork.code')}</Label><div className="flex gap-2"><Input id="ccwork-code" className="bg-surface-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} /><Button variant="outline" onClick={() => void sendCode()} disabled={busy || cooldown > 0}>{cooldown > 0 ? t('ccwork.resendAfter', { count: cooldown }) : t('ccwork.sendCode')}</Button></div><p className="text-xs text-muted-foreground">{t('ccwork.passwordHint')}</p></div>}
        </div>
        <Button data-testid="ccwork-submit" disabled={busy} onClick={() => void submit()}>{t(busy ? 'ccwork.loading' : register ? 'ccwork.register' : 'ccwork.login')}</Button>
        <Button variant="ghost" data-testid="ccwork-toggle-register" disabled={busy} onClick={() => { setRegister((value) => !value); setError(''); }}>{t(register ? 'ccwork.haveAccount' : 'ccwork.createAccount')}</Button>
        {useAccountStore.getState().loggedIn && <Button variant="outline" disabled={busy} onClick={() => void chooseModels().catch((err) => setError(String(err)))}>{t('ccwork.selectModels')}</Button>}
      </>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </DialogContent>
  </Dialog>;
}
