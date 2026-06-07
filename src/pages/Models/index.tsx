import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersModelConfig } from '@/components/models/ProvidersModelConfig';

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  return (
    <div data-testid="models-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1 data-testid="models-page-title" className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">
              {t('dashboard:models.title')}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">
              {t('dashboard:models.subtitle')}
            </p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {/* AI Providers Section (clawpanel-style, all providers) */}
          <ProvidersModelConfig />
        </div>
      </div>
    </div>
  );
}

export default Models;
