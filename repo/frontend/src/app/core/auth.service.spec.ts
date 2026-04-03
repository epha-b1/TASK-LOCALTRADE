import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const httpPost = vi.fn();

  beforeEach(() => {
    httpPost.mockReset();
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: HttpClient, useValue: { post: httpPost } },
      ],
    });
  });

  it('switches active user context cleanly across consecutive logins', async () => {
    const service = TestBed.inject(AuthService);
    httpPost
      .mockReturnValueOnce(of({ accessToken: 'token-a', refreshToken: 'refresh-a', roles: ['buyer'] }))
      .mockReturnValueOnce(of({ accessToken: 'token-b', refreshToken: 'refresh-b', roles: ['seller'] }));

    await service.login('buyer@example.com', 'Password123');
    expect(service.token()).toBe('token-a');
    expect(service.roles()).toEqual(['buyer']);

    await service.login('seller@example.com', 'Password123');
    expect(service.token()).toBe('token-b');
    expect(service.refreshToken()).toBe('refresh-b');
    expect(service.roles()).toEqual(['seller']);
  });

  it('does not persist auth tokens to localStorage', async () => {
    const service = TestBed.inject(AuthService);
    httpPost.mockReturnValueOnce(of({ accessToken: 'token-a', refreshToken: 'refresh-a', roles: ['buyer'] }));

    await service.login('buyer@example.com', 'Password123');

    expect(localStorage.getItem('lt_token')).toBeNull();
    expect(localStorage.getItem('lt_refresh')).toBeNull();
    expect(localStorage.getItem('lt_roles')).toBeNull();
  });

  it('refresh rotates in-memory tokens without localStorage persistence', async () => {
    const service = TestBed.inject(AuthService);
    httpPost
      .mockReturnValueOnce(of({ accessToken: 'token-a', refreshToken: 'refresh-a', roles: ['buyer'] }))
      .mockReturnValueOnce(of({ accessToken: 'token-b', refreshToken: 'refresh-b' }));

    await service.login('buyer@example.com', 'Password123');
    const nextToken = await service.refresh();

    expect(nextToken).toBe('token-b');
    expect(service.token()).toBe('token-b');
    expect(service.refreshToken()).toBe('refresh-b');
    expect(localStorage.getItem('lt_token')).toBeNull();
    expect(localStorage.getItem('lt_refresh')).toBeNull();
  });
});
