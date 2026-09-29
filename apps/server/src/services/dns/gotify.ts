/**
 * Gotify notifications.
 *
 * A notification is a courtesy, never a step: it goes out only when the record
 * actually changed, and failing to send it is reported beside a run that still
 * succeeded. Nothing here throws a `DnsFailureError`, because a failed
 * notification has no place among the reason codes -- it is not why the run
 * ended.
 */

import { withDeadline } from '../../lib/http.js';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Blank out a token wherever it appears in a string headed for the log.
 *
 * The token travels in a header, so this is a regression guard rather than a
 * routine path: it exists for the day someone passes it as a query parameter.
 */
export function redactToken(text: string): string {
  return text.replace(/(token=)[^&\s]*/gi, '$1***');
}

/**
 * The URL a message is posted to, or null when nothing is configured.
 *
 * A bare host gets `https://` prefixed. The Python version asked `urlparse()`
 * whether a scheme was present, and `urlparse` reads "notify.example.com:8080" as
 * scheme "notify.example.com" -- a dot is legal in a scheme -- so a host with a
 * port never got one and the request died on a missing schema. Requiring the
 * "//" is what makes that case come out right.
 */
export function gotifyEndpoint(address: string): string | null {
  const trimmed = address.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export type GotifyMessage = {
  address: string;
  token: string;
  title: string;
  message: string;
  signal?: AbortSignal;
};

/**
 * Send one message.
 *
 * Returns false when the notifier is not configured, which is a skip and not a
 * failure: an operator who does not want notifications should not have to read
 * an error about it. A request that was attempted and failed throws.
 */
export async function sendGotify(params: GotifyMessage): Promise<boolean> {
  const endpoint = gotifyEndpoint(params.address);
  const token = params.token.trim();
  if (endpoint === null || token === '') return false;

  const response = await fetch(`${endpoint}/message`, {
    method: 'POST',
    headers: {
      // The token goes in a header, never in the URL: URLs end up in logs, in
      // proxy access lines and in browser history by default.
      'x-gotify-key': token,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ title: params.title, message: params.message, priority: '0' }),
    signal: withDeadline(params.signal, REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Gotify answered ${response.status}`);
  return true;
}
