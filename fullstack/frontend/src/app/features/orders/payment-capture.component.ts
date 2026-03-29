import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { ErrorMessageComponent } from '../../shared/error-message.component';

type PlacedOrder = { id: string; listingTitle: string; totalCents: number; status: string };

@Component({
  standalone: true,
  selector: 'app-payment-capture',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, LoadingStateComponent, ErrorMessageComponent],
  template: `
    <mat-card class="capture-card">
      <h2>Capture Payment</h2>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>Order</mat-label>
          <mat-select formControlName="orderId" (selectionChange)="syncSelectedOrder()">
            <mat-option *ngFor="let order of orders()" [value]="order.id">{{ order.listingTitle }} ({{ short(order.id) }})</mat-option>
          </mat-select>
          <mat-error *ngIf="form.controls.orderId.invalid && form.controls.orderId.touched">Required</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Amount (cents)</mat-label><input matInput type="number" formControlName="amountCents"><mat-error *ngIf="form.controls.amountCents.invalid && form.controls.amountCents.touched">Positive amount</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Tender Type</mat-label><mat-select formControlName="tenderType"><mat-option value="cash">Cash</mat-option><mat-option value="check">Check</mat-option><mat-option value="store_credit">Store Credit</mat-option><mat-option value="card_terminal_import">Card Terminal</mat-option></mat-select><mat-error *ngIf="form.controls.tenderType.invalid && form.controls.tenderType.touched">Required</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Transaction Reference</mat-label><input matInput formControlName="transactionKey"><mat-error *ngIf="form.controls.transactionKey.invalid && form.controls.transactionKey.touched">Required</mat-error></mat-form-field>
        <button mat-flat-button color="primary" class="btn-full" [disabled]="loading()">Capture Payment</button>
      </form>
      <app-loading-state [loading]="loading()" label="Capturing payment"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>
    </mat-card>
  `,
  styles: [
    `
      .capture-card { max-width: 760px; margin: 0 auto; display: grid; gap: 14px; border: 1px solid #e2e8f0; }
      .capture-card h2 { margin: 0; }
      form { display: grid; gap: 14px; }
    `,
  ],
})
export class PaymentCaptureComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly orders = signal<PlacedOrder[]>([]);
  readonly form = this.fb.nonNullable.group({
    orderId: ['', [Validators.required]],
    amountCents: [1000, [Validators.required, Validators.min(1)]],
    tenderType: ['cash', [Validators.required]],
    transactionKey: [`txn-${Date.now()}`, [Validators.required]],
  });

  constructor() {
    void this.loadOrders();
  }

  short(id: string) {
    return `${id.slice(0, 8)}...`;
  }

  private async loadOrders() {
    try {
      const response = await this.api.get<{ items: PlacedOrder[] }>('/api/orders?status=placed');
      const orders = response.items ?? [];
      this.orders.set(orders);
      const fromQuery = this.route.snapshot.queryParamMap.get('orderId');
      const selected = orders.find((x) => x.id === fromQuery) ?? orders[0];
      if (selected) {
        this.form.patchValue({ orderId: selected.id, amountCents: selected.totalCents });
      }
    } catch {
      this.toast.error('Failed to load payable orders');
    }
  }

  syncSelectedOrder() {
    const selectedId = this.form.controls.orderId.value;
    const selected = this.orders().find((x) => x.id === selectedId);
    if (selected) {
      this.form.patchValue({ amountCents: selected.totalCents });
    }
  }

  async submit() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      await this.api.post('/api/payments/capture', this.form.getRawValue());
      this.toast.success('Payment captured');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Capture failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
