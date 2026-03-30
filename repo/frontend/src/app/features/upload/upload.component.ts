import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type UploadStatus = 'pending' | 'uploading' | 'failed' | 'uploaded';

type UploadItem = {
  file: File;
  valid: boolean;
  error: string | null;
  status: UploadStatus;
  progress: number;
  sessionId: string | null;
  assetId: string | null;
  failedChunkIndex: number | null;
  nextChunkIndex: number;
  metadataText: string | null;
};

type ListingReadiness = {
  id: string;
  status: string;
  readyToPublish: boolean;
  blockedReason: string | null;
  assets: Array<{ status: string }>;
};

type SellerListingOption = { id: string; title: string };

@Component({
  standalone: true,
  selector: 'app-upload',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatProgressBarModule, MatIconModule, MatSelectModule, ErrorMessageComponent, LoadingStateComponent],
  template: `
    <mat-card class="upload-shell">
      <h2>Upload Assets</h2>

      <form [formGroup]="form" class="listing-form">
        <mat-form-field appearance="outline">
          <mat-label>Listing</mat-label>
          <mat-select formControlName="listingId">
            <mat-option *ngFor="let listing of listingOptions()" [value]="listing.id">{{ listing.title }}</mat-option>
          </mat-select>
          <mat-error *ngIf="form.controls.listingId.invalid && form.controls.listingId.touched">Choose a listing</mat-error>
        </mat-form-field>
      </form>

      <div class="dropzone" (dragover)="onDragOver($event)" (drop)="onDrop($event)" (click)="fileInput.click()" role="button" tabindex="0">
        <mat-icon class="drop-icon">cloud_upload</mat-icon>
        <p class="drop-title">Drag files here or click to browse</p>
        <p class="drop-subtitle">Allowed: JPG, PNG, MP4, PDF - up to 2 GB each (max 20 files)</p>
        <input #fileInput type="file" multiple hidden (change)="onFilePicker($event)">
      </div>

      <div class="actions-row">
        <button mat-flat-button color="primary" type="button" [disabled]="uploading() || !hasValidPending()" (click)="startUpload()"><mat-icon>play_arrow</mat-icon>Start Upload</button>
        <button mat-button type="button" [disabled]="uploading()" (click)="refreshReadiness()"><mat-icon>refresh</mat-icon>Refresh Publish Gate</button>
      </div>

      <app-loading-state [loading]="uploading()" label="Uploading assets"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <div class="gate" *ngIf="readiness() as gate">
        <h3>Ready to Publish Gate</h3>
        <p *ngIf="gate.readyToPublish" class="ok">Ready to publish.</p>
        <p *ngIf="!gate.readyToPublish" class="blocked">Blocked: {{ gate.blockedReason ?? 'LISTING_NOT_READY' }}</p>
      </div>

      <div class="file-list" *ngIf="items().length">
        <div class="file-row" *ngFor="let item of items(); let i = index">
          <div>
            <div class="file-header">
              <mat-icon>{{ statusIcon(item.status) }}</mat-icon>
              <strong>{{ item.file.name }}</strong>
            </div>
            <p class="meta">{{ formatBytes(item.file.size) }}</p>
            <p class="error" *ngIf="item.error">{{ item.error }}</p>
            <div class="metadata-box" *ngIf="item.metadataText">
              <mat-icon>info</mat-icon>
              <div><strong>Extracted metadata</strong><p>{{ item.metadataText }}</p></div>
            </div>
          </div>
          <div class="progress-wrap">
            <mat-progress-bar mode="determinate" [value]="item.progress"></mat-progress-bar>
            <p class="meta">{{ item.status }}</p>
            <button mat-stroked-button color="warn" type="button" *ngIf="item.status === 'failed' && item.failedChunkIndex !== null" [disabled]="uploading()" (click)="retryFailedChunk(i)"><mat-icon>replay</mat-icon>Retry Failed Chunk</button>
          </div>
        </div>
      </div>
    </mat-card>
  `,
  styles: [
    `
      .upload-shell { max-width: 1020px; margin: 0 auto; display: grid; gap: 16px; }
      .upload-shell h2 { margin: 0; }
      .listing-form { margin-bottom: 1rem; }
      .dropzone { border: 2px dashed #94a3b8; border-radius: 12px; padding: 24px; text-align: center; background: #f8fafc; cursor: pointer; display: grid; gap: .3rem; transition: border-color .2s ease, background .2s ease; }
      .dropzone:hover { border-color: #3f51b5; background: #f2f5ff; }
      .drop-icon { font-size: 34px; height: 34px; width: 34px; margin: 0 auto; color: #0277bd; }
      .drop-title { margin: 0; font-weight: 600; color: #1f3b4d; }
      .drop-subtitle { margin: 0; color: #607d8b; }
      .actions-row { display: flex; gap: 0.75rem; margin: .5rem 0 0; flex-wrap: wrap; }
      .file-list { display: grid; gap: 0.75rem; margin-top: 1rem; }
      .file-row { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; display: grid; grid-template-columns: 1fr 320px; gap: 1rem; align-items: center; background: #fff; }
      .file-header { display: flex; align-items: center; gap: .45rem; }
      .progress-wrap { display: grid; gap: 0.5rem; }
      .meta { color: #607d8b; margin: 0; }
      .error { color: #b71c1c; margin: 0.35rem 0 0; }
      .ok { color: #1b5e20; margin: 0.35rem 0 0; }
      .metadata-box { margin-top: .5rem; padding: .55rem .65rem; border-radius: 8px; background: #effaf2; display: flex; gap: .45rem; color: #1b5e20; border: 1px solid #d5edd9; }
      .metadata-box p { margin: .1rem 0 0; }
      .blocked { color: #b71c1c; font-weight: 600; }
      @media (max-width: 900px) { .file-row { grid-template-columns: 1fr; } }
    `,
  ],
})
export class UploadComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  readonly form = this.fb.nonNullable.group({
    listingId: ['', [Validators.required]],
  });

  readonly items = signal<UploadItem[]>([]);
  readonly listingOptions = signal<SellerListingOption[]>([]);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly readiness = signal<ListingReadiness | null>(null);

  private readonly allowedMime = new Set(['image/jpeg', 'image/png', 'video/mp4', 'application/pdf']);
  private readonly maxFiles = 20;
  private readonly maxSize = 2 * 1024 * 1024 * 1024;
  private readonly chunkSize = 5 * 1024 * 1024;

  constructor() {
    void this.loadListings();
  }

  private async loadListings() {
    try {
      const response = await this.api.get<{ items: Array<{ id: string; title: string }> }>('/api/listings');
      const options = response.items ?? [];
      this.listingOptions.set(options.map((row) => ({ id: row.id, title: row.title })));
      const fromQuery = this.route.snapshot.queryParamMap.get('listingId');
      const selected = options.find((row) => row.id === fromQuery) ?? options[0];
      if (selected) {
        this.form.patchValue({ listingId: selected.id });
      }
    } catch {
      this.toast.error('Failed to load your listings');
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files) return;
    this.addFiles(Array.from(files));
  }

  onFilePicker(event: Event) {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  hasValidPending() {
    return this.items().some((item) => item.valid && item.status === 'pending');
  }

  formatBytes(bytes: number) {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }

  private addFiles(files: File[]) {
    const current = this.items();
    const remaining = this.maxFiles - current.length;
    const selected = files.slice(0, Math.max(0, remaining));
    const mapped = selected.map((file) => this.toUploadItem(file));
    this.items.set([...current, ...mapped]);
    if (files.length > remaining) {
      const message = `Only ${this.maxFiles} files are allowed per listing.`;
      this.error.set(message);
      this.toast.error(message);
    }
  }

  statusIcon(status: UploadStatus) {
    if (status === 'uploaded') return 'check_circle';
    if (status === 'failed') return 'error';
    if (status === 'uploading') return 'sync';
    return 'schedule';
  }

  private toUploadItem(file: File): UploadItem {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    const fallbackMime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'mp4' ? 'video/mp4' : ext === 'pdf' ? 'application/pdf' : '';
    const mime = file.type || fallbackMime;

    if (!this.allowedMime.has(mime)) {
      return { file, valid: false, error: 'Unsupported file type. Allowed: JPG, PNG, MP4, PDF.', status: 'pending', progress: 0, sessionId: null, assetId: null, failedChunkIndex: null, nextChunkIndex: 0, metadataText: null };
    }
    if (file.size > this.maxSize) {
      return { file, valid: false, error: 'File too large. Max size is 2 GB.', status: 'pending', progress: 0, sessionId: null, assetId: null, failedChunkIndex: null, nextChunkIndex: 0, metadataText: null };
    }
    return { file, valid: true, error: null, status: 'pending', progress: 0, sessionId: null, assetId: null, failedChunkIndex: null, nextChunkIndex: 0, metadataText: null };
  }

  async startUpload() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.uploading.set(true);
    try {
      for (let i = 0; i < this.items().length; i += 1) {
        const item = this.items()[i];
        if (!item.valid || item.status !== 'pending') continue;
        await this.uploadOne(i);
      }
      this.toast.success('Upload queue completed');
      await this.refreshReadiness();
    } finally {
      this.uploading.set(false);
    }
  }

  async retryFailedChunk(index: number) {
    const item = this.items()[index];
    if (!item || item.status !== 'failed' || item.failedChunkIndex === null || !item.sessionId) return;
    this.uploading.set(true);
    this.error.set(null);
    try {
      await this.uploadChunk(index, item.failedChunkIndex);
      await this.continueUpload(index);
      this.toast.success('Chunk retry succeeded');
      await this.refreshReadiness();
    } catch (e: any) {
      const message = e?.error?.message ?? 'Retry failed';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.uploading.set(false);
    }
  }

  private async uploadOne(index: number) {
    const item = this.items()[index];
    if (!item) return;
    this.patchItem(index, { status: 'uploading', progress: 1, error: null, failedChunkIndex: null, nextChunkIndex: 0 });
    try {
      const extension = (item.file.name.split('.').pop() ?? '').toLowerCase() || 'jpg';
      const session = await this.api.post<{ sessionId: string; assetId: string }>('/api/media/upload-sessions', {
        listingId: this.form.getRawValue().listingId,
        fileName: item.file.name,
        sizeBytes: item.file.size,
        extension,
        mimeType: item.file.type,
        totalChunks: Math.max(1, Math.ceil(item.file.size / this.chunkSize)),
        chunkSizeBytes: this.chunkSize,
      });
      this.patchItem(index, { sessionId: session.sessionId, assetId: session.assetId });
      await this.continueUpload(index);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Upload failed';
      this.patchItem(index, { status: 'failed', error: message });
      this.error.set(message);
      this.toast.error(message);
    }
  }

  private async continueUpload(index: number) {
    const item = this.items()[index];
    if (!item || !item.sessionId) return;
    const totalChunks = Math.max(1, Math.ceil(item.file.size / this.chunkSize));
    for (let chunkIndex = item.nextChunkIndex; chunkIndex < totalChunks; chunkIndex += 1) {
      try {
        await this.uploadChunk(index, chunkIndex);
      } catch {
        this.patchItem(index, { status: 'failed', failedChunkIndex: chunkIndex, error: `Chunk ${chunkIndex + 1} failed. Retry this chunk.` });
        return;
      }
    }
    await this.api.post(`/api/media/upload-sessions/${item.sessionId}/finalize`, { detectedMime: item.file.type });
    const metadata = await this.api.get<Record<string, unknown>>(`/api/assets/${item.assetId}/metadata`);
    this.patchItem(index, { status: 'uploaded', progress: 100, metadataText: this.metadataText(item.file.type, metadata), failedChunkIndex: null, error: null });
  }

  private async uploadChunk(index: number, chunkIndex: number) {
    const item = this.items()[index];
    if (!item || !item.sessionId) return;
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, item.file.size);
    const chunk = item.file.slice(start, end);
    await firstValueFrom(
      this.http.put(`/api/media/upload-sessions/${item.sessionId}/chunks/${chunkIndex}`, chunk, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    const totalChunks = Math.max(1, Math.ceil(item.file.size / this.chunkSize));
    const progress = Math.min(99, Math.round(((chunkIndex + 1) / totalChunks) * 100));
    this.patchItem(index, { progress, nextChunkIndex: chunkIndex + 1, failedChunkIndex: null, status: 'uploading' });
  }

  async refreshReadiness() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    try {
      const listingId = this.form.getRawValue().listingId;
      const gate = await this.api.get<ListingReadiness>(`/api/listings/${listingId}`);
      this.readiness.set(gate);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load publish readiness';
      this.error.set(message);
      this.toast.error(message);
    }
  }

  private metadataText(mimeType: string, metadata: Record<string, unknown>) {
    if (mimeType === 'video/mp4') {
      const duration = metadata['durationSec'];
      const codec = metadata['codec'];
      return `${duration ?? 'n/a'} sec, ${codec ?? 'unknown codec'}`;
    }
    const width = metadata['width'];
    const height = metadata['height'];
    if (typeof width === 'number' && typeof height === 'number') {
      return `${width} x ${height}`;
    }
    if (Object.keys(metadata).length > 0) {
      return 'Metadata extracted';
    }
    return 'No metadata available';
  }

  private patchItem(index: number, patch: Partial<UploadItem>) {
    const next = [...this.items()];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch };
    this.items.set(next);
  }
}
