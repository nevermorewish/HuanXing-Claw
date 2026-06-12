/**
 * Edit Provider dialog.
 *
 * Edits an existing provider's baseUrl / apiKey / api-type. Leaving the API key
 * blank preserves the existing inline key (the placeholder shows its mask).
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
import { API_TYPES } from '@/lib/model-presets';
import { useModelProvidersStore, type ModelProviderDTO } from '@/stores/modelProviders';

interface EditProviderDialogProps {
  open: boolean;
  provider: ModelProviderDTO;
  onOpenChange: (open: boolean) => void;
}

export function EditProviderDialog({ open, provider, onOpenChange }: EditProviderDialogProps) {
  const saveProvider = useModelProvidersStore((s) => s.saveProvider);

  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [api, setApi] = useState(provider.api || API_TYPES[0].value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await saveProvider({
        key: provider.key,
        baseUrl: baseUrl.trim(),
        api,
        // Blank → preserve existing inline key (handled main-side).
        apiKey: apiKey.trim() || undefined,
        models: provider.models,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const keyPlaceholder = provider.hasKey
    ? `留空保留现有密钥（${provider.maskedKey ?? '已设置'}）`
    : 'sk-...';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[440px] max-w-[92vw] p-6">
        <DialogTitle className="text-lg font-semibold">编辑提供商：{provider.key}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          修改服务地址、密钥与 API 类型。
        </DialogDescription>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-baseurl">服务地址 (Base URL)</Label>
            <Input
              id="edit-baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="如 https://api.example.com/v1"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-apikey">API 密钥</Label>
            <Input
              id="edit-apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyPlaceholder}
              disabled={submitting}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-api">API 类型</Label>
            <select
              id="edit-api"
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
