import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  const open = vi.fn();

  beforeEach(() => {
    open.mockReset();
    TestBed.configureTestingModule({
      providers: [
        ToastService,
        { provide: MatSnackBar, useValue: { open } },
      ],
    });
  });

  it('success() opens a snack bar with success class and 3500ms duration', () => {
    const svc = TestBed.inject(ToastService);
    svc.success('Saved');
    expect(open).toHaveBeenCalledWith('Saved', 'Close', expect.objectContaining({
      duration: 3500,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['toast-success'],
    }));
  });

  it('error() opens a snack bar with error class and 5000ms duration', () => {
    const svc = TestBed.inject(ToastService);
    svc.error('Failed');
    expect(open).toHaveBeenCalledWith('Failed', 'Close', expect.objectContaining({
      duration: 5000,
      panelClass: ['toast-error'],
    }));
  });

  it('info() opens a snack bar with info class', () => {
    const svc = TestBed.inject(ToastService);
    svc.info('FYI');
    expect(open).toHaveBeenCalledWith('FYI', 'Close', expect.objectContaining({
      duration: 3500,
      panelClass: ['toast-info'],
    }));
  });
});
