import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { OrderListComponent } from './order-list.component';

describe('OrderListComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const hasRole = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    hasRole.mockReset();
    hasRole.mockImplementation((r: string) => r === 'seller');

    await TestBed.configureTestingModule({
      imports: [OrderListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: AuthService, useValue: { hasRole } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('loads orders and computes stats', async () => {
    apiGet.mockResolvedValue({ items: [
      { id: 'a', status: 'placed', createdAt: '2026-01-01' },
      { id: 'b', status: 'payment_captured', createdAt: '2026-01-02' },
      { id: 'c', status: 'completed', createdAt: '2026-01-03' },
    ] as any });
    const fixture = TestBed.createComponent(OrderListComponent);
    await fixture.componentInstance.load();
    expect(apiGet).toHaveBeenCalledWith('/api/orders');
    const stats = fixture.componentInstance.stats();
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(2);
    expect(stats.completed).toBe(1);
  });

  it('completeOrder posts to /api/orders/:id/complete', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(OrderListComponent);
    await fixture.componentInstance.completeOrder({ id: 'o-1' } as any);
    expect(apiPost).toHaveBeenCalledWith('/api/orders/o-1/complete', { note: 'Completed from order list' });
  });

  it('goCapture navigates to payment-capture with orderId', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(OrderListComponent);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.goCapture({ id: 'o-2' } as any);
    expect(nav).toHaveBeenCalledWith(['/orders/payment-capture'], { queryParams: { orderId: 'o-2' } });
  });

  it('canCapture is true for seller on placed order', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(OrderListComponent);
    expect(fixture.componentInstance.canCapture({ status: 'placed' } as any)).toBe(true);
    expect(fixture.componentInstance.canCapture({ status: 'completed' } as any)).toBe(false);
  });
});
