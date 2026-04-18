import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { RegisterComponent } from './register.component';

describe('RegisterComponent', () => {
  const post = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    await TestBed.configureTestingModule({
      imports: [RegisterComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { post } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError } },
      ],
    }).compileComponents();
  });

  it('renders the Create-account heading', () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Create your account');
  });

  it('expands rolePreset "both" to ["buyer","seller"] when submitting', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    post.mockResolvedValue({ id: 'u1', email: 'a@b.co', displayName: 'U', roles: ['buyer', 'seller'] });

    fixture.componentInstance.form.setValue({ email: 'a@b.co', displayName: 'New User', password: 'Passw0rd1', rolePreset: 'both' });
    await fixture.componentInstance.submit();

    expect(post).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      email: 'a@b.co',
      displayName: 'New User',
      password: 'Passw0rd1',
      roles: ['buyer', 'seller'],
    }));
    expect(toastSuccess).toHaveBeenCalledWith('Registration successful');
  });

  it('surfaces backend error message on registration failure', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    post.mockRejectedValue({ error: { message: 'Email already exists' } });
    fixture.componentInstance.form.setValue({ email: 'a@b.co', displayName: 'U', password: 'Passw0rd1', rolePreset: 'buyer' });
    await fixture.componentInstance.submit();

    expect(fixture.componentInstance.error()).toBe('Email already exists');
    expect(toastError).toHaveBeenCalledWith('Email already exists');
  });

  it('does not submit when form is invalid', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: 'bad', displayName: '', password: 'short', rolePreset: 'buyer' });
    await fixture.componentInstance.submit();
    expect(post).not.toHaveBeenCalled();
  });
});
