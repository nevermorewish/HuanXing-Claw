/**
 * Account Login Dialog
 *
 * Collects server URL + credentials, logs in via the main-process Account
 * session, then lets the user pick which fetched models to register as custom
 * provider accounts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LogIn, Loader2, Boxes, KeyRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAccountStore, DEFAULT_ACCOUNT_URL, type AccountToken } from '@/stores/account';
import { ACCOUNT_BRAND } from '@/lib/account-brand';
import { groupAccountModels, defaultSelectedModels, type ModelGroup } from '@/lib/account-models';
import { BRAND } from '@shared/brand';

interface AccountLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'credentials' | 'selectModels';

/**
 * Pick the token to pre-select: prefer one on the "default" group, else the
 * first enabled token, else the first token of any status.
 */
function pickDefaultToken(tokens: AccountToken[]): number | null {
  if (tokens.length === 0) return null;
  const onDefault = tokens.find((t) => t.group === 'default' && t.status === 1)
    ?? tokens.find((t) => t.group === 'default');
  if (onDefault) return onDefault.id;
  const enabled = tokens.find((t) => t.status === 1);
  return (enabled ?? tokens[0]).id;
}

export function AccountLoginDialog({ open, onOpenChange }: AccountLoginDialogProps) {
  const serverUrl = useAccountStore((s) => s.serverUrl);
  const lastUsername = useAccountStore((s) => s.lastUsername);
  const setServerUrl = useAccountStore((s) => s.setServerUrl);
  const savedCredentials = useAccountStore((s) => s.savedCredentials);
  const login = useAccountStore((s) => s.login);
  const listTokens = useAccountStore((s) => s.listTokens);
  const saveModels = useAccountStore((s) => s.saveModels);
  const loadModelConfig = useAccountStore((s) => s.loadModelConfig);

  const [step, setStep] = useState<Step>('credentials');
  const [url, setUrl] = useState(serverUrl || DEFAULT_ACCOUNT_URL);
  const [username, setUsername] = useState(lastUsername);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<AccountToken[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);

  // Track whether we've already initialised for the current open cycle, so the
  // reset only runs on the open→ transition. Without this guard, handleLogin's
  // setServerUrl()/login() mutate serverUrl/lastUsername in the store, which
  // would re-fire a [serverUrl, lastUsername]-keyed reset, bounce step back to
  // 'credentials', and wipe the user's model selection.
  const initialisedRef = useRef(false);

  // Reset to a clean state whenever the dialog is (re)opened — once per open.
  useEffect(() => {
    if (!open) {
      initialisedRef.current = false;
      return;
    }
    if (initialisedRef.current) return;
    initialisedRef.current = true;
    setStep('credentials');
    setUrl(serverUrl || DEFAULT_ACCOUNT_URL);
    setUsername(lastUsername);
    setPassword('');
    setError(null);
    setModels([]);
    setSelected(new Set());
    setTokens([]);
    setSelectedTokenId(null);
  }, [open, serverUrl, lastUsername]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    void savedCredentials()
      .then((credentials) => {
        if (cancelled || !credentials) {
          return;
        }
        setUrl((current) => current || credentials.baseUrl || DEFAULT_ACCOUNT_URL);
        setUsername((current) => current || credentials.username);
        setPassword((current) => current || credentials.password);
      })
      .catch(() => {
        // Keep the dialog usable when no stored credentials are available.
      });

    return () => {
      cancelled = true;
    };
  }, [open, savedCredentials]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      setServerUrl(url.trim() || DEFAULT_ACCOUNT_URL);
      const fetched = await login(username.trim(), password);
      // Pre-select the brand's recommended models (those the gateway actually
      // returned), plus any models already configured so re-login doesn't drop
      // them. We intentionally do NOT select every fetched model.
      const existing = await loadModelConfig().catch(() => null);
      const existingIds = new Set((existing?.models ?? []).map((m) => m.id));
      setModels(fetched);
      const initial = defaultSelectedModels(fetched, BRAND.recommendedModels ?? []);
      for (const id of fetched) {
        if (existingIds.has(id)) initial.add(id);
      }
      setSelected(initial);
      // Fetch the account's API tokens so the user can pick which one backs the
      // provider; default to a "default"-group token. Non-fatal on failure —
      // omitting a token id lets the backend auto-pick.
      const fetchedTokens = await listTokens().catch(() => []);
      setTokens(fetchedTokens);
      setSelectedTokenId(pickDefaultToken(fetchedTokens));
      if (fetched.length === 0) {
        toast.info('登录成功，但该账号暂无可用模型');
        onOpenChange(false);
        return;
      }
      setStep('selectModels');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleModel = (model: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  };

  const allSelected = models.length > 0 && selected.size === models.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(models));
  };

  // Group fetched models for display: a pinned "推荐" group on top, then the
  // rest grouped by model family. Recomputed only when the model list changes.
  const groups = useMemo<ModelGroup[]>(
    () => groupAccountModels(models, BRAND.recommendedModels ?? []),
    [models],
  );

  const toggleGroup = (group: ModelGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allInGroup = group.models.every((m) => next.has(m));
      for (const m of group.models) {
        if (allInGroup) next.delete(m);
        else next.add(m);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) {
      setError('请至少选择一个模型');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const count = await saveModels(
        Array.from(selected).map((id) => ({ id, name: id })),
        null,
        selectedTokenId,
      );
      toast.success(`已添加 ${count} 个 ${ACCOUNT_BRAND} 模型，可在「模型」页查看`);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`添加模型失败：${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] max-w-[90vw] p-6">
        {step === 'credentials' ? (
          <>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <LogIn size={18} /> 连接 {ACCOUNT_BRAND}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              登录到 {ACCOUNT_BRAND} API 服务，拉取可用模型并添加为可用的 Provider。
            </DialogDescription>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="hx-url">服务地址</Label>
                <Input
                  id="hx-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={DEFAULT_ACCOUNT_URL}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hx-username">用户名</Label>
                <Input
                  id="hx-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  disabled={submitting}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hx-password">密码</Label>
                <Input
                  id="hx-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !submitting) {
                      void handleLogin();
                    }
                  }}
                  placeholder="请输入密码"
                  disabled={submitting}
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                取消
              </Button>
              <Button onClick={handleLogin} disabled={submitting}>
                {submitting ? <Loader2 size={16} className="mr-1 animate-spin" /> : <LogIn size={16} className="mr-1" />}
                登录
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <Boxes size={18} /> 选择模型
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              选择要添加为 Provider 的模型，每个模型会作为一个可用账号。
            </DialogDescription>

            {tokens.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="hx-token" className="flex items-center gap-1.5">
                  <KeyRound size={14} /> API 令牌
                </Label>
                <select
                  id="hx-token"
                  value={selectedTokenId ?? ''}
                  onChange={(e) => setSelectedTokenId(e.target.value ? Number(e.target.value) : null)}
                  disabled={submitting}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tokens.map((token) => (
                    <option key={token.id} value={token.id}>
                      {token.name}
                      {token.group ? ` · ${token.group}` : ''}
                      {token.status !== 1 ? '（已禁用）' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  默认使用 default 分组令牌，所选令牌的密钥将用于已添加的模型。
                </p>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                共 {models.length} 个，已选 {selected.size} 个
              </span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={toggleAll}>
                {allSelected ? '全不选' : '全选'}
              </Button>
            </div>

            <div className="mt-2 max-h-64 space-y-3 overflow-auto rounded-md border border-border/60 p-2">
              {groups.map((group) => {
                const groupAllSelected = group.models.every((m) => selected.has(m));
                return (
                  <div key={group.key} className="space-y-1">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {group.label} · {group.models.length}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => toggleGroup(group)}
                      >
                        {groupAllSelected ? '全不选' : '全选'}
                      </button>
                    </div>
                    {group.models.map((model) => (
                      <label
                        key={model}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(model)}
                          onChange={() => toggleModel(model)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="truncate" title={model}>{model}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('credentials')} disabled={submitting}>
                返回
              </Button>
              <Button onClick={handleConfirm} disabled={submitting || selected.size === 0}>
                {submitting && <Loader2 size={16} className="mr-1 animate-spin" />}
                添加 {selected.size} 个模型
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
