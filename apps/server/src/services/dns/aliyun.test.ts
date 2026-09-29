import { afterEach, describe, expect, test, vi } from 'vitest';

import { createAlibabaProvider } from './aliyun.js';
import { DnsFailureError, type ResolvedDnsSettings } from './types.js';

/**
 * The SDK is replaced wholesale: this module is two calls into it, and what these
 * tests are about is what those calls are -- the signature is the SDK's job.
 */
const sdk = vi.hoisted(() => ({
  describeCalls: [] as unknown[],
  updateCalls: [] as unknown[],
  configs: [] as unknown[],
  describeResult: vi.fn(),
  updateResult: vi.fn(),
}));

vi.mock('@alicloud/alidns20150109', () => ({
  default: class {
    constructor(config: unknown) {
      sdk.configs.push(config);
    }
    describeDomainRecordInfoWithOptions(request: unknown): unknown {
      sdk.describeCalls.push(request);
      return sdk.describeResult(request);
    }
    updateDomainRecordWithOptions(request: unknown): unknown {
      sdk.updateCalls.push(request);
      return sdk.updateResult(request);
    }
  },
  DescribeDomainRecordInfoRequest: class {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  },
  UpdateDomainRecordRequest: class {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  },
}));

vi.mock('@alicloud/openapi-client', () => ({
  Config: class {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  },
}));

function settings(overrides: Partial<ResolvedDnsSettings> = {}): ResolvedDnsSettings {
  return {
    provider: 'alibaba',
    scheduleEnabled: false,
    intervalMinutes: 10,
    cloudflareToken: '',
    cloudflareZoneId: '',
    cloudflareRecordName: '',
    alibabaAccessKeyId: 'key-id',
    alibabaAccessKeySecret: 'key-secret',
    alibabaRecordId: 'record-1',
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
  sdk.describeCalls = [];
  sdk.updateCalls = [];
  sdk.configs = [];
  sdk.describeResult.mockReset();
  sdk.updateResult.mockReset();
});

describe('getRecord', () => {
  test('reads the record the API returns and keeps the configured id', async () => {
    sdk.describeResult.mockResolvedValue({
      body: { RR: 'home', type: 'AAAA', value: '2001:db8::1', TTL: 600 },
    });

    const record = await createAlibabaProvider(settings()).getRecord();

    expect(sdk.describeCalls[0]).toMatchObject({ recordId: 'record-1' });
    expect(record).toEqual({
      provider: 'alibaba',
      recordName: 'home',
      recordType: 'AAAA',
      value: '2001:db8::1',
      // The configured id, not one off the response: it is the key the update
      // uses, and the two agreeing is not something to assume.
      recordId: 'record-1',
      proxied: null,
      ttl: 600,
    });
  });

  test('builds the client with the stored credentials and the fixed endpoint', async () => {
    sdk.describeResult.mockResolvedValue({ body: {} });

    await createAlibabaProvider(settings()).getRecord();

    expect(sdk.configs[0]).toMatchObject({
      accessKeyId: 'key-id',
      accessKeySecret: 'key-secret',
      endpoint: 'alidns.cn-hangzhou.aliyuncs.com',
    });
  });

  test('reports a rejected query as a query failure', async () => {
    sdk.describeResult.mockRejectedValue(new Error('InvalidAccessKeyId'));
    expect(await reasonOf(() => createAlibabaProvider(settings()).getRecord())).toBe(
      'dns_query_failed',
    );
  });
});

describe('setIpv6', () => {
  test('never creates a record', async () => {
    expect(
      await reasonOf(() => createAlibabaProvider(settings()).setIpv6('2001:db8::1', null)),
    ).toBe('record_missing');
    expect(sdk.updateCalls).toHaveLength(0);
  });

  test('refuses an empty host record without sending a request', async () => {
    expect(
      await reasonOf(() =>
        createAlibabaProvider(settings()).setIpv6('2001:db8::1', {
          provider: 'alibaba',
          recordName: '   ',
          recordType: 'AAAA',
          value: '2001:db8::2',
          recordId: 'record-1',
          proxied: null,
          ttl: null,
        }),
      ),
    ).toBe('record_identity_missing');
    expect(sdk.updateCalls).toHaveLength(0);
  });

  test('writes nothing when the address already matches', async () => {
    await expect(
      createAlibabaProvider(settings()).setIpv6('2001:db8::1', {
        provider: 'alibaba',
        recordName: 'home',
        recordType: 'AAAA',
        value: '2001:db8::1',
        recordId: 'record-1',
        proxied: null,
        ttl: null,
      }),
    ).resolves.toBe('unchanged');
    expect(sdk.updateCalls).toHaveLength(0);
  });

  test('updates with the host record and type the query returned, not the settings', async () => {
    // The invariant: a wrong value in the form must not be able to rename a live
    // record. Nothing in `settings()` says "home", so an implementation reading
    // the settings would send an empty RR instead.
    sdk.updateResult.mockResolvedValue({ body: {} });

    await expect(
      createAlibabaProvider(settings()).setIpv6('2001:db8::2', {
        provider: 'alibaba',
        recordName: 'home',
        recordType: 'aaaa',
        value: '2001:db8::1',
        recordId: 'record-1',
        proxied: null,
        ttl: null,
      }),
    ).resolves.toBe('updated');

    expect(sdk.updateCalls[0]).toMatchObject({
      recordId: 'record-1',
      RR: 'home',
      type: 'AAAA',
      value: '2001:db8::2',
    });
  });

  test('reports a rejected update as a write failure', async () => {
    sdk.updateResult.mockRejectedValue(new Error('RecordNotExist'));
    expect(
      await reasonOf(() =>
        createAlibabaProvider(settings()).setIpv6('2001:db8::2', {
          provider: 'alibaba',
          recordName: 'home',
          recordType: 'AAAA',
          value: '2001:db8::1',
          recordId: 'record-1',
          proxied: null,
          ttl: null,
        }),
      ),
    ).toBe('dns_write_failed');
  });
});
