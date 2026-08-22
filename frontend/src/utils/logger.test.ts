import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, enableConsoleOverride } from './logger';

// Mock Amplify Auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      idToken: {
        toString: () => 'mock-token'
      }
    }
  })
}));

describe('Frontend Logger Utility', () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_LOG_FORWARDING', 'false');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' })
      } as Response)
    );
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * [FUNC-SYS-2] Setup logger and level setting
   */
  it('should initialize and support setting log levels', () => {
    expect(logger).toBeDefined();
    expect(() => logger.setLevel('warn')).not.toThrow();
  });

  /**
   * [NFR-PERF-7] Configurable Frontend Network Log Forwarding
   * When forwarding is disabled (default), log calls should NOT make fetch requests.
   */
  it('should not call fetch API to forward logs when forwarding is disabled', async () => {
    logger.error('Test error message');
    await new Promise(r => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * [NFR-PERF-7] Log Forwarding via LocalStorage Toggle
   */
  it('should call fetch API to forward logs when localStorage flag is enabled', async () => {
    localStorage.setItem('enableLogForwarding', 'true');
    logger.error('Test error message for backend');

    await new Promise(r => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalled();
    const [url, options]: any = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/logs');
    expect(options.method).toBe('POST');
    
    const body = JSON.parse(options.body);
    expect(body.level).toBe('error');
    expect(body.message).toBe('Test error message for backend');
  });

  /**
   * [NFR-PERF-6] Dynamic Console Override Interception
   */
  it('should intercept standard console.error and console.warn calls when override is enabled', async () => {
    const originalConsoleError = console.error;
    
    try {
      enableConsoleOverride();
      localStorage.setItem('enableLogForwarding', 'true');
      
      console.error('Interception test message');
      
      await new Promise(r => setTimeout(r, 50));
      expect(fetchSpy).toHaveBeenCalled();
      const [, options]: any = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.level).toBe('error');
      expect(body.message).toBe('Interception test message');
    } finally {
      console.error = originalConsoleError;
    }
  });
});
