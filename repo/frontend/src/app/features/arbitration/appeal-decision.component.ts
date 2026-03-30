import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type AppealQueueItem = { id: string; review_text: string };

@Component({
  standalone: true,
  selector: 'app-appeal-decision',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <mat-card class="role-card">
      <div class="role-page-header"><mat-icon>balance</mat-icon>Appeal Decision</div>
      <h2>Appeal Decision</h2>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline"><mat-label>Appeal</mat-label><mat-select formControlName="appealId"><mat-option *ngFor="let item of queue()" [value]="item.id">{{ item.review_text }}</mat-option></mat-select><mat-error *ngIf="form.controls.appealId.invalid && form.controls.appealId.touched">Required</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Outcome</mat-label><mat-select formControlName="outcome"><mat-option value="uphold">uphold</mat-option><mat-option value="modify">modify</mat-option><mat-option value="remove">remove</mat-option></mat-select><mat-error *ngIf="form.controls.outcome.invalid && form.controls.outcome.touched">Required</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Note</mat-label><input matInput formControlName="note"><mat-error *ngIf="form.controls.note.invalid && form.controls.note.touched">Required</mat-error></mat-form-field>
        <button mat-flat-button color="primary" [disabled]="loading()">Resolve</button>
      </form>
      <app-loading-state [loading]="loading()" label="Resolving appeal"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>
    </mat-card>
  `,
  styles: [`mat-card{max-width:760px;margin:0 auto;display:grid;gap:12px}h2{margin:0}form{display:grid;gap:12px}`],
})
export class AppealDecisionComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly queue = signal<AppealQueueItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    appealId: ['', [Validators.required]],
    outcome: ['uphold', [Validators.required]],
    note: ['', [Validators.required]],
  });

  constructor() {
    void this.loadQueue();
  }

  private async loadQueue() {
    try {
      const response = await this.api.get<{ items: AppealQueueItem[] }>('/api/arbitration/appeals');
      this.queue.set(response.items ?? []);
      if (this.queue().length) {
        this.form.patchValue({ appealId: this.queue()[0].id });
      }
    } catch {
      this.toast.error('Failed to load appeals');
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
      const value = this.form.getRawValue();
      await this.api.post(`/api/arbitration/appeals/${value.appealId}/resolve`, { outcome: value.outcome, note: value.note });
      this.toast.success('Appeal resolved');
      await this.loadQueue();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Resolve failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
