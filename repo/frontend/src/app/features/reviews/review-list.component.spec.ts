import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ReviewListComponent } from './review-list.component';

describe('ReviewListComponent', () => {
  const apiGet = vi.fn();
  const hasRole = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    hasRole.mockReset();

    await TestBed.configureTestingModule({
      imports: [ReviewListComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet } },
        { provide: AuthService, useValue: { hasRole } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('stars() renders rating as filled + empty stars', () => {
    hasRole.mockReturnValue(true);
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ReviewListComponent);
    expect(fixture.componentInstance.stars(5)).toMatch(/★{5}/);
    expect(fixture.componentInstance.stars(3)).toMatch(/★{3}☆{2}/);
  });

  it('loads storefront listings and fetches seller reviews for buyers', async () => {
    hasRole.mockImplementation((r: string) => r === 'buyer');
    apiGet
      .mockResolvedValueOnce({ items: [{ seller_id: 'S1', seller_display_name: 'S' }] })
      .mockResolvedValueOnce({ items: [{ id: 'r1', rating: 5, body: 'Great', createdAt: '2026-01-01' }] });

    const fixture = TestBed.createComponent(ReviewListComponent);
    await fixture.componentInstance.load();

    expect(apiGet).toHaveBeenCalledWith('/api/storefront/listings');
    expect(apiGet).toHaveBeenCalledWith('/api/storefront/sellers/S1/reviews');
  });

  it('seller role loads own-seller reviews via /api/users/me', async () => {
    hasRole.mockImplementation((r: string) => r === 'seller');
    apiGet
      .mockResolvedValueOnce({ id: 'S-me' })
      .mockResolvedValueOnce({ items: [] });

    const fixture = TestBed.createComponent(ReviewListComponent);
    await fixture.componentInstance.load();

    expect(apiGet).toHaveBeenCalledWith('/api/users/me');
    expect(apiGet).toHaveBeenCalledWith('/api/storefront/sellers/S-me/reviews');
  });
});
