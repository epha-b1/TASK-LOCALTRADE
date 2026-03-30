import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type OrderRow = {
  id: string;
  listingTitle: string;
  status: 'placed' | 'cancelled' | 'payment_captured' | 'completed' | 'refunded';
  totalCents: number;
  createdAt: string;
  completedAt?: string | null;
};

@Component({
  standalone: true,
  selector: 'app-order-list',
  imports: [CommonModule, MatCardModule, MatButtonModule, MatTableModule, MatChipsModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent, DatePipe, CurrencyPipe],
  template: `
    <section class="orders-shell">
      <div class="header-row">
        <h2>Orders</h2>
        <button mat-flat-button color="primary" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>Refresh</button>
      </div>

      <div class="stats-grid" *ngIf="!loading()">
        <mat-card><p>Total</p><h3>{{ stats().total }}</h3></mat-card>
        <mat-card><p>Pending</p><h3>{{ stats().pending }}</h3></mat-card>
        <mat-card><p>Completed</p><h3>{{ stats().completed }}</h3></mat-card>
      </div>

      <app-loading-state [loading]="loading()" label="Loading orders"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <table mat-table [dataSource]="rows()" *ngIf="!loading() && rows().length" class="orders-table desktop-view">
        <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>Order</th><td mat-cell *matCellDef="let row">{{ shortId(row.id) }}</td></ng-container>
        <ng-container matColumnDef="listingTitle"><th mat-header-cell *matHeaderCellDef>Listing</th><td mat-cell *matCellDef="let row">{{ row.listingTitle }}</td></ng-container>
        <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th><td mat-cell *matCellDef="let row"><span class="status-chip" [ngClass]="statusClass(row.status)">{{ statusLabel(row.status) }}</span></td></ng-container>
        <ng-container matColumnDef="total"><th mat-header-cell *matHeaderCellDef>Total</th><td mat-cell *matCellDef="let row">{{ row.totalCents / 100 | currency:'USD':'symbol':'1.2-2' }}</td></ng-container>
        <ng-container matColumnDef="date"><th mat-header-cell *matHeaderCellDef>Date</th><td mat-cell *matCellDef="let row">{{ row.createdAt | date:'mediumDate' }}</td></ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let row" class="actions-cell">
            <button mat-stroked-button *ngIf="canLeaveReview(row)" (click)="goReview(row.id)"><mat-icon>rate_review</mat-icon>Leave Review</button>
            <button mat-stroked-button color="accent" *ngIf="canCapture(row)" (click)="goCapture(row)"><mat-icon>payments</mat-icon>Capture Payment</button>
            <button mat-stroked-button color="primary" *ngIf="canComplete(row)" (click)="completeOrder(row)"><mat-icon>task_alt</mat-icon>Complete</button>
            <button mat-stroked-button (click)="viewDetails(row.id)"><mat-icon>open_in_new</mat-icon>View Details</button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="displayed"></tr>
        <tr mat-row *matRowDef="let row; columns: displayed"></tr>
      </table>

      <div class="mobile-cards" *ngIf="!loading() && rows().length">
        <mat-card *ngFor="let row of rows()" class="mobile-order-card">
          <h3>{{ row.listingTitle }}</h3>
          <p>{{ shortId(row.id) }}</p>
          <span class="status-chip" [ngClass]="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
          <p>{{ row.totalCents / 100 | currency:'USD':'symbol':'1.2-2' }}</p>
          <div class="actions-cell">
            <button mat-stroked-button *ngIf="canLeaveReview(row)" (click)="goReview(row.id)">Leave Review</button>
            <button mat-stroked-button color="accent" *ngIf="canCapture(row)" (click)="goCapture(row)">Capture Payment</button>
            <button mat-stroked-button color="primary" *ngIf="canComplete(row)" (click)="completeOrder(row)">Complete</button>
            <button mat-stroked-button (click)="viewDetails(row.id)">View Details</button>
          </div>
        </mat-card>
      </div>

      <mat-card class="empty" *ngIf="!loading() && !rows().length">No orders found.</mat-card>
    </section>
  `,
  styles: [
    `
      .orders-shell { display: grid; gap: 18px; }
      .header-row { display: flex; justify-content: space-between; align-items: center; }
      .header-row h2 { margin: 0; }
      .stats-grid { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .stats-grid mat-card { padding: 16px !important; }
      .stats-grid p { margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
      .stats-grid h3 { margin: 6px 0 0; font-size: 28px; }
      .orders-table { width: 100%; }
      .orders-table th { color: #475569; font-weight: 600; }
      .actions-cell { display: flex; gap: 8px; flex-wrap: wrap; }
      .status-chip {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: .8rem;
        font-weight: 600;
      }
      .status-placed { background: #e3f2fd; color: #1565c0; }
      .status-cancelled { background: #eceff1; color: #455a64; }
      .status-payment-captured { background: #fff8e1; color: #f9a825; }
      .status-completed { background: #e8f5e9; color: #2e7d32; }
      .status-refunded { background: #ede7f6; color: #5e35b1; }
      .mobile-cards { display: none; gap: 12px; }
      .mobile-order-card { display: grid; gap: 8px; border: 1px solid #e2e8f0; }
      .empty { padding: 24px; text-align: center; color: #607d8b; }
      @media (max-width: 1199px) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 767px) {
        .stats-grid { grid-template-columns: 1fr; }
        .desktop-view { display: none; }
        .mobile-cards { display: grid; }
      }
    `,
  ],
})
export class OrderListComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);

  readonly rows = signal<OrderRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly displayed = ['id', 'listingTitle', 'status', 'total', 'date', 'actions'];
  readonly stats = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      pending: rows.filter((x) => x.status === 'placed' || x.status === 'payment_captured').length,
      completed: rows.filter((x) => x.status === 'completed').length,
    };
  });

  constructor() {
    void this.load();
  }

  shortId(id: string) {
    return `${id.slice(0, 8)}...`;
  }

  statusLabel(status: OrderRow['status']) {
    return status.replace('_', ' ');
  }

  statusClass(status: OrderRow['status']) {
    return 'status-' + status.replace('_', '-');
  }

  canLeaveReview(row: OrderRow) {
    if (!(row.status === 'completed' && this.auth.hasRole('buyer'))) return false;
    const completed = new Date(row.completedAt ?? row.createdAt).getTime();
    return Date.now() - completed <= 14 * 24 * 60 * 60 * 1000;
  }

  canCapture(row: OrderRow) {
    return (this.auth.hasRole('seller') || this.auth.hasRole('admin')) && row.status === 'placed';
  }

  canComplete(row: OrderRow) {
    return this.auth.hasRole('seller') && row.status === 'payment_captured';
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<{ items: OrderRow[] }>('/api/orders');
      this.rows.set(response.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load orders';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  goReview(orderId: string) {
    void this.router.navigate(['/reviews/form'], { queryParams: { orderId } });
  }

  goCapture(row: OrderRow) {
    void this.router.navigate(['/orders/payment-capture'], { queryParams: { orderId: row.id } });
  }

  async completeOrder(row: OrderRow) {
    try {
      await this.api.post(`/api/orders/${row.id}/complete`, { note: 'Completed from order list' });
      this.toast.success('Order marked completed');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to complete order';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  viewDetails(orderId: string) {
    void this.router.navigate(['/orders', orderId]);
  }
}
