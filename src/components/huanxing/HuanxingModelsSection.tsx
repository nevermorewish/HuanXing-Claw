/**
 * Huanxing Models Section
 *
 * clawpanel-style model management for the single `huanxing` provider:
 * a provider header with the model count, then one row per model supporting
 * 测试 (test) / 设为主模型 (set primary) / 编辑 (edit) / 删除 (delete), plus
 * add-model. All writes flow through the huanxing store into
 * `~/.openclaw/openclaw.json` (`models.providers.huanxing` + the default model).
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Boxes, Check, Edit2, Loader2, Plus, Trash2, Zap, AlertTriangle } from 'lucide-react';
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
import {
  useHuanxingStore,
  type HuanxingModelEntry,
} from '@/stores/huanxing';

const HUANXING_PREFIX = 'huanxing/';

/** Per-model local test state (latency / failure), keyed by model id. */
interface TestState {
  status: 'ok' | 'fail';
  latencyMs?: number;
  error?: string;
}

export function HuanxingModelsSection() {
  const modelConfig = useHuanxingStore((s) => s.modelConfig);
  const loadModelConfig = useHuanxingStore((s) => s.loadModelConfig);
  const setPrimaryModel = useHuanxingStore((s) => s.setPrimaryModel);
  const deleteModel = useHuanxingStore((s) => s.deleteModel);
  const testModel = useHuanxingStore((s) => s.testModel);
  const saveModels = useHuanxingStore((s) => s.saveModels);

  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestState>>({});
  const [editTarget, setEditTarget] = useState<HuanxingModelEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void loadModelConfig();
  }, [loadModelConfig]);

  const models = modelConfig?.models ?? [];
  const primary = modelConfig?.primary ?? null;

  // Nothing configured yet — keep the section out of the way until the user
  // connects Huanxing and picks models.
  if (models.length === 0) {
    return null;
  }

  const handleSetPrimary = async (modelId: string) => {
    setBusyModelId(modelId);
    try {
      await setPrimaryModel(modelId);
      toast.success(`已将 ${modelId} 设为主模型`);
    } catch (error) {
      toast.error(`设置主模型失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyModelId(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    setBusyModelId(modelId);
    try {
      await deleteModel(modelId);
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
      toast.success(`已删除模型 ${modelId}`);
    } catch (error) {
      toast.error(`删除模型失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyModelId(null);
    }
  };

  const handleTest = async (modelId: string) => {
    setTesting((prev) => ({ ...prev, [modelId]: true }));
    try {
      const result = await testModel(modelId);
      if (result.ok) {
        setTestResults((prev) => ({
          ...prev,
          [modelId]: { status: 'ok', latencyMs: result.latencyMs },
        }));
        const secs = result.latencyMs != null ? (result.latencyMs / 1000).toFixed(1) : '?';
        toast.success(`${modelId} 可用（${secs}s）${result.reply ? `：${result.reply}` : ''}`);
      } else {
        setTestResults((prev) => ({
          ...prev,
          [modelId]: { status: 'fail', error: result.error },
        }));
        toast.error(`${modelId} 测试失败：${result.error || '未知错误'}`);
      }
    } finally {
      setTesting((prev) => ({ ...prev, [modelId]: false }));
    }
  };

  return (
    <div data-testid="huanxing-models-section">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl font-serif text-foreground font-normal tracking-tight">
          Huanxing 模型
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={15} className="mr-1.5" /> 添加模型
        </Button>
      </div>

      <div className="rounded-3xl border border-border/60 bg-black/5 dark:bg-white/5 p-5">
        {/* Provider header */}
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Boxes size={16} />
          <span className="font-medium text-foreground">Huanxing</span>
          <span>openai-completions · {models.length} 个模型</span>
        </div>

        {/* Model rows */}
        <div className="space-y-2">
          {models.map((model) => {
            const ref = `${HUANXING_PREFIX}${model.id}`;
            const isPrimary = ref === primary;
            const isBusy = busyModelId === model.id;
            const isTesting = testing[model.id];
            const test = testResults[model.id];
            return (
              <div
                key={model.id}
                data-testid={`huanxing-model-${model.id}`}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3',
                  isPrimary
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-border/50 bg-background/40',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm text-foreground" title={model.id}>
                      {model.id}
                    </span>
                    {isPrimary && (
                      <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-medium text-white">
                        主模型
                      </span>
                    )}
                    {model.reasoning && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
                        <Zap size={10} className="mr-0.5 inline" /> 推理
                      </span>
                    )}
                    {test?.status === 'ok' && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                        {test.latencyMs != null ? `${(test.latencyMs / 1000).toFixed(1)}s` : '可用'}
                      </span>
                    )}
                    {test?.status === 'fail' && (
                      <span
                        className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive"
                        title={test.error}
                      >
                        <AlertTriangle size={10} className="mr-0.5 inline" /> 不可用
                      </span>
                    )}
                  </div>
                  {model.name && model.name !== model.id && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{model.name}</div>
                  )}
                </div>

                <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3"
                    disabled={isTesting || isBusy}
                    onClick={() => handleTest(model.id)}
                  >
                    {isTesting ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                    测试
                  </Button>
                  {!isPrimary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3"
                      disabled={isBusy}
                      onClick={() => handleSetPrimary(model.id)}
                    >
                      <Check size={14} className="mr-1" /> 设为主模型
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3"
                    disabled={isBusy}
                    onClick={() => setEditTarget(model)}
                  >
                    <Edit2 size={14} className="mr-1" /> 编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3 text-destructive hover:text-destructive"
                    disabled={isBusy}
                    onClick={() => handleDelete(model.id)}
                  >
                    {isBusy ? (
                      <Loader2 size={14} className="mr-1 animate-spin" />
                    ) : (
                      <Trash2 size={14} className="mr-1" />
                    )}
                    删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editTarget && (
        <HuanxingModelEditDialog
          open={!!editTarget}
          model={editTarget}
          existingModels={models}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSave={async (next) => {
            const merged = models.map((m) => (m.id === editTarget.id ? next : m));
            // Preserve the primary selection: if the edited model was primary,
            // re-point primary at its (possibly new) id.
            const primaryId = primary === `${HUANXING_PREFIX}${editTarget.id}`
              ? next.id
              : undefined;
            await saveModels(merged, primaryId);
            setEditTarget(null);
            toast.success('已保存模型');
          }}
        />
      )}

      {addOpen && (
        <HuanxingModelEditDialog
          open={addOpen}
          model={null}
          existingModels={models}
          onOpenChange={setAddOpen}
          onSave={async (next) => {
            await saveModels([...models, next]);
            setAddOpen(false);
            toast.success(`已添加模型 ${next.id}`);
          }}
        />
      )}
    </div>
  );
}

interface HuanxingModelEditDialogProps {
  open: boolean;
  /** null = add a new model. */
  model: HuanxingModelEntry | null;
  existingModels: HuanxingModelEntry[];
  onOpenChange: (open: boolean) => void;
  onSave: (model: HuanxingModelEntry) => Promise<void>;
}

function HuanxingModelEditDialog({
  open,
  model,
  existingModels,
  onOpenChange,
  onSave,
}: HuanxingModelEditDialogProps) {
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
    // Block duplicate ids (except the model being edited).
    if (existingModels.some((m) => m.id === trimmedId && m.id !== model?.id)) {
      setError('已存在同名模型 ID');
      return;
    }
    const entry: HuanxingModelEntry = {
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
          模型 ID 需与 Huanxing 服务端一致，名称仅用于显示。
        </DialogDescription>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="hx-model-id">模型 ID</Label>
            <Input
              id="hx-model-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="如 deepseek-v4-flash"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hx-model-name">显示名称</Label>
            <Input
              id="hx-model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空则与 ID 相同"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hx-model-ctx">上下文长度（可选）</Label>
            <Input
              id="hx-model-ctx"
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
