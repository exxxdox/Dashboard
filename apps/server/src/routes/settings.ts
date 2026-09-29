/**
 * The application settings' HTTP surface.
 *
 * Three routes and no more: read the settings, write them, and prove the
 * notification credential works. The test is its own POST rather than a flag on
 * the PATCH, because it has a side effect the caller did not ask the settings to
 * have -- a message on someone's phone -- and a save must never send one by
 * accident.
 *
 * No error wrapping here, unlike the DNS probes: nothing on this path throws a
 * `DnsFailureError`, so every failure is already an `AppError` carrying its own
 * status.
 */

import type { FastifyInstance } from 'fastify';
import { testNotificationSchema, updateAppSettingsSchema } from '@dashboard/shared';

import type { AppContext } from '../context.js';

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { notifications } = ctx;

  app.get('/api/settings', () => notifications.state());

  app.patch('/api/settings', (request) =>
    notifications.saveSettings(updateAppSettingsSchema.parse(request.body)),
  );

  app.post('/api/settings/notification-test', (request) =>
    notifications.test(testNotificationSchema.parse(request.body)),
  );
}
