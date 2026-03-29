import { Component, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type Rule = {
  id: string;
  rule_type: 'keyword' | 'regex';
  pattern: string;
  active: boolean;
  created_at: string;
};

@Component({
  standalone: true,
  selector: 'app-keyword-rules',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatChipsModule, MatTableModule, MatIconModule, MatSlideToggleModule, ErrorMessageComponent, LoadingStateComponent, DatePipe],
  template: `
    <mat-card class="role-card">
      <div class="role-page-header"><mat-icon>rule</mat-icon>Content Rules</div>
      <h2>Keyword and Regex Rules</h2>
      <button mat-flat-button color="primary" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>Refresh Rules</button>
      <app-loading-state [loading]="loading()" label="Loading content rules"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <table mat-table [dataSource]="rules()" class="rule-table" *ngIf="rules().length">
        <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>Type</th><td mat-cell *matCellDef="let row">{{ row.rule_type }}</td></ng-container>
        <ng-container matColumnDef="pattern"><th mat-header-cell *matHeaderCellDef>Pattern</th><td mat-cell *matCellDef="let row"><code>{{ row.pattern }}</code></td></ng-container>
        <ng-container matColumnDef="active"><th mat-header-cell *matHeaderCellDef>Status</th><td mat-cell *matCellDef="let row"><mat-chip [color]="row.active ? 'primary' : 'warn'" selected>{{ row.active ? 'active' : 'inactive' }}</mat-chip></td></ng-container>
        <ng-container matColumnDef="created"><th mat-header-cell *matHeaderCellDef>Created</th><td mat-cell *matCellDef="let row">{{ row.created_at | date:'medium' }}</td></ng-container>
        <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef>Actions</th><td mat-cell *matCellDef="let row" class="actions"><mat-slide-toggle [checked]="row.active" (change)="toggle(row)">Active</mat-slide-toggle><button mat-stroked-button color="warn" (click)="remove(row)"><mat-icon>delete</mat-icon>Delete</button></td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>

      <mat-card class="create-card">
        <h3>Create New Rule</h3>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline"><mat-label>Rule Type</mat-label><mat-select formControlName="ruleType"><mat-option value="keyword">keyword</mat-option><mat-option value="regex">regex</mat-option></mat-select></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Pattern</mat-label><input matInput formControlName="pattern"><mat-error *ngIf="form.controls.pattern.invalid">Required</mat-error></mat-form-field>
          <button mat-flat-button color="accent"><mat-icon>add</mat-icon>Create Rule</button>
        </form>
      </mat-card>
    </mat-card>
  `,
  styles: [`mat-card{max-width:1200px;margin:0 auto}h2{margin:0}.rule-table{width:100%;margin-top:1rem}.rule-table th{color:#475569;font-weight:600}.actions{display:flex;gap:.5rem;flex-wrap:wrap}.create-card{margin-top:1rem;border:1px solid #e2e8f0}form{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-start}code{word-break:break-all}`],
})
export class KeywordRulesComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly rules = signal<Rule[]>([]);
  readonly form = this.fb.nonNullable.group({ ruleType: ['keyword' as 'keyword' | 'regex', [Validators.required]], pattern: ['', [Validators.required]] });
  readonly columns = ['type', 'pattern', 'active', 'created', 'actions'];

  constructor() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<{ items: Rule[] }>('/api/admin/content-rules');
      this.rules.set(response.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load rules';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  async toggle(rule: Rule) {
    try {
      await this.api.patch(`/api/admin/content-rules/${rule.id}`, { active: !rule.active });
      this.toast.success('Rule updated');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to update rule';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  async remove(rule: Rule) {
    try {
      await this.api.delete(`/api/admin/content-rules/${rule.id}`);
      this.toast.info('Rule deleted');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to delete rule';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  async submit() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    try {
      await this.api.post('/api/admin/content-rules', { ...this.form.getRawValue(), active: true });
      this.form.reset({ ruleType: 'keyword', pattern: '' });
      this.toast.success('Rule created');
      await this.load();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to create rule';
      this.error.set(message);
      this.toast.error(message);
    }
  }
}
