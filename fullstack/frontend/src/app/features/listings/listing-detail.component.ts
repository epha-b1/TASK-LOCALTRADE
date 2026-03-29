import { Component, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { ErrorMessageComponent } from '../../shared/error-message.component';

type Listing = {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price_cents: number;
  quantity: number;
  created_at: string;
  seller_display_name?: string;
};

@Component({
  standalone: true,
  selector: 'app-listing-detail',
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatDividerModule, LoadingStateComponent, ErrorMessageComponent, CurrencyPipe, DatePipe],
  template: `
    <mat-card>
      <h2>Listing Detail</h2>
      <app-loading-state [loading]="loading()"></app-loading-state>
      <app-error-message [message]="error()"></app-error-message>

      <div *ngIf="row() as listing" class="details">
        <div class="hero-image"><mat-icon>image</mat-icon></div>
        <h3>{{ listing.title }}</h3>
        <p class="price">{{ listing.price_cents / 100 | currency:'USD':'symbol':'1.2-2' }}</p>
        <p>{{ listing.description }}</p>
        <p><strong>Available Quantity:</strong> {{ listing.quantity }}</p>
        <button mat-button class="seller-link" (click)="openStorefront(listing.seller_id)"><mat-icon>storefront</mat-icon>{{ listing.seller_display_name || 'Seller storefront' }}</button>
        <p><strong>Listed:</strong> {{ listing.created_at | date:'medium' }}</p>
        <mat-divider></mat-divider>

        <form [formGroup]="orderForm" (ngSubmit)="placeOrder(listing)" *ngIf="auth.hasRole('buyer')" class="order-form">
          <button mat-icon-button type="button" (click)="decrementQty()" [disabled]="orderForm.controls.quantity.value <= 1"><mat-icon>remove</mat-icon></button>
          <mat-form-field appearance="outline">
            <mat-label>Quantity</mat-label>
            <input matInput type="number" formControlName="quantity" min="1" [max]="listing.quantity">
            <mat-error *ngIf="orderForm.controls.quantity.invalid">Enter a valid quantity</mat-error>
          </mat-form-field>
          <button mat-icon-button type="button" (click)="incrementQty(listing.quantity)" [disabled]="orderForm.controls.quantity.value >= listing.quantity"><mat-icon>add</mat-icon></button>
          <p class="total">Total: {{ ((orderForm.controls.quantity.value || 0) * listing.price_cents) / 100 | currency:'USD':'symbol':'1.2-2' }}</p>
          <button mat-flat-button color="primary" [disabled]="placingOrder()"><mat-icon>shopping_cart</mat-icon>Place Order</button>
        </form>
      </div>
    </mat-card>
  `,
  styles: [
    `
      mat-card { max-width: 900px; margin: 0 auto; }
      .details { display: grid; gap: 14px; }
      .hero-image { height: 240px; border-radius: 12px; background: linear-gradient(135deg, #eef2f9, #e3e8f3); display:flex; align-items:center; justify-content:center; color:#78909c; }
      .hero-image .mat-icon { font-size: 48px; height: 48px; width: 48px; }
      .price { font-size: 28px; color: #2e7d32; font-weight: 700; margin: 0; }
      .seller-link { justify-self: start; padding: 0; font-weight: 600; }
      .order-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding-top: 10px; }
      .order-form .mat-mdc-form-field { width: 130px; }
      .total { font-weight: 600; margin-right: 8px; color: #1a1a2e; }
    `,
  ],
})
export class ListingDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);

  readonly row = signal<Listing | null>(null);
  readonly loading = signal(false);
  readonly placingOrder = signal(false);
  readonly error = signal<string | null>(null);
  readonly orderForm = this.fb.nonNullable.group({
    quantity: [1, [Validators.required, Validators.min(1)]],
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      void this.load(id);
    }
  }

  async load(id: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<{ items: Listing[] }>('/api/storefront/listings');
      this.row.set((response.items ?? []).find((item) => item.id === id) ?? null);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to load detail';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  async placeOrder(listing: Listing) {
    this.error.set(null);
    if (this.orderForm.invalid) {
      this.orderForm.markAllAsTouched();
      return;
    }
    this.placingOrder.set(true);
    try {
      await this.api.post('/api/orders', { listingId: listing.id, quantity: this.orderForm.getRawValue().quantity });
      this.toast.success('Order placed successfully');
      await this.router.navigate(['/orders/list']);
    } catch (e: any) {
      const message = e?.error?.message ?? 'Failed to place order';
      this.error.set(message);
      this.toast.error(message);
    } finally {
      this.placingOrder.set(false);
    }
  }

  openStorefront(sellerId: string) {
    void this.router.navigate(['/storefront', sellerId]);
  }

  incrementQty(max: number) {
    const current = this.orderForm.controls.quantity.value || 1;
    this.orderForm.patchValue({ quantity: Math.min(max, current + 1) });
  }

  decrementQty() {
    const current = this.orderForm.controls.quantity.value || 1;
    this.orderForm.patchValue({ quantity: Math.max(1, current - 1) });
  }
}
