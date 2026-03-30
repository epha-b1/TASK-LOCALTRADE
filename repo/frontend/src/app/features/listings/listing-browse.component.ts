import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { ErrorMessageComponent } from '../../shared/error-message.component';

type ListingCard = {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  quantity: number;
  seller_display_name?: string;
};

@Component({
  standalone: true,
  selector: 'app-listing-browse',
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    LoadingStateComponent,
    ErrorMessageComponent,
    CurrencyPipe,
  ],
  template: `
    <mat-card class="browse-shell">
      <div class="browse-header">
        <h2>Marketplace Listings</h2>
        <button mat-flat-button color="primary" (click)="load()" [disabled]="loading()">
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
      </div>

      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Search listings</mat-label>
        <input matInput [(ngModel)]="searchTerm" placeholder="Title or description" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      <app-loading-state [loading]="loading()" label="Loading listings"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <div class="listing-grid" *ngIf="loading()">
        <mat-card class="listing-card skeleton" *ngFor="let _item of [1,2,3,4,5,6]">
          <div class="skeleton-image"></div>
          <div class="skeleton-line short"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </mat-card>
      </div>

      <div class="listing-grid" *ngIf="!loading() && filteredRows().length">
        <mat-card class="listing-card" *ngFor="let row of filteredRows()">
          <div class="image-placeholder"><mat-icon>image</mat-icon></div>
          <h3>{{ row.title }}</h3>
          <p class="description">{{ row.description }}</p>
          <p class="price">{{ row.price_cents / 100 | currency:'USD':'symbol':'1.2-2' }}</p>
          <p class="muted">{{ row.quantity }} available</p>
          <p class="muted">Seller: {{ row.seller_display_name || 'Local seller' }}</p>
          <button mat-flat-button color="primary" (click)="viewOrder(row.id)">
            <mat-icon>shopping_cart</mat-icon>
            View & Order
          </button>
        </mat-card>
      </div>

      <p class="empty" *ngIf="!loading() && !filteredRows().length">No listings available.</p>
    </mat-card>
  `,
  styles: [
    `
      .browse-shell { display: grid; gap: 18px; }
      .browse-header { display: flex; justify-content: space-between; gap: 1rem; align-items: center; flex-wrap: wrap; }
      .browse-header h2 { margin: 0; font-size: 1.5rem; }
      .search-field { width: 100%; }
      .listing-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
      .listing-card { border: 1px solid #e2e8f0; display: grid; gap: 10px; padding: 10px; transition: transform .2s ease, box-shadow .2s ease; }
      .listing-card:hover { transform: translateY(-2px); box-shadow: 0 10px 18px rgba(15,23,42,.08); }
      .image-placeholder { height: 150px; border-radius: 10px; background: linear-gradient(135deg, #eef2f9, #e3e8f3); display:flex; align-items:center; justify-content:center; color:#78909c; }
      .image-placeholder .mat-icon { font-size: 36px; height: 36px; width: 36px; }
      .listing-card h3 { margin: 0; font-size: 1rem; }
      .description { color: #64748b; min-height: 42px; margin: 0; }
      .price { color: #2e7d32; font-weight: 700; font-size: 20px; margin: 0; }
      .muted { color: #64748b; margin: 0; font-size: 13px; }
      .empty { color: #607d8b; margin-top: 0.75rem; }
      .skeleton { animation: pulse 1.2s ease-in-out infinite; }
      .skeleton-image { height: 140px; border-radius: 10px; background: #eceff1; }
      .skeleton-line { height: 12px; border-radius: 999px; background: #eceff1; }
      .skeleton-line.short { width: 65%; }
      @keyframes pulse { 0%,100% { opacity: .7; } 50% { opacity: 1; } }
    `,
  ],
})
export class ListingBrowseComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly rows = signal<ListingCard[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  searchTerm = '';
  readonly filteredRows = computed(() => {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.rows();
    return this.rows().filter((row) => row.title.toLowerCase().includes(term) || row.description.toLowerCase().includes(term));
  });

  constructor() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<{ items: ListingCard[] }>('/api/storefront/listings');
      this.rows.set(response.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load listings';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  viewOrder(id: string) {
    void this.router.navigate(['/listings', id]);
  }
}
