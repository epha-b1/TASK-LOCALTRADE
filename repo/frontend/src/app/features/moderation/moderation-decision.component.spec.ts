import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ModerationDecisionComponent } from './moderation-decision.component';

describe('ModerationDecisionComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const toastSuccess = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    toastSuccess.mockReset();
    apiGet.mockResolvedValue({ items: [] });

    await TestBed.configureTestingModule({
      imports: [ModerationDecisionComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: ToastService, useValue: { success: toastSuccess, error: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('renders Moderation-Decision heading', () => {
    const fixture = TestBed.createComponent(ModerationDecisionComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Moderation Decision');
  });

  it('submit posts to /api/moderation/listings/:id/decision', async () => {
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(ModerationDecisionComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ listingId: '22222222-2222-2222-2222-222222222222', decision: 'approve', notes: 'Looks fine' });
    await fixture.componentInstance.submit();
    expect(apiPost).toHaveBeenCalledWith('/api/moderation/listings/22222222-2222-2222-2222-222222222222/decision', { decision: 'approve', notes: 'Looks fine' });
    expect(toastSuccess).toHaveBeenCalledWith('Decision submitted');
  });

  it('invalid form blocks submission', async () => {
    const fixture = TestBed.createComponent(ModerationDecisionComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ listingId: '', decision: 'approve', notes: '' });
    await fixture.componentInstance.submit();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
