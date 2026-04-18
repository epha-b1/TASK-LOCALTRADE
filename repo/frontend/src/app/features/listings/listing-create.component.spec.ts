import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ListingCreateComponent } from './listing-create.component';

describe('ListingCreateComponent', () => {
  const post = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    await TestBed.configureTestingModule({
      imports: [ListingCreateComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { post } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError } },
      ],
    }).compileComponents();
  });

  it('renders Create-Listing heading', () => {
    const fixture = TestBed.createComponent(ListingCreateComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Create Listing');
  });

  it('posts form to /api/listings and stores returned id', async () => {
    post.mockResolvedValue({ id: 'listing-abc' });
    const fixture = TestBed.createComponent(ListingCreateComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ title: 'T', description: 'D', priceCents: 1000, quantity: 5 });
    await fixture.componentInstance.submit();

    expect(post).toHaveBeenCalledWith('/api/listings', { title: 'T', description: 'D', priceCents: 1000, quantity: 5 });
    expect(fixture.componentInstance.listingId()).toBe('listing-abc');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('does not submit when form is invalid (empty title)', async () => {
    const fixture = TestBed.createComponent(ListingCreateComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ title: '', description: 'D', priceCents: 100, quantity: 1 });
    await fixture.componentInstance.submit();
    expect(post).not.toHaveBeenCalled();
  });

  it('surfaces backend error on failure', async () => {
    post.mockRejectedValue({ error: { message: 'Quota exceeded' } });
    const fixture = TestBed.createComponent(ListingCreateComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ title: 'T', description: 'D', priceCents: 100, quantity: 1 });
    await fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('Quota exceeded');
    expect(toastError).toHaveBeenCalledWith('Quota exceeded');
  });
});
