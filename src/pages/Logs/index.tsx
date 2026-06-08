/**
 * Logs Page
 *
 * A clawpanel-style gateway log viewer. DeepClaw merges all app + gateway
 * output into one daily `deepclaw-{date}.log` where each line is prefixed with a
 * `[LEVEL]` token (gateway stderr lands at WARN). So the two tabs are level
 * filters over the same combined log:
 *   - 网关日志 (Gateway Logs)   = every line
 *   - 网关错误 (Gateway Errors) = WARN + ERROR lines (where gateway stderr lives)
 *
 * Search filters the already-loaded lines client-side with match highlighting.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Search, Copy, FileText, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';

type LogTab = 'gateway' | 'error';

const LINE_OPTIONS = [200, 500, 1000, 2000] as const;
const AUTO_REFRESH_MS = 3000;

/** Lines whose `[LEVEL]` token marks them as an error/warning. */
function isErrorLine(line: string): boolean {
  return line.includes('] [WARN') || line.includes('] [ERROR');
}

/** Pull the level token out of a `[ts] [LEVEL] msg` line for coloring. */
function lineTone(line: string): 'error' | 'warn' | 'debug' | 'info' {
  if (line.includes('] [ERROR')) return 'error';
  if (line.includes('] [WARN')) return 'warn';
  if (line.includes('] [DEBUG')) return 'debug';
  return 'info';
}

const TONE_CLASS: Record<ReturnType<typeof lineTone>, string> = {
  error: 'text-red-500 dark:text-red-400',
  warn: 'text-yellow-600 dark:text-yellow-400',
  debug: 'text-foreground/40',
  info: 'text-foreground/80',
};

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a line into segments around a (case-insensitive) query for highlight. */
function highlightSegments(line: string, query: string): Array<{ text: string; hit: boolean }> {
  if (!query) return [{ text: line, hit: false }];
  const re = new RegExp(`(${escapeRegExp(query)})`, 'ig');
  return line
    .split(re)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, hit: re.test(part) && part.toLowerCase() === query.toLowerCase() }));
}

export function Logs() {
  const { t } = useTranslation('logs');
  const [tab, setTab] = useState<LogTab>('gateway');
  const [search, setSearch] = useState('');
  const [tailLines, setTailLines] = useState<number>(500);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await hostApi.logs.recent(tailLines);
      const content = result?.content ?? '';
      const split = content.split('\n').filter((line) => line.trim().length > 0);
      setLines(split);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tailLines]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // Auto-refresh polling (tail).
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void loadLogs({ silent: true }), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, loadLogs]);

  const visibleLines = useMemo(() => {
    const byTab = tab === 'error' ? lines.filter(isErrorLine) : lines;
    if (!search.trim()) return byTab;
    const q = search.trim().toLowerCase();
    return byTab.filter((line) => line.toLowerCase().includes(q));
  }, [lines, tab, search]);

  // Auto-scroll to the bottom when content changes (newest lines are last).
  useEffect(() => {
    const el = contentRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleLines]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(visibleLines.join('\n'));
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }, [visibleLines, t]);

  const tabBtnClass = (active: boolean) =>
    cn(
      'h-9 px-4 rounded-full text-meta font-medium transition-colors',
      active
        ? 'bg-foreground text-background'
        : 'bg-transparent text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
    );

  return (
    <div data-testid="logs-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">
              {t('title')}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={() => void loadLogs()}
              className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
              {t('refresh')}
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4 shrink-0">
          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/5 p-1">
            <button
              data-testid="logs-tab-gateway"
              className={tabBtnClass(tab === 'gateway')}
              onClick={() => setTab('gateway')}
            >
              <FileText className="h-3.5 w-3.5 mr-1.5 inline" />
              {t('tabGateway')}
            </button>
            <button
              data-testid="logs-tab-error"
              className={tabBtnClass(tab === 'error')}
              onClick={() => setTab('error')}
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5 inline" />
              {t('tabError')}
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/40" />
            <Input
              data-testid="logs-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="h-9 pl-9 rounded-full bg-black/5 dark:bg-white/5 border-transparent"
            />
          </div>

          {/* Lines selector */}
          <select
            value={tailLines}
            onChange={(e) => setTailLines(Number(e.target.value))}
            className="h-9 rounded-full bg-black/5 dark:bg-white/5 border border-transparent px-3 text-meta text-foreground/80"
            aria-label={t('lines')}
          >
            {LINE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} {t('lines')}</option>
            ))}
          </select>

          {/* Auto-refresh toggle */}
          <Button
            variant="outline"
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn(
              'h-9 text-meta font-medium rounded-full px-4 shadow-none transition-colors',
              autoRefresh
                ? 'bg-foreground/10 text-foreground border-foreground/20'
                : 'bg-transparent text-foreground/80 hover:text-foreground border-black/10 dark:border-white/10',
            )}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-2', autoRefresh && 'animate-spin')} />
            {t('autoRefresh')}
          </Button>

          {/* Copy */}
          <Button
            variant="outline"
            onClick={() => void handleCopy()}
            disabled={visibleLines.length === 0}
            className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
          >
            <Copy className="h-3.5 w-3.5 mr-2" />
            {t('copy')}
          </Button>
        </div>

        {/* Count line */}
        <div className="text-meta text-foreground/50 mb-2 shrink-0">
          {visibleLines.length} {t('entries')}
          {search.trim() && ` · ${t('matched')}`}
        </div>

        {/* Log content */}
        <div
          ref={contentRef}
          data-testid="logs-content"
          className="flex-1 overflow-y-auto rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 p-4 font-mono text-xs leading-relaxed min-h-0"
        >
          {error ? (
            <div className="text-red-500 dark:text-red-400">{t('loadFailed')}: {error}</div>
          ) : loading ? (
            <div className="text-foreground/40">{t('loading')}</div>
          ) : visibleLines.length === 0 ? (
            <div className="text-foreground/40">{search.trim() ? t('noResults') : t('empty')}</div>
          ) : (
            visibleLines.map((line, idx) => (
              <div key={idx} className={cn('whitespace-pre-wrap break-all', TONE_CLASS[lineTone(line)])}>
                {highlightSegments(line, search.trim()).map((seg, i) =>
                  seg.hit ? (
                    <mark key={i} className="bg-yellow-300/60 dark:bg-yellow-500/40 text-foreground rounded-sm">
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  ),
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
