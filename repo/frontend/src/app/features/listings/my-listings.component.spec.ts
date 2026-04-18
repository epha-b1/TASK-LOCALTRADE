import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { MyListingsComponent } from './my-listings.component';

describe('MyListingsComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const apiDelete = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    await TestBed.configureTestingModule({
      imports: [MyListingsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: apiGet, post: apiPost, delete: apiDelete } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('loads listings from /api/listings', async () => {
    apiGet.mockResolvedValue({ items: [{ id: 'L1', title: 'Apples', status: 'draft', priceCents: 500, quantity: 5, assetCount: 1 }] });
    const fixture = TestBed.createComponent(MyListingsComponent);
    await fixture.componentInstance.load();
    expect(apiGet).toHaveBeenCalledWith('/api/listings');
    expect(fixture.componentInstance.items().length).toBe(1);
  });

  it('createNew navigates to /listings/create', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(MyListingsComponent);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.createNew();
    expect(nav).toHaveBeenCalledWith('/listings/create');
  });

  it('publish posts to /api/listings/:id/publish when listing is ready', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(MyListingsComponent);
    await fixture.componentInstance.publish({ id: 'L-9', status: 'draft', readiness: true } as any);
    expect(apiPost).toHaveBeenCalledWith('/api/listings/L-9/publish', {});
  });

  it('publish is a no-op when readiness is false', async () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(MyListingsComponent);
    await fixture.componentInstance.publish({ id: 'L-9', status: 'draft', readiness: false } as any);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('remove deletes via /api/listings/:id', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiDelete.mockResolvedValue({});
    const fixture = TestBed.createComponent(MyListingsComponent);
    await fixture.componentInstance.remove('L-4');
    expect(apiDelete).toHaveBeenCalledWith('/api/listings/L-4');
  });
});
