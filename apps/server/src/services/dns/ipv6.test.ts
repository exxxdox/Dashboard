import { afterEach, describe, expect, test, vi } from 'vitest';

import { detectPublicIpv6 } from './ipv6.js';
import { DnsFailureError } from './types.js';

type Recorded = { url: string; init: RequestInit | undefined };

/** Replace fetch for one test, recording how it was called. */
function stubFetch(answer: {
  ok?: boolean;
  status?: number;
  body?: string;
  reject?: Error;
}): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (answer.reject) return Promise.reject(answer.reject);
    return Promise.resolve({
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      text: (): Promise<string> => Promise.resolve(answer.body ?? ''),
    } as unknown as Response);
  });
  return calls;
}

async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DnsFailureError) return error.reason;
    throw error;
  }
  throw new Error('expected the probe to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('detectPublicIpv6', () => {
  test('asks the one endpoint and returns the compressed address', async () => {
    // A real global address, not the documentation range: 2001:db8::/32 is one of
    // the ranges the parser refuses, which has its own test.
    const calls = stubFetch({ body: '2606:4700:0:0:0:0:0:1111\n' });

    await expect(detectPublicIpv6()).resolves.toBe('2606:4700::1111');
    expect(calls.map((call) => call.url)).toEqual(['https://api6.ipify.org']);
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('passes no dispatcher, so no proxy can decide which address is reported', async () => {
    // The Python version set `session.trust_env = False` for this. Node's global
    // fetch already ignores HTTP_PROXY and NO_PROXY, so the requirement is met by
    // passing nothing -- and this test is what stops someone adding an
    // EnvHttpProxyAgent later, which would quietly write the proxy's address into
    // the AAAA record.
    const calls = stubFetch({ body: '2001:4860::8888' });
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890');

    await detectPublicIpv6();

    expect(Object.keys(calls[0]?.init ?? {})).not.toContain('dispatcher');
  });

  test('reports an unreachable probe as a detection failure', async () => {
    stubFetch({ reject: new TypeError('fetch failed') });
    expect(await reasonOf(() => detectPublicIpv6())).toBe('ipv6_detect_failed');
  });

  test('reports a non-OK answer as a detection failure, with the URL kept out of it', async () => {
    stubFetch({ ok: false, status: 502, body: 'gateway' });
    try {
      await detectPublicIpv6();
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DnsFailureError);
      expect((error as DnsFailureError).reason).toBe('ipv6_detect_failed');
      expect((error as Error).message).toContain('502');
      expect((error as Error).message).not.toContain('api6.ipify.org');
    }
  });

  test('separates a reached probe that answered with a private address', async () => {
    // A different reason on purpose: the operator's next step differs from the
    // one for an unreachable probe.
    stubFetch({ body: 'fd00::1' });
    expect(await reasonOf(() => detectPublicIpv6())).toBe('ipv6_not_global');
  });

  test('treats an empty body as an answer rather than a transport failure', async () => {
    stubFetch({ body: '   \n' });
    expect(await reasonOf(() => detectPublicIpv6())).toBe('ipv6_not_global');
  });
});
