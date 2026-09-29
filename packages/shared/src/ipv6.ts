/**
 * IPv6 parsing, and the one question the DNS console actually asks of it: is
 * this address somewhere a public address can live?
 *
 * It sits in the shared package rather than the server because the rule decides
 * whether an address gets written into a DNS record, and a second copy of it
 * anywhere would be a second answer. Nothing here uses a Node built-in, for the
 * same reason.
 *
 * The check is deliberately stricter than CPython's `is_global`, which the
 * original Python implementation used. That one treats anything outside its
 * list of special ranges as global, so deprecated site-local `fec0::/10`,
 * NAT64 `64:ff9b::/96` and Teredo `2001::/32` all pass it. None of those is an
 * address a host should be reachable at, and refusing too much costs a run that
 * writes nothing, while accepting too much writes a record pointing at an
 * address nothing can reach.
 */

/** Longest possible textual IPv6 form, "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255". */
const MAX_TEXT_LENGTH = 45;

const GROUP_COUNT = 8;
const BYTES = GROUP_COUNT * 2;

type Prefix = { readonly bytes: Uint8Array; readonly bits: number };

/**
 * Global unicast, the only range a public host address can be in: 2000::/3.
 * Starting here rather than listing the ranges to exclude means an unlisted
 * special range fails closed instead of being accepted by omission.
 */
const GLOBAL_UNICAST = prefix('2000::', 3);

/**
 * Ranges inside 2000::/3 that are still not a host's public address: IETF
 * protocol assignments (which include Teredo and benchmarking), and the
 * documentation range.
 */
const RESERVED = [prefix('2001::', 23), prefix('2001:2::', 48), prefix('2001:db8::', 32)];

/**
 * Canonical compressed form, as RFC 5952 defines it: lowercase, the longest run
 * of two or more zero groups replaced by "::", leftmost run when there is a tie,
 * and an embedded IPv4 tail always rendered as two hextets. This is the form the
 * address is stored and displayed in, so two runs that saw the same address
 * produce the same string.
 */
export function compressIpv6(address: string): string {
  const bytes = expandIpv6(address);
  if (!bytes) throw new Error(`Not an IPv6 address: ${truncate(address)}`);
  return compressBytes(bytes);
}

/** True when the address is one a public AAAA record could legitimately hold. */
export function isGlobalIpv6(address: string): boolean {
  const bytes = expandIpv6(address);
  if (!bytes) return false;
  if (!matches(bytes, GLOBAL_UNICAST)) return false;
  return !RESERVED.some((network) => matches(bytes, network));
}

/**
 * Validate what an IPv6 probe returned, or throw.
 *
 * The two ways this fails are kept apart by the caller, not by the message: a
 * transport failure is "the probe could not be reached", while anything that
 * gets this far was reached and did not answer with a usable public address.
 */
export function parsePublicIpv6(text: string): string {
  const trimmed = text.trim();
  // An empty body is what a captive portal or a proxy error page often looks
  // like, and it is worth its own message in the log.
  if (trimmed === '') throw new Error('The IPv6 probe returned an empty body');
  // A scope id ("fe80::1%eth0") marks a link-local address. Rejecting it here
  // means the parser below never has to represent a zone at all.
  if (trimmed.includes('%')) throw new Error('The IPv6 probe returned a scoped address');

  const bytes = expandIpv6(trimmed);
  // The body is not echoed here on purpose: when it is not an address it can be
  // an entire HTML error page, and this message goes to the log.
  if (!bytes) throw new Error('The IPv6 probe returned something that is not an IPv6 address');

  if (!isGlobalIpv6(trimmed)) {
    // A parsed address is at most 45 characters, so this one is safe to quote
    // and genuinely useful -- it names what was refused.
    throw new Error(`The IPv6 probe returned a non-public address: ${trimmed}`);
  }
  return compressBytes(bytes);
}

/**
 * Text to 16 bytes, or null. Accepts the forms a hex parser accepts: up to eight
 * hextets, one optional "::" standing for one or more zero groups, and an
 * embedded IPv4 tail in the last 32 bits.
 */
