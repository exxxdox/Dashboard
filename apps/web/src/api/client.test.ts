import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, UNAUTHORIZED_EVENT, apiRequest, errorMessage } from './client';

function jsonResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(implementation: (input: URL, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    implementation(input as URL, init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  // These tests run in the node environment; `apiRequest` is browser-only, so
  // the origin it builds against is supplied here. `dispatchEvent` is stubbed
  // too, because a 401 has to be reported to the shell.
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost:4173' },
    dispatchEvent: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest success path', () => {
  it('parses a JSON body', async () => {
    stubFetch(async () => jsonResponse('{"status":"ok","version":"0.4.2"}', 200));
    await expect(apiRequest('/health')).resolves.toEqual({ status: 'ok', version: '0.4.2' });
  });

  it('resolves undefined for a 204 rather than throwing on an empty body', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(apiRequest('/targets/abc', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('drops blank query values and keeps real ones', async () => {
    const spy = stubFetch(async () => jsonResponse('[]', 200));
    await apiRequest('/executions', {
      query: { status: 'failed', scriptId: undefined, targetId: '', limit: 25, offset: 0 },
    });

    const url = spy.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get('status')).toBe('failed');
    expect(url.searchParams.has('scriptId')).toBe(false);
    expect(url.searchParams.has('targetId')).toBe(false);
    // `0` is a real value and must survive.
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it('targets the API prefix on the current origin', async () => {
    const spy = stubFetch(async () => jsonResponse('{}', 200));
    await apiRequest('/overview');
    const url = spy.mock.calls[0]?.[0] as URL;
    expect(url.origin).toBe('http://localhost:4173');
    expect(url.pathname).toBe('/api/overview');
  });

  it('sends a body as JSON with the matching content type', async () => {
    const spy = stubFetch(async () => jsonResponse('{}', 200));
    await apiRequest('/targets', { method: 'POST', body: { name: 'prod-01' } });

    const init = spy.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"name":"prod-01"}');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('sends no body for a GET', async () => {
    const spy = stubFetch(async () => jsonResponse('{}', 200));
    await apiRequest('/overview');
    expect(spy.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
});

describe('apiRequest error path', () => {
  it('unwraps the server error envelope', async () => {
    stubFetch(async () =>
      jsonResponse(
        '{"error":{"code":"invalid_target","message":"Host is not reachable","details":{"host":"10.0.0.12"}}}',
        400,
      ),
    );

    const error = await apiRequest('/targets').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw new Error('expected an ApiError');

    expect(error.status).toBe(400);
    expect(error.code).toBe('invalid_target');
    // The caller must receive the server's own wording, not a generic one.
    expect(error.message).toBe('Host is not reachable');
    expect(error.details).toEqual({ host: '10.0.0.12' });
    expect(errorMessage(error)).toBe('Host is not reachable');
  });

  it('keeps the status when a proxy answers with HTML instead of JSON', async () => {
    // A 502 from a reverse proxy is the common case: the body is a web page,
    // and a JSON parse failure here would mask the real status.
    stubFetch(async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }));

    const error = await apiRequest('/overview').catch((caught: unknown) => caught);
    if (!(error instanceof ApiError)) throw new Error('expected an ApiError');

    expect(error.status).toBe(502);
    expect(error.code).toBe('http_error');
    expect(error.message).toContain('502');
    expect(error.message).not.toMatch(/JSON|Unexpected token/i);
  });

  it('handles an empty error body', async () => {
    stubFetch(async () => new Response('', { status: 500 }));

    const error = await apiRequest('/overview').catch((caught: unknown) => caught);
    if (!(error instanceof ApiError)) throw new Error('expected an ApiError');
    expect(error.status).toBe(500);
    expect(error.message).toContain('500');
  });

  it('handles an error envelope that is missing its message', async () => {
    stubFetch(async () => jsonResponse('{"error":{"code":"boom"}}', 418));

    const error = await apiRequest('/overview').catch((caught: unknown) => caught);
    if (!(error instanceof ApiError)) throw new Error('expected an ApiError');
    expect(error.code).toBe('boom');
    expect(error.message).toContain('418');
  });

  it('reports an unreachable server as such instead of as a bad response', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await apiRequest('/health').catch((caught: unknown) => caught);
    if (!(error instanceof ApiError)) throw new Error('expected an ApiError');

    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/could not reach the server/i);
    expect(error.details).toBeInstanceOf(TypeError);
  });

  it('lets an abort surface unchanged, so React Query can ignore it', async () => {
    stubFetch(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    const error = await apiRequest('/executions').catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

describe('errorMessage', () => {
  it('falls back for values that are not errors at all', () => {
    expect(errorMessage('a string')).toBe('Unexpected error');
    expect(errorMessage(undefined)).toBe('Unexpected error');
  });

  it('uses a plain Error message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});

describe('unauthorized responses', () => {
  it('announces a 401 so the shell can return to the sign-in screen', async () => {
    stubFetch(async () =>
      new Response('{"error":{"code":"unauthorized","message":"Sign in to continue"}}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(apiRequest('/targets')).rejects.toBeInstanceOf(ApiError);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect((window.dispatchEvent as unknown as { mock: { calls: [Event][] } }).mock.calls[0]![0].type)
      .toBe(UNAUTHORIZED_EVENT);
  });

  it('leaves other failures to the caller', async () => {
    stubFetch(async () => jsonResponse('{"error":{"code":"no","message":"nope"}}', 500));
    await expect(apiRequest('/targets')).rejects.toBeInstanceOf(ApiError);
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
});
