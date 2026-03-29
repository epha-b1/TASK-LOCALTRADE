import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

@Component({
  standalone: true,
  selector: 'app-reset-password',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <section class="auth-layout">
      <div class="auth-left">
        <a class="brand" routerLink="/auth/login">
          <mat-icon>storefront</mat-icon>
          <span>LocalTrade</span>
        </a>

        <div class="form-shell">
          <h1>Set a new password</h1>
          <p class="subtitle">Use your reset token to create a new secure password for your account.</p>

          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="fill"><mat-label>Reset Token</mat-label><mat-icon matPrefix>vpn_key</mat-icon><input matInput formControlName="resetToken"><mat-error *ngIf="form.controls.resetToken.invalid && form.controls.resetToken.touched">Token required</mat-error></mat-form-field>
            <mat-form-field appearance="fill"><mat-label>New Password</mat-label><mat-icon matPrefix>lock</mat-icon><input matInput type="password" formControlName="newPassword"><mat-error *ngIf="form.controls.newPassword.invalid && form.controls.newPassword.touched">Min 8 chars, letters + numbers</mat-error></mat-form-field>
            <mat-form-field appearance="fill"><mat-label>Confirm Password</mat-label><mat-icon matPrefix>lock_clock</mat-icon><input matInput type="password" formControlName="confirmPassword"><mat-error *ngIf="(form.controls.confirmPassword.touched || form.controls.newPassword.touched) && passwordMismatch()">Passwords must match</mat-error></mat-form-field>
            <button mat-flat-button color="primary" class="btn-full" [disabled]="passwordMismatch() || loading()">Reset Password</button>
          </form>

          <div class="auth-links">
            <a routerLink="/auth/login">Back to login</a>
            <a routerLink="/auth/forgot-password">Need a token?</a>
          </div>

          <app-loading-state [loading]="loading()" label="Resetting password"></app-loading-state>
          <app-error-message [message]="error()"></app-error-message>
        </div>
      </div>

      <aside class="auth-right">
        <div class="art-wrap" aria-hidden="true">
          <svg viewBox="0 0 360 320" class="market-art">
            <rect x="56" y="96" width="248" height="160" rx="18" fill="#ffffff" fill-opacity="0.14" />
            <rect x="88" y="130" width="182" height="18" rx="9" fill="#ffffff" fill-opacity="0.32" />
            <rect x="88" y="160" width="118" height="14" rx="7" fill="#ffffff" fill-opacity="0.24" />
            <circle cx="236" cy="193" r="34" fill="#ffffff" fill-opacity="0.2" />
            <path d="M152 65a28 28 0 0 1 56 0v19h-12V65a16 16 0 0 0-32 0v19h-12z" fill="#ffffff" fill-opacity="0.3" />
          </svg>
          <p>Protect your marketplace account with secure password reset controls.</p>
        </div>
      </aside>
    </section>
  `,
  styles: [
    `
      .auth-layout { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; }
      .auth-left { position: relative; background: #fff; padding: 40px; display: flex; align-items: center; justify-content: center; }
      .brand { position: absolute; top: 40px; left: 40px; display: inline-flex; align-items: center; gap: 8px; color: #1a1a2e; text-decoration: none; font-size: 1.1rem; font-weight: 700; }
      .brand mat-icon { color: #3f51b5; }
      .form-shell { width: min(420px, 100%); }
      h1 {
        margin: 0;
        font-size: 1.75rem;
        font-weight: 700;
        color: #1a1a2e;
      }
      .subtitle { margin: 12px 0 32px; color: #64748b; font-size: 0.9375rem; line-height: 1.6; }
      form { display: flex; flex-direction: column; gap: 24px; }
      :host ::ng-deep .mat-mdc-form-field .mdc-text-field--filled { background: #f5f5f5; border-radius: 8px; }
      :host ::ng-deep .mat-mdc-form-field .mdc-line-ripple { display: none; }
      :host ::ng-deep .mat-mdc-form-field.mat-focused .mdc-text-field--filled { box-shadow: 0 0 0 2px rgba(63, 81, 181, 0.2); }
      .btn-full { margin-top: 8px; }
      .auth-links { display: flex; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: 0.8rem; }
      .auth-links a { color: #3f51b5; text-decoration: none; font-weight: 500; }
      .auth-links a:hover { text-decoration: underline; }
      .auth-right { background: linear-gradient(160deg, #2e43a8 0%, #3f51b5 50%, #4f63c5 100%); display: flex; align-items: center; justify-content: center; padding: 40px; }
      .art-wrap { max-width: 440px; text-align: center; color: #fff; }
      .market-art { width: 100%; max-width: 340px; }
      .art-wrap p { margin: 24px 0 0; color: rgba(255, 255, 255, 0.92); font-size: 0.95rem; line-height: 1.6; }
      @media (max-width: 768px) {
        .auth-layout { grid-template-columns: 1fr; }
        .auth-right { display: none; }
        .auth-left { padding: 32px 24px; }
        .brand { top: 32px; left: 24px; }
      }
    `,
  ],
})
export class ResetPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    resetToken: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(8), Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)]],
    confirmPassword: ['', [Validators.required]],
  });

  passwordMismatch() {
    const value = this.form.getRawValue();
    return value.newPassword !== value.confirmPassword;
  }

  async submit() {
    this.error.set(null);
    if (this.form.invalid || this.passwordMismatch()) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      const value = this.form.getRawValue();
      await this.api.post('/api/auth/reset-password', { resetToken: value.resetToken, newPassword: value.newPassword });
      this.toast.success('Password updated');
      await this.router.navigateByUrl('/auth/login');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Password reset failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
