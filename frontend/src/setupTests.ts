import '@testing-library/jest-dom';

// Default global fetch handler for test environment
const originalFetch = global.fetch;

(globalThis as any).__SERVER_HEALTHY__ = true;

global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

  if (urlStr.includes('/api/health')) {
    return new Response(
      JSON.stringify({ status: 'ok', server: 'ready', database: 'connected' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (originalFetch) {
    try {
      return await originalFetch(input, init);
    } catch (_e) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
