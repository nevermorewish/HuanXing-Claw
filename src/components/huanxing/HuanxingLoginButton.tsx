/**
 * Huanxing Login Button / Account Panel
 *
 * Sidebar footer entry point (below Settings).
 *   - Logged out: a "登录" nav item that opens the login dialog.
 *   - Logged in: an account panel showing the username, balance, and
 *     充值 (recharge) / 登出 (logout) actions.
 * Collapses to a single icon when the sidebar is collapsed (click → dialog).
 * Credentials are saved on login, so subsequent opens pre-fill them.
 */
import { useEffect, useState } from 'react';
import { LogIn, CheckCircle2, Wallet, LogOut, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHuanxingStore } from '@/stores/huanxing';
import { HuanxingLoginDialog } from './HuanxingLoginDialog';

interface HuanxingLoginButtonProps {
  collapsed?: boolean;
}

/** Render a New-API quota figure as a currency amount (or raw quota). */
function formatBalance(balance: {
  quota: number;
  quotaPerUnit: number;
  displayInCurrency: boolean;
}): string {
  if (balance.displayInCurrency && balance.quotaPerUnit > 0) {
    return `$${(balance.quota / balance.quotaPerUnit).toFixed(2)}`;
  }
  return balance.quota.toLocaleString();
}

export function HuanxingLoginButton({ collapsed = false }: HuanxingLoginButtonProps) {
  const [open, setOpen] = useState(false);
  const loggedIn = useHuanxingStore((s) => s.loggedIn);
  const user = useHuanxingStore((s) => s.user);
  const balance = useHuanxingStore((s) => s.balance);
  const fetchBalance = useHuanxingStore((s) => s.fetchBalance);
  const openRecharge = useHuanxingStore((s) => s.openRecharge);
  const logout = useHuanxingStore((s) => s.logout);
  const [refreshing, setRefreshing] = useState(false);

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
          data-testid="sidebar-huanxing-login"
          onClick={() => setOpen(true)}
          title="登录 Huanxing"
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
            <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">登录</span>
          )}
        </button>
        <HuanxingLoginDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  // ── Logged in, collapsed → icon that opens the manage dialog ─────
  if (collapsed) {
    return (
      <>
        <button
          type="button"
          data-testid="sidebar-huanxing-account"
          onClick={() => setOpen(true)}
          title={`${user?.displayName || '已登录'}${balance ? ` · ${formatBalance(balance)}` : ''}`}
          className="sidebar-nav-text flex w-full items-center justify-center rounded-lg px-0 py-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80"
        >
          <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2} />
          </div>
        </button>
        <HuanxingLoginDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  // ── Logged in, expanded → account panel ──────────────────────────
  return (
    <>
      <div
        data-testid="sidebar-huanxing-account"
        className="rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] px-2.5 py-2"
      >
        {/* Username */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="管理 Huanxing 连接"
          className="flex w-full items-center gap-2 rounded-md text-left text-foreground/90 hover:text-foreground transition-colors"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2} />
          <span className="sidebar-nav-text flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
            {user?.displayName || user?.username || '已登录'}
          </span>
        </button>

        {/* Balance */}
        <div className="mt-1.5 flex items-center gap-1.5 text-meta text-foreground/60">
          <Wallet className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            余额 {balance ? formatBalance(balance) : '—'}
          </span>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            title="刷新余额"
            className="shrink-0 rounded p-0.5 text-foreground/40 hover:text-foreground/80 transition-colors"
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} strokeWidth={2} />
          </button>
        </div>

        {/* Actions */}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            data-testid="sidebar-huanxing-recharge"
            onClick={() => void openRecharge()}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-meta font-medium text-primary hover:bg-primary/15 transition-colors"
          >
            <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
            充值
          </button>
          <button
            type="button"
            data-testid="sidebar-huanxing-logout"
            onClick={() => void logout()}
            title="登出"
            className="flex items-center justify-center gap-1 rounded-md px-2 py-1 text-meta font-medium text-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
            登出
          </button>
        </div>
      </div>

      <HuanxingLoginDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
