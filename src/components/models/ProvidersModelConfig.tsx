/**
 * Providers Model Config — the clawpanel-style provider list.
 *
 * Reads every provider from openclaw.json (via the modelProviders store) and
 * renders one ProviderCard each, plus an "添加 AI 提供商" button. This replaces
 * the old account-based ProvidersSettings + single HuanxingModelsSection.
 */
import { useEffect, useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModelProvidersStore } from '@/stores/modelProviders';
import { useGatewayStore } from '@/stores/gateway';
import { ProviderCard } from './ProviderCard';
import { AddProviderDialog } from './AddProviderDialog';

export function ProvidersModelConfig() {
  const providers = useModelProvidersStore((s) => s.providers);
  const loading = useModelProvidersStore((s) => s.loading);
  const load = useModelProvidersStore((s) => s.load);
  const gatewayState = useGatewayStore((s) => s.status.state);

  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // Reload once the gateway comes up, in case config changed out-of-band.
  useEffect(() => {
    if (gatewayState === 'running') void load();
  }, [gatewayState, load]);

  return (
    <div data-testid="providers-model-config">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl font-serif text-foreground font-normal tracking-tight">
          AI 提供商
        </h2>
        <Button
          variant="default"
          className="rounded-full h-11 px-6 text-base font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/25"
          onClick={() => setAddOpen(true)}
          data-testid="add-provider-button"
        >
          <Plus size={18} className="mr-2" /> 添加 AI 提供商
        </Button>
      </div>

      {loading && providers.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={18} className="mr-2 animate-spin" /> 加载中...
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/60 px-6 py-12 text-center text-muted-foreground">
          还没有配置任何提供商。点击「添加 AI 提供商」开始。
        </div>
      ) : (
        <div className="space-y-6">
          {providers.map((provider) => (
            <ProviderCard key={provider.key} provider={provider} />
          ))}
        </div>
      )}

      {addOpen && (
        <AddProviderDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          existingKeys={providers.map((p) => p.key)}
        />
      )}
    </div>
  );
}
