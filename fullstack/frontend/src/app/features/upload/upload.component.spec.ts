import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { UploadComponent } from './upload.component';

describe('UploadComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const httpPut = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    httpPut.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();

    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/listings') {
        return { items: [{ id: 'listing-1', title: 'Seller Listing' }] };
      }
      if (url === '/api/listings/listing-1') {
        return { id: 'listing-1', status: 'draft', readyToPublish: true, blockedReason: null, assets: [] };
      }
      if (url === '/api/assets/asset-1/metadata') {
        return { width: 640, height: 480 };
      }
      throw new Error(`Unhandled GET URL in test: ${url}`);
    });
    apiPost.mockResolvedValue({});
    httpPut.mockReturnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [UploadComponent, NoopAnimationsModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ listingId: 'listing-1' }) } },
        },
        { provide: ApiService, useValue: { get: apiGet, post: apiPost } },
        { provide: HttpClient, useValue: { put: httpPut } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError } },
      ],
    }).compileComponents();
  });

  it('flags unsupported file types as invalid', async () => {
    const fixture = TestBed.createComponent(UploadComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const badFile = new File(['invalid'], 'malware.exe', { type: 'application/octet-stream' });
    (component as any).addFiles([badFile]);

    const item = component.items()[0];
    expect(item.valid).toBe(false);
    expect(item.error).toContain('Unsupported file type');
    expect(component.hasValidPending()).toBe(false);
  });

  it('retries failed chunk and completes upload flow', async () => {
    const fixture = TestBed.createComponent(UploadComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const file = new File(['chunk-data'], 'photo.jpg', { type: 'image/jpeg' });
    component.items.set([
      {
        file,
        valid: true,
        error: 'Chunk 1 failed. Retry this chunk.',
        status: 'failed',
        progress: 0,
        sessionId: 'session-1',
        assetId: 'asset-1',
        failedChunkIndex: 0,
        nextChunkIndex: 0,
        metadataText: null,
      },
    ]);

    await component.retryFailedChunk(0);

    const item = component.items()[0];
    expect(httpPut).toHaveBeenCalledWith(
      '/api/media/upload-sessions/session-1/chunks/0',
      expect.any(Blob),
      { headers: { 'Content-Type': 'application/octet-stream' } },
    );
    expect(apiPost).toHaveBeenCalledWith('/api/media/upload-sessions/session-1/finalize', { detectedMime: 'image/jpeg' });
    expect(item.status).toBe('uploaded');
    expect(item.failedChunkIndex).toBeNull();
    expect(item.progress).toBe(100);
    expect(item.metadataText).toContain('640 x 480');
    expect(toastSuccess).toHaveBeenCalledWith('Chunk retry succeeded');
    expect(toastError).not.toHaveBeenCalled();
  });
});
