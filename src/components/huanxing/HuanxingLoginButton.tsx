/**
 * Huanxing Login Button
 *
 * Floating bottom-right entry point to connect to a Huanxing API server and
 * register its models as usable providers. Sits below the global Toaster
 * (z-index 99999) so toasts stay on top.
 */
import { useState } from 'react';
import { Boxes, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHuanxingStore } from '@/stores/huanxing';
import { HuanxingLoginDialog } from './HuanxingLoginDialog';

export function HuanxingLoginButton() {
  const [open, setOpen] = useState(false);
  const loggedIn = useHuanxingStore((s) => s.loggedIn);
  const user = useHuanxingStore((s) => s.user);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant={loggedIn ? 'outline' : 'default'}
          size="sm"
          className="shadow-lg"
          onClick={() => setOpen(true)}
          title={loggedIn ? '管理 Huanxing 连接' : '连接到 Huanxing 并拉取模型'}
        >
          {loggedIn ? (
            <CheckCircle2 size={16} className="mr-1.5 text-emerald-500" />
          ) : (
            <Boxes size={16} className="mr-1.5" />
          )}
          {loggedIn ? (user?.displayName || '已连接') : '连接 Huanxing'}
        </Button>
      </div>

      <HuanxingLoginDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
