import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { AuditLogComponent } from './audit-log.component';

describe('AuditLogComponent', () => {
  const apiGet = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    toastError.mockReset();
    await TestBed.configureTestingModule({
      imports: [AuditLogComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet } },
        { provide: ToastService, useValue: { success: vi.fn(), error: toastError, info: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('renders Audit-Logs heading', () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const fixture = TestBed.createComponent(AuditLogComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Audit Logs');
  });

  it('refresh calls GET /api/admin/audit-logs with pagination params', async () => {
    apiGet.mockResolvedValue({ items: [{ id: '1', action: 'listing.create', target_type: 'listing', target_id: 'L', actor: 'admin', created_at: '2026-01-01' }], total: 1, page: 1, pageSize: 50 });
    const fixture = TestBed.createComponent(AuditLogComponent);
    await fixture.componentInstance.refresh();
    expect(apiGet).toHaveBeenCalledWith('/api/admin/audit-logs?page=1&pageSize=50');
    expect(fixture.componentInstance.rows().length).toBe(1);
    expect(fixture.componentInstance.total()).toBe(1);
  });

  it('refresh appends action filter to URL', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const fixture = TestBed.createComponent(AuditLogComponent);
    fixture.componentInstance.actionFilter = 'order.cancel';
    await fixture.componentInstance.refresh();
    expect(apiGet).toHaveBeenCalledWith('/api/admin/audit-logs?page=1&pageSize=50&action=order.cancel');
  });

  it('nextPage increments and prevPage respects lower bound', async () => {
    apiGet.mockResolvedValue({ items: [], total: 200, page: 1, pageSize: 50 });
    const fixture = TestBed.createComponent(AuditLogComponent);
    await fixture.componentInstance.refresh();
    expect(fixture.componentInstance.totalPages()).toBe(4);
    fixture.componentInstance.nextPage();
    expect(fixture.componentInstance.page()).toBe(2);
    fixture.componentInstance.prevPage();
    expect(fixture.componentInstance.page()).toBe(1);
    fixture.componentInstance.prevPage();
    expect(fixture.componentInstance.page()).toBe(1);
  });
});
