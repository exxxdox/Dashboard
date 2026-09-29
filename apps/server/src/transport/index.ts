/**
 * Transport selection.
 *
 * Only SSH is implemented. The point of this module is that it is the single
 * place that decides, so adding a host agent later means adding one branch here
 * rather than touching the runner or the routes.
 */

export type {
  ExecChunk,
  ExecOptions,
  ExecOutcome,
  ExecStream,
  Transport,
  TransportCheck,
} from './types.js';
export { createSshTransport, type SshTransportConfig } from './ssh-transport.js';
export { createFakeTransport, type FakeScript, type FakeTransport } from './fake-transport.js';
