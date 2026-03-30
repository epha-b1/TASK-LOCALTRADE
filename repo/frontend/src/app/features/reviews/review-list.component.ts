import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type ReviewRow = {
  id: string;
  rating: number;
  body: string;
  reviewerName: string;
  createdAt: string;
};

type SellerOption = {
  id: string;
  name: string;
};

type StorefrontListing = {
  seller_id: string;
  seller_display_name?: string;
};

@Component({
  standalone: true,
  selector: 'app-review-list',
  imports: [CommonModule, FormsModule, MatCardModule, MatIconModule, MatFormFieldModule, MatSelectModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <section class="review-shell">
      <h2>Seller Reviews</h2>

      <mat-form-field appearance="outline" class="seller-select" *ngIf="!auth.hasRole('seller') && sellerOptions().length">
        <mat-label>Seller</mat-label>
        <mat-select [value]="selectedSellerId()" (selectionChange)="onSellerChange($event.value)">
          <mat-option *ngFor="let seller of sellerOptions()" [value]="seller.id">{{ seller.name }}</mat-option>
        </mat-select>
      </mat-form-field>

      <app-loading-state [loading]="loading()" label="Loading reviews"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <div class="reviews" *ngIf="!loading() && rows().length">
        <mat-card *ngFor="let row of rows()" class="review-card">
          <strong>{{ row.reviewerName }}</strong>
          <p>{{ stars(row.rating) }}</p>
          <p>{{ row.body }}</p>
        </mat-card>
      </div>
    </section>
  `,
  styles: [
    `
      .review-shell { display: grid; gap: 14px; }
      .review-shell h2 { margin: 0; }
      .seller-select { max-width: 360px; }
      .reviews { display: grid; gap: 12px; }
      .review-card { border: 1px solid #e2e8f0; display: grid; gap: 6px; }
      .review-card p { margin: 0; color: #475569; }
      .review-card strong { font-size: .95rem; }
    `,
  ],
})
export class ReviewListComponent {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly rows = signal<ReviewRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly sellerOptions = signal<SellerOption[]>([]);
  readonly selectedSellerId = signal<string>('');

  constructor() {
    void this.load();
  }

  stars(rating: number) {
    return '★'.repeat(Math.max(0, Math.min(5, rating))) + '☆'.repeat(5 - Math.max(0, Math.min(5, rating)));
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      if (!this.auth.hasRole('seller')) {
        const listings = await this.api.get<{ items: StorefrontListing[] }>('/api/storefront/listings');
        const unique = new Map<string, string>();
        for (const row of listings.items ?? []) {
          if (!unique.has(row.seller_id)) {
            unique.set(row.seller_id, row.seller_display_name || 'Seller');
          }
        }
        const options = [...unique.entries()].map(([id, name]) => ({ id, name }));
        this.sellerOptions.set(options);
        if (!options.length) {
          this.rows.set([]);
          return;
        }
        const sellerId = this.selectedSellerId() || options[0].id;
        this.selectedSellerId.set(sellerId);
        const response = await this.api.get<{ items: ReviewRow[] }>(`/api/storefront/sellers/${sellerId}/reviews`);
        this.rows.set(response.items ?? []);
        return;
      }
      const me = await this.api.get<{ id: string }>('/api/users/me');
      const response = await this.api.get<{ items: ReviewRow[] }>(`/api/storefront/sellers/${me.id}/reviews`);
      this.rows.set(response.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load reviews';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  async onSellerChange(sellerId: string) {
    this.selectedSellerId.set(sellerId);
    await this.load();
  }
}
