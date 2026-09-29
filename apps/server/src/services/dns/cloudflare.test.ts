import { afterEach, describe, expect, test, vi } from 'vitest';

import { createCloudflareProvider } from './cloudflare.js';
import { DnsFailureError, type ResolvedDnsSettings } from './types.js';

type Recorded = { url: string; init: RequestInit | undefined; body: unknown };

/**
 * Answer the next calls in order. A call past the end of the list is a bug in
 * the test's expectation: an extra request means the code under test wrote when
 * it should not have.
 */
function stubFetch(...answers: { status?: number; payload?: unknown }[]): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit): Promise<Response> => {
    const answer = answers[calls.length];
    if (!answer) throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    calls.push({
      url,
      init,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve({
      ok: (answer.status ?? 200) < 400,
      status: answer.status ?? 200,
      json: (): Promise<unknown> => Promise.resolve(answer.payload ?? { success: true, result: [] }),
    } as unknown as Response);
  });
  return calls;
}

function settings(overrides: Partial<ResolvedDnsSettings> = {}): ResolvedDnsSettings {
  return {
    provider: 'cloudflare',
    scheduleEnabled: false,
    intervalMinutes: 10,
    cloudflareToken: 'token',
    cloudflareZoneId: 'zone-1',
    cloudflareRecordName: 'home.example.com',
    alibabaAccessKeyId: '',
    alibabaAccessKeySecret: '',
    alibabaRecordId: '',
    alibabaRecordType: 'AAAA',
    gotifyAddress: '',
    gotifyToken: '',
    ...overrides,
  };
}

async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DnsFailureError) return error.reason;
    throw error;
  }
  throw new Error('expected the provider to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getRecord', () => {
  test('asks for the type and name, and maps only what it reads', async () => {
    const calls = stubFetch({
      payload: {
        success: true,
        result: [
          {
            id: 'rec-1',
            name: 'home.example.com',
            type: 'AAAA',
            content: '2001:db8::1',
            proxied: true,
            ttl: 300,
          },
        ],
      },
    });

    const record = await createCloudflareProvider(settings()).getRecord();

    expect(calls[0]?.url).toContain('/zones/zone-1/dns_records');
    expect(calls[0]?.url).toContain('type=AAAA');
    expect(calls[0]?.url).toContain('name=home.example.com');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer token');
    expect(record).toEqual({
      provider: 'cloudflare',
      recordName: 'home.example.com',
      recordType: 'AAAA',
      value: '2001:db8::1',
      recordId: 'rec-1',
      proxied: true,
      ttl: 300,
    });
  });

  test('drops a record the server returned with the wrong type or name', async () => {
    // The server-side filter is not the only defence: filtering here is what
    // stops a record of another type from being overwritten.
    stubFetch({
      payload: {
        success: true,
        result: [
          { id: 'rec-a', name: 'home.example.com', type: 'A', content: '1.2.3.4' },
          { id: 'rec-b', name: 'other.example.com', type: 'AAAA', content: '2001:db8::2' },
        ],
      },
    });

    await expect(createCloudflareProvider(settings()).getRecord()).resolves.toBeNull();
  });

  test('treats "no record yet" as a value, not a failure', async () => {
    stubFetch({ payload: { success: true, result: [] } });
    await expect(createCloudflareProvider(settings()).getRecord()).resolves.toBeNull();
  });

  test('refuses a record without an id, rather than patching an empty path', async () => {
    stubFetch({ payload: { success: true, result: [{ name: 'home.example.com', type: 'AAAA' }] } });
    expect(await reasonOf(() => createCloudflareProvider(settings()).getRecord())).toBe(
      'dns_query_failed',
    );
  });

  test('reads success: false on an HTTP 200 as a failure', async () => {
    stubFetch({ payload: { success: false, errors: [{ message: 'nope' }] } });
    expect(await reasonOf(() => createCloudflareProvider(settings()).getRecord())).toBe(
      'dns_query_failed',
    );
  });

  test('reports an unreachable API as a query failure', async () => {
    const provider = createCloudflareProvider(settings());
    vi.stubGlobal('fetch', (): Promise<Response> => Promise.reject(new TypeError('fetch failed')));
    expect(await reasonOf(() => provider.getRecord())).toBe('dns_query_failed');
  });
});

