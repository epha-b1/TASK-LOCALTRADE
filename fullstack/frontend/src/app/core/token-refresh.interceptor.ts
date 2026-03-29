import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const tokenRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  if (req.url.includes('/api/auth/login') || req.url.includes('/api/auth/refresh')) {
    return next(req);
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) {
        return throwError(() => error);
      }
      return from(auth.refresh()).pipe(
        switchMap((newToken) => {
          if (!newToken) {
            auth.clear();
            return throwError(() => error);
          }
          const retry = req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
          return next(retry);
        }),
        catchError((refreshError) => {
          auth.clear();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
