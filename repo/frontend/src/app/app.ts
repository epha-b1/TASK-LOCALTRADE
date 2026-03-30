import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from './core/auth.service';
import { ApiService } from './core/api.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule, MatIconModule, MatMenuModule, MatChipsModule, MatSnackBarModule, MatTooltipModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly currentEmail = signal<string | null>(null);
  readonly pageRoleClass = signal<string>('');
  readonly currentUrl = signal(this.router.url);
  readonly isAuthPage = computed(() => this.currentUrl().startsWith('/auth'));
  readonly sidebarCollapsed = signal(false);
  readonly mobileOpen = signal(false);
  readonly pageTitle = computed(() => {
    const url = this.currentUrl();
    if (url.startsWith('/listings/browse')) return 'Browse Listings';
    if (url.startsWith('/listings/my-listings')) return 'My Listings';
    if (url.startsWith('/listings/create')) return 'Create Listing';
    if (url.startsWith('/listings/')) return 'Listing Detail';
    if (url.startsWith('/orders/payment-capture')) return 'Capture Payment';
    if (url.startsWith('/orders/list')) return 'My Orders';
    if (url.startsWith('/orders/')) return 'Order Detail';
    if (url.startsWith('/reviews/form')) return 'Leave Review';
    if (url.startsWith('/reviews/list')) return 'Reviews';
    if (url.startsWith('/upload')) return 'Upload Media';
    if (url.startsWith('/storefront')) return 'My Storefront';
    if (url.startsWith('/moderation/queue')) return 'Moderation Queue';
    if (url.startsWith('/arbitration/queue')) return 'Appeals Queue';
    if (url.startsWith('/admin/users')) return 'Users';
    if (url.startsWith('/admin/keyword-rules')) return 'Keyword Rules';
    if (url.startsWith('/admin/refunds')) return 'Refund Approvals';
    if (url.startsWith('/admin/audit-logs')) return 'Audit Logs';
    return 'LocalTrade';
  });
  readonly primaryRole = computed(() => {
    const roles = this.auth.roles();
    if (roles.includes('admin')) return 'Admin account';
    if (roles.includes('moderator')) return 'Moderator account';
    if (roles.includes('arbitrator')) return 'Arbitrator account';
    if (roles.includes('seller')) return 'Seller account';
    if (roles.includes('buyer')) return 'Buyer account';
    return 'Account';
  });

  constructor() {
    effect(() => {
      const token = this.auth.token();
      if (!token) {
        this.currentEmail.set(null);
        return;
      }
      void this.loadCurrentUser();
    });
    const applyRoleClass = (url: string) => {
      if (url.startsWith('/admin')) this.pageRoleClass.set('role-admin');
      else if (url.startsWith('/moderation')) this.pageRoleClass.set('role-moderator');
      else if (url.startsWith('/arbitration')) this.pageRoleClass.set('role-arbitrator');
      else if (url.startsWith('/listings') || url.startsWith('/upload') || url.startsWith('/storefront')) this.pageRoleClass.set('role-seller');
      else if (url.startsWith('/orders') || url.startsWith('/reviews')) this.pageRoleClass.set('role-buyer');
      else this.pageRoleClass.set('');
    };
    applyRoleClass(this.router.url);
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd)
    ).subscribe((e) => {
      this.currentUrl.set(e.urlAfterRedirects);
      applyRoleClass(e.urlAfterRedirects);
      this.mobileOpen.set(false);
    });
  }

  private async loadCurrentUser() {
    try {
      const me = await this.api.get<{ email: string }>('/api/users/me');
      this.currentEmail.set(me.email);
    } catch {
      this.currentEmail.set(null);
    }
  }

  async logout() {
    await this.auth.logout();
    this.currentEmail.set(null);
    this.pageRoleClass.set('');
    await this.router.navigateByUrl('/auth/login');
  }

  toggleSidebarCollapsed() {
    this.sidebarCollapsed.set(!this.sidebarCollapsed());
  }

  toggleMobileSidebar() {
    this.mobileOpen.set(!this.mobileOpen());
  }

  closeMobileSidebar() {
    this.mobileOpen.set(false);
  }

  initials() {
    const email = this.currentEmail() ?? '';
    return email ? email[0].toUpperCase() : 'U';
  }
}
