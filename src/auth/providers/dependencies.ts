import { ProfileStore } from '../../profile/store.js';
import { CredentialManager } from '../credentialManager.js';

export interface ProviderDependencies {
  /**
   * Shared credential manager instance used by providers.
   * Callers are responsible for invoking `initialize()` before use.
   */
  credentialManager: CredentialManager;

  /**
   * Accessor that returns a profile store implementation.
   * Callers may return a singleton or a fresh instance, depending on needs.
   */
  getProfileStore(): ProfileStore;
}

export function createDefaultProviderDependencies(): ProviderDependencies {
  const credentialManager = new CredentialManager();
  const profileStore = new ProfileStore();
  return {
    credentialManager,
    getProfileStore: () => profileStore,
  };
}
