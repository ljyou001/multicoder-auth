/**
 * Profile Module Types
 */

export interface ProviderAuthInfo {
  credentialSource: 'native' | 'managed' | 'env';
  credentialPath?: string;
  lastAuth?: number;
  expiresAt?: number;
}

export interface ProfileData {
  name: string;
  providers: {
    [providerId: string]: ProviderAuthInfo;
  };
  lastProvider?: string; // Last used provider for this profile
  lastUsedAt?: number;
  permissionMode?: 'ask' | 'allow' | 'deny';
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileStoreData {
  version: string;
  currentProfile: string | null;
  profiles: {
    [name: string]: ProfileData;
  };
}
