import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, type RoleCode } from './auth.service';

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const required = (route.data['roles'] as RoleCode[] | undefined) ?? [];
  const token = auth.token();
  if (!token) {
    return router.createUrlTree(['/auth/login']);
  }
  if (!required.length) {
    return true;
  }
  if (required.some((r) => auth.hasRole(r))) {
    return true;
  }
  return router.createUrlTree([auth.defaultHomeRoute()]);
};

export const authOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.token()) {
    return router.createUrlTree(['/auth/login']);
  }
  return true;
};

export const landingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.token()) {
    return router.createUrlTree(['/auth/login']);
  }
  return router.createUrlTree([auth.defaultHomeRoute()]);
};
