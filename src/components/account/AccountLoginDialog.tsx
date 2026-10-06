import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAccountStore, DEFAULT_ACCOUNT_URL } from '@/stores/account';

/** email / mainland-China phone, matching ccwork's identifier rules. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^1[3-9]\d{9}$/;
const isValidIdentifier = (value: string) => EMAIL_RE.test(value) || PHONE_RE.test(value);

/**
 * ccwork offers three entry points. Verification-code login is the default
 * because it is the only one that works for both new and existing accounts:
 * ccwork registers an unknown identifier on first use, so the user never has to
 * decide between "log in" and "register".
 */
type Mode = 'code' | 'password' | 'register';

export function AccountLoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('common');
  const login = useAccountStore((s) => s.login);
  const sendCode = useAccountStore((s) => s.sendCode);
  const [mode, setMode] = useState<Mode>('code');
  const [url, setUrl] = useState(DEFAULT_ACCOUNT_URL);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeKey, setChallengeKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!open) return;
    const state = useAccountStore.getState();
    setUrl(state.baseUrl || DEFAULT_ACCOUNT_URL); setUsername(state.lastUsername);
    setPassword(''); setCode(''); setChallengeKey(''); setMode('code'); setError(''); setBusy(false); setCooldown(0);
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
  const switchMode = (next: Mode) => {
    if (busy) return;
    setMode(next); setError('');
    // A code is scoped to its code_type, so it cannot be carried across modes.
    setCode(''); setChallengeKey(''); setCooldown(0);
  };
  const sendVerificationCode = async () => {
    const identifier = username.trim();
    if (!isValidIdentifier(identifier)) { setError(t('ccwork.identifierInvalid')); return; }
    setBusy(true); setError('');
    try {
      // ccwork binds a login code to the challenge key it was issued under, so
      // Main mints the key and the redeem call must echo this exact value.
      const result = await sendCode({ baseUrl: url, username: identifier, codeType: mode === 'register' ? 'register' : 'login' });
      setChallengeKey(result.challengeKey); setCooldown(60);
      toast.success(t('ccwork.codeSent'));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const needsCode = mode !== 'password';
  const needsPassword = mode !== 'code';
  const submit = async () => {
    const identifier = username.trim();
    if (!url.trim() || !identifier) { setError(t('ccwork.required')); return; }
    // A code is delivered to an email/phone, so only those modes need the
    // stricter check — ccwork's password login also accepts a plain username.
    if (mode !== 'password' && !isValidIdentifier(identifier)) { setError(t('ccwork.identifierInvalid')); return; }
    if (mode !== 'code' && !password) { setError(t('ccwork.required')); return; }
    // Report the missing code request before complaining about the code itself,
    // because a code can only be redeemed under the challenge key it was issued with.
    if (mode === 'code' && !challengeKey) { setError(t('ccwork.sendCodeFirst')); return; }
    if (needsCode && !/^\d{6}$/.test(code)) { setError(t('ccwork.required')); return; }
    setBusy(true); setError('');
    try {
      await login(mode === 'password'
        ? { baseUrl: url, username: identifier, mode: 'password', password }
        : mode === 'code'
          ? { baseUrl: url, username: identifier, mode: 'code', verificationCode: code, challengeKey }
          : { baseUrl: url, username: identifier, mode: 'register', password, verificationCode: code });
      setPassword(''); setCode(''); setChallengeKey('');
      toast.success(t('ccwork.loginSuccess')); onOpenChange(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="w-[460px] max-w-[90vw] bg-surface-modal p-6">
      <DialogTitle className="font-serif font-normal tracking-tight">
        {t(mode === 'register' ? 'ccwork.register' : 'ccwork.login')}
      </DialogTitle>
      <DialogDescription>{t('ccwork.description')}</DialogDescription>
      <div className="space-y-3">
        <div className="space-y-1"><Label htmlFor="hx-url">{t('ccwork.server')}</Label><Input id="hx-url" className="bg-surface-input" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} /></div>
        <div className="space-y-1">
          <Label htmlFor="hx-username">{t(mode === 'register' ? 'ccwork.registerIdentifier' : 'ccwork.identifier')}</Label>
          <Input id="hx-username" className="bg-surface-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" disabled={busy} />
        </div>
        {needsPassword && <div className="space-y-1"><Label htmlFor="hx-password">{t('ccwork.password')}</Label><Input id="hx-password" className="bg-surface-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} disabled={busy} onKeyDown={(e) => { if (e.key === 'Enter' && !busy && !needsCode) void submit(); }} />{mode === 'register' && <p className="text-xs text-muted-foreground">{t('ccwork.passwordHint')}</p>}</div>}
        {needsCode && <div className="space-y-1">
          <Label htmlFor="ccwork-code">{t('ccwork.code')}</Label>
          <div className="flex gap-2">
            <Input id="ccwork-code" className="bg-surface-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit(); }} />
            <Button variant="outline" data-testid="ccwork-send-code" onClick={() => void sendVerificationCode()} disabled={busy || cooldown > 0}>{cooldown > 0 ? t('ccwork.resendAfter', { count: cooldown }) : t('ccwork.sendCode')}</Button>
          </div>
        </div>}
      </div>
      <Button data-testid="ccwork-submit" disabled={busy} onClick={() => void submit()}>
        {t(busy ? 'ccwork.loading' : mode === 'register' ? 'ccwork.register' : 'ccwork.login')}
      </Button>
      <div className="flex flex-wrap gap-2">
        {mode !== 'code' && <Button variant="ghost" data-testid="ccwork-use-code" disabled={busy} onClick={() => switchMode('code')}>{t('ccwork.useCodeLogin')}</Button>}
        {mode !== 'password' && <Button variant="ghost" data-testid="ccwork-use-password" disabled={busy} onClick={() => switchMode('password')}>{t('ccwork.usePasswordLogin')}</Button>}
        <Button variant="ghost" data-testid="ccwork-toggle-register" disabled={busy} onClick={() => switchMode(mode === 'register' ? 'code' : 'register')}>{t(mode === 'register' ? 'ccwork.haveAccount' : 'ccwork.createAccount')}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </DialogContent>
  </Dialog>;
}
