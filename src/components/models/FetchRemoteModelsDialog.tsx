/**
 * Fetch Remote Models dialog.
 *
 * Calls the provider's `/models` endpoint, shows a searchable checkbox list of
 * model ids (those already added are disabled), and adds the selected ones.
 * When the endpoint doesn't support listing, shows a hint to add manually.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModelProvidersStore, type ModelProviderEntry } from '@/stores/modelProviders';

interface FetchRemoteModelsDialogProps {
  open: boolean;
  providerKey: string;
  existingModelIds: string[];
  onOpenChange: (open: boolean) => void;
}

export function FetchRemoteModelsDialog({
  open,
  providerKey,
  existingModelIds,
  onOpenChange,
}: FetchRemoteModelsDialogProps) {
  const fetchRemoteModels = useModelProvidersStore((s) => s.fetchRemoteModels);
  const addModels = useModelProvidersStore((s) => s.addModels);

  const [loading, setLoading] = useState(true);
  const [remote, setRemote] = useState<ModelProviderEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notSupported, setNotSupported] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const existing = useMemo(() => new Set(existingModelIds), [existingModelIds]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotSupported(false);
    setSelected(new Set());
    setSearch('');
    void fetchRemoteModels(providerKey)
      .then((result) => {
        if (cancelled) return;
        setRemote(result.models);
        // Pre-select everything not already added.
        setSelected(new Set(result.models.filter((m) => !existing.has(m.id)).map((m) => m.id)));
      })
      .catch((err: Error & { notSupported?: boolean }) => {
        if (cancelled) return;
        setError(err.message);
        setNotSupported(Boolean(err.notSupported));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, providerKey, fetchRemoteModels, existing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return remote;
    return remote.filter((m) => m.id.toLowerCase().includes(q));
  }, [remote, search]);

  const selectableIds = useMemo(
    () => remote.filter((m) => !existing.has(m.id)).map((m) => m.id),
    [remote, existing],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  const handleConfirm = async () => {
    const toAdd = remote.filter((m) => selected.has(m.id) && !existing.has(m.id));
    if (toAdd.length === 0) {
      setError('请至少选择一个模型');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await addModels(providerKey, toAdd);
      toast.success(`已添加 ${toAdd.length} 个模型`);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`添加失败：${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-[460px] max-w-[92vw] flex-col p-6">
        <DialogTitle className="text-lg font-semibold">获取模型列表：{providerKey}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          从服务端拉取可用模型，勾选后添加。
        </DialogDescription>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 size={18} className="mr-2 animate-spin" /> 加载中...
          </div>
        ) : notSupported ? (
          <div className="mt-4 rounded-lg bg-yellow-500/10 border border-yellow-500/40 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium text-yellow-700 dark:text-yellow-400">
              <AlertTriangle size={15} /> 该服务不支持自动获取模型列表
            </div>
            <p className="text-muted-foreground">请使用「添加模型」手动填写模型 ID。{error ? `（${error}）` : ''}</p>
          </div>
        ) : error ? (
          <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/40" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型..."
                  className="h-9 pl-9 rounded-full"
                />
              </div>
              <Button variant="ghost" size="sm" className="rounded-full" onClick={toggleAll}>
                {allSelected ? '全不选' : '全选'}
              </Button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              共 {remote.length} 个，已选 {selected.size} 个
            </div>
            <div className="mt-2 flex-1 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
              {filtered.map((m) => {
                const already = existing.has(m.id);
                return (
                  <label
                    key={m.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10',
                      already && 'opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={already || selected.has(m.id)}
                      disabled={already}
                      onChange={() => toggle(m.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="truncate font-mono" title={m.id}>{m.id}</span>
                    {already && <span className="ml-auto text-xs text-muted-foreground">已添加</span>}
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {notSupported || error ? '关闭' : '取消'}
          </Button>
          {!notSupported && !error && !loading && (
            <Button onClick={handleConfirm} disabled={submitting || selected.size === 0}>
              {submitting && <Loader2 size={16} className="mr-1 animate-spin" />}
              添加 {selected.size} 个
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
