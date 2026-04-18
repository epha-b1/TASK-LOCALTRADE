import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { UserManagementComponent } from './user-management.component';

describe('UserManagementComponent', () => {
  const apiGet = vi.fn();
  const apiPatch = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPatch.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();

    apiGet.mockResolvedValue({
      items: [
        {
          id: 'user-1',
          email: 'buyer@localtrade.test',
          display_name: 'Buyer',
          status: 'active',
          roles: ['buyer'],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    apiPatch.mockResolvedValue({});

    await TestBed.configureTestingModule({
      imports: [UserManagementComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, patch: apiPatch } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError } },
      ],
    }).compileComponents();
  });

  const LONG_TIMEOUT = 30_000;

  it('loads users on init and stores rows', async () => {
    const fixture = TestBed.createComponent(UserManagementComponent);
    fixture.detectChanges();
    await componentReady(fixture);

    const component = fixture.componentInstance;
    expect(apiGet).toHaveBeenCalledWith('/api/admin/users?page=1&pageSize=20');
    expect(component.rows().length).toBe(1);
    expect(component.rows()[0].email).toBe('buyer@localtrade.test');
  }, LONG_TIMEOUT);

  it('sends status update request and shows success toast', async () => {
    const fixture = TestBed.createComponent(UserManagementComponent);
    fixture.detectChanges();
    await componentReady(fixture);

    const component = fixture.componentInstance;
    const row = component.rows()[0];
    await component.setStatus(row, 'inactive');

    expect(apiPatch).toHaveBeenCalledWith('/api/admin/users/user-1/status', { status: 'inactive', reason: 'Admin set status to inactive' });
    expect(toastSuccess).toHaveBeenCalledWith('User deactivated');
  }, LONG_TIMEOUT);

  it('reports API failures from role update', async () => {
    const fixture = TestBed.createComponent(UserManagementComponent);
    fixture.detectChanges();
    await componentReady(fixture);

    const component = fixture.componentInstance;
    component.toggleEditRoles('user-1');
    component.setDraftRoles('user-1', ['seller']);
    apiPatch.mockRejectedValueOnce({ error: { message: 'Role update failed' } });

    await component.updateRoles(component.rows()[0]);

    expect(component.error()).toBe('Role update failed');
    expect(toastError).toHaveBeenCalledWith('Role update failed');
  }, LONG_TIMEOUT);

  async function componentReady(fixture: ReturnType<typeof TestBed.createComponent<UserManagementComponent>>) {
    for (let i = 0; i < 200; i += 1) {
      await Promise.resolve();
      fixture.detectChanges();
      if (fixture.componentInstance.rows().length > 0 || fixture.componentInstance.error()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
