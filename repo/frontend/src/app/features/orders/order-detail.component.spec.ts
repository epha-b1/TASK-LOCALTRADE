import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { OrderDetailComponent } from './order-detail.component';

describe('OrderDetailComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  const hasRole = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    hasRole.mockReset();
    hasRole.mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [OrderDetailComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: AuthService, useValue: { hasRole } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError, info: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'O-1' } } } },
      ],
    }).compileComponents();
  });

  it('loads order detail from /api/orders/:id', async () => {
    apiGet.mockResolvedValue({ id: 'O-1', status: 'completed', paymentStatus: 'captured', refundStatus: 'none' });
    const fixture = TestBed.createComponent(OrderDetailComponent);
    await fixture.componentInstance.load();
    expect(apiGet).toHaveBeenCalledWith('/api/orders/O-1');
    expect(fixture.componentInstance.order()?.id).toBe('O-1');
  });

  it('cancelOrder posts to /api/orders/:id/cancel with a reason', async () => {
    apiGet.mockResolvedValue({ id: 'O-1', status: 'placed', paymentStatus: 'pending', refundStatus: 'none' });
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(OrderDetailComponent);
    await fixture.componentInstance.cancelOrder('O-1');
    expect(apiPost).toHaveBeenCalledWith('/api/orders/O-1/cancel', { reason: 'Cancelled from order detail' });
    expect(toastSuccess).toHaveBeenCalledWith('Order cancelled');
  });

  it('submitRefund converts dollars to cents and posts /api/refunds (auto-approved ≤ $250)', async () => {
    apiGet.mockResolvedValue({ id: 'O-1', status: 'completed', paymentStatus: 'captured', refundStatus: 'none' });
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(OrderDetailComponent);
    fixture.componentInstance.refundForm.setValue({ amountDollars: 100.5, reason: 'Damaged' });
    await fixture.componentInstance.submitRefund('O-1');
    expect(apiPost).toHaveBeenCalledWith('/api/refunds', { orderId: 'O-1', amountCents: 10050, reason: 'Damaged' });
    expect(toastSuccess).toHaveBeenCalledWith('Refund request submitted and auto-approved');
  });

  it('submitRefund signals admin approval for amount > $250', async () => {
    apiGet.mockResolvedValue({ id: 'O-1', status: 'completed', paymentStatus: 'captured', refundStatus: 'none' });
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(OrderDetailComponent);
    fixture.componentInstance.refundForm.setValue({ amountDollars: 300, reason: 'High value return' });
    await fixture.componentInstance.submitRefund('O-1');
    expect(apiPost).toHaveBeenCalledWith('/api/refunds', { orderId: 'O-1', amountCents: 30000, reason: 'High value return' });
    expect(toastSuccess).toHaveBeenCalledWith('Refund request submitted — awaiting admin approval');
  });

  it('submitRefund skips network call when form invalid', async () => {
    apiGet.mockResolvedValue({ id: 'O-1', status: 'completed' });
    const fixture = TestBed.createComponent(OrderDetailComponent);
    fixture.componentInstance.refundForm.setValue({ amountDollars: 0, reason: '' });
    await fixture.componentInstance.submitRefund('O-1');
    expect(apiPost).not.toHaveBeenCalled();
  });
});
