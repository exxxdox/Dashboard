import { clsx, type ClassValue } from 'clsx';

/** Single place where conditional class lists are joined. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
