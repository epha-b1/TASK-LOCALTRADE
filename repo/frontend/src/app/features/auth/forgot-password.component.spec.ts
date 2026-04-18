import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ForgotPasswordComponent } from './forgot-password.component';

describe('ForgotPasswordComponent', () => {
  const post = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { post } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError } },
      ],
    }).compileComponents();
  });

  it('renders the Forgot-password heading', () => {
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Forgot password?');
  });

  it('posts email to /api/auth/forgot-password and shows success banner', async () => {
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    post.mockResolvedValue({ message: 'ok' });
    fixture.componentInstance.form.setValue({ email: 'ops@localtrade.test' });
    await fixture.componentInstance.submit();

    expect(post).toHaveBeenCalledWith('/api/auth/forgot-password', { email: 'ops@localtrade.test' });
    expect(fixture.componentInstance.success()).toContain('Reset request created');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('records inline error on failure', async () => {
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    post.mockRejectedValue({ error: { message: 'User blocked' } });
    fixture.componentInstance.form.setValue({ email: 'ops@localtrade.test' });
    await fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('User blocked');
    expect(toastError).toHaveBeenCalledWith('User blocked');
  });

  it('does not submit when email is invalid', async () => {
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: 'not-an-email' });
    await fixture.componentInstance.submit();
    expect(post).not.toHaveBeenCalled();
  });
});
