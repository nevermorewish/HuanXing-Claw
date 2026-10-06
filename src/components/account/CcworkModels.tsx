import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AccountLoginDialog } from './AccountLoginDialog';
import { useAccountStore } from '@/stores/account';
import { BRAND } from '@shared/brand';

export function CcworkModels() {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const config = useAccountStore((s) => s.modelConfig);
  const loggedIn = useAccountStore((s) => s.loggedIn);
  const load = useAccountStore((s) => s.loadModelConfig);
  useEffect(() => { void load(); }, [load, loggedIn, open]);
  return <section data-testid="ccwork-models" className="mb-8 space-y-3">
    <div className="flex items-center justify-between"><h2 className="font-serif text-2xl font-normal tracking-tight">{t('ccwork.selectModels')}</h2><Button onClick={() => setOpen(true)}>{t(loggedIn ? 'ccwork.selectModels' : 'ccwork.login')}</Button></div>
    <p className="text-sm text-muted-foreground">{t('ccwork.modelsDescription')}</p>
    {!config?.models.length && <p className="text-muted-foreground">{t('ccwork.noModels')}</p>}
    {config?.models.map((model) => <div key={model.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-input p-3"><span>{model.name}</span><Button variant="outline" disabled={!loggedIn || config.primary === `${BRAND.providerKey}/${model.id}`} onClick={() => { void useAccountStore.getState().setPrimaryModel(model.id).catch((err) => setError(String(err))); }}>{t('ccwork.useModel')}</Button></div>)}
    {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
    <AccountLoginDialog open={open} onOpenChange={setOpen} />
  </section>;
}
