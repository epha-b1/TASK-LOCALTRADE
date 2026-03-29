import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const nonce = `${Date.now()}-${Math.random()}`;
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const headers: Record<string, string> = {
    'X-Request-Nonce': nonce,
    'X-Request-Timestamp': timestamp,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return next(req.clone({ setHeaders: headers }));
};
