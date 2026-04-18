import { TestBed } from '@angular/core/testing';
import { HttpRequest, HttpResponse, HttpHandlerFn } from '@angular/common/http';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { jwtInterceptor } from './jwt.interceptor';

describe('jwtInterceptor', () => {
  const tokenSignal = vi.fn<() => string | null>();

  beforeEach(() => {
    tokenSignal.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token: tokenSignal } },
      ],
    });
  });

  async function run(req: HttpRequest<unknown>) {
    const seen: HttpRequest<unknown>[] = [];
    const next: HttpHandlerFn = (r) => {
      seen.push(r);
      return of(new HttpResponse({ status: 200 }));
    };
    const injector = TestBed.inject(EnvironmentInjector);
    await runInInjectionContext(injector, () => firstValueFrom(jwtInterceptor(req, next) as any));
    return seen[0];
  }

  it('adds X-Request-Nonce and X-Request-Timestamp on every request', async () => {
    tokenSignal.mockReturnValue(null);
    const seenReq = await run(new HttpRequest('GET', '/api/storefront/listings'));
    expect(seenReq.headers.has('X-Request-Nonce')).toBe(true);
    expect(seenReq.headers.has('X-Request-Timestamp')).toBe(true);
    expect(seenReq.headers.has('Authorization')).toBe(false);
  });

  it('adds Authorization: Bearer <token> when token is present', async () => {
    tokenSignal.mockReturnValue('the-jwt-token');
    const seenReq = await run(new HttpRequest('POST', '/api/listings', { title: 't' }));
    expect(seenReq.headers.get('Authorization')).toBe('Bearer the-jwt-token');
    expect(seenReq.headers.has('X-Request-Nonce')).toBe(true);
  });
});
