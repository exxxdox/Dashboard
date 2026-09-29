import { describe, expect, test } from 'vitest';

import { compressIpv6, isGlobalIpv6, parsePublicIpv6 } from './ipv6.js';

describe('compressIpv6', () => {
  test('writes the canonical form RFC 5952 asks for', () => {
    // One line per rule the format has: lowercase, the longest zero run elided,
    // leftmost when two runs tie, one zero group left alone, and an IPv4 tail
    // always rendered as hextets.
    const cases: [string, string][] = [
      ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
      ['2001:DB8::1', '2001:db8::1'],
      ['::', '::'],
      ['0:0:0:0:0:0:0:0', '::'],
      ['::1', '::1'],
      ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
      ['2001:0:0:1:0:0:0:1', '2001:0:0:1::1'],
      ['1:0:0:2:0:0:3:4', '1::2:0:0:3:4'],
      ['::ffff:1.2.3.4', '::ffff:102:304'],
      ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
    ];

    for (const [input, expected] of cases) {
      expect(compressIpv6(input), input).toBe(expected);
    }
  });

  test('refuses text that is not an address', () => {
    const rejected = [
      '',
      'not-an-address',
      '1.2.3.4',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      // "::" has to stand for at least one group.
      '1:2:3:4:5:6:7:8::',
      'fe80::1%eth0',
      '::ffff:1.2.3.256',
      '::ffff:01.2.3.4',
      'g::1',
      '12345::1',
    ];

    for (const input of rejected) {
      expect(() => compressIpv6(input), input).toThrow();
    }
  });
});

describe('isGlobalIpv6', () => {
  test('accepts addresses in global unicast', () => {
    const accepted = [
      '2001:4860::8888',
      '2606:4700::1111',
      '2400:3200::1',
      '2a00:1450:4001:80e::200e',
      '2000::1',
    ];

    for (const input of accepted) {
      expect(isGlobalIpv6(input), input).toBe(true);
    }
  });

  test('refuses everything a public record must never point at', () => {
    // Grouped by why: not global unicast at all, special ranges inside it, and
    // IPv4 wearing an IPv6 costume.
    const refused = [
      'fe80::1',
      'fec0::1',
      'fc00::1',
      'fd00::1',
      'ff02::1',
      '::1',
      '::',
      '100::1',
      '64:ff9b::1.2.3.4',
      '2001::1',
      '2001:2::1',
      '2001:db8::1',
      '::ffff:1.2.3.4',
      '::ffff:8.8.8.8',
      '10.0.0.1',
      'garbage',
    ];

    for (const input of refused) {
      expect(isGlobalIpv6(input), input).toBe(false);
    }
  });
});

describe('parsePublicIpv6', () => {
  test('returns the compressed address and tolerates a probe that adds whitespace', () => {
    expect(parsePublicIpv6('2001:4860::8888\n')).toBe('2001:4860::8888');
    expect(parsePublicIpv6('  2606:4700::1111  ')).toBe('2606:4700::1111');
  });

  test('refuses an empty body', () => {
    expect(() => parsePublicIpv6('   \n')).toThrow(/empty/i);
  });

  test('refuses a scoped address, which is always link-local', () => {
    expect(() => parsePublicIpv6('fe80::1%eth0')).toThrow(/scoped/i);
  });

  test('does not quote a body that is not an address', () => {
    // The body of a failed probe can be an HTML error page, and this message
    // ends up in the log.
    const body = '<html><body>502 Bad Gateway</body></html>';
    expect(() => parsePublicIpv6(body)).toThrow();
    try {
      parsePublicIpv6(body);
    } catch (error) {
      expect(String(error)).not.toContain('502 Bad Gateway');
    }
  });

  test('names the non-public address it refused', () => {
    expect(() => parsePublicIpv6('fd00::1')).toThrow(/fd00::1/);
    expect(() => parsePublicIpv6('2001:db8::1')).toThrow(/2001:db8::1/);
  });
});
