import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHandlerFn, HttpRequest, HttpResponse, HttpEvent } from '@angular/common/http';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { firstValueFrom, lastValueFrom, of, throwError, toArray } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { tokenRefreshInterceptor } from './token-refresh.interceptor';

describe('tokenRefreshInterceptor', () => {
  const refresh = vi.fn();
  const clear = vi.fn();

  beforeEach(() => {
    refresh.mockReset();
    clear.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { refresh, clear } },
      ],
    });
  });

  function intercept(req: HttpRequest<unknown>, next: HttpHandlerFn) {
    const injector = TestBed.inject(EnvironmentInjector);
    return runInInjectionContext(injector, () => tokenRefreshInterceptor(req, next));
  }

  it('skips refresh for /api/auth/login requests', async () => {
    const req = new HttpRequest('POST', '/api/auth/login', { email: 'a' });
    const next: HttpHandlerFn = () => throwError(() => new HttpErrorResponse({ status: 401 }));
    await expect(firstValueFrom(intercept(req, next) as any)).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('propagates non-401 errors without calling refresh', async () => {
    const req = new HttpRequest('GET', '/api/orders');
    const next: HttpHandlerFn = () => throwError(() => new HttpErrorResponse({ status: 500 }));
    await expect(firstValueFrom(intercept(req, next) as any)).rejects.toMatchObject({ status: 500 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on 401 and retries with new Bearer token', async () => {
    const req = new HttpRequest('GET', '/api/users/me');
    refresh.mockResolvedValue('new-jwt');
    let call = 0;
    let retriedReq: HttpRequest<unknown> | null = null;
    const next: HttpHandlerFn = (r) => {
      call += 1;
      if (call === 1) return throwError(() => new HttpErrorResponse({ status: 401 }));
      retriedReq = r;
      return of(new HttpResponse({ status: 200 }));
    };
    const events = await lastValueFrom((intercept(req, next) as any).pipe(toArray()));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(retriedReq!.headers.get('Authorization')).toBe('Bearer new-jwt');
    expect((events as HttpEvent<unknown>[]).some((e) => (e as HttpResponse<unknown>).status === 200)).toBe(true);
  });

  it('clears auth state when refresh returns null', async () => {
    const req = new HttpRequest('GET', '/api/users/me');
    refresh.mockResolvedValue(null);
    const next: HttpHandlerFn = () => throwError(() => new HttpErrorResponse({ status: 401 }));
    await expect(firstValueFrom(intercept(req, next) as any)).rejects.toBeDefined();
    expect(clear).toHaveBeenCalled();
  });
});
