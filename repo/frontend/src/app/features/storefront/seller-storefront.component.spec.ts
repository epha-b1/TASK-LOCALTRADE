import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { SellerStorefrontComponent } from './seller-storefront.component';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

describe('SellerStorefrontComponent', () => {
  it('renders appeal and arbitration removal badges from API flags', async () => {
    await TestBed.configureTestingModule({
      imports: [SellerStorefrontComponent, NoopAnimationsModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ sellerId: '11111111-1111-1111-1111-111111111111' }) } },
        },
        {
          provide: AuthService,
          useValue: { hasRole: () => false },
        },
        {
          provide: ApiService,
          useValue: {
            get: async (url: string) => {
              if (url.includes('/credit-metrics')) {
                return { avgRating90d: 4.2, positiveRate90d: 80, reviewCount90d: 2 };
              }
              if (url.includes('/reviews?sortRule=')) {
                return {
                  items: [
                    {
                      id: 'r1',
                      rating: 5,
                      body: 'good',
                      reviewerName: 'Buyer A',
                      createdAt: new Date().toISOString(),
                      underAppeal: true,
                      removedByArbitration: true,
                    },
                  ],
                };
              }
              throw new Error(`Unhandled URL in test: ${url}`);
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SellerStorefrontComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    if (!component.reviews().length) {
      component.reviews.set([
        {
          id: 'r1',
          rating: 5,
          body: 'good',
          reviewerName: 'Buyer A',
          createdAt: new Date().toISOString(),
          underAppeal: true,
          removedByArbitration: true,
        },
      ]);
    }
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Under Appeal');
    expect(text).toContain('Removed by Arbitration');
  });
});
