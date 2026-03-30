import { Component, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { ErrorMessageComponent } from '../../shared/error-message.component';

type OrderDetail = {
  id: string;
  listing: { id: string; title: string };
  status: 'placed' | 'cancelled' | 'payment_captured' | 'completed' | 'refunded';
  quantity: number;
  totalCents: number;
  createdAt: string;
  completedAt?: string | null;
  paymentStatus: string;
  paymentTenderType: string | null;
  refundStatus: string;
  refundAmountCents: number | null;
};

@Component({
  standalone: true,
  selector: 'app-order-detail',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatChipsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    LoadingStateComponent,
    ErrorMessageComponent,
    DatePipe,
    CurrencyPipe,
  ],
  template: `
    <section class="detail-shell">
      <app-loading-state [loading]="loading()" label="Loading order details"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <mat-card *ngIf="order() as data" class="detail-card">
        <div class="title-row">
          <div>
            <h2>{{ data.listing.title }}</h2>
            <p class="muted">Order {{ shortId(data.id) }}</p>
          </div>
          <mat-chip [ngClass]="statusClass(data.status)">{{ statusLabel(data.status) }}</mat-chip>
        </div>

        <div class="grid">
          <div>
            <p class="label">Quantity</p>
            <p>{{ data.quantity }}</p>
          </div>
          <div>
            <p class="label">Total</p>
            <p>{{ data.totalCents / 100 | currency:'USD':'symbol':'1.2-2' }}</p>
          </div>
          <div>
            <p class="label">Payment</p>
            <p>{{ paymentLabel(data) }}</p>
          </div>
          <div>
            <p class="label">Refund</p>
            <p>{{ refundLabel(data) }}</p>
          </div>
          <div>
            <p class="label">Placed</p>
            <p>{{ data.createdAt | date:'medium' }}</p>
          </div>
          <div>
            <p class="label">Completed</p>
            <p>{{ data.completedAt ? (data.completedAt | date:'medium') : '—' }}</p>
          </div>
        </div>

        <div class="actions-row">
          <button mat-stroked-button color="warn" *ngIf="canCancel(data)" (click)="cancelOrder(data.id)">
            <mat-icon>cancel</mat-icon>
            Cancel Order
          </button>
          <button mat-flat-button color="primary" *ngIf="canLeaveReview(data)" (click)="goReview(data.id)">
            <mat-icon>rate_review</mat-icon>
            Leave Review
          </button>
          <button mat-flat-button color="accent" *ngIf="canCapture(data)" (click)="goCapture(data.id)">
            <mat-icon>payments</mat-icon>
            Capture Payment
          </button>
          <button mat-stroked-button color="warn" *ngIf="canRefund(data)" (click)="showRefundForm.set(true)">
            <mat-icon>undo</mat-icon>
            Request Refund
          </button>
        </div>

        <div class="refund-form" *ngIf="showRefundForm() && canRefund(data)" [formGroup]="refundForm">
          <p class="refund-title">Refund Request</p>
          <mat-form-field appearance="fill">
            <mat-label>Amount (USD)</mat-label>
            <input matInput type="number" formControlName="amountDollars" min="0.01" step="0.01">
            <mat-error *ngIf="refundForm.controls.amountDollars.invalid && refundForm.controls.amountDollars.touched">
              Enter a valid amount
            </mat-error>
          </mat-form-field>
          <mat-form-field appearance="fill">
            <mat-label>Reason</mat-label>
            <textarea matInput formControlName="reason" rows="3"></textarea>
            <mat-error *ngIf="refundForm.controls.reason.invalid && refundForm.controls.reason.touched">
              Reason is required
            </mat-error>
          </mat-form-field>
          <p class="refund-hint" *ngIf="refundForm.controls.amountDollars.value > 250">
            ⚠ Amount exceeds $250.00 — Admin approval will be required.
          </p>
          <div class="refund-actions">
            <button mat-flat-button color="warn" [disabled]="refundLoading()" (click)="submitRefund(data.id)">
              <mat-icon>send</mat-icon> Submit Refund
            </button>
            <button mat-button (click)="showRefundForm.set(false)">Cancel</button>
          </div>
        </div>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .detail-shell { display: grid; gap: 14px; }
      .detail-card { display: grid; gap: 18px; border: 1px solid #e2e8f0; }
      .title-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .title-row h2 { margin: 0; }
      .muted { margin: 2px 0 0; color: #64748b; }
      .grid { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .grid > div { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; background: #f8fafc; }
      .label { margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
      .grid p { margin: 0; }
      .actions-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .refund-form { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: #fff5f5; border: 1px solid #fecaca; border-radius: 10px; }
      .refund-title { margin: 0; font-weight: 600; color: #b91c1c; font-size: 0.95rem; }
      .refund-hint { margin: 0; color: #b45309; font-size: 0.85rem; }
      .refund-actions { display: flex; gap: 8px; align-items: center; }
      :host ::ng-deep .refund-form .mdc-text-field--filled { background: #fff; }
      .status-chip-placed { background: #e3f2fd; color: #1565c0; }
      .status-chip-payment-captured { background: #fff8e1; color: #f9a825; }
      .status-chip-completed { background: #e8f5e9; color: #2e7d32; }
      .status-chip-cancelled { background: #eceff1; color: #455a64; }
      .status-chip-refunded { background: #ede7f6; color: #5e35b1; }
      @media (max-width: 767px) {
        .grid { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class OrderDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly order = signal<OrderDetail | null>(null);
  readonly showRefundForm = signal(false);
  readonly refundLoading = signal(false);

  readonly refundForm = this.fb.nonNullable.group({
    amountDollars: [0, [Validators.required, Validators.min(0.01)]],
    reason: ['', [Validators.required, Validators.minLength(1)]],
  });

  constructor() {
    void this.load();
  }

  shortId(id: string) {
    return `${id.slice(0, 8)}...`;
  }

  statusClass(status: OrderDetail['status']) {
    return `status-chip-${status.replace('_', '-')}`;
  }

  statusLabel(status: OrderDetail['status']) {
    return status.replace('_', ' ');
  }

  paymentLabel(order: OrderDetail) {
    if (!order.paymentTenderType) return order.paymentStatus;
    return `${order.paymentStatus} (${order.paymentTenderType.replace('_', ' ')})`;
  }

  refundLabel(order: OrderDetail) {
    if (!order.refundAmountCents) return order.refundStatus;
    return `${order.refundStatus} • ${(order.refundAmountCents / 100).toFixed(2)} USD`;
  }

  canCancel(order: OrderDetail) {
    return this.auth.hasRole('buyer') && order.status === 'placed';
  }

  canLeaveReview(order: OrderDetail) {
    return this.auth.hasRole('buyer') && order.status === 'completed';
  }

  canCapture(order: OrderDetail) {
    return (this.auth.hasRole('seller') || this.auth.hasRole('admin')) && order.status === 'placed';
  }

  canRefund(order: OrderDetail) {
    return this.auth.hasRole('seller') &&
      (order.status === 'completed' || order.status === 'payment_captured') &&
      order.refundStatus === 'none';
  }

  async load() {
    const orderId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!orderId) {
      this.error.set('Missing order id');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.api.get<OrderDetail>(`/api/orders/${orderId}`);
      this.order.set(data);
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'Failed to load order detail');
    } finally {
      this.loading.set(false);
    }
  }

  async cancelOrder(orderId: string) {
    this.error.set(null);
    try {
      await this.api.post(`/api/orders/${orderId}/cancel`, { reason: 'Cancelled from order detail' });
      this.toast.success('Order cancelled');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to cancel order';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  goReview(orderId: string) {
    void this.router.navigate(['/reviews/form'], { queryParams: { orderId } });
  }

  goCapture(orderId: string) {
    void this.router.navigate(['/orders/payment-capture'], { queryParams: { orderId } });
  }

  async submitRefund(orderId: string) {
    if (this.refundForm.invalid) {
      this.refundForm.markAllAsTouched();
      return;
    }
    const { amountDollars, reason } = this.refundForm.getRawValue();
    const amountCents = Math.round(amountDollars * 100);
    this.refundLoading.set(true);
    this.error.set(null);
    try {
      await this.api.post('/api/refunds', { orderId, amountCents, reason });
      this.toast.success(amountDollars > 250
        ? 'Refund request submitted — awaiting admin approval'
        : 'Refund request submitted and auto-approved');
      this.showRefundForm.set(false);
      this.refundForm.reset({ amountDollars: 0, reason: '' });
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to submit refund';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.refundLoading.set(false);
    }
  }
}
