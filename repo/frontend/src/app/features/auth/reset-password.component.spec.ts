import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ResetPasswordComponent } from './reset-password.component';

describe('ResetPasswordComponent', () => {
  const post = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    await TestBed.configureTestingModule({
      imports: [ResetPasswordComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { post } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError } },
      ],
    }).compileComponents();
  });

  it('renders Set-new-password heading', () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Set a new password');
  });

  it('passwordMismatch() is true when confirm differs', () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ resetToken: 'tok', newPassword: 'Passw0rd1', confirmPassword: 'Different1' });
    expect(fixture.componentInstance.passwordMismatch()).toBe(true);
  });

  it('posts reset and navigates to login on success', async () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    post.mockResolvedValue(undefined);
    fixture.componentInstance.form.setValue({ resetToken: 'tok', newPassword: 'Passw0rd1', confirmPassword: 'Passw0rd1' });

    await fixture.componentInstance.submit();

    expect(post).toHaveBeenCalledWith('/api/auth/reset-password', { resetToken: 'tok', newPassword: 'Passw0rd1' });
    expect(navigateSpy).toHaveBeenCalledWith('/auth/login');
    expect(toastSuccess).toHaveBeenCalledWith('Password updated');
  });

  it('does not submit when passwords do not match', async () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ resetToken: 'tok', newPassword: 'Passw0rd1', confirmPassword: 'Other1234' });
    await fixture.componentInstance.submit();
    expect(post).not.toHaveBeenCalled();
  });

  it('surfaces error when api rejects', async () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    post.mockRejectedValue({ error: { message: 'Invalid or expired' } });
    fixture.componentInstance.form.setValue({ resetToken: 'tok', newPassword: 'Passw0rd1', confirmPassword: 'Passw0rd1' });
    await fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('Invalid or expired');
    expect(toastError).toHaveBeenCalledWith('Invalid or expired');
  });
});
