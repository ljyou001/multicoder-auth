export { CredentialManager } from './auth/credentialManager.js';
export type { CredentialInfo } from './auth/credentialManager.js';

export { ProfileService } from './auth/profileService.js';

export { authRegistry } from './auth/providers/registry.js';
export { GeminiAuthenticator, setGeminiHomeDirOverride } from './auth/providers/gemini.js';

export { getProfileStore } from './profile/index.js';
export { ProfileManager } from './profile/profileManager.js';
export { ProfileStore } from './profile/store.js';
export {
  SystemEnvironmentManager
} from './system/systemEnvironmentManager.js';
export type {
  EnvScope,
  EnvMutationOptions,
  EnvQueryOptions
} from './system/systemEnvironmentManager.js';
