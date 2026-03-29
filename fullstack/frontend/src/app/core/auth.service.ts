import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type RoleCode = 'buyer' | 'seller' | 'moderator' | 'arbitrator' | 'admin';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenKey = 'lt_token';
  private readonly refreshKey = 'lt_refresh';
  private readonly roleKey = 'lt_roles';

  readonly token = signal<string | null>(localStorage.getItem(this.tokenKey));
  readonly refreshToken = signal<string | null>(localStorage.getItem(this.refreshKey));
  readonly roles = signal<RoleCode[]>(this.readRolesFromStorage());

  constructor(private readonly http: HttpClient) {}

  async login(email: string, password: string) {
    const response: any = await firstValueFrom(this.http.post('/api/auth/login', { email, password }));
    this.token.set(response.accessToken);
    this.refreshToken.set(response.refreshToken);
    const roles = this.sanitizeRoles(response.roles);
    this.roles.set(roles);
    localStorage.setItem(this.tokenKey, response.accessToken);
    localStorage.setItem(this.refreshKey, response.refreshToken);
    localStorage.setItem(this.roleKey, JSON.stringify(roles));
  }

  async refresh(): Promise<string | null> {
    const refreshToken = this.refreshToken();
    if (!refreshToken) return null;
    const response: any = await firstValueFrom(this.http.post('/api/auth/refresh', { refreshToken }));
    this.token.set(response.accessToken);
    this.refreshToken.set(response.refreshToken);
    localStorage.setItem(this.tokenKey, response.accessToken);
    localStorage.setItem(this.refreshKey, response.refreshToken);
    return response.accessToken;
  }

  async logout() {
    const refreshToken = this.refreshToken();
    try {
      if (refreshToken) {
        await firstValueFrom(this.http.post('/api/auth/logout', { refreshToken }));
      }
    } finally {
      this.clear();
    }
  }

  hasRole(role: RoleCode) {
    return this.roles().includes(role);
  }

  defaultHomeRoute() {
    const roles = this.roles();
    if (roles.includes('admin')) return '/admin/users';
    if (roles.includes('arbitrator')) return '/arbitration/queue';
    if (roles.includes('moderator')) return '/moderation/queue';
    if (roles.includes('seller')) return '/listings/my-listings';
    if (roles.includes('buyer')) return '/listings/browse';
    return '/auth/login';
  }

  private readRolesFromStorage(): RoleCode[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.roleKey) ?? '[]');
      return this.sanitizeRoles(parsed);
    } catch {
      return [];
    }
  }

  private sanitizeRoles(input: unknown): RoleCode[] {
    const allowed: RoleCode[] = ['buyer', 'seller', 'moderator', 'arbitrator', 'admin'];
    if (!Array.isArray(input)) return [];
    return input.filter((role): role is RoleCode => allowed.includes(role as RoleCode));
  }

  clear() {
    this.token.set(null);
    this.refreshToken.set(null);
    this.roles.set([]);
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.refreshKey);
    localStorage.removeItem(this.roleKey);
  }
}
