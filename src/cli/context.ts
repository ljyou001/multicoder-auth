import { ProfileStore } from '../profile/store.js';
import { ProfileService, type ProfileServiceDependencies } from '../auth/profileService.js';
import { CredentialManager } from '../auth/credentialManager.js';
import { SystemEnvironmentManager } from '../system/systemEnvironmentManager.js';
import { ProviderAuthRegistry } from '../auth/providers/registry.js';
import type { ProviderDependencies } from '../auth/providers/dependencies.js';

export interface CliContext {
  profileStore: ProfileStore;
  profileService: ProfileService;
  credentialManager: CredentialManager;
  systemEnvManager: SystemEnvironmentManager;
  registry: ProviderAuthRegistry;
}

export function createCliContext(): CliContext {
  const profileStore = new ProfileStore();
  const credentialManager = new CredentialManager();
  const systemEnvManager = new SystemEnvironmentManager();

  const serviceDependencies: ProfileServiceDependencies = {
    credentialManager,
    systemEnvManager,
  };
  const profileService = new ProfileService(profileStore, serviceDependencies);

  const providerDependencies: ProviderDependencies = {
    credentialManager,
    getProfileStore: () => profileStore,
  };
  const registry = new ProviderAuthRegistry(providerDependencies);

  return {
    profileStore,
    profileService,
    credentialManager,
    systemEnvManager,
    registry,
  };
}
