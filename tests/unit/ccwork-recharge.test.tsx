import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  creditPackages: vi.fn(),
  createRecharge: vi.fn(),
  rechargeStatus: vi.fn(),
  cancelRecharge: vi.fn(),
  fetchBalance: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/host-api', () => ({
  hostApi: { account: {
    creditPackages: mocks.creditPackages,
    createRecharge: mocks.createRecharge,
    rechargeStatus: mocks.rechargeStatus,
    cancelRecharge: mocks.cancelRecharge,
  } },
}));
vi.mock('@/stores/account', () => ({
  useAccountStore: (selector: (state: { fetchBalance: () => Promise<void> }) => unknown) => selector({ fetchBalance: mocks.fetchBalance }),
}));

import { RechargeDialog } from '@/components/account/RechargeDialog';

describe('RechargeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.creditPackages.mockResolvedValue({ success: true, packages: [{ id: 'starter', name: 'Starter', description: '100 credits', price: 10, total_credits: 100, bonus_credits: 0 }] });
    mocks.createRecharge.mockResolvedValue({ success: true, payment: { order_no: 'order-1', qr_code: 'https://pay.test/qr' } });
    mocks.rechargeStatus.mockResolvedValue({ success: true, order: { order_no: 'order-1', status: 'paid' } });
  });

  it('creates an order, observes payment, and refreshes the balance', async () => {
    render(<RechargeDialog open onOpenChange={vi.fn()} />);
    await screen.findByText('Starter');
    fireEvent.click(screen.getByText('ccwork.rechargeConfirm'));
    await waitFor(() => expect(mocks.createRecharge).toHaveBeenCalledWith({ packageId: 'starter', paymentMethod: 'alipay' }));
    await waitFor(() => expect(screen.getByText('ccwork.rechargeSuccess')).toBeInTheDocument());
    expect(mocks.rechargeStatus).toHaveBeenCalledWith('order-1');
    expect(mocks.fetchBalance).toHaveBeenCalled();
  });

  it('keeps the pending order when the dialog is closed', async () => {
    mocks.rechargeStatus.mockResolvedValue({ success: true, order: { order_no: 'order-1', status: 'paying' } });
    const onOpenChange = vi.fn();
    const view = render(<RechargeDialog open onOpenChange={onOpenChange} />);
    await screen.findByText('Starter');
    fireEvent.click(screen.getByText('ccwork.rechargeConfirm'));
    await waitFor(() => expect(mocks.createRecharge).toHaveBeenCalled());
    fireEvent.click(screen.getByText('actions.close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.cancelRecharge).not.toHaveBeenCalled();
    view.unmount();
  });
});
