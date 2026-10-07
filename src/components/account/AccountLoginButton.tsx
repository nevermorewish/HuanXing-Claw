/**
 * Account Login Button / Account Panel
 *
 * Sidebar footer entry point (below Settings).
 *   - Logged out: a "登录" nav item that opens the login dialog.
 *   - Logged in: an account panel showing the username, balance, and
 *     充值 (recharge) / 登出 (logout) actions.
 * Collapses to a single icon when the sidebar is collapsed (click → dialog).
 * Main restores encrypted JWT sessions; passwords are never prefilled.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogIn, CheckCircle2, Wallet, LogOut, RefreshCw, Settings, ReceiptText, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccountStore } from '@/stores/account';
import { AccountLoginDialog } from './AccountLoginDialog';
import { RechargeDialog } from './RechargeDialog';

interface AccountLoginButtonProps {
  collapsed?: boolean;
}

/** ccwork credits retain six decimal places. */
function formatBalance(balance: {
  quota: number;
  quotaPerUnit: number;
  displayInCurrency: boolean;
}): string {
  if (balance.displayInCurrency && balance.quotaPerUnit > 0) {
    return `$${(balance.quota / balance.quotaPerUnit).toFixed(2)}`;
  }
  return balance.quota.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function AccountLoginButton({ collapsed = false }: AccountLoginButtonProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  useEffect(() => { void useAccountStore.getState().restore().catch(() => {}); }, []);
  const loggedIn = useAccountStore((s) => s.loggedIn);
  const user = useAccountStore((s) => s.user);
  const balance = useAccountStore((s) => s.balance);
  const fetchBalance = useAccountStore((s) => s.fetchBalance);
  const logout = useAccountStore((s) => s.logout);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  // Refresh the balance whenever the panel becomes logged-in.
  useEffect(() => {
    if (loggedIn && !balance) {
      void fetchBalance();
    }
  }, [loggedIn, balance, fetchBalance]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchBalance();
    } finally {
      setRefreshing(false);
    }
  };

  // ── Logged out ──────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <>
        <button
          type="button"
          data-testid="sidebar-account-login"
          onClick={() => setOpen(true)}
          title={t('ccwork.login')}
          className={cn(
            'sidebar-nav-text flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
            'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
            collapsed ? 'justify-center px-0' : 'justify-start',
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
            <LogIn className="h-4 w-4" strokeWidth={2} />
          </div>
          {!collapsed && (
            <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('ccwork.login')}</span>
          )}
        </button>
        <AccountLoginDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  // ── Logged in, collapsed → icon that opens the account menu ─────
  if (collapsed) {
    return (
      <>
        <button
          type="button"
          data-testid="sidebar-account-account"
          onClick={() => setMenuOpen(true)}
          title={`${user?.displayName || t('ccwork.loggedIn')}${balance ? ` · ${formatBalance(balance)}` : ''}`}
          className="sidebar-nav-text flex w-full items-center justify-center rounded-lg px-0 py-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80"
        >
          <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" strokeWidth={2} />
          </div>
        </button>
        <AccountMenu open={menuOpen} onOpenChange={setMenuOpen} onRecharge={() => setRechargeOpen(true)} onRefresh={handleRefresh} refreshing={refreshing} onLogout={() => { setMenuOpen(false); void logout(); }} />
        <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
      </>
    );
  }

  // ── Logged in → compact account trigger; all actions live in the menu ──
  return (
    <>
      <button
        type="button"
        data-testid="sidebar-account-account"
        onClick={() => setMenuOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-black/5 bg-black/[0.02] px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={2} />
        <span className="sidebar-nav-text min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground/90">
          {user?.displayName || user?.username || t('ccwork.loggedIn')}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
      </button>

      <AccountMenu open={menuOpen} onOpenChange={setMenuOpen} onRecharge={() => setRechargeOpen(true)} onRefresh={handleRefresh} refreshing={refreshing} onLogout={() => { setMenuOpen(false); void logout(); }} />
      <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
    </>
  );
}

function AccountMenu({ open, onOpenChange, onRecharge, onRefresh, refreshing, onLogout }: { open: boolean; onOpenChange: (open: boolean) => void; onRecharge: () => void; onRefresh: () => void; refreshing: boolean; onLogout: () => void }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const user = useAccountStore((s) => s.user);
  const balance = useAccountStore((s) => s.balance);
  const format = balance ? balance.quota.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—';
  return <div className="relative"><button type="button" aria-label={t('ccwork.accountMenu')} onClick={() => onOpenChange(!open)} className="sr-only" /><div className={open ? 'fixed inset-x-2 bottom-14 z-50 w-72 rounded-xl border border-border bg-surface-modal p-3 shadow-xl' : 'hidden'}><div className="flex items-center gap-2 border-b border-border pb-3"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><div className="min-w-0"><strong className="block truncate">{user?.displayName || user?.username}</strong><span className="text-xs text-muted-foreground">{t('ccwork.accountLabel')}</span></div></div><div className="flex items-center gap-2 py-3 text-sm"><Wallet className="h-4 w-4" />{t('ccwork.credits')} {format}<button type="button" onClick={onRefresh} title={t('ccwork.refreshBalance')} className="ml-auto"><RefreshCw className={refreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /></button></div><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { onOpenChange(false); onRecharge(); }}><Wallet className="h-4 w-4" />{t('ccwork.recharge')}</button><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { navigate('/usage'); onOpenChange(false); }}><ReceiptText className="h-4 w-4" />{t('ccwork.consumption')}</button><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { navigate('/settings'); onOpenChange(false); }}><Settings className="h-4 w-4" />{t('sidebar.settings')}</button><button type="button" className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-red-600 hover:bg-red-500/10" onClick={onLogout}><LogOut className="h-4 w-4" />{t('ccwork.logout')}</button></div></div>;
}
