/**
 * Cloudflare, over its REST API.
 *
 * No SDK, following the Python version's reasoning and this repository's own
 * preference for a direct call over a generated client: three endpoints are
 * involved, and the generated package for this API is larger than the whole
 * runtime image.
 *
 * Cloudflare reports application errors with HTTP 200 and `success: false`, so
 * the status code is not the answer to "did this work" -- the body is.
 */

import type { DnsFailureReason } from '@dashboard/shared';

import { withDeadline } from '../../lib/http.js';
import { DnsFailureError, type DnsProvider, type ResolvedDnsSettings } from './types.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * One total budget. The Python version split this into a 5s connect and a 15s
 * read; `fetch` takes a single timeout, and the difference between the two
 * arrangements only shows up on a TCP connect that never answers.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Only the fields this module reads, all unvalidated until they are used. */
type CloudflareRecord = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  content?: unknown;
  proxied?: unknown;
  ttl?: unknown;
};

export function createCloudflareProvider(settings: ResolvedDnsSettings): DnsProvider {
  const { cloudflareToken: token, cloudflareZoneId: zoneId, cloudflareRecordName: recordName } =
    settings;

  async function request<T>(
    path: string,
    init: RequestInit,
    reason: DnsFailureReason,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        signal: withDeadline(signal, REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DnsFailureError('Cloudflare could not be reached', reason, error);
    }

    if (!response.ok) {
      throw new DnsFailureError(`Cloudflare answered ${response.status}`, reason);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new DnsFailureError('Cloudflare answered with something that is not JSON', reason, error);
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      (payload as { success?: unknown }).success !== true
    ) {
      throw new DnsFailureError('Cloudflare reported the request as failed', reason);
    }
    return (payload as { result: T }).result;
  }

  return {
    name: 'cloudflare',

    async getRecord(signal) {
      const query = new URLSearchParams({ type: 'AAAA', name: recordName });
      const result = await request<CloudflareRecord[]>(
        `/zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`,
        { method: 'GET' },
        'dns_query_failed',
        signal,
      );

      // The server-side filter is not the only defence: a filter that gets
      // ignored, or a zone where the name matches more than intended, must not be
      // able to hand back a record of another type or name for us to overwrite.
      const candidates = Array.isArray(result) ? result : [];
      const match = candidates.find(
        (record) => record.name === recordName && record.type === 'AAAA',
      );
      // No record is a value, not a failure: the caller creates one.
      if (!match) return null;

      const recordId = typeof match.id === 'string' ? match.id : '';
      if (recordId === '') {
        // The old implementation would have sent PATCH /dns_records/ and read the
        // 404 as "the record is gone". Saying what is wrong beats that.
        throw new DnsFailureError('Cloudflare returned a record without an id', 'dns_query_failed');
      }

      return {
        provider: 'cloudflare',
        recordName,
        recordType: 'AAAA',
        value: typeof match.content === 'string' ? match.content : '',
        recordId,
        proxied: optionalBoolean(match.proxied),
        ttl: optionalInteger(match.ttl),
      };
    },

    async setIpv6(ipv6, current, signal) {
      if (current === null) {
        await request(
          `/zones/${encodeURIComponent(zoneId)}/dns_records`,
          {
            method: 'POST',
            body: JSON.stringify({
              content: ipv6,
              name: recordName,
              type: 'AAAA',
              proxied: false,
              ttl: 60,
            }),
          },
          'dns_write_failed',
          signal,
        );
        return 'created';
      }

      // Unchanged means no request at all: a PATCH that writes the same value
      // still shows up in an audit log and still costs a round trip.
      if (current.value === ipv6) return 'unchanged';

      const body: Record<string, unknown> = { content: ipv6, name: recordName, type: 'AAAA' };
      // Carry proxied and ttl across only when the API actually reported them,
      // and as the types they were: a string "300" or a truthy non-boolean would
      // be written back as a *different* setting than the one being preserved.
      // Changing the address should not change how the record is exposed.
      if (current.proxied !== null) body.proxied = current.proxied;
      if (current.ttl !== null) body.ttl = current.ttl;

      await request(
        `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(current.recordId)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        'dns_write_failed',
        signal,
      );
      return 'updated';
    },
  };
}

/** `null` unless the API reported a real boolean; a string "true" is not one. */
function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** `null` unless the API reported a real integer; a string "300" is not one. */
function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
