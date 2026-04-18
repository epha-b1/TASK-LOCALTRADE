import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { AppealQueueComponent } from './appeal-queue.component';

describe('AppealQueueComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const toastSuccess = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    toastSuccess.mockReset();
    await TestBed.configureTestingModule({
      imports: [AppealQueueComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: ToastService, useValue: { success: toastSuccess, error: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('loads /api/arbitration/appeals on load()', async () => {
    apiGet.mockResolvedValue({ items: [{ id: 'A-1', review_text: 't', rating: 3, reason: 'r' }] });
    const fixture = TestBed.createComponent(AppealQueueComponent);
    await fixture.componentInstance.load();
    expect(apiGet).toHaveBeenCalledWith('/api/arbitration/appeals');
    expect(fixture.componentInstance.items().length).toBe(1);
  });

  it('setOutcome tracks selected outcome per appeal', () => {
    apiGet.mockResolvedValue({ items: [] });
    const fixture = TestBed.createComponent(AppealQueueComponent);
    fixture.componentInstance.setOutcome('A-1', 'remove');
    expect(fixture.componentInstance.selectedOutcome()['A-1']).toBe('remove');
  });

  it('submit posts to /api/arbitration/appeals/:id/resolve', async () => {
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(AppealQueueComponent);
    fixture.componentInstance.setOutcome('A-1', 'modify');
    fixture.componentInstance.notes['A-1'] = 'Partial';
    await fixture.componentInstance.submit({ id: 'A-1' } as any);
    expect(apiPost).toHaveBeenCalledWith('/api/arbitration/appeals/A-1/resolve', { outcome: 'modify', note: 'Partial' });
    expect(toastSuccess).toHaveBeenCalled();
  });
});
