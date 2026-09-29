import { afterEach, describe, expect, test, vi } from 'vitest';

import { gotifyEndpoint, redactToken, sendGotify } from './gotify.js';

type Recorded = { url: string; init: RequestInit | undefined };

function stubFetch(answer: { ok?: boolean; status?: number }): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
    } as unknown as Response);
  });
  return calls;
}

const message = { title: 'DNS IPv6 updated', message: 'cloudflare: a -> b' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gotifyEndpoint', () => {
  test('prefixes https on a bare host', () => {
    expect(gotifyEndpoint('notify.example.com')).toBe('https://notify.example.com');
  });

  test('prefixes a host that carries a port', () => {
    // The Python version asked urlparse() whether a scheme was present, and
    // urlparse reads "notify.example.com:8080" as scheme "notify.example.com" --
    // a dot is legal in a scheme -- so this address was never prefixed and the
    // request died on a missing schema.
    expect(gotifyEndpoint('notify.example.com:8080')).toBe('https://notify.example.com:8080');
  });

  test('keeps a scheme it was given and strips trailing slashes', () => {
    expect(gotifyEndpoint('http://notify.test/')).toBe('http://notify.test');
    expect(gotifyEndpoint('  https://notify.test/base//  ')).toBe('https://notify.test/base');
  });

  test('is null when nothing is configured', () => {
    expect(gotifyEndpoint('')).toBeNull();
    expect(gotifyEndpoint('   ')).toBeNull();
  });
});

describe('redactToken', () => {
  test('blanks a token in a string headed for the log', () => {
    expect(redactToken('GET /message?token=abc123&x=1 answered 401')).toBe(
      'GET /message?token=***&x=1 answered 401',
    );
  });

  test('leaves a string without one alone', () => {
    expect(redactToken('fetch failed')).toBe('fetch failed');
  });
});

describe('sendGotify', () => {
  test('posts the message with the token in a header, never in the URL', async () => {
    const calls = stubFetch({});

    await expect(
      sendGotify({ address: 'notify.test', token: 'secret-token', ...message }),
    ).resolves.toBe(true);

    const call = calls[0];
    expect(call?.url).toBe('https://notify.test/message');
    expect(call?.url).not.toContain('secret-token');

    const init = call?.init;
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-gotify-key']).toBe('secret-token');
    const body = String(init?.body);
    expect(body).toContain('title=DNS+IPv6+updated');
    expect(body).toContain('priority=0');
  });

  test('skips, rather than fails, when the notifier is not configured', async () => {
    const calls = stubFetch({});

    await expect(sendGotify({ address: '', token: 'x', ...message })).resolves.toBe(false);
    await expect(sendGotify({ address: 'notify.test', token: '  ', ...message })).resolves.toBe(
      false,
    );
    expect(calls).toHaveLength(0);
  });

  test('throws when the server answers with an error', async () => {
    stubFetch({ ok: false, status: 401 });
    await expect(
      sendGotify({ address: 'notify.test', token: 'secret-token', ...message }),
    ).rejects.toThrow('401');
  });
});
