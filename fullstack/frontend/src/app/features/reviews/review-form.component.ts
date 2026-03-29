import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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

type CompletedOrder = { id: string; listingTitle: string; status: string };
type ReviewCreateResponse = { id: string; status: string };
type OrderDetailResponse = { listing: { id: string } };
type UploadSessionResponse = { sessionId: string; assetId: string };

@Component({
  standalone: true,
  selector: 'app-review-form',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <mat-card class="form-card">
      <h2>Leave a Review</h2>
      <form [formGroup]="form" (ngSubmit)="submitReview()">
        <mat-form-field appearance="outline">
          <mat-label>Completed Order</mat-label>
          <mat-select formControlName="orderId">
            <mat-option *ngFor="let order of orders()" [value]="order.id">{{ order.listingTitle }} ({{ short(order.id) }})</mat-option>
          </mat-select>
          <mat-error *ngIf="form.controls.orderId.invalid && form.controls.orderId.touched">Required</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Rating (1-5)</mat-label><input matInput type="number" formControlName="rating"><mat-error *ngIf="form.controls.rating.invalid && form.controls.rating.touched">1 to 5</mat-error></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Review</mat-label><textarea matInput formControlName="body"></textarea><mat-error *ngIf="form.controls.body.invalid && form.controls.body.touched">Max 1000 chars</mat-error></mat-form-field>
        <button mat-flat-button color="primary" class="btn-full" [disabled]="loading()">Submit Review</button>
      </form>

      <section class="attach-section" *ngIf="reviewId() && !imageFlowDone()">
        <h3>Attach review images (optional)</h3>
        <p class="hint">You can attach up to 5 images (.jpg/.png)</p>

        <input #filePicker hidden type="file" accept="image/jpeg,image/png" multiple (change)="onFilesSelected($event)">
        <div class="attach-actions">
          <button mat-stroked-button type="button" (click)="filePicker.click()">
            <mat-icon>add_photo_alternate</mat-icon>
            Select Images
          </button>
          <button mat-flat-button color="primary" type="button" (click)="attachSelectedImages()" [disabled]="imageLoading() || !selectedFiles().length">
            Upload & Attach
          </button>
          <button mat-button type="button" (click)="skipAttachments()" [disabled]="imageLoading()">Skip</button>
        </div>

        <div *ngIf="selectedFiles().length" class="file-list">
          <p>Selected:</p>
          <ul>
            <li *ngFor="let file of selectedFiles()">{{ file.name }}</li>
          </ul>
        </div>

        <app-loading-state [loading]="imageLoading()" label="Uploading and attaching images"></app-loading-state>
        <app-error-message [message]="imageError()"></app-error-message>
      </section>

      <mat-card class="done-card" *ngIf="imageFlowDone()">
        <p>Review submitted. Image attachment is complete.</p>
      </mat-card>

      <app-loading-state [loading]="loading()" label="Submitting review"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>
    </mat-card>
  `,
  styles: [
    `
      .form-card { max-width: 780px; margin: 0 auto; display: grid; gap: 14px; border: 1px solid #e2e8f0; }
      .form-card h2 { margin: 0; }
      form { display: grid; gap: 14px; }
      .attach-section { border-top: 1px solid #dde7ec; padding-top: 12px; display: grid; gap: 10px; }
      .hint { margin: 0; color: #64748b; }
      .attach-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .file-list p { margin: 0; font-weight: 500; }
      .file-list ul { margin: 6px 0 0; padding-left: 18px; }
      .done-card { padding: 12px !important; border: 1px solid #d5edd9; background: #effaf2; }
    `,
  ],
})
export class ReviewFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  private readonly maxImages = 5;
  readonly orders = signal<CompletedOrder[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly reviewId = signal<string | null>(null);
  readonly submittedOrderId = signal<string | null>(null);
  readonly selectedFiles = signal<File[]>([]);
  readonly imageLoading = signal(false);
  readonly imageError = signal<string | null>(null);
  readonly attachedCount = signal(0);
  readonly imageFlowDone = signal(false);
  readonly remainingSlots = computed(() => this.maxImages - this.attachedCount());

  readonly form = this.fb.nonNullable.group({
    orderId: ['', [Validators.required]],
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    body: ['', [Validators.required, Validators.maxLength(1000)]],
  });

  constructor() {
    void this.loadOrders();
  }

  short(id: string) {
    return `${id.slice(0, 8)}...`;
  }

  private async loadOrders() {
    try {
      const response = await this.api.get<{ items: CompletedOrder[] }>('/api/orders?status=completed');
      const orders = response.items ?? [];
      this.orders.set(orders);
      const fromQuery = this.route.snapshot.queryParamMap.get('orderId');
      const preferred = orders.find((x) => x.id === fromQuery) ?? orders[0];
      if (preferred) {
        this.form.patchValue({ orderId: preferred.id });
      }
    } catch {
      this.toast.error('Could not load your completed orders');
    }
  }

  async submitReview() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      const payload = this.form.getRawValue();
      const created = await this.api.post<ReviewCreateResponse>('/api/reviews', payload);
      this.reviewId.set(created.id);
      this.submittedOrderId.set(payload.orderId);
      this.selectedFiles.set([]);
      this.attachedCount.set(0);
      this.imageFlowDone.set(false);
      this.toast.success('Review submitted. You can now attach images.');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Review submission failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';

    if (!files.length) return;
    this.imageError.set(null);

    const valid = files.filter((file) => file.type === 'image/jpeg' || file.type === 'image/png');
    if (valid.length !== files.length) {
      this.imageError.set('Only JPEG/PNG images are allowed.');
    }

    const current = this.selectedFiles();
    const maxSelectable = this.remainingSlots() - current.length;
    if (maxSelectable <= 0) {
      this.imageError.set('You have already selected the maximum of 5 images.');
      return;
    }

    this.selectedFiles.set([...current, ...valid.slice(0, maxSelectable)]);
    if (valid.length > maxSelectable) {
      this.imageError.set('Maximum 5 images allowed. Extra files were ignored.');
    }
  }

  async attachSelectedImages() {
    this.imageError.set(null);
    const reviewId = this.reviewId();
    const orderId = this.submittedOrderId();
    const files = this.selectedFiles();
    if (!reviewId || !orderId || !files.length) return;

    this.imageLoading.set(true);
    try {
      const order = await this.api.get<OrderDetailResponse>(`/api/orders/${orderId}`);
      const listingId = order.listing.id;

      for (const file of files) {
        const ext = this.fileExtension(file);
        const session = await this.api.post<UploadSessionResponse>('/api/media/upload-sessions', {
          listingId,
          fileName: file.name,
          sizeBytes: file.size,
          extension: ext,
          mimeType: file.type,
          totalChunks: 1,
          chunkSizeBytes: 5 * 1024 * 1024,
        });

        const body = await file.arrayBuffer();
        await firstValueFrom(
          this.http.put(`/api/media/upload-sessions/${session.sessionId}/chunks/0`, body, {
            headers: { 'content-type': 'application/octet-stream' },
          }),
        );

        await this.api.post(`/api/media/upload-sessions/${session.sessionId}/finalize`, { detectedMime: file.type });
        await this.api.post(`/api/reviews/${reviewId}/images`, { assetId: session.assetId });
        this.attachedCount.set(this.attachedCount() + 1);
      }

      this.selectedFiles.set([]);
      this.imageFlowDone.set(true);
      this.toast.success('Review images attached successfully');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to attach one or more images';
      this.imageError.set(message);
      this.toast.error(message);
    } finally {
      this.imageLoading.set(false);
    }
  }

  skipAttachments() {
    this.imageFlowDone.set(true);
    this.selectedFiles.set([]);
  }

  private fileExtension(file: File) {
    const fromName = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : '';
    if (fromName === 'jpg' || fromName === 'jpeg') return 'jpg';
    if (fromName === 'png') return 'png';
    if (file.type === 'image/png') return 'png';
    return 'jpg';
  }
}
