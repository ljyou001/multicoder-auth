/**
 * ProfileStore - Persistent profile storage
 *
 * Stores all profiles in ~/.multicoder/profiles.json
 * Manages current profile selection across sessions
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProviderAuthInfo, ProfileData, ProfileStoreData } from './types.js';

export class ProfileStore {
  private readonly homeDir: string;
  private readonly storePath: string;
  private data: ProfileStoreData;

  constructor(homeDir?: string) {
    this.homeDir = homeDir || os.homedir();
    const multicoderDir = path.join(this.homeDir, '.multicoder');
    this.storePath = path.join(multicoderDir, 'profiles.json');
    this.data = this.load();
  }

  private getLegacyStorePaths(): string[] {
    const homeDir = this.homeDir;
    const legacyPaths = [
      path.join(homeDir, '.unycode', 'profiles.json'),
      path.join(homeDir, '.config', 'unycoding', 'profiles.json'),
      path.join(homeDir, 'AppData', 'Roaming', 'unycoding', 'profiles.json'),
      path.join(homeDir, 'Library', 'Application Support', 'unycoding', 'profiles.json'),
    ];

    const transitionalPaths = [
      path.join(homeDir, '.config', 'multicoder', 'profiles.json'),
      path.join(homeDir, 'AppData', 'Roaming', 'multicoder', 'profiles.json'),
      path.join(homeDir, 'Library', 'Application Support', 'multicoder', 'profiles.json'),
    ];

    return [...new Set<string>([...legacyPaths, ...transitionalPaths])];
  }

  private createEmptyData(): ProfileStoreData {
    return {
      version: '2.0',
      currentProfile: null,
      profiles: {},
    };
  }

  private normalizeData(raw: unknown): ProfileStoreData {
    const empty = this.createEmptyData();
    if (!raw || typeof raw !== 'object') {
      return empty;
    }

    const source = raw as Record<string, any>;
    const normalized: ProfileStoreData = {
      version: typeof source.version === 'string' ? source.version : '2.0',
      currentProfile: null,
      profiles: {},
    };

    const current =
      typeof source.currentProfile === 'string'
        ? source.currentProfile
        : typeof source.current === 'string'
          ? source.current
          : null;
    normalized.currentProfile = current;

    const profileEntries = source.profiles;
    if (Array.isArray(profileEntries)) {
      for (const profile of profileEntries) {
        if (!profile || typeof profile !== 'object') {
          continue;
        }
        const normalizedProfile = this.normalizeProfile(profile, profile.name);
        if (!normalizedProfile) {
          continue;
        }
        normalized.profiles[normalizedProfile.name] = normalizedProfile;
      }
    } else if (profileEntries && typeof profileEntries === 'object') {
      for (const [name, profile] of Object.entries(profileEntries)) {
        if (!profile || typeof profile !== 'object') {
          continue;
        }
        const normalizedProfile = this.normalizeProfile(profile, name);
        if (!normalizedProfile) {
          continue;
        }
        normalized.profiles[normalizedProfile.name] = normalizedProfile;
      }
    }

    if (normalized.currentProfile && !normalized.profiles[normalized.currentProfile]) {
      normalized.currentProfile = null;
    }

    if (!normalized.currentProfile) {
      const available = Object.keys(normalized.profiles).sort();
      normalized.currentProfile = available[0] ?? null;
    }

    return normalized;
  }

  private normalizeProfile(rawProfile: any, fallbackName?: string): ProfileData | null {
    const resolvedName =
      typeof rawProfile?.name === 'string' && rawProfile.name.length > 0
        ? rawProfile.name
        : typeof fallbackName === 'string' && fallbackName.length > 0
          ? fallbackName
          : undefined;

    if (!resolvedName) {
      return null;
    }

    const now = Date.now();

    const providersSource = rawProfile?.providers;
    const providers: Record<string, ProviderAuthInfo> = {};
    if (providersSource && typeof providersSource === 'object') {
      for (const [providerId, providerInfo] of Object.entries(providersSource)) {
        if (!providerInfo || typeof providerInfo !== 'object') {
          continue;
        }
        const info = providerInfo as {
          credentialSource?: unknown;
          credentialPath?: unknown;
          lastAuth?: unknown;
          expiresAt?: unknown;
        };
        const source = info.credentialSource;
        const credentialSource: ProviderAuthInfo['credentialSource'] =
          source === 'managed' || source === 'native' || source === 'env' ? source : 'native';

        const normalizedProvider: ProviderAuthInfo = {
          credentialSource,
        };

        if (typeof info.credentialPath === 'string' && info.credentialPath.length > 0) {
          normalizedProvider.credentialPath = info.credentialPath;
        }
        if (typeof info.lastAuth === 'number') {
          normalizedProvider.lastAuth = info.lastAuth;
        }
        if (typeof info.expiresAt === 'number') {
          normalizedProvider.expiresAt = info.expiresAt;
        }

        providers[providerId] = normalizedProvider;
      }
    }

    const lastProvider = typeof rawProfile?.lastProvider === 'string' ? rawProfile.lastProvider : undefined;
    const lastUsedAt = typeof rawProfile?.lastUsedAt === 'number' ? rawProfile.lastUsedAt : undefined;
    const permissionMode =
      rawProfile?.permissionMode === 'ask' || rawProfile?.permissionMode === 'allow' || rawProfile?.permissionMode === 'deny'
        ? rawProfile.permissionMode
        : undefined;
    const model = typeof rawProfile?.model === 'string' ? rawProfile.model : undefined;
    const createdAt = typeof rawProfile?.createdAt === 'number' ? rawProfile.createdAt : now;
    const updatedAt = typeof rawProfile?.updatedAt === 'number' ? rawProfile.updatedAt : createdAt;

    return {
      name: resolvedName,
      providers,
      lastProvider,
      lastUsedAt,
      permissionMode,
      model,
      createdAt,
      updatedAt,
    };
  }

  private serializeData(data: ProfileStoreData = this.data): Record<string, unknown> {
    const profilesArray = Object.values(data.profiles)
      .map((profile) => ({
        ...profile,
        providers: { ...profile.providers },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      version: data.version ?? '2.0',
      current: data.currentProfile ?? null,
      currentProfile: data.currentProfile ?? null,
      profiles: profilesArray,
    };
  }

  /**
   * Load profiles from disk
   */
  private load(): ProfileStoreData {
    try {
      if (fs.existsSync(this.storePath)) {
        const content = fs.readFileSync(this.storePath, 'utf-8');
        return this.normalizeData(JSON.parse(content));
      }

      for (const legacyPath of this.getLegacyStorePaths()) {
        if (legacyPath === this.storePath || !fs.existsSync(legacyPath)) {
          continue;
        }

        try {
          const content = fs.readFileSync(legacyPath, 'utf-8');
          const data = this.normalizeData(JSON.parse(content));
          const dir = path.dirname(this.storePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          try {
            fs.renameSync(legacyPath, this.storePath);
          } catch {
            fs.writeFileSync(this.storePath, JSON.stringify(this.serializeData(data), null, 2), 'utf-8');
          }

          // Ensure the migrated file uses the normalized schema
          fs.writeFileSync(this.storePath, JSON.stringify(this.serializeData(data), null, 2), 'utf-8');
          return data;
        } catch (error) {
          console.warn(`Failed to migrate profiles from ${legacyPath}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Failed to load profiles from ${this.storePath}:`, error);
    }

    // Return empty structure if load fails
    return this.createEmptyData();
  }

  /**
   * Save profiles to disk
   */
  private save(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(this.serializeData(), null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save profiles to ${this.storePath}: ${error}`);
    }
  }

  /**
   * Get current profile
   */
  getCurrent(): ProfileData | null {
    if (!this.data.currentProfile) {
      return null;
    }
    return this.data.profiles[this.data.currentProfile] || null;
  }

  /**
   * Get current profile name
   */
  getCurrentName(): string | null {
    return this.data.currentProfile;
  }

  /**
   * Set current profile
   */
  setCurrent(name: string | null): void {
    if (name !== null && !this.data.profiles[name]) {
      throw new Error(`Profile '${name}' does not exist`);
    }
    this.data.currentProfile = name;
    this.save();
  }

  /**
   * Get a specific profile
   */
  get(name: string): ProfileData | null {
    return this.data.profiles[name] || null;
  }

  /**
   * List all profiles
   */
  list(): ProfileData[] {
    return Object.values(this.data.profiles);
  }

  /**
   * Create a new profile
   */
  create(name: string): ProfileData {
    if (this.data.profiles[name]) {
      throw new Error(`Profile '${name}' already exists`);
    }

    const now = Date.now();
    const profile: ProfileData = {
      name,
      providers: {},
      createdAt: now,
      updatedAt: now,
    };

    this.data.profiles[name] = profile;

    // Set as current if it's the first profile
    if (Object.keys(this.data.profiles).length === 1) {
      this.data.currentProfile = name;
    }

    this.save();
    return profile;
  }

  /**
   * Update a profile
   */
  update(name: string, updater: (profile: ProfileData) => ProfileData): ProfileData {
    const existing = this.data.profiles[name];
    if (!existing) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    const updated = updater(existing);
    updated.updatedAt = Date.now();

    this.data.profiles[name] = updated;
    this.save();

    return updated;
  }

  /**
   * Delete a profile and its associated credentials
   */
  async delete(name: string): Promise<void> {
    if (!this.data.profiles[name]) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    const profile = this.data.profiles[name];

    // Delete associated credential files
    try {
      const { CredentialManager } = await import('../auth/credentialManager.js');
      const credentialManager = new CredentialManager();
      await credentialManager.initialize();

      // Delete credentials for each provider in the profile
      for (const providerId of Object.keys(profile.providers)) {
        try {
          await credentialManager.clearCredentials(providerId, name);
          console.log(`✓ Deleted credentials for ${providerId}`);
        } catch (error) {
          console.warn(`⚠️  Could not delete credentials for ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not delete credential files: ${error instanceof Error ? error.message : String(error)}`);
    }

    delete this.data.profiles[name];

    // If current profile was deleted, set to null
    if (this.data.currentProfile === name) {
      this.data.currentProfile = null;

      // Auto-select another profile if available
      const remaining = Object.keys(this.data.profiles);
      if (remaining.length > 0) {
        this.data.currentProfile = remaining[0];
      }
    }

    this.save();
  }

  /**
   * Set provider auth info for a profile
   */
  setProviderAuth(profileName: string, providerId: string, authInfo: ProviderAuthInfo): void {
    this.update(profileName, (profile) => ({
      ...profile,
      providers: {
        ...profile.providers,
        [providerId]: authInfo,
      },
    }));
  }

  /**
   * Get provider auth info for a profile
   */
  getProviderAuth(profileName: string, providerId: string): ProviderAuthInfo | null {
    const profile = this.get(profileName);
    if (!profile) {
      return null;
    }
    return profile.providers[providerId] || null;
  }

  /**
   * Remove provider auth info from a profile
   */
  removeProviderAuth(profileName: string, providerId: string): void {
    this.update(profileName, (profile) => {
      const { [providerId]: removed, ...remaining } = profile.providers;
      return {
        ...profile,
        providers: remaining,
      };
    });
  }

  /**
   * Check if a profile exists
   */
  exists(name: string): boolean {
    return name in this.data.profiles;
  }

  /**
   * Get storage file path
   */
  getStorePath(): string {
    return this.storePath;
  }

  /**
   * Set last used provider for a profile
   */
  setLastProvider(profileName: string, providerId: string): void {
    this.update(profileName, (profile) => ({
      ...profile,
      lastProvider: providerId,
    }));
  }

  /**
   * Get last used provider for a profile
   */
  getLastProvider(profileName: string): string | null {
    const profile = this.get(profileName);
    return profile?.lastProvider || null;
  }
}
