import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <section class="auth-layout">
      <div class="auth-left">
        <a class="brand" routerLink="/auth/login">
          <mat-icon>storefront</mat-icon>
          <span>LocalTrade</span>
        </a>

        <div class="form-shell">
          <h1>Welcome back</h1>
          <p class="subtitle">Sign in to continue managing your local marketplace operations.</p>

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <mat-form-field appearance="fill">
              <mat-label>Email</mat-label>
              <mat-icon matPrefix>mail</mat-icon>
              <input matInput formControlName="email" />
              <mat-error *ngIf="form.controls.email.invalid && form.controls.email.touched">Valid email is required</mat-error>
            </mat-form-field>

            <mat-form-field appearance="fill">
              <mat-label>Password</mat-label>
              <mat-icon matPrefix>lock</mat-icon>
              <input matInput type="password" formControlName="password" />
              <mat-error *ngIf="form.controls.password.invalid && form.controls.password.touched">Password is required</mat-error>
            </mat-form-field>

            <button mat-flat-button color="primary" class="btn-full" [disabled]="loading()">Sign In</button>

            <div class="auth-links">
              <a routerLink="/auth/forgot-password">Forgot password?</a>
              <a routerLink="/auth/register">Create account</a>
            </div>

            <app-loading-state [loading]="loading()" label="Signing in"></app-loading-state>
            <app-error-message [message]="error()"></app-error-message>
          </form>
        </div>
      </div>

      <aside class="auth-right">
        <div class="art-wrap" aria-hidden="true">
          <svg viewBox="0 0 360 320" class="market-art">
            <rect x="40" y="88" width="280" height="170" rx="18" fill="#ffffff" fill-opacity="0.15" />
            <rect x="68" y="116" width="224" height="18" rx="9" fill="#ffffff" fill-opacity="0.32" />
            <rect x="68" y="146" width="138" height="14" rx="7" fill="#ffffff" fill-opacity="0.26" />
            <circle cx="258" cy="154" r="30" fill="#ffffff" fill-opacity="0.2" />
            <path d="M128 248l22-54h58l22 54" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none" />
            <circle cx="180" cy="66" r="24" fill="#ffffff" fill-opacity="0.28" />
          </svg>
          <p>Trusted local commerce for buyers, sellers, and operations teams.</p>
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
      .auth-links { display: flex; justify-content: space-between; gap: 12px; margin-top: 2px; font-size: 0.8rem; }
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
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  async submit() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      await this.auth.login(this.form.value.email!, this.form.value.password!);
      this.toast.success('Welcome back');
      await this.router.navigateByUrl(this.auth.defaultHomeRoute());
    } catch (e: any) {
      const message = e?.error?.message ?? 'Login failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
