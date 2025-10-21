/**
 * Profile Module - Independent profile management
 *
 * Responsibilities:
 * - Profile CRUD operations
 * - Persistent storage (~/.unycode/profiles.json)
 * - Current profile management
 * - Provider binding tracking
 *
 * Dependencies: None (fully independent)
 */

export { ProfileStore } from './store.js';
export type { ProfileData, ProviderAuthInfo, ProfileStoreData } from './types.js';

// Singleton instance for convenience
import { ProfileStore } from './store.js';
let _instance: ProfileStore | null = null;

export function getProfileStore(): ProfileStore {
  if (!_instance) {
    _instance = new ProfileStore();
  }
  return _instance;
}
