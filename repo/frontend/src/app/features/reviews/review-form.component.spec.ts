import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ReviewFormComponent } from './review-form.component';

describe('ReviewFormComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();

    await TestBed.configureTestingModule({
      imports: [ReviewFormComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: HttpClient, useValue: { put: () => of({}), request: () => of({}) } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError, info: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    }).compileComponents();
  });

  it('renders Leave-Review heading', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ReviewFormComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Leave a Review');
  });

  it('loads completed orders on init via /api/orders?status=completed', async () => {
    apiGet.mockResolvedValue({ items: [{ id: 'o-1', listingTitle: 'Apples', completedAt: '2026-01-01' }] });
    const fixture = TestBed.createComponent(ReviewFormComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    expect(apiGet).toHaveBeenCalledWith('/api/orders?status=completed');
  });

  it('submitReview posts to /api/reviews and stores the returned id', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockResolvedValue({ id: 'rev-1', status: 'published' });
    const fixture = TestBed.createComponent(ReviewFormComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ orderId: '11111111-1111-1111-1111-111111111111', rating: 5, body: 'Great' });

    await fixture.componentInstance.submitReview();

    expect(apiPost).toHaveBeenCalledWith('/api/reviews', { orderId: '11111111-1111-1111-1111-111111111111', rating: 5, body: 'Great' });
    expect(fixture.componentInstance.reviewId()).toBe('rev-1');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('does not submit when form is invalid', async () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ReviewFormComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ orderId: '', rating: 0 as any, body: '' });
    await fixture.componentInstance.submitReview();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('surfaces error when review submission fails', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockRejectedValue({ error: { message: 'Review window expired' } });
    const fixture = TestBed.createComponent(ReviewFormComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ orderId: '11111111-1111-1111-1111-111111111111', rating: 4, body: 'ok' });
    await fixture.componentInstance.submitReview();
    expect(fixture.componentInstance.error()).toBe('Review window expired');
    expect(toastError).toHaveBeenCalledWith('Review window expired');
  });
});
