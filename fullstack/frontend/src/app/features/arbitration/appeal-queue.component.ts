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

type AppealItem = {
  id: string;
  review_text: string;
  rating: number;
  buyer_name: string;
  seller_name: string;
  reason: string;
  created_at: string;
};

@Component({
  standalone: true,
  selector: 'app-appeal-queue',
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, ErrorMessageComponent, LoadingStateComponent, DatePipe],
  template: `
    <mat-card class="role-card">
      <div class="role-page-header"><mat-icon>balance</mat-icon> Appeals Queue</div>
      <h2>Appeals Queue</h2>
      <button mat-flat-button color="primary" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>Refresh</button>
      <p class="pending-stat">{{ items().length }} appeals pending</p>
      <app-loading-state [loading]="loading()" label="Loading appeals"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <section *ngIf="items().length" class="queue">
        <mat-card *ngFor="let item of items()" class="appeal-card" [class.fade-out]="removingId() === item.id">
          <p><strong>Review:</strong> {{ item.review_text }}</p>
          <p><strong>Rating:</strong> {{ stars(item.rating) }}</p>
          <p><strong>Buyer:</strong> {{ item.buyer_name }}</p>
          <p><strong>Seller:</strong> {{ item.seller_name }}</p>
          <p><strong>Appeal Reason:</strong> {{ item.reason }}</p>
          <p><strong>Submitted:</strong> {{ item.created_at | date:'medium' }}</p>

          <div class="actions">
             <button mat-stroked-button color="primary" (click)="setOutcome(item.id, 'uphold')"><mat-icon>check_circle</mat-icon>Uphold</button>
             <button mat-stroked-button color="accent" (click)="setOutcome(item.id, 'modify')"><mat-icon>edit</mat-icon>Modify</button>
             <button mat-stroked-button color="warn" (click)="setOutcome(item.id, 'remove')"><mat-icon>delete</mat-icon>Remove</button>
          </div>

          <div *ngIf="outcomeFor(item.id)">
            <mat-form-field appearance="outline" class="note-field">
              <mat-label>Decision Note</mat-label>
              <input matInput [(ngModel)]="notes[item.id]" placeholder="Required arbitrator note">
            </mat-form-field>
             <button mat-flat-button color="primary" (click)="submit(item)"><mat-icon>send</mat-icon>Submit Decision</button>
           </div>
         </mat-card>
      </section>
    </mat-card>
  `,
  styles: [`mat-card{max-width:980px;margin:0 auto}.pending-stat{margin:.5rem 0 0;color:#64748b}.queue{display:grid;gap:12px;margin-top:1rem}.appeal-card{border:1px solid #e2e8f0;transition:opacity .2s ease,transform .2s ease}.appeal-card p{margin:0;color:#475569}.appeal-card.fade-out{opacity:0;transform:translateX(16px)}.actions{display:flex;gap:.5rem;flex-wrap:wrap;margin:.5rem 0}.note-field{width:100%}`],
})
export class AppealQueueComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly items = signal<AppealItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly removingId = signal<string | null>(null);
  readonly selectedOutcome = signal<Record<string, 'uphold' | 'modify' | 'remove' | undefined>>({});
  readonly notes: Record<string, string> = {};

  constructor() {
    void this.load();
  }

  stars(rating: number) {
    return '★'.repeat(Math.max(0, Math.min(5, rating))) + '☆'.repeat(5 - Math.max(0, Math.min(5, rating)));
  }

  outcomeFor(id: string) {
    return this.selectedOutcome()[id];
  }

  setOutcome(id: string, outcome: 'uphold' | 'modify' | 'remove') {
    this.selectedOutcome.set({ ...this.selectedOutcome(), [id]: outcome });
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<{ items: AppealItem[] }>('/api/arbitration/appeals');
      this.items.set(response.items ?? []);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load appeals';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  async submit(item: AppealItem) {
    const outcome = this.outcomeFor(item.id);
    const note = this.notes[item.id]?.trim();
    if (!outcome || !note) {
      const message = 'Decision note is required.';
      this.error.set(message);
      this.toast.error(message);
      return;
    }
    try {
      await this.api.post(`/api/arbitration/appeals/${item.id}/resolve`, { outcome, note });
      this.removingId.set(item.id);
      setTimeout(() => {
        this.items.set(this.items().filter((x) => x.id !== item.id));
        this.removingId.set(null);
      }, 220);
      this.toast.success('Appeal resolved');
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to resolve appeal';
      this.error.set(message);
      this.toast.error(message);
    }
  }
}
