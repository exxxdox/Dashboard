/**
 * Alibaba Cloud DNS, through the official SDK.
 *
 * The SDK signs the RPC request, and the signature is the one part of this
 * integration that is hard to get right by hand -- the Python version used the
 * same SDK for the same reason.
 *
 * Two invariants live in `setIpv6`, both ports of rules the Python version
 * stated in comments:
 *
 * - This provider never creates a record. The update call needs an existing
 *   record id, and inventing one would either fail or, worse, overwrite a record
 *   the operator did not name.
 * - The host record and type come from the *query result*, never from the saved
 *   settings. A wrong value in the form must not be able to rename a live record.
 */

import Alidns, {
  DescribeDomainRecordInfoRequest,
  UpdateDomainRecordRequest,
} from '@alicloud/alidns20150109';
import { Config as OpenApiConfig } from '@alicloud/openapi-client';
import { RuntimeOptions } from '@darabonba/typescript';
import type { DnsRecord } from '@dashboard/shared';

import { DnsFailureError, type DnsProvider, type ResolvedDnsSettings } from './types.js';

const ENDPOINT = 'alidns.cn-hangzhou.aliyuncs.com';

/**
 * Kept as a pair, which is what the Python version passed to the SDK. This is a
 * plain RPC endpoint with no streaming, so a slow read means the service is in
 * trouble rather than that more time would help.
 */
const CONNECT_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 15_000;

export function createAlibabaProvider(settings: ResolvedDnsSettings): DnsProvider {
  const client = new Alidns(
    new OpenApiConfig({
      accessKeyId: settings.alibabaAccessKeyId,
      accessKeySecret: settings.alibabaAccessKeySecret,
      endpoint: ENDPOINT,
    }),
  );
  const runtime = new RuntimeOptions({
    connectTimeout: CONNECT_TIMEOUT_MS,
    readTimeout: READ_TIMEOUT_MS,
  });
  const recordId = settings.alibabaRecordId;

  return {
    name: 'alibaba',

    async getRecord() {
      let body: { RR?: unknown; type?: unknown; value?: unknown; TTL?: unknown } | undefined;
      try {
        const response = await client.describeDomainRecordInfoWithOptions(
          new DescribeDomainRecordInfoRequest({ recordId }),
          runtime,
        );
        body = response.body;
      } catch (error) {
        throw new DnsFailureError(
          'Alibaba Cloud rejected the record query',
          'dns_query_failed',
          error,
        );
      }

      return {
        provider: 'alibaba',
        // The host record as the API reports it. An update has to send it back,
        // which is why it is deliberately not compared with anything saved.
        recordName: typeof body?.RR === 'string' ? body.RR : '',
        recordType: typeof body?.type === 'string' ? body.type : settings.alibabaRecordType,
        value: typeof body?.value === 'string' ? body.value : '',
        // The configured id, not the one in the response: the configured one is
        // the key the update uses, and the two agreeing is not something to
        // assume.
        recordId,
        // The Alibaba API has no equivalent of either, so they stay unknown
        // rather than being invented as false and 0.
        proxied: null,
        ttl: typeof body?.TTL === 'number' && Number.isInteger(body.TTL) ? body.TTL : null,
      } satisfies DnsRecord;
    },

    async setIpv6(ipv6, current) {
      if (current === null) {
        throw new DnsFailureError(
          'No record with that id, and this provider never creates one',
          'record_missing',
        );
      }

      const recordName = current.recordName.trim();
      if (recordName === '') {
        // Refused before a request goes out: an update without a host record
        // would be rejected by the API anyway, and this says why.
        throw new DnsFailureError(
          'The queried record has no host name, so there is nothing to update with',
          'record_identity_missing',
        );
      }

      if (current.value === ipv6) return 'unchanged';

      try {
        await client.updateDomainRecordWithOptions(
          new UpdateDomainRecordRequest({
            recordId,
            // From the query result, on purpose. See the note at the top.
            RR: recordName,
            type: (current.recordType || 'AAAA').toUpperCase(),
            value: ipv6,
          }),
          runtime,
        );
      } catch (error) {
        throw new DnsFailureError(
          'Alibaba Cloud rejected the record update',
          'dns_write_failed',
          error,
        );
      }
      return 'updated';
    },
  };
}
