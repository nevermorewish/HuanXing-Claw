/**
 * Huanxing Login Dialog
 *
 * Collects server URL + credentials, logs in via the main-process Huanxing
 * session, then lets the user pick which fetched models to register as custom
 * provider accounts.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LogIn, Loader2, Boxes } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHuanxingStore, DEFAULT_HUANXING_URL } from '@/stores/huanxing';

interface HuanxingLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'credentials' | 'selectModels';

export function HuanxingLoginDialog({ open, onOpenChange }: HuanxingLoginDialogProps) {
  const serverUrl = useHuanxingStore((s) => s.serverUrl);
  const lastUsername = useHuanxingStore((s) => s.lastUsername);
  const setServerUrl = useHuanxingStore((s) => s.setServerUrl);
  const savedCredentials = useHuanxingStore((s) => s.savedCredentials);
  const login = useHuanxingStore((s) => s.login);
  const createAccounts = useHuanxingStore((s) => s.createAccounts);

  const [step, setStep] = useState<Step>('credentials');
  const [url, setUrl] = useState(serverUrl || DEFAULT_HUANXING_URL);
  const [username, setUsername] = useState(lastUsername);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset to a clean state whenever the dialog is opened.
  useEffect(() => {
    if (open) {
      setStep('credentials');
      setUrl(serverUrl || DEFAULT_HUANXING_URL);
      setUsername(lastUsername);
      setPassword('');
      setError(null);
      setModels([]);
      setSelected(new Set());
    }
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
        setUrl((current) => current || credentials.baseUrl || DEFAULT_HUANXING_URL);
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
      setServerUrl(url.trim() || DEFAULT_HUANXING_URL);
      const fetched = await login(username.trim(), password);
      setModels(fetched);
      setSelected(new Set(fetched));
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

  const handleConfirm = async () => {
    if (selected.size === 0) {
      setError('请至少选择一个模型');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const count = await createAccounts(Array.from(selected));
      toast.success(`已添加 ${count} 个 Huanxing 模型，可在「模型」页查看`);
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
              <LogIn size={18} /> 连接 Huanxing
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              登录到 Huanxing API 服务，拉取可用模型并添加为可用的 Provider。
            </DialogDescription>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="hx-url">服务地址</Label>
                <Input
                  id="hx-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={DEFAULT_HUANXING_URL}
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

            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                共 {models.length} 个，已选 {selected.size} 个
              </span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={toggleAll}>
                {allSelected ? '全不选' : '全选'}
              </Button>
            </div>

            <div className="mt-2 max-h-64 space-y-1 overflow-auto rounded-md border border-border/60 p-2">
              {models.map((model) => (
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
