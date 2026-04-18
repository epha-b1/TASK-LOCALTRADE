import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ModerationQueueComponent } from './moderation-queue.component';

describe('ModerationQueueComponent', () => {
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
      imports: [ModerationQueueComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError, info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('loads /api/moderation/queue and stores items', async () => {
    apiGet.mockResolvedValue({ items: [{ id: 'L-1', title: 't', description: 'd' }] });
    const fixture = TestBed.createComponent(ModerationQueueComponent);
    await fixture.componentInstance.load();
    expect(apiGet).toHaveBeenCalledWith('/api/moderation/queue');
    expect(fixture.componentInstance.items().length).toBe(1);
  });

  it('setAction records the moderator choice for a listing', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ModerationQueueComponent);
    fixture.componentInstance.setAction('L-1', 'approve');
    expect(fixture.componentInstance.actionFor('L-1')).toBe('approve');
  });

  it('submitDecision posts to /api/moderation/listings/:id/decision', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(ModerationQueueComponent);
    fixture.componentInstance.setAction('L-1', 'reject');
    fixture.componentInstance.notes['L-1'] = 'Spam';
    await fixture.componentInstance.submitDecision({ id: 'L-1' } as any);
    expect(apiPost).toHaveBeenCalledWith('/api/moderation/listings/L-1/decision', { decision: 'reject', notes: 'Spam' });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('excerpt truncates long descriptions', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(ModerationQueueComponent);
    const long = 'x'.repeat(400);
    expect(fixture.componentInstance.excerpt(long).length).toBeLessThan(long.length);
  });
});
