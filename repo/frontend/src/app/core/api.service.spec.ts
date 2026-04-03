import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from './api.service';

describe('ApiService offline cache', () => {
  const httpGet = vi.fn();
  let originalOnline = true;

  beforeEach(() => {
    httpGet.mockReset();
    localStorage.clear();
    originalOnline = navigator.onLine;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });

    TestBed.configureTestingModule({
      providers: [
        ApiService,
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: originalOnline });
  });

  it('caches storefront GET responses and serves cache while offline', async () => {
    const service = TestBed.inject(ApiService);
    httpGet.mockReturnValueOnce(of({ items: [{ id: 'listing-1' }] }));

    const online = await service.get<{ items: Array<{ id: string }> }>('/api/storefront/listings');
    expect(online.items[0].id).toBe('listing-1');

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    httpGet.mockReturnValueOnce(throwError(() => ({ status: 0 })));

    const offline = await service.get<{ items: Array<{ id: string }> }>('/api/storefront/listings');
    expect(offline.items[0].id).toBe('listing-1');
  });

  it('throws offline network error when no cache exists', async () => {
    const service = TestBed.inject(ApiService);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    httpGet.mockReturnValueOnce(throwError(() => ({ status: 0, error: { message: 'offline' } })));

    await expect(service.get('/api/storefront/sellers/missing/reviews')).rejects.toEqual({ status: 0, error: { message: 'offline' } });
  });
});
