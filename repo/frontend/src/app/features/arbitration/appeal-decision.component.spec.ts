import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { AppealDecisionComponent } from './appeal-decision.component';

describe('AppealDecisionComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const toastSuccess = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    toastSuccess.mockReset();
    apiGet.mockResolvedValue({ items: [] });

    await TestBed.configureTestingModule({
      imports: [AppealDecisionComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: ToastService, useValue: { success: toastSuccess, error: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('renders Appeal-Decision heading', () => {
    const fixture = TestBed.createComponent(AppealDecisionComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Appeal Decision');
  });

  it('submit posts to /api/arbitration/appeals/:id/resolve', async () => {
    apiPost.mockResolvedValue({});
    const fixture = TestBed.createComponent(AppealDecisionComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ appealId: '33333333-3333-3333-3333-333333333333', outcome: 'uphold', note: 'Upheld' });
    await fixture.componentInstance.submit();
    expect(apiPost).toHaveBeenCalledWith('/api/arbitration/appeals/33333333-3333-3333-3333-333333333333/resolve', { outcome: 'uphold', note: 'Upheld' });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('invalid form blocks submission', async () => {
    const fixture = TestBed.createComponent(AppealDecisionComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ appealId: '', outcome: 'uphold', note: '' });
    await fixture.componentInstance.submit();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
