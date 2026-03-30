import { Component, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type AuditRow = {
  id: string;
  created_at: string;
  actor_email?: string | null;
  actor_user_id?: string | null;
  action: string;
  target_type: string;
  target_id: string;
};

type AuditResponse = {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

@Component({
  standalone: true,
  selector: 'app-audit-log',
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatTableModule, MatFormFieldModule, MatSelectModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent, DatePipe],
  template: `
    <mat-card class="role-card">
      <div class="role-page-header"><mat-icon>history</mat-icon>Audit Logs</div>
      <h2>Audit Logs</h2>
      <div class="toolbar">
        <mat-form-field appearance="outline">
          <mat-label>Action Filter</mat-label>
          <mat-select [(ngModel)]="actionFilter" (selectionChange)="refresh()">
            <mat-option value="">All actions</mat-option>
            <mat-option *ngFor="let action of actionOptions()" [value]="action">{{ action }}</mat-option>
          </mat-select>
        </mat-form-field>
        <button mat-flat-button color="primary" (click)="refresh()" [disabled]="loading()"><mat-icon>refresh</mat-icon>Refresh</button>
        <span>Page {{ page() }}</span>
        <button mat-button (click)="prevPage()" [disabled]="page() <= 1">Previous</button>
        <button mat-button (click)="nextPage()" [disabled]="page() >= totalPages()">Next</button>
      </div>

      <app-loading-state [loading]="loading()" label="Loading audit logs"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <table mat-table [dataSource]="rows()" class="audit-table" *ngIf="rows().length">
        <ng-container matColumnDef="timestamp"><th mat-header-cell *matHeaderCellDef>Timestamp</th><td mat-cell *matCellDef="let row">{{ row.created_at | date:'medium' }}</td></ng-container>
        <ng-container matColumnDef="actor"><th mat-header-cell *matHeaderCellDef>Actor Email</th><td mat-cell *matCellDef="let row">{{ row.actor_email ?? row.actor_user_id ?? 'system' }}</td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>Action</th><td mat-cell *matCellDef="let row"><span [ngClass]="actionClass(row.action)">{{ row.action }}</span></td></ng-container>
        <ng-container matColumnDef="targetType"><th mat-header-cell *matHeaderCellDef>Target Type</th><td mat-cell *matCellDef="let row">{{ row.target_type }}</td></ng-container>
        <ng-container matColumnDef="targetId"><th mat-header-cell *matHeaderCellDef>Target ID</th><td mat-cell *matCellDef="let row" class="mono">{{ row.target_id }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </mat-card>
  `,
  styles: [`mat-card{max-width:1200px;margin:0 auto}h2{margin:0}.toolbar{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}.audit-table{width:100%;margin-top:1rem}.audit-table th{color:#475569;font-weight:600}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.action-auth{color:#1565c0;font-weight:600}.action-admin{color:#6a1b9a;font-weight:600}.action-listing{color:#2e7d32;font-weight:600}.action-order{color:#ef6c00;font-weight:600}`],
})
export class AuditLogComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly rows = signal<AuditRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly actionOptions = signal<string[]>([]);
  actionFilter = '';
  readonly columns = ['timestamp', 'actor', 'action', 'targetType', 'targetId'];

  constructor() {
    void this.refresh();
  }

  totalPages() {
    return Math.max(1, Math.ceil(this.total() / this.pageSize()));
  }

  async refresh() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const actionQuery = this.actionFilter ? `&action=${encodeURIComponent(this.actionFilter)}` : '';
      const res = await this.api.get<AuditResponse>(`/api/admin/audit-logs?page=${this.page()}&pageSize=${this.pageSize()}${actionQuery}`);
      this.rows.set(res.items ?? []);
      this.total.set(res.total ?? 0);
      if (!this.actionFilter) {
        this.actionOptions.set(Array.from(new Set((res.items ?? []).map((row) => row.action))).sort());
      }
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load audit logs';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.set(this.page() - 1);
    void this.refresh();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.set(this.page() + 1);
    void this.refresh();
  }

  actionClass(action: string) {
    if (action.startsWith('auth.')) return 'action-auth';
    if (action.startsWith('admin.')) return 'action-admin';
    if (action.startsWith('listing.')) return 'action-listing';
    if (action.startsWith('order.')) return 'action-order';
    return '';
  }
}