describe('setIpv6', () => {
  test('creates the record when there is none, unproxied with a short ttl', async () => {
    const calls = stubFetch({ payload: { success: true, result: { id: 'rec-1' } } });

    await expect(createCloudflareProvider(settings()).setIpv6('2001:db8::1', null)).resolves.toBe(
      'created',
    );

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/zones/zone-1/dns_records');
    expect(calls[0]?.body).toEqual({
      content: '2001:db8::1',
      name: 'home.example.com',
      type: 'AAAA',
      proxied: false,
      ttl: 60,
    });
  });

  test('writes nothing when the address already matches', async () => {
    // The point of the whole "unchanged" path: no request, so nothing lands in
    // Cloudflare's audit log for a check that changed nothing.
    const calls = stubFetch();

    const result = await createCloudflareProvider(settings()).setIpv6('2001:db8::1', {
      provider: 'cloudflare',
      recordName: 'home.example.com',
      recordType: 'AAAA',
      value: '2001:db8::1',
      recordId: 'rec-1',
      proxied: true,
      ttl: 300,
    });

    expect(result).toBe('unchanged');
    expect(calls).toHaveLength(0);
  });

  test('preserves how the record is exposed, and only the parts the API reported', async () => {
    const calls = stubFetch({ payload: { success: true, result: {} } });

    await expect(
      createCloudflareProvider(settings()).setIpv6('2001:db8::2', {
        provider: 'cloudflare',
        recordName: 'home.example.com',
        recordType: 'AAAA',
        value: '2001:db8::1',
        recordId: 'rec-1',
        proxied: false,
        ttl: 300,
      }),
    ).resolves.toBe('updated');

    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(calls[0]?.url).toContain('/dns_records/rec-1');
    expect(calls[0]?.body).toEqual({
      content: '2001:db8::2',
      name: 'home.example.com',
      type: 'AAAA',
      proxied: false,
      ttl: 300,
    });
  });

  test('drops a proxied or ttl that arrived as the wrong type, from the read to the write', async () => {
    // The guard belongs where untrusted JSON becomes a `DnsRecord`, which is the
    // read: from there on the type says these are clean. A string "300" -- which
    // is what Cloudflare sends for an automatic TTL -- written back would change
    // how the record is exposed rather than preserve it.
    const calls = stubFetch(
      {
        payload: {
          success: true,
          result: [
            {
              id: 'rec-1',
              name: 'home.example.com',
              type: 'AAAA',
              content: '2001:db8::1',
              proxied: 'true',
              ttl: '300',
            },
          ],
        },
      },
      { payload: { success: true, result: {} } },
    );

    const provider = createCloudflareProvider(settings());
    const current = await provider.getRecord();
    expect(current).toMatchObject({ proxied: null, ttl: null });

    await provider.setIpv6('2001:db8::2', current);

    expect(calls[1]?.body).toEqual({
      content: '2001:db8::2',
      name: 'home.example.com',
      type: 'AAAA',
    });
  });

  test('reports a rejected write as a write failure', async () => {
    stubFetch({ payload: { success: false } });
    expect(
      await reasonOf(() =>
        createCloudflareProvider(settings()).setIpv6('2001:db8::2', {
          provider: 'cloudflare',
          recordName: 'home.example.com',
          recordType: 'AAAA',
          value: '2001:db8::1',
          recordId: 'rec-1',
          proxied: null,
          ttl: null,
        }),
      ),
    ).toBe('dns_write_failed');
  });
});
