import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { detectLocalIpv6, detectPublicIpv6 } from './ipv6.js';
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

// Read the Linux address table without requiring iproute2 in the runtime image.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

function localRow(address: string, flags = '80', scope = '00', name = 'eth0'): string {
  return `${address} 02 40 ${scope} ${flags} ${name}`;
}

describe('detectLocalIpv6', () => {
  test('reads and compresses a stable global address without a network request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.mocked(readFile).mockResolvedValue(localRow('26064700000000000000000000001111'));
    await expect(detectLocalIpv6()).resolves.toBe('2606:4700::1111');
    expect(fetch).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith('/proc/net/if_inet6', expect.objectContaining({ encoding: 'utf8' }));
  });

  test('ignores private, loopback, link-local, temporary and unusable addresses', async () => {
    vi.mocked(readFile).mockResolvedValue([
      localRow('fd000000000000000000000000000001'),
      localRow('00000000000000000000000000000001', '80', '10', 'lo'),
      localRow('fe800000000000000000000000000001', '80', '20'),
      ...['01', '20', '40', '08'].map(flags => localRow('26064700000000000000000000000001', flags)),
      localRow('26064700000000000000000000001111'),
    ].join('\n'));
    await expect(detectLocalIpv6()).resolves.toBe('2606:4700::1111');
  });

  test('refuses to guess between multiple stable global addresses', async () => {
    vi.mocked(readFile).mockResolvedValue([
      localRow('26064700000000000000000000000001'),
      localRow('26064700000000000000000000000002'),
    ].join('\n'));
    await expect(detectLocalIpv6()).rejects.toMatchObject({ reason: 'ipv6_detect_failed', message: expect.stringContaining('multiple') });
  });

  test('deduplicates an address present on more than one interface', async () => {
    const address = '26064700000000000000000000000001';
    vi.mocked(readFile).mockResolvedValue([localRow(address), localRow(address, '80', '00', 'eth1')].join('\n'));
    await expect(detectLocalIpv6()).resolves.toBe('2606:4700::1');
  });

  test.each(['', 'malformed address table', localRow('fd000000000000000000000000000001')])('refuses a table without a stable public address: %s', async table => {
    vi.mocked(readFile).mockResolvedValue(table);
    expect(await reasonOf(() => detectLocalIpv6())).toBe('ipv6_not_global');
  });

  test('reports an unavailable Linux address table as a detection failure', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));
    expect(await reasonOf(() => detectLocalIpv6())).toBe('ipv6_detect_failed');
  });
});


test('local detection only considers the configured interface', async () => {
  vi.mocked(readFile).mockResolvedValue([
    localRow('26064700000000000000000000000001', '80', '00', 'eth0'),
    localRow('26064700000000000000000000000002', '80', '00', 'wlan0'),
  ].join('\n'));
  await expect(detectLocalIpv6('eth0')).resolves.toBe('2606:4700::1');
  await expect(detectLocalIpv6('missing')).rejects.toMatchObject({ reason: 'ipv6_not_global' });
});
