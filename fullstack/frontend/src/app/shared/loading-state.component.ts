import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-loading-state',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  template: `
    <div class="loading" *ngIf="loading">
      <mat-spinner diameter="28"></mat-spinner>
      <span>{{ label }}</span>
    </div>
  `,
  styles: [
    `.loading{display:flex;align-items:center;gap:10px;padding:8px 0;color:#64748b;font-weight:500}`,
  ],
})
export class LoadingStateComponent {
  @Input() loading = false;
  @Input() label = 'Loading...';
}
