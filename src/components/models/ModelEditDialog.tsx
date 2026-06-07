/**
 * Model add/edit dialog (generic, any provider).
 *
 * Collects a model's id / display name / context window / reasoning flag.
 * `model === null` means "add"; otherwise "edit".
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
import type { ModelProviderEntry } from '@/stores/modelProviders';

interface ModelEditDialogProps {
  open: boolean;
  /** null = add a new model. */
  model: ModelProviderEntry | null;
  existingModels: ModelProviderEntry[];
  onOpenChange: (open: boolean) => void;
  onSave: (model: ModelProviderEntry) => Promise<void>;
}

export function ModelEditDialog({
  open,
  model,
  existingModels,
  onOpenChange,
  onSave,
}: ModelEditDialogProps) {
  const isEdit = !!model;
  const [id, setId] = useState(model?.id ?? '');
  const [name, setName] = useState(model?.name ?? '');
  const [contextWindow, setContextWindow] = useState(
    model?.contextWindow != null ? String(model.contextWindow) : '',
  );
  const [reasoning, setReasoning] = useState(model?.reasoning ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmedId = id.trim();
    if (!trimmedId) {
      setError('请输入模型 ID');
      return;
    }
    if (existingModels.some((m) => m.id === trimmedId && m.id !== model?.id)) {
      setError('已存在同名模型 ID');
      return;
    }
    const entry: ModelProviderEntry = {
      id: trimmedId,
      name: name.trim() || trimmedId,
    };
    const ctx = Number(contextWindow);
    if (contextWindow.trim() && Number.isFinite(ctx) && ctx > 0) {
      entry.contextWindow = ctx;
    }
    if (reasoning) entry.reasoning = true;

    setSubmitting(true);
    setError(null);
    try {
      await onSave(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[400px] max-w-[90vw] p-6">
        <DialogTitle className="text-lg font-semibold">
          {isEdit ? '编辑模型' : '添加模型'}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          模型 ID 需与服务端一致，名称仅用于显示。
        </DialogDescription>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="model-id">模型 ID</Label>
            <Input
              id="model-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="如 deepseek-chat"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-name">显示名称</Label>
            <Input
              id="model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空则与 ID 相同"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-ctx">上下文长度（可选）</Label>
            <Input
              id="model-ctx"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="如 128000"
              disabled={submitting}
              inputMode="numeric"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reasoning}
              onChange={(e) => setReasoning(e.target.checked)}
              className="h-4 w-4 accent-primary"
              disabled={submitting}
            />
            推理模型
          </label>
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