function expandIpv6(input: string): Uint8Array | null {
  if (input.length === 0 || input.length > MAX_TEXT_LENGTH) return null;

  // Rewrite an embedded IPv4 tail as the two hextets it occupies, so the rest of
  // the parser only ever sees hextets.
  let text = input;
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon < 0) return null;
    const tail = parseIpv4Tail(text.slice(lastColon + 1));
    if (!tail) return null;
    text = `${text.slice(0, lastColon + 1)}${tail}`;
  }

  const compression = text.indexOf('::');
  if (compression !== -1 && text.indexOf('::', compression + 1) !== -1) return null;

  const headText = compression === -1 ? text : text.slice(0, compression);
  const hasTail = compression !== -1;
  const tailText = hasTail ? text.slice(compression + 2) : '';

  const head = readGroups(headText);
  if (!head) return null;
  const tail = hasTail ? readGroups(tailText) : null;
  if (hasTail && !tail) return null;

  // Without "::" every one of the eight groups has to be written out; with it,
  // at least one group has to be elided, or the address is simply invalid
  // ("1:2:3:4:5:6:7:8::" is not an address).
  if (!tail) {
    if (head.length !== GROUP_COUNT) return null;
  } else if (head.length + tail.length >= GROUP_COUNT) {
    return null;
  }

  const groups = [...head];
  if (tail) {
    const elided = GROUP_COUNT - head.length - tail.length;
    for (let i = 0; i < elided; i += 1) groups.push(0);
    groups.push(...tail);
  }

  const bytes = new Uint8Array(BYTES);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/** Hextets as numbers, or null when any of them is not 1-4 hex digits. */
function readGroups(text: string): number[] | null {
  if (text === '') return [];
  const parts = text.split(':');
  const groups: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 4 || !/^[0-9a-fA-F]+$/.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

/** "1.2.3.4" as the two hextets that hold it, or null. */
function parseIpv4Tail(text: string): string | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // Leading zeros are refused rather than read as octal, which is the rule the
    // rest of the tooling around addresses follows.
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  const high = ((a << 8) | b).toString(16);
  const low = ((c << 8) | d).toString(16);
  return `${high}:${low}`;
}

function compressBytes(bytes: Uint8Array): string {
  const groups: number[] = [];
  for (let i = 0; i < GROUP_COUNT; i += 1) {
    groups.push(((bytes[i * 2] ?? 0) << 8) | (bytes[i * 2 + 1] ?? 0));
  }

  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < GROUP_COUNT; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < GROUP_COUNT && groups[end] === 0) end += 1;
    // Strictly greater keeps the leftmost run when two are the same length.
    if (end - i > bestLength) {
      bestStart = i;
      bestLength = end - i;
    }
    i = end;
  }

  const parts = groups.map((group) => group.toString(16));
  // A single zero group is written as "0": "::" would be shorter to read but
  // RFC 5952 forbids it, and one form per address is the point.
  if (bestLength < 2) return parts.join(':');
  return `${parts.slice(0, bestStart).join(':')}::${parts.slice(bestStart + bestLength).join(':')}`;
}

function matches(bytes: Uint8Array, { bytes: network, bits }: Prefix): boolean {
  const whole = bits >> 3;
  for (let i = 0; i < whole; i += 1) {
    if (bytes[i] !== network[i]) return false;
  }
  const remainder = bits & 7;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return ((bytes[whole] ?? 0) & mask) === ((network[whole] ?? 0) & mask);
}

function prefix(notation: string, bits: number): Prefix {
  const bytes = expandIpv6(notation);
  if (!bytes) throw new Error(`Malformed entry in the IPv6 prefix table: ${notation}`);
  return { bytes, bits };
}

function truncate(value: string): string {
  return value.length <= MAX_TEXT_LENGTH ? value : `${value.slice(0, MAX_TEXT_LENGTH)}…`;
}
