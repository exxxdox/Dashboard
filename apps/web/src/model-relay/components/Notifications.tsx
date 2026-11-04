import { useCallback } from 'react';
import { pushToast } from '../../lib/toast';

export type NotificationTone = 'success' | 'error' | 'info';
export type Notify = (message: string, tone?: NotificationTone) => void;

/** Share the dashboard's bounded feedback stack rather than adding a second one. */
export function useNotify(): Notify {
  return useCallback((message, tone = 'success') => { pushToast(message, { tone }); }, []);
}
