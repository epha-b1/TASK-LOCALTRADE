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

type ModerationQueueItem = { id: string; title: string };

@Component({
  standalone: true,
  selector: 'app-moderation-decision',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <mat-card class="role-card">
      <div class="role-page-header"><mat-icon>fact_check</mat-icon>Moderation Decision</div>
      <h2>Moderation Decision</h2>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline"><mat-label>Flagged Listing</mat-label><mat-select formControlName="listingId"><mat-option *ngFor="let item of queue()" [value]="item.id">{{ item.title }}</mat-option></mat-select><mat-error *ngIf="form.controls.listingId.invalid && form.controls.listingId.touched">Required</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Decision</mat-label><mat-select formControlName="decision"><mat-option value="approve">approve</mat-option><mat-option value="reject">reject</mat-option></mat-select><mat-error *ngIf="form.controls.decision.invalid && form.controls.decision.touched">Required</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Notes</mat-label><input matInput formControlName="notes"><mat-error *ngIf="form.controls.notes.invalid && form.controls.notes.touched">Required</mat-error></mat-form-field>
        <button mat-flat-button color="primary" [disabled]="loading()">Submit</button>
      </form>
      <app-loading-state [loading]="loading()" label="Submitting decision"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>
    </mat-card>
  `,
  styles: [`mat-card{max-width:760px;margin:0 auto;display:grid;gap:12px}h2{margin:0}form{display:grid;gap:12px}`],
})
export class ModerationDecisionComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly queue = signal<ModerationQueueItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    listingId: ['', [Validators.required]],
    decision: ['approve', [Validators.required]],
    notes: ['', [Validators.required]],
  });

  constructor() {
    void this.loadQueue();
  }

  private async loadQueue() {
    try {
      const response = await this.api.get<{ items: ModerationQueueItem[] }>('/api/moderation/queue');
      this.queue.set(response.items ?? []);
      if (this.queue().length) {
        this.form.patchValue({ listingId: this.queue()[0].id });
      }
    } catch {
      this.toast.error('Failed to load moderation queue');
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
      await this.api.post(`/api/moderation/listings/${value.listingId}/decision`, { decision: value.decision, notes: value.notes });
      this.toast.success('Decision submitted');
      await this.loadQueue();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Decision failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
