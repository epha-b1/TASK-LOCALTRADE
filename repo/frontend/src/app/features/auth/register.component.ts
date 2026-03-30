import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

@Component({
  standalone: true,
  selector: 'app-register',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <section class="auth-layout">
      <div class="auth-left">
        <a class="brand" routerLink="/auth/login">
          <mat-icon>storefront</mat-icon>
          <span>LocalTrade</span>
        </a>

        <div class="form-shell">
          <h1>Create your account</h1>
          <p class="subtitle">Set up your LocalTrade profile to buy, sell, and operate with role-based access.</p>

          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="fill"><mat-label>Email</mat-label><mat-icon matPrefix>mail</mat-icon><input matInput formControlName="email"><mat-error *ngIf="form.controls.email.invalid && form.controls.email.touched">Valid email required</mat-error></mat-form-field>
            <mat-form-field appearance="fill"><mat-label>Display Name</mat-label><mat-icon matPrefix>person</mat-icon><input matInput formControlName="displayName"><mat-error *ngIf="form.controls.displayName.invalid && form.controls.displayName.touched">Required</mat-error></mat-form-field>
            <mat-form-field appearance="fill"><mat-label>Password</mat-label><mat-icon matPrefix>lock</mat-icon><input matInput type="password" formControlName="password"><mat-error *ngIf="form.controls.password.invalid && form.controls.password.touched">Min 8 chars with letters and numbers</mat-error></mat-form-field>
            <mat-form-field appearance="fill">
              <mat-label>Account Type</mat-label>
              <mat-icon matPrefix>shield</mat-icon>
              <mat-select formControlName="rolePreset">
                <mat-option value="buyer">Buyer</mat-option>
                <mat-option value="seller">Seller</mat-option>
                <mat-option value="both">Buyer + Seller</mat-option>
              </mat-select>
              <mat-error *ngIf="form.controls.rolePreset.invalid && form.controls.rolePreset.touched">Required</mat-error>
            </mat-form-field>
            <button mat-flat-button color="primary" class="btn-full" [disabled]="loading()">Register</button>
            <div class="auth-links">
              <a routerLink="/auth/login">Already have an account? Sign in</a>
              <a routerLink="/auth/forgot-password">Forgot password?</a>
            </div>
            <p *ngIf="success()" class="success">{{ success() }}</p>
            <app-loading-state [loading]="loading()"></app-loading-state>
            <app-error-message [message]="error()"></app-error-message>
          </form>
        </div>
      </div>

      <aside class="auth-right">
        <div class="art-wrap" aria-hidden="true">
          <svg viewBox="0 0 360 320" class="market-art">
            <rect x="44" y="84" width="272" height="176" rx="20" fill="#ffffff" fill-opacity="0.15" />
            <path d="M72 146h216" stroke="#ffffff" stroke-opacity="0.34" stroke-width="14" stroke-linecap="round" />
            <path d="M72 178h140" stroke="#ffffff" stroke-opacity="0.26" stroke-width="12" stroke-linecap="round" />
            <circle cx="250" cy="183" r="32" fill="#ffffff" fill-opacity="0.2" />
            <path d="M130 244h100" stroke="#ffffff" stroke-width="11" stroke-linecap="round" />
            <rect x="154" y="52" width="52" height="52" rx="14" fill="#ffffff" fill-opacity="0.3" />
          </svg>
          <p>Start building trust with verified listings, secure transactions, and transparent reviews.</p>
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
      .success { margin: 0; color: #2e7d32; font-weight: 600; }
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
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    displayName: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)]],
    rolePreset: ['buyer' as 'buyer' | 'seller' | 'both', [Validators.required]],
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
      const value = this.form.getRawValue();
      const roles = value.rolePreset === 'both' ? ['buyer', 'seller'] : [value.rolePreset];
      await this.api.post('/api/auth/register', { email: value.email, displayName: value.displayName, password: value.password, roles });
      this.form.reset({ email: '', displayName: '', password: '', rolePreset: 'buyer' });
      this.success.set('Registration successful. You can now log in.');
      this.toast.success('Registration successful');
      await this.router.navigateByUrl('/auth/login');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Registration failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
