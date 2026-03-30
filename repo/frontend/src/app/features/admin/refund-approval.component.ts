import { Component, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type RefundRow = {
  id: string;
  order_id: string;
  seller_name: string;
  amount_cents: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'confirmed';
  requires_admin_approval: boolean;
  created_at: string;
};

@Component({
  standalone: true,
  selector: 'app-refund-approval',
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent, CurrencyPipe, DatePipe],
  template: `
    <div class="refund-shell">
      <div class="header-row">
        <button mat-flat-button color="primary" (click)="load()" [disabled]="loading()">
          <mat-icon>refresh</mat-icon> Refresh
        </button>
      </div>

      <app-loading-state [loading]="loading()" label="Loading refunds"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <p class="empty" *ngIf="!loading() && !items().length">No refunds found.</p>

      <table mat-table [dataSource]="items()" class="refund-table" *ngIf="items().length">
        <ng-container matColumnDef="order">
          <th mat-header-cell *matHeaderCellDef>Order</th>
          <td mat-cell *matCellDef="let row">{{ shortId(row.order_id) }}</td>
        </ng-container>
        <ng-container matColumnDef="seller">
          <th mat-header-cell *matHeaderCellDef>Seller</th>
          <td mat-cell *matCellDef="let row">{{ row.seller_name }}</td>
        </ng-container>
        <ng-container matColumnDef="amount">
          <th mat-header-cell *matHeaderCellDef>Amount</th>
          <td mat-cell *matCellDef="let row">{{ row.amount_cents / 100 | currency:'USD':'symbol':'1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="reason">
          <th mat-header-cell *matHeaderCellDef>Reason</th>
          <td mat-cell *matCellDef="let row">{{ row.reason }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let row">
            <span class="status-badge" [ngClass]="'badge-' + row.status">{{ row.status }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="date">
          <th mat-header-cell *matHeaderCellDef>Requested</th>
          <td mat-cell *matCellDef="let row">{{ row.created_at | date:'mediumDate' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let row">
            <ng-container *ngIf="row.status === 'pending'; else resolved">
              <mat-form-field appearance="outline" class="note-field">
                <mat-label>Decision Note</mat-label>
                <input matInput [(ngModel)]="notes[row.id]">
              </mat-form-field>
              <div class="action-btns">
                <button mat-stroked-button color="primary" (click)="decide(row, true)">
                  <mat-icon>check</mat-icon> Approve
                </button>
                <button mat-stroked-button color="warn" (click)="decide(row, false)">
                  <mat-icon>close</mat-icon> Reject
                </button>
              </div>
            </ng-container>
            <ng-template #resolved>
              <span class="resolved-label">{{ row.requires_admin_approval ? 'Decided' : 'Auto-approved' }}</span>
            </ng-template>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </div>
  `,
  styles: [`
    .refund-shell { display: grid; gap: 16px; }
    .header-row { display: flex; justify-content: flex-end; }
    .refund-table { width: 100%; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .refund-table th { background: #f8fafc; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; font-weight: 600; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: capitalize; }
    .badge-pending   { background: #fff8e1; color: #f9a825; }
    .badge-approved  { background: #e8f5e9; color: #2e7d32; }
    .badge-rejected  { background: #fce4ec; color: #c62828; }
    .badge-confirmed { background: #ede7f6; color: #5e35b1; }
    .note-field { width: 220px; max-width: 100%; }
    .action-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .resolved-label { color: #94a3b8; font-size: 13px; }
    .empty { color: #94a3b8; text-align: center; padding: 24px; }
  `],
})
export class RefundApprovalComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly items = signal<RefundRow[]>([]);
  readonly notes: Record<string, string> = {};
  readonly columns = ['order', 'seller', 'amount', 'reason', 'status', 'date', 'actions'];

  constructor() {
    void this.load();
  }

  shortId(id: string) {
    return `${id.slice(0, 8)}...`;
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<{ items: RefundRow[] }>('/api/admin/refunds');
      this.items.set(response.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load refunds';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  async decide(item: RefundRow, approve: boolean) {
    const note = this.notes[item.id]?.trim();
    if (!note) {
      this.toast.error('A decision note is required.');
      return;
    }
    try {
      await this.api.post(`/api/refunds/${item.id}/approve`, { approve, note });
      this.toast.success(`Refund ${approve ? 'approved' : 'rejected'}`);
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Decision failed';
      this.error.set(message);
      this.toast.error(message);
    }
  }
}
