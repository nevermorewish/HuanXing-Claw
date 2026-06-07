/**
 * Add Provider dialog (clawpanel-style).
 *
 * Preset buttons auto-fill key/baseUrl/api; manual fields cover provider key,
 * base URL, API key, and api-type. On confirm, writes a new
 * `models.providers.<key>` entry with an empty model list.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { API_TYPES, PROVIDER_PRESETS, type ProviderPreset } from '@/lib/model-presets';
import { useModelProvidersStore } from '@/stores/modelProviders';

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingKeys: string[];
}

export function AddProviderDialog({ open, onOpenChange, existingKeys }: AddProviderDialogProps) {
  const saveProvider = useModelProvidersStore((s) => s.saveProvider);

  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [api, setApi] = useState(API_TYPES[0].value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (preset: ProviderPreset) => {
    setSelectedPreset(preset.key);
    setKey(preset.key);
    setBaseUrl(preset.baseUrl);
    setApi(preset.api);
  };

  const handleSubmit = async () => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError('请输入提供商标识');
      return;
    }
    if (existingKeys.includes(trimmedKey)) {
      setError('已存在同名提供商');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await saveProvider({
        key: trimmedKey,
        baseUrl: baseUrl.trim(),
        api,
        apiKey: apiKey.trim() || undefined,
        models: [],
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const activePreset = PROVIDER_PRESETS.find((p) => p.key === selectedPreset);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[460px] max-w-[92vw] max-h-[85vh] overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">添加 AI 提供商</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          选择预设快速填充，或手动填写。保存后可获取/添加模型。
        </DialogDescription>

        {/* Presets */}
        <div className="mt-4 space-y-1.5">
          <Label>快速选择</Label>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  selectedPreset === preset.key
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                {preset.label}
                {preset.badge && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">
                    {preset.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
          {activePreset?.desc && (
            <div className="mt-1 rounded-lg bg-black/5 dark:bg-white/5 px-3 py-2 text-xs text-muted-foreground">
              {activePreset.desc}
              {activePreset.site && (
                <a
                  href={activePreset.site}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-primary hover:underline"
                >
                  → 访问官网
                </a>
              )}
            </div>
          )}
        </div>

        {/* Fields */}
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="prov-key">提供商标识</Label>
            <Input
              id="prov-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="如 qtcool（唯一，用于 provider/model）"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-baseurl">服务地址 (Base URL)</Label>
            <Input
              id="prov-baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="如 https://api.example.com/v1"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-apikey">API 密钥</Label>
            <Input
              id="prov-apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              disabled={submitting}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-api">API 类型</Label>
            <select
              id="prov-api"
              value={api}
              onChange={(e) => setApi(e.target.value)}
              disabled={submitting}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {API_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 size={16} className="mr-1 animate-spin" />}
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
