import { Component, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ErrorMessageComponent } from '../../shared/error-message.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

type QueueItem = {
  id: string;
  title: string;
  description: string;
  flagged_rule_pattern: string | null;
  seller_name: string;
  updated_at: string;
};

@Component({
  standalone: true,
  selector: 'app-moderation-queue',
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent, DatePipe],
  template: `
    <mat-card class="role-card">
      <div class="role-page-header"><mat-icon>gavel</mat-icon> Moderation Queue</div>
      <h2>Moderation Queue</h2>
      <button mat-flat-button color="primary" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>Refresh Queue</button>
      <p class="pending-stat">{{ items().length }} items pending</p>
      <app-loading-state [loading]="loading()" label="Loading moderation queue"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <section class="queue" *ngIf="items().length">
        <mat-card *ngFor="let item of items()" class="queue-item" [class.fade-out]="removingId() === item.id">
          <h3>{{ item.title }}</h3>
          <p>{{ excerpt(item.description) }}</p>
          <p><strong>Flagged Rule:</strong> {{ item.flagged_rule_pattern ?? 'N/A' }}</p>
          <p><strong>Seller:</strong> {{ item.seller_name }}</p>
          <p><strong>Date Flagged:</strong> {{ item.updated_at | date:'medium' }}</p>

          <div class="actions">
             <button mat-stroked-button color="primary" (click)="setAction(item.id, 'approve')"><mat-icon>check</mat-icon>Approve</button>
             <button mat-stroked-button color="warn" (click)="setAction(item.id, 'reject')"><mat-icon>close</mat-icon>Reject</button>
          </div>

          <div *ngIf="actionFor(item.id)">
            <mat-form-field appearance="outline" class="note-field">
              <mat-label>Notes</mat-label>
              <input matInput [(ngModel)]="notes[item.id]" placeholder="Required moderator note">
            </mat-form-field>
             <button mat-flat-button color="accent" (click)="submitDecision(item)"><mat-icon>send</mat-icon>Submit</button>
           </div>
         </mat-card>
      </section>
    </mat-card>
  `,
  styles: [`mat-card{max-width:980px;margin:0 auto}.pending-stat{margin:.5rem 0 0;color:#64748b}.queue{display:grid;gap:12px;margin-top:1rem}.queue-item{border:1px solid #e2e8f0;transition:opacity .2s ease,transform .2s ease}.queue-item h3{margin:0;font-size:1rem}.queue-item p{margin:0;color:#475569}.queue-item.fade-out{opacity:0;transform:translateX(16px)}.actions{display:flex;gap:.5rem;margin:.5rem 0;flex-wrap:wrap}.note-field{width:100%}`],
})
export class ModerationQueueComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly items = signal<QueueItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly removingId = signal<string | null>(null);
  readonly actions = signal<Record<string, 'approve' | 'reject' | undefined>>({});
  readonly notes: Record<string, string> = {};

  constructor() {
    void this.load();
  }

  excerpt(text: string) {
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  }

  actionFor(id: string) {
    return this.actions()[id];
  }

  setAction(id: string, action: 'approve' | 'reject') {
    this.actions.set({ ...this.actions(), [id]: action });
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<{ items: QueueItem[] }>('/api/moderation/queue');
      this.items.set(response.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load moderation queue';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  async submitDecision(item: QueueItem) {
    const decision = this.actionFor(item.id);
    const notes = this.notes[item.id]?.trim();
    if (!decision || !notes) {
      const message = 'Decision note is required.';
      this.error.set(message);
      this.toast.error(message);
      return;
    }
    try {
      await this.api.post(`/api/moderation/listings/${item.id}/decision`, { decision, notes });
      this.removingId.set(item.id);
      setTimeout(() => {
        this.items.set(this.items().filter((x) => x.id !== item.id));
        this.removingId.set(null);
      }, 220);
      this.toast.success('Moderation decision submitted');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to submit moderation decision';
      this.error.set(message);
      this.toast.error(message);
    }
  }
}
