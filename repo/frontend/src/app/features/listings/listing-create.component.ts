import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

@Component({
  standalone: true,
  selector: 'app-listing-create',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <mat-card class="role-card create-shell">
      <div class="role-page-header"><mat-icon>add_business</mat-icon>Create Listing</div>
      <h2>Create Listing</h2>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline"><mat-label>Title</mat-label><input matInput formControlName="title"><mat-error *ngIf="form.controls.title.invalid && form.controls.title.touched">Required</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Description</mat-label><input matInput formControlName="description"><mat-error *ngIf="form.controls.description.invalid && form.controls.description.touched">Required</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Price Cents</mat-label><input matInput type="number" formControlName="priceCents"><mat-error *ngIf="form.controls.priceCents.invalid && form.controls.priceCents.touched">Positive integer</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Quantity</mat-label><input matInput type="number" formControlName="quantity"><mat-error *ngIf="form.controls.quantity.invalid && form.controls.quantity.touched">Non-negative integer</mat-error></mat-form-field>
        <button mat-flat-button color="primary" class="btn-full" [disabled]="loading()">Create</button>
      </form>
      <app-loading-state [loading]="loading()"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>
      <p *ngIf="listingId()" class="created-id">Created ID: {{ listingId() }}</p>
    </mat-card>
  `,
  styles: [
    `
      .create-shell { max-width: 760px; margin: 0 auto; display: grid; gap: 16px; }
      h2 { margin: 0; }
      form { display: grid; gap: 16px; }
      .created-id { margin: 0; color: #2e7d32; font-weight: 600; }
    `,
  ],
})
export class ListingCreateComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly listingId = signal<string>('');

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required]],
    description: ['', [Validators.required]],
    priceCents: [1000, [Validators.required, Validators.min(1)]],
    quantity: [1, [Validators.required, Validators.min(0)]],
  });

  async submit() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      const response: any = await this.api.post('/api/listings', this.form.getRawValue());
      this.listingId.set(response.id);
      this.toast.success('Listing created successfully');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Create failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }
}
