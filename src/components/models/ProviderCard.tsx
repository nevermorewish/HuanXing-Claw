/**
 * Provider card — one provider with its header (name · api · N models),
 * 4 header buttons (编辑 / 添加模型 / 获取列表 / 删除), and nested model rows
 * each with 测试 / 设为主模型 / 编辑 / 删除.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Boxes, Check, Edit2, Loader2, Plus, Trash2, Zap, AlertTriangle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { getApiTypeLabel } from '@/lib/model-presets';
import { useModelProvidersStore, type ModelProviderDTO, type ModelProviderEntry } from '@/stores/modelProviders';
import { ModelEditDialog } from './ModelEditDialog';
import { EditProviderDialog } from './EditProviderDialog';
import { FetchRemoteModelsDialog } from './FetchRemoteModelsDialog';

/** Per-model local test state (latency / failure), keyed by model id. */
interface TestState {
  status: 'ok' | 'fail';
  latencyMs?: number;
  error?: string;
}

export function ProviderCard({ provider }: { provider: ModelProviderDTO }) {
  const setPrimary = useModelProvidersStore((s) => s.setPrimary);
  const deleteModel = useModelProvidersStore((s) => s.deleteModel);
  const deleteProvider = useModelProvidersStore((s) => s.deleteProvider);
  const testModel = useModelProvidersStore((s) => s.testModel);
  const addModels = useModelProvidersStore((s) => s.addModels);
  const editModel = useModelProvidersStore((s) => s.editModel);

  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestState>>({});
  const [editTarget, setEditTarget] = useState<ModelProviderEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editProviderOpen, setEditProviderOpen] = useState(false);
  const [fetchOpen, setFetchOpen] = useState(false);
  const [confirmDeleteProvider, setConfirmDeleteProvider] = useState(false);

  const { key, models, primary, api } = provider;

  const handleSetPrimary = async (modelId: string) => {
    setBusyModelId(modelId);
    try {
      await setPrimary(`${key}/${modelId}`);
      toast.success(`已将 ${modelId} 设为主模型`);
    } catch (error) {
      toast.error(`设置主模型失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyModelId(null);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    setBusyModelId(modelId);
    try {
      await deleteModel(key, modelId);
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
      const result = await testModel(key, modelId);
      if (result.ok) {
        setTestResults((prev) => ({ ...prev, [modelId]: { status: 'ok', latencyMs: result.latencyMs } }));
        const secs = result.latencyMs != null ? (result.latencyMs / 1000).toFixed(1) : '?';
        toast.success(`${modelId} 可用（${secs}s）${result.reply ? `：${result.reply}` : ''}`);
      } else {
        setTestResults((prev) => ({ ...prev, [modelId]: { status: 'fail', error: result.error } }));
        toast.error(`${modelId} 测试失败：${result.error || '未知错误'}`);
      }
    } finally {
      setTesting((prev) => ({ ...prev, [modelId]: false }));
    }
  };

  const handleDeleteProvider = async () => {
    try {
      await deleteProvider(key);
      toast.success(`已删除提供商 ${key}`);
    } catch (error) {
      toast.error(`删除提供商失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="rounded-3xl border border-border/60 bg-black/5 dark:bg-white/5 p-5">
      {/* Provider header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
          <Boxes size={16} className="shrink-0" />
          <span className="font-medium text-foreground truncate" title={key}>{key}</span>
          <span className="shrink-0">{getApiTypeLabel(api)} · {models.length} 个模型</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-8 rounded-full px-3" onClick={() => setEditProviderOpen(true)}>
            <Edit2 size={14} className="mr-1" /> 编辑
          </Button>
          <Button variant="ghost" size="sm" className="h-8 rounded-full px-3" onClick={() => setAddOpen(true)}>
            <Plus size={14} className="mr-1" /> 添加模型
          </Button>
          <Button
            size="sm"
            className="h-9 rounded-full px-4 bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/25"
            onClick={() => setFetchOpen(true)}
          >
            <Download size={15} className="mr-1.5" /> 获取列表
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-destructive hover:text-destructive"
            onClick={() => setConfirmDeleteProvider(true)}
          >
            <Trash2 size={14} className="mr-1" /> 删除
          </Button>
        </div>
      </div>

      {/* Model rows */}
      {models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 px-4 py-6 text-center text-sm text-muted-foreground">
          暂无模型，点击「获取列表」或「添加模型」
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((model) => {
            const ref = `${key}/${model.id}`;
            const isPrimary = ref === primary;
            const isBusy = busyModelId === model.id;
            const isTesting = testing[model.id];
            const test = testResults[model.id];
            return (
              <div
                key={model.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3',
                  isPrimary ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border/50 bg-background/40',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm text-foreground" title={model.id}>{model.id}</span>
                    {isPrimary && (
                      <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-medium text-white">主模型</span>
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
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive" title={test.error}>
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
                    onClick={() => handleDeleteModel(model.id)}
                  >
                    {isBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Trash2 size={14} className="mr-1" />}
                    删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editTarget && (
        <ModelEditDialog
          open={!!editTarget}
          model={editTarget}
          existingModels={models}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSave={async (next) => {
            await editModel(key, editTarget.id, next);
            setEditTarget(null);
            toast.success('已保存模型');
          }}
        />
      )}

      {addOpen && (
        <ModelEditDialog
          open={addOpen}
          model={null}
          existingModels={models}
          onOpenChange={setAddOpen}
          onSave={async (next) => {
            await addModels(key, [next]);
            setAddOpen(false);
            toast.success(`已添加模型 ${next.id}`);
          }}
        />
      )}

      {editProviderOpen && (
        <EditProviderDialog open={editProviderOpen} provider={provider} onOpenChange={setEditProviderOpen} />
      )}

      {fetchOpen && (
        <FetchRemoteModelsDialog
          open={fetchOpen}
          providerKey={key}
          existingModelIds={models.map((m) => m.id)}
          onOpenChange={setFetchOpen}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteProvider}
        title={`删除提供商 ${key}？`}
        message="将从配置中移除该提供商及其所有模型。"
        confirmLabel="删除"
        variant="destructive"
        onConfirm={async () => {
          await handleDeleteProvider();
          setConfirmDeleteProvider(false);
        }}
        onCancel={() => setConfirmDeleteProvider(false)}
      />
    </div>
  );
}
