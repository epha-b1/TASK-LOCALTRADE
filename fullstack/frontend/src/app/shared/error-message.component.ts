import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-error-message',
  standalone: true,
  imports: [CommonModule],
  template: `<p class="error" *ngIf="message">{{ message }}</p>`,
  styles: [`.error{margin:8px 0 0;color:#b71c1c;font-size:.875rem;font-weight:500;line-height:1.35}`],
})
export class ErrorMessageComponent {
  @Input() message: string | null = null;
}
