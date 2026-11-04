/**
 * The public IPv6 probe.
 *
 * One endpoint and no fallbacks, as in the Python version: a second endpoint
 * would mean two possible answers to "which address is this host", and whichever
 * answered last would be written into DNS.
 *
 * It deliberately ignores proxy environment variables. In Python that was
 * `session.trust_env = False`; Node's global `fetch` already behaves that way --
 * it uses undici's default agent, which honours neither `HTTP_PROXY` nor
 * `NO_PROXY` -- so the requirement is met by doing nothing. The risk runs the
 * other way: adding an `EnvHttpProxyAgent` dispatcher, or starting node with
 * `--use-env-proxy`, would quietly write the *proxy's* address into the AAAA
 * record. A test pins the absence of a dispatcher for exactly that reason.
 */

import { readFile } from 'node:fs/promises';
import { parsePublicIpv6 } from '@dashboard/shared';

import { errorMessage } from '../../lib/errors.js';
import { withDeadline } from '../../lib/http.js';
import { DnsFailureError } from './types.js';

/** A single small GET. Ten seconds is generous for it. */
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_URL = 'https://api6.ipify.org';

/** Linux exposes address state here, including temporary and DAD flags absent from networkInterfaces(). */
export async function detectLocalIpv6(interfaceName = '', signal?: AbortSignal): Promise<string> {
  let table: string;
  try {
    table = await readFile('/proc/net/if_inet6', { encoding: 'utf8', signal });
  } catch (error) {
    throw new DnsFailureError('The local Linux IPv6 address table could not be read', 'ipv6_detect_failed', error);
  }

  const addresses = new Set<string>();
  for (const line of table.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const [hex, , , scope, flags] = fields;
    if (
      fields.length !== 6 || !hex || !/^[\da-f]{32}$/i.test(hex) || scope !== '00' ||
      !flags || !/^[\da-f]+$/i.test(flags)
    ) continue;
    if (interfaceName !== '' && fields[5] !== interfaceName) continue;
    // Linux IFA_F_TEMPORARY | DADFAILED | DEPRECATED | TENTATIVE must never enter DDNS.
    if ((Number.parseInt(flags, 16) & (0x01 | 0x08 | 0x20 | 0x40)) !== 0) continue;
    try {
      addresses.add(parsePublicIpv6(hex.replace(/(.{4})(?=.)/g, '$1:')));
    } catch {
      // Global scope also includes ULA and reserved ranges; reuse the public-address validator.
    }
  }

  const [address] = addresses;
  if (address === undefined) {
    throw new DnsFailureError('No stable public IPv6 address was found on the local interfaces', 'ipv6_not_global');
  }
  // A stable ordering cannot establish which interface the operator wants published.
  if (addresses.size > 1) {
    throw new DnsFailureError('Local IPv6 detection found multiple stable public addresses; select a local interface', 'ipv6_detect_failed');
  }
  return address;
}

export async function detectPublicIpv6(signal?: AbortSignal): Promise<string> {
  const body = await readProbe(signal);
  try {
    return parsePublicIpv6(body);
  } catch (error) {
    // The probe answered, and the answer is not an address this may write: a
    // captive portal, an IPv4-only host, or an address the container can see but
    // the internet cannot. Not "the probe failed" -- the operator's next step is
    // different.
    throw new DnsFailureError(errorMessage(error), 'ipv6_not_global', error);
  }
}

async function readProbe(signal: AbortSignal | undefined): Promise<string> {
  try {
    const response = await fetch(PROBE_URL, { signal: withDeadline(signal, PROBE_TIMEOUT_MS) });
    if (!response.ok) {
      throw new DnsFailureError(
        `The public IPv6 probe answered ${response.status}`,
        'ipv6_detect_failed',
      );
    }
    return await response.text();
  } catch (error) {
    if (error instanceof DnsFailureError) throw error;
    throw new DnsFailureError(
      'The public IPv6 probe could not be reached',
      'ipv6_detect_failed',
      error,
    );
  }
}
