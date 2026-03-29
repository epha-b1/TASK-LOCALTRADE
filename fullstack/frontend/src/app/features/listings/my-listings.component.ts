import { Component, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type ListingRow = {
  id: string;
  title: string;
  status: 'draft' | 'flagged' | 'published' | 'removed';
  priceCents: number;
  quantity: number;
  assetCount: number;
  readiness: boolean;
  blockedReason: string | null;
};

@Component({
  standalone: true,
  selector: 'app-my-listings',
  imports: [CommonModule, MatCardModule, MatButtonModule, MatChipsModule, MatIconModule, MatTooltipModule, ErrorMessageComponent, LoadingStateComponent, CurrencyPipe],
  template: `
    <section class="shell">
      <div class="toolbar">
        <h2>My Listings</h2>
        <button mat-flat-button color="primary" (click)="createNew()"><mat-icon>add</mat-icon>Create New Listing</button>
      </div>

      <app-loading-state [loading]="loading()" label="Loading listings"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <div class="listing-grid" *ngIf="!loading() && items().length">
        <mat-card class="listing-card" *ngFor="let row of items()">
          <div class="card-header">
            <h3>{{ row.title }}</h3>
            <mat-chip [ngClass]="chipClass(row.status)">{{ row.status }}</mat-chip>
          </div>
          <p class="price">{{ row.priceCents / 100 | currency:'USD':'symbol':'1.2-2' }}</p>
          <p class="meta">Quantity: {{ row.quantity }}</p>
          <p class="meta">Assets: <span class="badge">{{ row.assetCount }}</span></p>

          <div class="actions">
            <button mat-stroked-button (click)="edit(row.id)"><mat-icon>edit</mat-icon>Edit</button>
            <button mat-stroked-button color="accent" (click)="openUpload(row.id)"><mat-icon>cloud_upload</mat-icon>Upload Media</button>
            <button
              mat-stroked-button
              color="primary"
              (click)="publish(row)"
              [disabled]="!row.readiness || row.status === 'flagged'"
              [matTooltip]="publishTooltip(row)">
              <mat-icon>publish</mat-icon>
              Publish
            </button>
            <button mat-stroked-button color="warn" *ngIf="row.status === 'published'" (click)="remove(row.id)"><mat-icon>delete</mat-icon>Remove</button>
          </div>
        </mat-card>
      </div>

      <mat-card class="empty" *ngIf="!loading() && !items().length">
        <mat-icon>inventory_2</mat-icon>
        <h3>Create your first listing</h3>
        <button mat-flat-button color="primary" (click)="createNew()">Create Listing</button>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .shell { display: grid; gap: 18px; }
      .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
      .toolbar h2 { margin: 0; }
      .listing-grid { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .listing-card { display: grid; gap: 10px; border: 1px solid #e2e8f0; }
      .card-header { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
      .card-header h3 { margin: 0; font-size: 18px; }
      .price { margin: 0; font-size: 24px; color: #2e7d32; font-weight: 700; }
      .meta { margin: 0; color: #64748b; font-size: 13px; }
      .badge { background: #eceff1; border-radius: 999px; padding: 2px 8px; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      .chip-draft { background: #eceff1; color: #546e7a; }
      .chip-published { background: #e8f5e9; color: #2e7d32; }
      .chip-flagged { background: #fff8e1; color: #ef6c00; }
      .chip-removed { background: #ffebee; color: #c62828; }
      .empty { display: grid; place-items: center; text-align: center; gap: 8px; padding: 32px; }
      .empty .mat-icon { font-size: 48px; height: 48px; width: 48px; color: #90a4ae; }
      @media (max-width: 1199px) { .listing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 767px) { .listing-grid { grid-template-columns: 1fr; } }
    `,
  ],
})
export class MyListingsComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly items = signal<ListingRow[]>([]);

  constructor() {
    void this.load();
  }

  chipClass(status: ListingRow['status']) {
    return `chip-${status}`;
  }

  publishTooltip(row: ListingRow) {
    if (row.status === 'flagged') return 'Listing is flagged and cannot be published.';
    if (!row.readiness) return row.blockedReason ?? 'Listing is not ready to publish yet.';
    return 'Publish listing';
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.get<{ items: ListingRow[] }>('/api/listings');
      this.items.set(res.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load listings';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  createNew() {
    void this.router.navigateByUrl('/listings/create');
  }

  edit(id: string) {
    void this.router.navigate(['/listings', id], { queryParams: { mode: 'edit' } });
  }

  openUpload(id: string) {
    void this.router.navigate(['/upload'], { queryParams: { listingId: id } });
  }

  async publish(row: ListingRow) {
    if (!row.readiness || row.status === 'flagged') return;
    try {
      await this.api.post(`/api/listings/${row.id}/publish`, {});
      this.toast.success('Listing published');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to publish listing';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  async remove(id: string) {
    try {
      await this.api.delete(`/api/listings/${id}`);
      this.toast.info('Listing removed');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to remove listing';
      this.error.set(message);
      this.toast.error(message);
    }
  }
}
