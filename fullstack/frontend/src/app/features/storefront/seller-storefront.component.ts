import { Component, inject, signal } from '@angular/core';
import { CommonModule, DatePipe, PercentPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type Metrics = {
  avgRating90d: number | null;
  positiveRate90d: number | null;
  reviewCount90d: number;
};

type ReviewCard = {
  id: string;
  rating: number;
  body: string;
  reviewerName: string;
  createdAt: string;
  underAppeal: boolean;
  removedByArbitration: boolean;
};

type MeProfile = {
  id: string;
  displayName: string;
  sensitiveProfile?: {
    taxIdMasked: string | null;
    bankRoutingMasked: string | null;
    bankAccountMasked: string | null;
  };
};

@Component({
  standalone: true,
  selector: 'app-seller-storefront',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatChipsModule, MatIconModule, MatProgressBarModule, ErrorMessageComponent, LoadingStateComponent, DatePipe, PercentPipe],
  template: `
    <mat-card>
      <div class="header-row">
        <h2>{{ auth.hasRole('seller') ? 'Your Seller Storefront' : 'Seller Storefront' }}</h2>
        <button mat-stroked-button *ngIf="!auth.hasRole('seller')" (click)="backToListings()"><mat-icon>arrow_back</mat-icon>Back to Listings</button>
      </div>

      <mat-card class="profile-card" *ngIf="auth.hasRole('seller')">
        <h3>{{ sellerName() || 'Seller Profile' }}</h3>
        <p class="masked">Tax ID: {{ sensitiveMask().taxIdMasked || 'Not set' }}</p>
        <p class="masked">Routing: {{ sensitiveMask().bankRoutingMasked || 'Not set' }}</p>
        <p class="masked">Account: {{ sensitiveMask().bankAccountMasked || 'Not set' }}</p>

        <form [formGroup]="sensitiveForm" (ngSubmit)="saveSensitive()" class="sensitive-form">
          <mat-form-field appearance="outline"><mat-label>Tax ID</mat-label><input matInput formControlName="taxId"><mat-error *ngIf="sensitiveForm.controls.taxId.invalid && sensitiveForm.controls.taxId.touched">Minimum 4 chars</mat-error></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Bank Routing</mat-label><input matInput formControlName="bankRouting"><mat-error *ngIf="sensitiveForm.controls.bankRouting.invalid && sensitiveForm.controls.bankRouting.touched">Minimum 4 chars</mat-error></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Bank Account</mat-label><input matInput formControlName="bankAccount"><mat-error *ngIf="sensitiveForm.controls.bankAccount.invalid && sensitiveForm.controls.bankAccount.touched">Minimum 4 chars</mat-error></mat-form-field>
          <button mat-flat-button color="accent" [disabled]="loading()"><mat-icon>save</mat-icon>Save Sensitive Fields</button>
        </form>
      </mat-card>

      <form [formGroup]="form" (ngSubmit)="load()" class="filters">
        <mat-form-field appearance="outline">
          <mat-label>Sort Reviews</mat-label>
          <mat-select formControlName="sortRule">
            <mat-option value="verified_purchase_first">Verified purchase first</mat-option>
            <mat-option value="most_recent">Most recent</mat-option>
            <mat-option value="highest_rated">Highest rated</mat-option>
          </mat-select>
        </mat-form-field>
        <button mat-flat-button color="primary">Load</button>
      </form>

      <app-loading-state [loading]="loading()" label="Loading storefront"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <section class="metrics" *ngIf="metrics() as metric">
        <mat-card class="metric-card">
          <h3>Avg Rating (90d)</h3>
          <p>{{ metric.avgRating90d ?? 'N/A' }}</p>
          <p class="stars" *ngIf="metric.avgRating90d !== null">{{ stars(roundRating(metric.avgRating90d)) }}</p>
        </mat-card>
        <mat-card class="metric-card">
          <h3>Positive Rate (90d)</h3>
          <p>{{ metric.positiveRate90d !== null ? (metric.positiveRate90d / 100 | percent:'1.0-2') : 'N/A' }}</p>
          <mat-progress-bar *ngIf="metric.positiveRate90d !== null" mode="determinate" [value]="metric.positiveRate90d"></mat-progress-bar>
        </mat-card>
        <mat-card class="metric-card">
          <h3>Review Count (90d)</h3>
          <p>{{ metric.reviewCount90d }}</p>
        </mat-card>
      </section>

      <section class="reviews" *ngIf="reviews().length; else emptyState">
        <mat-card *ngFor="let review of reviews()" class="review-card">
          <div class="review-header">
            <div>
              <strong>{{ review.reviewerName }}</strong>
              <p>{{ review.createdAt | date:'mediumDate' }}</p>
            </div>
            <p class="stars">{{ stars(review.rating) }}</p>
          </div>

          <p>{{ review.body }}</p>

          <div class="chips">
            <mat-chip color="accent" selected *ngIf="review.underAppeal">Under Appeal</mat-chip>
            <mat-chip color="warn" selected *ngIf="review.removedByArbitration">Removed by Arbitration</mat-chip>
          </div>

          <button mat-stroked-button color="primary" *ngIf="auth.hasRole('seller')" (click)="appeal(review.id)"><mat-icon>gavel</mat-icon>Appeal this review</button>
        </mat-card>
      </section>

      <ng-template #emptyState>
        <mat-card class="empty-state">
          <mat-icon>rate_review</mat-icon>
          <h3>No reviews yet</h3>
        </mat-card>
      </ng-template>
    </mat-card>
  `,
  styles: [
    `
      mat-card { max-width: 1100px; margin: 0 auto; }
      .header-row { display:flex; justify-content:space-between; gap:.75rem; align-items:center; flex-wrap:wrap; margin-bottom:.5rem; }
      .header-row h2 { margin: 0; }
      .profile-card { margin-bottom: 16px; border: 1px solid #e2e8f0; }
      .masked { margin: 0 0 6px; color: #64748b; font-size: 13px; }
      .sensitive-form { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; margin-top: 8px; }
      .filters { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
      .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; margin: 1rem 0; }
      .metric-card { border: 1px solid #e2e8f0; }
      .metric-card h3 { margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
      .metric-card p { font-size: 1.5rem; font-weight: 700; margin: 0.25rem 0; }
      .reviews { display: grid; gap: 0.75rem; }
      .review-card { border: 1px solid #e2e8f0; }
      .review-header { display: flex; justify-content: space-between; align-items: center; }
      .review-header p { margin: 0; color: #607d8b; }
      .stars { font-weight: 700; letter-spacing: 1px; color: #ff8f00; }
      .chips { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
      .empty-state { text-align: center; padding: 24px; color: #78909c; }
      .empty-state mat-icon { font-size: 64px; height: 64px; width: 64px; }
      @media (max-width: 1199px) { .sensitive-form { grid-template-columns: 1fr 1fr; } }
      @media (max-width: 900px) { .metrics { grid-template-columns: 1fr; } .sensitive-form { grid-template-columns: 1fr; } }
    `,
  ],
})
export class SellerStorefrontComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);

  readonly sellerId = signal<string>('');
  readonly sellerName = signal<string>('');
  readonly sensitiveMask = signal<{ taxIdMasked: string | null; bankRoutingMasked: string | null; bankAccountMasked: string | null }>({
    taxIdMasked: null,
    bankRoutingMasked: null,
    bankAccountMasked: null,
  });
  readonly metrics = signal<Metrics | null>(null);
  readonly reviews = signal<ReviewCard[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    sortRule: ['verified_purchase_first' as 'verified_purchase_first' | 'most_recent' | 'highest_rated', [Validators.required]],
  });
  readonly sensitiveForm = this.fb.nonNullable.group({
    taxId: ['', [Validators.minLength(4)]],
    bankRouting: ['', [Validators.minLength(4)]],
    bankAccount: ['', [Validators.minLength(4)]],
  });

  constructor() {
    void this.initSellerContext();
  }

  private async initSellerContext() {
    const routeSellerId = this.route.snapshot.paramMap.get('sellerId');
    if (routeSellerId) {
      this.sellerId.set(routeSellerId);
      await this.load();
      return;
    }

    if (!this.auth.hasRole('seller')) {
      const message = 'Seller storefront not available without a seller route.';
      this.error.set(message);
      this.toast.error(message);
      return;
    }

    try {
      const me = await this.api.get<MeProfile>('/api/users/me');
      this.sellerId.set(me.id);
      this.sellerName.set(me.displayName);
      this.sensitiveMask.set({
        taxIdMasked: me.sensitiveProfile?.taxIdMasked ?? null,
        bankRoutingMasked: me.sensitiveProfile?.bankRoutingMasked ?? null,
        bankAccountMasked: me.sensitiveProfile?.bankAccountMasked ?? null,
      });
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to auto-load seller storefront';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  async saveSensitive() {
    if (this.sensitiveForm.invalid) {
      this.sensitiveForm.markAllAsTouched();
      return;
    }
    const value = this.sensitiveForm.getRawValue();
    if (!value.taxId && !value.bankRouting && !value.bankAccount) {
      this.toast.error('Enter at least one field to update');
      return;
    }
    try {
      await this.api.patch('/api/users/me/seller-profile', value);
      this.toast.success('Sensitive profile fields updated');
      const me = await this.api.get<MeProfile>('/api/users/me');
      this.sensitiveMask.set({
        taxIdMasked: me.sensitiveProfile?.taxIdMasked ?? null,
        bankRoutingMasked: me.sensitiveProfile?.bankRoutingMasked ?? null,
        bankAccountMasked: me.sensitiveProfile?.bankAccountMasked ?? null,
      });
      this.sensitiveForm.reset({ taxId: '', bankRouting: '', bankAccount: '' });
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to update sensitive profile fields';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  async load() {
    const sellerId = this.sellerId();
    if (!sellerId) {
      this.error.set('Seller context unavailable');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.loading.set(false);
      return;
    }
    try {
      const sortRule = this.form.getRawValue().sortRule;
      const [metrics, reviews] = await Promise.all([
        this.api.get<Metrics>(`/api/storefront/sellers/${sellerId}/credit-metrics`),
        this.api.get<{ items: ReviewCard[] }>(`/api/storefront/sellers/${sellerId}/reviews?sortRule=${sortRule}`),
      ]);
      this.metrics.set(metrics);
      this.reviews.set(reviews.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load storefront';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  stars(rating: number) {
    return '★'.repeat(Math.max(0, Math.min(5, rating))) + '☆'.repeat(5 - Math.max(0, Math.min(5, rating)));
  }

  roundRating(value: number) {
    return Math.round(value);
  }

  async appeal(reviewId: string) {
    try {
      await this.api.post(`/api/reviews/${reviewId}/appeal`, { reason: 'Seller appealed from storefront' });
      this.toast.success('Appeal submitted');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Appeal failed';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  backToListings() {
    void this.router.navigate(['/listings/browse']);
  }
}
