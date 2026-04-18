import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ListingDetailComponent } from './listing-detail.component';

describe('ListingDetailComponent', () => {
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
      imports: [ListingDetailComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: AuthService, useValue: { hasRole } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError, info: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (_k: string) => 'L-1' } } } },
      ],
    }).compileComponents();
  });

  it('loads the matching listing from /api/storefront/listings on init', async () => {
    apiGet.mockResolvedValue({ items: [
      { id: 'L-1', title: 'Apples', description: 'fresh', price_cents: 500, quantity: 5, seller_id: 'S1' },
      { id: 'L-2', title: 'Pears', description: 'ripe', price_cents: 600, quantity: 3, seller_id: 'S1' },
    ]});
    const fixture = TestBed.createComponent(ListingDetailComponent);
    await fixture.componentInstance.load('L-1');
    expect(apiGet).toHaveBeenCalledWith('/api/storefront/listings');
    expect(fixture.componentInstance.row()?.id).toBe('L-1');
  });

  it('placeOrder posts to /api/orders and navigates to /orders/list', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockResolvedValue({ id: 'O-1' });
    const fixture = TestBed.createComponent(ListingDetailComponent);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.orderForm.setValue({ quantity: 2 });
    await fixture.componentInstance.placeOrder({ id: 'L-1', title: 't', description: 'd', price_cents: 500, quantity: 5, seller_id: 'S1' } as any);

    expect(apiPost).toHaveBeenCalledWith('/api/orders', { listingId: 'L-1', quantity: 2 });
    expect(nav).toHaveBeenCalledWith(['/orders/list']);
    expect(toastSuccess).toHaveBeenCalledWith('Order placed successfully');
  });

  it('openStorefront navigates to /storefront/:sellerId', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ListingDetailComponent);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.openStorefront('S-9');
    expect(nav).toHaveBeenCalledWith(['/storefront', 'S-9']);
  });

  it('records error when placing order fails', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockRejectedValue({ error: { message: 'Out of stock' } });
    const fixture = TestBed.createComponent(ListingDetailComponent);
    fixture.componentInstance.orderForm.setValue({ quantity: 1 });
    await fixture.componentInstance.placeOrder({ id: 'L-1', price_cents: 1 } as any);
    expect(fixture.componentInstance.error()).toBe('Out of stock');
    expect(toastError).toHaveBeenCalledWith('Out of stock');
  });
});
