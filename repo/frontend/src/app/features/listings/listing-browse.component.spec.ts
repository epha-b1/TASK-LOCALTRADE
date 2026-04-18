import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ListingBrowseComponent } from './listing-browse.component';

describe('ListingBrowseComponent', () => {
  const apiGet = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    toastError.mockReset();
    await TestBed.configureTestingModule({
      imports: [ListingBrowseComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: apiGet } },
        { provide: ToastService, useValue: { error: toastError, success: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('renders Marketplace-Listings heading', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ListingBrowseComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Marketplace Listings');
  });

  it('loads rows from /api/storefront/listings and exposes filteredRows', async () => {
    apiGet.mockResolvedValue({ items: [
      { id: '1', title: 'Apples', description: 'fresh', price_cents: 500, quantity: 10 },
      { id: '2', title: 'Oranges', description: 'juicy', price_cents: 700, quantity: 5 },
    ]});
    const fixture = TestBed.createComponent(ListingBrowseComponent);
    await fixture.componentInstance.load();
    expect(apiGet).toHaveBeenCalledWith('/api/storefront/listings');
    expect(fixture.componentInstance.rows().length).toBe(2);

    fixture.componentInstance.searchTerm = 'orange';
    expect(fixture.componentInstance.filteredRows().length).toBe(1);
    expect(fixture.componentInstance.filteredRows()[0].id).toBe('2');
  });

  it('viewOrder() navigates to /listings/:id', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ListingBrowseComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.viewOrder('abc');
    expect(nav).toHaveBeenCalledWith(['/listings', 'abc']);
  });

  it('surfaces error on load failure', async () => {
    apiGet.mockRejectedValue({ error: { message: 'network' } });
    const fixture = TestBed.createComponent(ListingBrowseComponent);
    await fixture.componentInstance.load();
    expect(fixture.componentInstance.error()).toBe('network');
    expect(toastError).toHaveBeenCalledWith('network');
  });
});
