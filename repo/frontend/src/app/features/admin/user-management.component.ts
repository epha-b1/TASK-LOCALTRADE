import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type RoleCode = 'buyer' | 'seller' | 'moderator' | 'arbitrator' | 'admin';

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  status: 'active' | 'inactive';
  roles: RoleCode[];
};

type UserResponse = {
  items: UserRow[];
  page: number;
  pageSize: number;
  total: number;
};

@Component({
  standalone: true,
  selector: 'app-user-management',
  imports: [CommonModule, MatCardModule, MatButtonModule, MatTableModule, MatSelectModule, MatChipsModule, MatFormFieldModule, MatInputModule, FormsModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <mat-card class="role-card">
      <div class="toolbar">
        <button mat-flat-button color="primary" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>Refresh</button>
        <span>Page {{ page() }} / {{ totalPages() }}</span>
        <button mat-button (click)="prevPage()" [disabled]="page() <= 1">Prev</button>
        <button mat-button (click)="nextPage()" [disabled]="page() >= totalPages()">Next</button>
        <mat-form-field appearance="outline">
          <mat-label>Search users</mat-label>
          <input matInput [(ngModel)]="searchTerm">
        </mat-form-field>
      </div>

      <app-loading-state [loading]="loading()" label="Loading users"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <div class="table-wrap" *ngIf="filteredRows().length">
        <table mat-table [dataSource]="filteredRows()" class="users-table">
          <ng-container matColumnDef="email">
            <th mat-header-cell *matHeaderCellDef>Email</th>
            <td mat-cell *matCellDef="let row">{{ row.email }}</td>
          </ng-container>

          <ng-container matColumnDef="display">
            <th mat-header-cell *matHeaderCellDef>Display Name</th>
            <td mat-cell *matCellDef="let row">{{ row.display_name }}</td>
          </ng-container>

          <ng-container matColumnDef="roles">
            <th mat-header-cell *matHeaderCellDef>Roles</th>
            <td mat-cell *matCellDef="let row">
              <div class="roles-inline">
                <span class="role-chip" *ngFor="let role of row.roles">{{ role }}</span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let row">
              <span class="status-badge" [ngClass]="row.status === 'active' ? 'status-active' : 'status-inactive'">{{ row.status }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let row" class="actions-cell">
              <button mat-stroked-button color="primary" (click)="toggleEditRoles(row.id)"><mat-icon>manage_accounts</mat-icon>{{ editingRolesFor() === row.id ? 'Close Roles' : 'Edit Roles' }}</button>
              <button mat-stroked-button color="warn" *ngIf="row.status === 'active'" (click)="setStatus(row, 'inactive')"><mat-icon>pause_circle</mat-icon>Deactivate</button>
              <button mat-stroked-button color="primary" *ngIf="row.status === 'inactive'" (click)="setStatus(row, 'active')"><mat-icon>play_circle</mat-icon>Reactivate</button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayed"></tr>
          <tr mat-row *matRowDef="let row; columns: displayed"></tr>
        </table>
      </div>

      <section class="role-editor-panel" *ngIf="editingRow() as row">
        <p class="editor-title">Edit roles for {{ row.email }}</p>
        <div class="role-editor">
          <mat-form-field appearance="outline" class="role-select">
            <mat-label>Assign Roles</mat-label>
            <mat-select [ngModel]="selectedRoles(row)" (ngModelChange)="setDraftRoles(row.id, $event)" multiple>
              <mat-option value="buyer">buyer</mat-option>
              <mat-option value="seller">seller</mat-option>
              <mat-option value="moderator">moderator</mat-option>
              <mat-option value="arbitrator">arbitrator</mat-option>
              <mat-option value="admin">admin</mat-option>
            </mat-select>
          </mat-form-field>
          <button mat-stroked-button color="primary" (click)="updateRoles(row)"><mat-icon>check</mat-icon>Save Roles</button>
          <button mat-button type="button" (click)="toggleEditRoles(row.id)">Cancel</button>
        </div>
      </section>
    </mat-card>
  `,
  styles: [
    `
      mat-card { max-width: 1200px; margin: 0 auto; }
      .toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
      .table-wrap { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: #fff; }
      .users-table { width: 100%; }
      .users-table th,
      .users-table td { vertical-align: middle; padding: 12px 16px; }
      .users-table th { background: #f8fafc; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b; font-weight: 600; }
      .users-table .mat-mdc-row { min-height: 52px; }
      .users-table .mat-mdc-row td { border-bottom: 1px solid #f1f5f9; }
      .users-table .mat-mdc-header-row th { border-bottom: 1px solid #f1f5f9; }
      .roles-inline { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .role-chip { display: inline-flex; align-items: center; background: #eef2ff; color: #3f51b5; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
      .status-badge { display: inline-flex; align-items: center; border-radius: 12px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
      .status-active { background: #dcfce7; color: #16a34a; }
      .status-inactive { background: #f1f5f9; color: #64748b; }
      .actions-cell { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .role-editor-panel { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #fff; }
      .editor-title { margin: 0 0 10px; color: #334155; font-weight: 600; }
      .role-editor { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
      .role-select { width: 360px; max-width: 100%; }
    `,
  ],
})
export class UserManagementComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly rows = signal<UserRow[]>([]);
  searchTerm = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly total = signal(0);
  readonly draftRoles = signal<Partial<Record<string, RoleCode[]>>>({});
  readonly editingRolesFor = signal<string | null>(null);
  readonly displayed = ['email', 'display', 'roles', 'status', 'actions'];
  readonly filteredRows = computed(() => {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.rows();
    return this.rows().filter((row) => row.email.toLowerCase().includes(term) || row.display_name.toLowerCase().includes(term));
  });

  constructor() {
    void this.load();
  }

  totalPages() {
    return Math.max(1, Math.ceil(this.total() / this.pageSize()));
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<UserResponse>(`/api/admin/users?page=${this.page()}&pageSize=${this.pageSize()}`);
      this.rows.set(response.items ?? []);
      this.total.set(response.total ?? 0);
      const nextDraft: Partial<Record<string, RoleCode[]>> = {};
      for (const row of response.items ?? []) {
        nextDraft[row.id] = [...row.roles];
      }
      this.draftRoles.set(nextDraft);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load users';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.set(this.page() - 1);
    void this.load();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.set(this.page() + 1);
    void this.load();
  }

  setDraftRoles(userId: string, roles: RoleCode[]) {
    this.draftRoles.set({ ...this.draftRoles(), [userId]: roles });
  }

  toggleEditRoles(userId: string) {
    this.editingRolesFor.set(this.editingRolesFor() === userId ? null : userId);
  }

  selectedRoles(row: UserRow): RoleCode[] {
    return this.draftRoles()[row.id] ?? row.roles;
  }

  editingRow() {
    const id = this.editingRolesFor();
    if (!id) return null;
    return this.rows().find((row) => row.id === id) ?? null;
  }

  async updateRoles(row: UserRow) {
    try {
      const roles = this.draftRoles()[row.id] ?? row.roles;
      await this.api.patch(`/api/admin/users/${row.id}/roles`, { roles });
      this.editingRolesFor.set(null);
      this.toast.success('User roles updated');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to update roles';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  async setStatus(row: UserRow, status: 'active' | 'inactive') {
    try {
      await this.api.patch(`/api/admin/users/${row.id}/status`, { status, reason: `Admin set status to ${status}` });
      this.toast.success(`User ${status === 'active' ? 'reactivated' : 'deactivated'}`);
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to update user status';
      this.error.set(message);
      this.toast.error(message);
    }
  }
}
