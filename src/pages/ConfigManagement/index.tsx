/**
 * Config Management Page
 *
 * Ports clawpanel's "service management" config features to HuanXing-Claw:
 *   - Service status (start/stop/restart the gateway = the OpenClaw service)
 *   - OpenClaw config directory override (custom path)
 *   - Config file editor (openclaw.json) with live JSON validation
 *   - Config calibration (inherit / reset)
 *   - Config backups (list / create / restore / delete)
 *
 * Models the Logs page (src/pages/Logs) design language: serif title,
 * pill controls, full-height layout. Sections live behind internal tabs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, Play, Square, RotateCcw, FolderOpen, Save, Download,
  Trash2, ShieldCheck, Wrench, Server, Sliders, FileJson, Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { useGatewayStore } from '@/stores/gateway';
import type { ConfigBackupEntry, ConfigDirResult } from '@shared/host-api/contract';

type ConfigTab = 'service' | 'path' | 'editor' | 'calibrate' | 'backup';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(seconds: number): string {
  if (!seconds) return '-';
  return new Date(seconds * 1000).toLocaleString();
}

/** Parse JSON, returning an error message (or null when valid / empty). */
function jsonError(content: string): string | null {
  if (!content.trim()) return null;
  try {
    JSON.parse(content);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function ConfigManagement() {
  const { t } = useTranslation(['config', 'common']);
  const [tab, setTab] = useState<ConfigTab>('service');

  return (
    <div
      data-testid="config-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden"
    >
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        {/* Header */}
        <div className="mb-8 shrink-0">
          <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">
            {t('title')}
          </h1>
          <p className="text-subtitle text-foreground/70 font-medium">{t('subtitle')}</p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 rounded-full bg-black/5 dark:bg-white/5 p-1 mb-6 shrink-0 w-fit">
          <TabButton active={tab === 'service'} onClick={() => setTab('service')} icon={<Server className="h-3.5 w-3.5" />}>
            {t('tabs.service')}
          </TabButton>
          <TabButton active={tab === 'path'} onClick={() => setTab('path')} icon={<Sliders className="h-3.5 w-3.5" />}>
            {t('tabs.path')}
          </TabButton>
          <TabButton active={tab === 'editor'} onClick={() => setTab('editor')} icon={<FileJson className="h-3.5 w-3.5" />}>
            {t('tabs.editor')}
          </TabButton>
          <TabButton active={tab === 'calibrate'} onClick={() => setTab('calibrate')} icon={<Wrench className="h-3.5 w-3.5" />}>
            {t('tabs.calibrate')}
          </TabButton>
          <TabButton active={tab === 'backup'} onClick={() => setTab('backup')} icon={<Archive className="h-3.5 w-3.5" />}>
            {t('tabs.backup')}
          </TabButton>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto min-h-0 pb-6">
          {tab === 'service' && <ServiceSection />}
          {tab === 'path' && <ConfigPathSection />}
          {tab === 'editor' && <EditorSection />}
          {tab === 'calibrate' && <CalibrateSection />}
          {tab === 'backup' && <BackupSection />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-9 px-4 rounded-full text-meta font-medium transition-colors inline-flex items-center gap-1.5',
        active
          ? 'bg-foreground text-background'
          : 'bg-transparent text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 p-6 mb-4">
      <h2 className="text-lg font-medium text-foreground mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ── Service status ────────────────────────────────────────────────

function ServiceSection() {
  const { t } = useTranslation('config');
  const status = useGatewayStore((s) => s.status);
  const start = useGatewayStore((s) => s.start);
  const stop = useGatewayStore((s) => s.stop);
  const restart = useGatewayStore((s) => s.restart);
  const [busy, setBusy] = useState<null | 'start' | 'stop' | 'restart'>(null);

  const stateLabel = useMemo(() => {
    switch (status.state) {
      case 'running': return t('service.running');
      case 'starting': return t('service.starting');
      case 'reconnecting': return t('service.restarting');
      case 'stopped': return t('service.stopped');
      default: return t('service.unknown');
    }
  }, [status.state, t]);

  const isRunning = status.state === 'running';
  const dotClass = isRunning
    ? 'bg-green-500'
    : status.state === 'starting' || status.state === 'reconnecting'
      ? 'bg-yellow-500 animate-pulse'
      : status.state === 'error'
        ? 'bg-red-500'
        : 'bg-foreground/30';

  const runAction = useCallback(
    async (action: 'start' | 'stop' | 'restart', fn: () => Promise<void>) => {
      setBusy(action);
      try {
        await fn();
      } catch (err) {
        toast.error(`${t('service.actionFailed')}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  return (
    <SectionCard title={t('service.title')}>
      <div className="flex items-center gap-3 mb-5">
        <span className={cn('h-2.5 w-2.5 rounded-full', dotClass)} />
        <span className="text-foreground font-medium">{stateLabel}</span>
        {status.pid ? (
          <span className="text-meta text-foreground/50">{t('service.pid')}: {status.pid}</span>
        ) : null}
        {status.port ? (
          <span className="text-meta text-foreground/50">{t('service.port')}: {status.port}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={isRunning || busy !== null}
          onClick={() => void runAction('start', start)}
          className="h-9 rounded-full px-4 text-meta font-medium"
        >
          <Play className={cn('h-3.5 w-3.5 mr-2', busy === 'start' && 'animate-pulse')} />
          {busy === 'start' ? t('service.starting_') : t('service.start')}
        </Button>
        <Button
          variant="outline"
          disabled={!isRunning || busy !== null}
          onClick={() => void runAction('stop', stop)}
          className="h-9 rounded-full px-4 text-meta font-medium"
        >
          <Square className={cn('h-3.5 w-3.5 mr-2', busy === 'stop' && 'animate-pulse')} />
          {busy === 'stop' ? t('service.stopping_') : t('service.stop')}
        </Button>
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => void runAction('restart', restart)}
          className="h-9 rounded-full px-4 text-meta font-medium"
        >
          <RotateCcw className={cn('h-3.5 w-3.5 mr-2', busy === 'restart' && 'animate-spin')} />
          {busy === 'restart' ? t('service.restarting_') : t('service.restart')}
        </Button>
      </div>
    </SectionCard>
  );
}

// ── Config path ───────────────────────────────────────────────────

function ConfigPathSection() {
  const { t } = useTranslation('config');
  const [info, setInfo] = useState<ConfigDirResult | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await hostApi.config.getConfigDir();
      setInfo(result);
      setValue(result.isCustom ? result.dir : '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const browse = useCallback(async () => {
    const result = await hostApi.dialog.open({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: info?.dir,
    });
    if (!result.canceled && result.filePaths[0]) {
      setValue(result.filePaths[0]);
    }
  }, [info?.dir]);

  const save = useCallback(async (dir: string) => {
    setSaving(true);
    try {
      const res = await hostApi.config.setConfigDir(dir);
      if (res.success) {
        toast.success(t('path.saved'));
        await load();
      } else {
        toast.error(res.error ? `${t('path.saveFailed')}: ${res.error}` : t('path.saveFailed'));
      }
    } catch (err) {
      toast.error(`${t('path.saveFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [load, t]);

  return (
    <SectionCard title={t('path.title')}>
      <p className="text-meta text-foreground/60 mb-4">{t('path.description')}</p>
      <div className="text-meta text-foreground/70 mb-4 space-y-1">
        <div>
          {t('path.current')}: <span className="font-mono text-foreground/90">{info?.dir ?? '-'}</span>
          {info && (
            <span className="ml-2 rounded-full bg-black/[0.06] dark:bg-white/[0.08] px-2 py-0.5 text-2xs">
              {info.isCustom ? t('path.custom') : t('path.default')}
            </span>
          )}
        </div>
        <div className="text-foreground/40">
          {t('path.default')}: <span className="font-mono">{info?.defaultDir ?? '-'}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('path.placeholder')}
          className="h-9 flex-1 min-w-[220px] rounded-full bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
        />
        <Button variant="outline" onClick={() => void browse()} className="h-9 rounded-full px-4 text-meta font-medium">
          <FolderOpen className="h-3.5 w-3.5 mr-2" />
          {t('path.browse')}
        </Button>
        <Button disabled={saving} onClick={() => void save(value)} className="h-9 rounded-full px-4 text-meta font-medium">
          <Save className="h-3.5 w-3.5 mr-2" />
          {t('path.save')}
        </Button>
        <Button
          variant="outline"
          disabled={saving || !info?.isCustom}
          onClick={() => { setValue(''); void save(''); }}
          className="h-9 rounded-full px-4 text-meta font-medium"
        >
          {t('path.resetDefault')}
        </Button>
      </div>
    </SectionCard>
  );
}

// ── Config editor ─────────────────────────────────────────────────

function EditorSection() {
  const { t } = useTranslation('config');
  const restart = useGatewayStore((s) => s.restart);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.config.read();
      setContent(result.content);
      setOriginal(result.content);
      setExists(result.exists);
    } catch (err) {
      toast.error(`${t('editor.loadFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const error = useMemo(() => jsonError(content), [content]);
  const dirty = content !== original;

  const save = useCallback(async (thenRestart: boolean) => {
    if (error) {
      toast.error(t('editor.jsonError'));
      return;
    }
    setSaving(true);
    try {
      const res = await hostApi.config.write(content);
      if (!res.success) {
        toast.error(res.error ? `${t('editor.saveFailed')}: ${res.error}` : t('editor.saveFailed'));
        return;
      }
      setOriginal(content);
      setExists(true);
      if (thenRestart) {
        toast.success(t('editor.savedRestart'));
        try { await restart(); } catch { /* surfaced elsewhere */ }
      } else {
        toast.success(t('editor.saved'));
      }
    } catch (err) {
      toast.error(`${t('editor.saveFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [content, error, restart, t]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 mb-3 shrink-0">
        <span className="text-meta text-foreground/60">
          {loading ? t('editor.loaded') + '...' : exists ? t('editor.loaded') : t('editor.notFound')}
        </span>
        {dirty && <span className="text-meta text-yellow-600 dark:text-yellow-400">{t('editor.unsaved')}</span>}
        <span className={cn('text-meta', error ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
          {error ? t('editor.jsonError') : t('editor.jsonValid')}
        </span>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => void load()} className="h-9 rounded-full px-4 text-meta font-medium">
          <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
          {t('editor.reload')}
        </Button>
        <Button disabled={saving || !!error || !dirty} onClick={() => void save(false)} className="h-9 rounded-full px-4 text-meta font-medium">
          <Save className="h-3.5 w-3.5 mr-2" />
          {t('editor.save')}
        </Button>
        <Button variant="outline" disabled={saving || !!error} onClick={() => void save(true)} className="h-9 rounded-full px-4 text-meta font-medium">
          <RotateCcw className="h-3.5 w-3.5 mr-2" />
          {t('editor.saveAndRestart')}
        </Button>
      </div>
      {error && (
        <div className="text-meta text-red-500 dark:text-red-400 mb-2 font-mono shrink-0">{error}</div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        placeholder={t('editor.placeholder')}
        className="flex-1 min-h-[300px] w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 p-4 font-mono text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
    </div>
  );
}

// ── Calibration (+ validate) ──────────────────────────────────────

function CalibrateSection() {
  const { t } = useTranslation('config');
  const [running, setRunning] = useState<null | 'inherit' | 'reset' | 'validate'>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [result, setResult] = useState<{
    mode: string; source: string; backup: string | null; inheritedKeys: string[]; warnings: string[]; message: string;
  } | null>(null);
  const [validation, setValidation] = useState<{
    valid: boolean; error?: string; warnings: string[]; uiFields: string[];
  } | null>(null);

  const runValidate = useCallback(async () => {
    setRunning('validate');
    try {
      const res = await hostApi.config.validate();
      setValidation(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  }, []);

  const runCalibrate = useCallback(async (mode: 'inherit' | 'reset') => {
    setRunning(mode);
    try {
      const res = await hostApi.config.calibrate(mode);
      setResult(res);
      if (res.success) toast.success(t('calibrate.done'));
      else toast.error(res.message || t('calibrate.failed'));
    } catch (err) {
      toast.error(`${t('calibrate.failed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(null);
    }
  }, [t]);

  return (
    <>
      {/* Validate */}
      <SectionCard title={t('validate.title')}>
        <Button variant="outline" disabled={running !== null} onClick={() => void runValidate()} className="h-9 rounded-full px-4 text-meta font-medium">
          <ShieldCheck className="h-3.5 w-3.5 mr-2" />
          {t('validate.run')}
        </Button>
        {validation && (
          <div className="mt-4 text-meta space-y-2">
            <div className={validation.valid ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
              {validation.valid ? t('validate.valid') : `${t('validate.invalid')}${validation.error ? `: ${validation.error}` : ''}`}
            </div>
            {validation.uiFields.length > 0 && (
              <div>
                <div className="text-foreground/60 mb-1">{t('validate.uiFieldsTitle')}</div>
                <ul className="font-mono text-foreground/80 list-disc list-inside">
                  {validation.uiFields.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
            )}
            {validation.warnings.length > 0 && (
              <div>
                <div className="text-foreground/60 mb-1">{t('validate.warningsTitle')}</div>
                <ul className="text-yellow-600 dark:text-yellow-400 list-disc list-inside">
                  {validation.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}
            {validation.valid && validation.uiFields.length === 0 && validation.warnings.length === 0 && (
              <div className="text-foreground/50">{t('validate.noIssues')}</div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Calibrate */}
      <SectionCard title={t('calibrate.title')}>
        <p className="text-meta text-foreground/60 mb-4">{t('calibrate.description')}</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <div className="rounded-xl border border-black/5 dark:border-white/5 p-4">
            <div className="font-medium text-foreground mb-1">{t('calibrate.inherit')}</div>
            <div className="text-meta text-foreground/60 mb-3">{t('calibrate.inheritDesc')}</div>
            <Button disabled={running !== null} onClick={() => void runCalibrate('inherit')} className="h-9 rounded-full px-4 text-meta font-medium w-full">
              <Wrench className={cn('h-3.5 w-3.5 mr-2', running === 'inherit' && 'animate-pulse')} />
              {running === 'inherit' ? t('calibrate.running') : t('calibrate.inheritBtn')}
            </Button>
          </div>
          <div className="rounded-xl border border-black/5 dark:border-white/5 p-4">
            <div className="font-medium text-foreground mb-1">{t('calibrate.reset')}</div>
            <div className="text-meta text-foreground/60 mb-3">{t('calibrate.resetDesc')}</div>
            <Button variant="outline" disabled={running !== null} onClick={() => setConfirmReset(true)} className="h-9 rounded-full px-4 text-meta font-medium w-full">
              <RotateCcw className={cn('h-3.5 w-3.5 mr-2', running === 'reset' && 'animate-spin')} />
              {running === 'reset' ? t('calibrate.running') : t('calibrate.resetBtn')}
            </Button>
          </div>
        </div>
        {result && (
          <div className="text-meta space-y-1 border-t border-black/5 dark:border-white/5 pt-4">
            <div className="text-foreground/90">{result.message}</div>
            <div className="text-foreground/60">{t('calibrate.source')}: <span className="font-mono">{result.source}</span></div>
            {result.backup && <div className="text-foreground/60">{t('calibrate.backup')}: <span className="font-mono">{result.backup}</span></div>}
            {result.inheritedKeys.length > 0 && (
              <div className="text-foreground/60">{t('calibrate.inheritedKeys')}: <span className="font-mono">{result.inheritedKeys.join(', ')}</span></div>
            )}
            {result.warnings.length > 0 && (
              <ul className="text-yellow-600 dark:text-yellow-400 list-disc list-inside">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={confirmReset}
        title={t('calibrate.reset')}
        message={t('calibrate.confirmReset')}
        confirmLabel={t('calibrate.resetBtn')}
        cancelLabel={t('actions.cancel')}
        variant="destructive"
        onConfirm={async () => { setConfirmReset(false); await runCalibrate('reset'); }}
        onCancel={() => setConfirmReset(false)}
      />
    </>
  );
}

// ── Backups ───────────────────────────────────────────────────────

function BackupSection() {
  const { t } = useTranslation('config');
  const [backups, setBackups] = useState<ConfigBackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hostApi.config.listBackups();
      setBackups(res.backups);
    } catch (err) {
      toast.error(`${t('backup.loadFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    setCreating(true);
    try {
      const res = await hostApi.config.createBackup();
      if (res.success) {
        toast.success(t('backup.created', { name: res.name ?? '' }));
        await load();
      } else {
        toast.error(res.error ? `${t('backup.createFailed')}: ${res.error}` : t('backup.createFailed'));
      }
    } catch (err) {
      toast.error(`${t('backup.createFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreating(false);
    }
  }, [load, t]);

  const restore = useCallback(async (name: string) => {
    try {
      const res = await hostApi.config.restoreBackup(name);
      if (res.success) {
        toast.success(t('backup.restored'));
        await load();
      } else {
        toast.error(res.error ? `${t('backup.restoreFailed')}: ${res.error}` : t('backup.restoreFailed'));
      }
    } catch (err) {
      toast.error(`${t('backup.restoreFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [load, t]);

  const remove = useCallback(async (name: string) => {
    try {
      const res = await hostApi.config.deleteBackup(name);
      if (res.success) {
        toast.success(t('backup.deleted'));
        await load();
      } else {
        toast.error(res.error ? `${t('backup.deleteFailed')}: ${res.error}` : t('backup.deleteFailed'));
      }
    } catch (err) {
      toast.error(`${t('backup.deleteFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [load, t]);

  return (
    <SectionCard title={t('backup.title')}>
      <div className="flex items-center gap-3 mb-4">
        <Button disabled={creating} onClick={() => void create()} className="h-9 rounded-full px-4 text-meta font-medium">
          <Download className={cn('h-3.5 w-3.5 mr-2', creating && 'animate-pulse')} />
          {creating ? t('backup.creating') : t('backup.create')}
        </Button>
        <Button variant="outline" onClick={() => void load()} className="h-9 rounded-full px-4 text-meta font-medium">
          <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
          {t('actions.refresh')}
        </Button>
      </div>

      {backups.length === 0 ? (
        <div className="text-meta text-foreground/40 py-6 text-center">{t('backup.empty')}</div>
      ) : (
        <div className="space-y-2">
          {backups.map((b) => (
            <div
              key={b.name}
              className="flex items-center gap-3 rounded-xl border border-black/5 dark:border-white/5 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-meta text-foreground truncate">{b.name}</div>
                <div className="text-2xs text-foreground/50">
                  {formatBytes(b.size)} · {formatTimestamp(b.createdAt)}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setRestoreTarget(b.name)}
                className="h-8 rounded-full px-3 text-meta font-medium"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                {t('backup.restore')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(b.name)}
                className="h-8 rounded-full px-3 text-meta font-medium text-red-500 hover:text-red-600 dark:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {t('backup.delete')}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={restoreTarget !== null}
        title={t('backup.restore')}
        message={t('backup.confirmRestore', { name: restoreTarget ?? '' })}
        confirmLabel={t('backup.restore')}
        cancelLabel={t('actions.cancel')}
        onConfirm={async () => {
          const name = restoreTarget;
          setRestoreTarget(null);
          if (name) await restore(name);
        }}
        onCancel={() => setRestoreTarget(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('backup.delete')}
        message={t('backup.confirmDelete', { name: deleteTarget ?? '' })}
        confirmLabel={t('backup.delete')}
        cancelLabel={t('actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          const name = deleteTarget;
          setDeleteTarget(null);
          if (name) await remove(name);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </SectionCard>
  );
}
