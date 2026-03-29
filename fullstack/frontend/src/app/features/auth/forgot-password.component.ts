import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
  selector: 'app-forgot-password',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <section class="auth-layout">
      <div class="auth-left">
        <a class="brand" routerLink="/auth/login">
          <mat-icon>storefront</mat-icon>
          <span>LocalTrade</span>
        </a>

        <div class="form-shell">
          <h1>Forgot password?</h1>
          <p class="subtitle">Enter your account email and we will create a reset request for your administrator workflow.</p>

          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="fill">
              <mat-label>Email</mat-label>
              <mat-icon matPrefix>mail</mat-icon>
              <input matInput formControlName="email">
              <mat-error *ngIf="form.controls.email.invalid && form.controls.email.touched">Valid email required</mat-error>
            </mat-form-field>
            <button mat-flat-button color="primary" class="btn-full" [disabled]="loading()">Create Reset Request</button>
          </form>

          <div class="auth-links">
            <a routerLink="/auth/login">Back to login</a>
            <a routerLink="/auth/reset-password">Have a token? Reset now</a>
          </div>

          <app-loading-state [loading]="loading()" label="Creating reset request"></app-loading-state>
          <app-error-message [message]="error()"></app-error-message>
          <section class="success-box" *ngIf="success()">
            <p>{{ success() }}</p>
          </section>
        </div>
      </div>

      <aside class="auth-right">
        <div class="art-wrap" aria-hidden="true">
          <svg viewBox="0 0 360 320" class="market-art">
            <rect x="54" y="92" width="252" height="164" rx="18" fill="#ffffff" fill-opacity="0.14" />
            <rect x="88" y="126" width="184" height="20" rx="10" fill="#ffffff" fill-opacity="0.3" />
            <rect x="88" y="160" width="112" height="14" rx="7" fill="#ffffff" fill-opacity="0.24" />
            <circle cx="236" cy="201" r="34" fill="#ffffff" fill-opacity="0.2" />
            <rect x="150" y="56" width="58" height="48" rx="12" fill="#ffffff" fill-opacity="0.28" />
          </svg>
          <p>Secure account recovery designed for offline operations and controlled access.</p>
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
      .success-box { margin-top: 12px; padding: 12px; border: 1px solid #c8e6c9; border-radius: 8px; background: #f1f8e9; }
      .success-box p { margin: 0; }
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
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  async submit() {
    this.error.set(null);
    this.success.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      await this.api.post<{ message: string }>('/api/auth/forgot-password', this.form.getRawValue());
      const message = 'Reset request created. Ask your system administrator to retrieve your reset token from the admin panel and provide it to you. Then use the Reset Password page to set your new password.';
      this.success.set(message);
      this.toast.success(message);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to create reset request';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
