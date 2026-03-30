import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { authOnlyGuard, landingGuard, roleGuard } from './auth.guard';

describe('auth guards', () => {
  const token = signal<string | null>(null);
  const hasRole = vi.fn();
  const defaultHomeRoute = vi.fn().mockReturnValue('/listings/browse');

  beforeEach(() => {
    token.set(null);
    hasRole.mockReset();
    defaultHomeRoute.mockReset();
    defaultHomeRoute.mockReturnValue('/listings/browse');

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            token,
            hasRole,
            defaultHomeRoute,
          },
        },
      ],
    });
  });

  it('roleGuard redirects anonymous users to login', () => {
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() =>
      roleGuard({ data: { roles: ['seller'] } } as any, {} as any),
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/auth/login');
  });

  it('roleGuard redirects authenticated users without role to default home', () => {
    const router = TestBed.inject(Router);
    token.set('access-token');
    hasRole.mockReturnValue(false);
    defaultHomeRoute.mockReturnValue('/admin/users');

    const result = TestBed.runInInjectionContext(() =>
      roleGuard({ data: { roles: ['seller'] } } as any, {} as any),
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/admin/users');
  });

  it('roleGuard allows authenticated users with matching role', () => {
    token.set('access-token');
    hasRole.mockImplementation((role: string) => role === 'seller');

    const result = TestBed.runInInjectionContext(() =>
      roleGuard({ data: { roles: ['seller'] } } as any, {} as any),
    );

    expect(result).toBe(true);
  });

  it('authOnlyGuard blocks anonymous users and allows authenticated users', () => {
    const router = TestBed.inject(Router);

    const anonResult = TestBed.runInInjectionContext(() => authOnlyGuard({} as any, {} as any));
    expect(router.serializeUrl(anonResult as UrlTree)).toBe('/auth/login');

    token.set('access-token');
    const authResult = TestBed.runInInjectionContext(() => authOnlyGuard({} as any, {} as any));
    expect(authResult).toBe(true);
  });

  it('landingGuard routes users to login when missing token, otherwise to default home', () => {
    const router = TestBed.inject(Router);

    const anonResult = TestBed.runInInjectionContext(() => landingGuard({} as any, {} as any));
    expect(router.serializeUrl(anonResult as UrlTree)).toBe('/auth/login');

    token.set('access-token');
    defaultHomeRoute.mockReturnValue('/moderation/queue');
    const authResult = TestBed.runInInjectionContext(() => landingGuard({} as any, {} as any));
    expect(router.serializeUrl(authResult as UrlTree)).toBe('/moderation/queue');
  });
});
