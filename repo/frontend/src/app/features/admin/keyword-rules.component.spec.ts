import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { KeywordRulesComponent } from './keyword-rules.component';

describe('KeywordRulesComponent', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const apiPatch = vi.fn();
  const apiDelete = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  const toastInfo = vi.fn();

  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();

    apiGet.mockResolvedValue({
      items: [
        {
          id: 'rule-1',
          rule_type: 'keyword',
          pattern: 'bannedword',
          active: true,
          created_at: new Date().toISOString(),
        },
      ],
    });
    apiPost.mockResolvedValue({});
    apiPatch.mockResolvedValue({});
    apiDelete.mockResolvedValue({});

    await TestBed.configureTestingModule({
      imports: [KeywordRulesComponent, NoopAnimationsModule],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError, info: toastInfo } },
      ],
    }).compileComponents();
  });

  // Long per-test timeout: this suite goes through the full Angular bootstrap
  // + async signal-settle loop. Containerized CPU time can push the slower
  // machines past vitest's default 5s.
  const LONG_TIMEOUT = 30_000;

  it('loads rules on init', async () => {
    const fixture = TestBed.createComponent(KeywordRulesComponent);
    fixture.detectChanges();
    await componentReady(fixture);

    const component = fixture.componentInstance;
    expect(apiGet).toHaveBeenCalledWith('/api/admin/content-rules');
    expect(component.rules().length).toBe(1);
  }, LONG_TIMEOUT);

  it('toggles a rule active state', async () => {
    const fixture = TestBed.createComponent(KeywordRulesComponent);
    fixture.detectChanges();
    await componentReady(fixture);

    const component = fixture.componentInstance;
    await component.toggle(component.rules()[0]);

    expect(apiPatch).toHaveBeenCalledWith('/api/admin/content-rules/rule-1', { active: false });
    expect(toastSuccess).toHaveBeenCalledWith('Rule updated');
  }, LONG_TIMEOUT);

  it('deletes a rule and shows info toast', async () => {
    const fixture = TestBed.createComponent(KeywordRulesComponent);
    fixture.detectChanges();
    await componentReady(fixture);

    const component = fixture.componentInstance;
    await component.remove(component.rules()[0]);

    expect(apiDelete).toHaveBeenCalledWith('/api/admin/content-rules/rule-1');
    expect(toastInfo).toHaveBeenCalledWith('Rule deleted');
  }, LONG_TIMEOUT);

  it('creates a rule and resets form', async () => {
    const fixture = TestBed.createComponent(KeywordRulesComponent);
    fixture.detectChanges();
    await componentReady(fixture);

    const component = fixture.componentInstance;
    component.form.setValue({ ruleType: 'regex', pattern: 'forbid\\s+me' });
    await component.submit();

    expect(apiPost).toHaveBeenCalledWith('/api/admin/content-rules', { ruleType: 'regex', pattern: 'forbid\\s+me', active: true });
    expect(component.form.getRawValue()).toEqual({ ruleType: 'keyword', pattern: '' });
    expect(toastSuccess).toHaveBeenCalledWith('Rule created');
  }, LONG_TIMEOUT);

  async function componentReady(fixture: ReturnType<typeof TestBed.createComponent<KeywordRulesComponent>>) {
    for (let i = 0; i < 120; i += 1) {
      await Promise.resolve();
      fixture.detectChanges();
      if (!fixture.componentInstance.loading() && (fixture.componentInstance.rules().length > 0 || fixture.componentInstance.error())) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
});
