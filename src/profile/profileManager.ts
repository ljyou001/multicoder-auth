import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CredentialManager } from '../auth/credentialManager.js';

export interface Profile {
  name: string;
  providers: {
    [providerId: string]: {
      credentialSource: 'native' | 'managed' | 'env';
      credentialPath?: string;
      lastAuth?: number;
      expiresAt?: number;
    };
  };
  lastProvider?: string; // Last used provider for this profile
  model?: string;
  permissionMode: 'ask' | 'allow' | 'deny';
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface ProfileManagerOptions {
  defaultPermissionMode?: 'ask' | 'allow' | 'deny';
  credentialManager?: CredentialManager;
  configDir?: string;
}

export class ProfileManager {
  profiles = new Map<string, Profile>();
  current: Profile | null = null;
  defaultPermissionMode: 'ask' | 'allow' | 'deny';
  credentialManager: CredentialManager;
  configDir: string;
  private readonly usingCustomConfigDir: boolean;

  constructor(options: ProfileManagerOptions = {}) {
    this.defaultPermissionMode = options.defaultPermissionMode ?? 'ask';
    this.credentialManager = options.credentialManager ?? new CredentialManager();
    this.configDir = options.configDir ?? this.getDefaultConfigDir();
    this.usingCustomConfigDir = Boolean(options.configDir);
  }

  getDefaultConfigDir(): string {
    return path.join(os.homedir(), '.multicoder');
  }

  private getLegacyConfigDirs(): string[] {
    const homeDir = os.homedir();
    const legacyRoots = [
      path.join(homeDir, '.unycode'),
      path.join(homeDir, '.config', 'unycoding'),
      path.join(homeDir, 'AppData', 'Roaming', 'unycoding'),
      path.join(homeDir, 'Library', 'Application Support', 'unycoding'),
    ];

    const transitionalRoots = [
      path.join(homeDir, '.config', 'multicoder'),
      path.join(homeDir, 'AppData', 'Roaming', 'multicoder'),
      path.join(homeDir, 'Library', 'Application Support', 'multicoder'),
    ];

    const uniqueRoots = new Set<string>([...legacyRoots, ...transitionalRoots]);
    uniqueRoots.delete(this.getDefaultConfigDir());
    return [...uniqueRoots];
  }

  private async migrateLegacyProfiles(): Promise<void> {
    const targetFile = path.join(this.configDir, 'profiles.json');
    if (await this.fileExists(targetFile)) {
      return;
    }

    for (const legacyDir of this.getLegacyConfigDirs()) {
      if (legacyDir === this.configDir) {
        continue;
      }

      const legacyFile = path.join(legacyDir, 'profiles.json');
      if (!(await this.fileExists(legacyFile))) {
        continue;
      }

      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      try {
        await fs.rename(legacyFile, targetFile);
      } catch {
        await fs.copyFile(legacyFile, targetFile);
      }
      break;
    }
  }

  async initialize(): Promise<void> {
    await this.credentialManager.initialize();
    if (!this.usingCustomConfigDir) {
      await this.migrateLegacyProfiles();
    }
    await this.load(); // Auto-load profiles on initialization
  }

  list(): Profile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Profile | null {
    return this.profiles.get(name) ?? null;
  }

  getCurrent(): Profile | null {
    return this.current;
  }

  setCurrent(profile: Profile | null): void {
    if (!profile) {
      this.current = null;
      return;
    }
    const stored = this.profiles.get(profile.name);
    this.current = stored ?? profile;
  }

  ensure(name: string): Profile {
    const normalized = name.trim();
    const existing = this.profiles.get(normalized);
    if (existing) {
      this.current = existing;
      this.save().catch(() => {}); // Auto-save (ignore errors)
      return existing;
    }

    const now = Date.now();
    const profile: Profile = {
      name: normalized,
      providers: {},
      model: undefined,
      permissionMode: this.defaultPermissionMode,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(normalized, profile);
    this.current = profile;
    this.save().catch(() => {}); // Auto-save (ignore errors)
    return profile;
  }

  update(profile: Profile): void {
    if (!this.profiles.has(profile.name)) {
      throw new Error(`Profile ${profile.name} not found`);
    }

    const next = { ...profile, updatedAt: Date.now() };
    this.profiles.set(profile.name, next);
    if (this.current?.name === profile.name) {
      this.current = next;
    }
    this.save().catch(() => {}); // Auto-save (ignore errors)
  }

  delete(name: string): boolean {
    const profile = this.profiles.get(name);
    if (!profile) {
      return false;
    }

    this.profiles.delete(name);
    if (this.current?.name === name) {
      this.current = null;
    }
    this.save().catch(() => {}); // Auto-save (ignore errors)
    return true;
  }

  /**
   * Switch to a different profile
   * Returns information about whether a process restart is needed
   */
  async switchProfile(name: string): Promise<{
    profile: Profile;
    needsRestart: boolean;
    envVars: Record<string, string>;
    appliedProviders: string[];
    errors: string[];
  }> {
    const profile = this.profiles.get(name);
    if (!profile) {
      throw new Error(`Profile ${name} not found`);
    }

    if (Object.keys(profile.providers).length === 0) {
      throw new Error(`Profile ${name} does not have any providers configured`);
    }

    // Step 1: Clean up existing environment variables to avoid conflicts
    this.cleanupExistingCredentials(name);

    const allEnvVars: Record<string, string> = {};
    let needsRestart = false;
    const appliedProviders: string[] = [];
    const errors: string[] = [];

    // Step 2: Apply credentials for all providers in the profile
    for (const [providerId, authInfo] of Object.entries(profile.providers)) {
      try {
        const { needsRestart: providerNeedsRestart } = await this.credentialManager.applyCredentials(
          providerId,
          profile.name
        );

        // No longer apply environment variables - all credentials are managed through config files
        
        if (providerNeedsRestart) {
          needsRestart = true;
        }

        appliedProviders.push(providerId);
      } catch (error) {
        errors.push(`${providerId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Update last used timestamp
    profile.lastUsedAt = Date.now();
    this.update(profile);

    // Set as current
    this.current = profile;

    return { profile, needsRestart, envVars: allEnvVars, appliedProviders, errors };
  }

  /**
   * Check if a profile has valid credentials for any provider
   */
  async hasValidCredentials(profileName: string): Promise<boolean> {
    const profile = this.profiles.get(profileName);
    if (!profile || Object.keys(profile.providers).length === 0) {
      return false;
    }

    // Check if any provider has valid credentials
    for (const providerId of Object.keys(profile.providers)) {
      try {
        const credInfo = await this.credentialManager.getCredentialInfo(
          providerId,
          profile.name
        );
        if (credInfo && this.credentialManager.isCredentialValid(credInfo)) {
          return true;
        }
      } catch {
        // Continue checking other providers
      }
    }

    return false;
  }

  /**
   * Check if a profile has valid credentials for a specific provider
   */
  async hasValidCredentialsForProvider(profileName: string, providerId: string): Promise<boolean> {
    const profile = this.profiles.get(profileName);
    if (!profile?.providers[providerId]) {
      return false;
    }

    try {
      const credInfo = await this.credentialManager.getCredentialInfo(
        providerId,
        profile.name
      );
      if (!credInfo) {
        return false;
      }

      return this.credentialManager.isCredentialValid(credInfo);
    } catch {
      return false;
    }
  }

  /**
   * Create a profile with managed API key credentials
   */
  async createProfileWithApiKey(
    name: string,
    providerId: string,
    apiKey: string,
    options?: {
      model?: string;
      permissionMode?: 'ask' | 'allow' | 'deny';
    }
  ): Promise<Profile> {
    if (this.profiles.has(name)) {
      throw new Error(`Profile ${name} already exists`);
    }

    // Save the API key
    await this.credentialManager.saveApiKey(providerId, name, apiKey);

    const credInfo = await this.credentialManager.getCredentialInfo(
      providerId,
      name
    );

    // Create the profile
    const now = Date.now();
    const providerAuth: Profile['providers'][string] = {
      credentialSource: credInfo?.source === 'native' ? 'native' : 'managed',
      lastAuth: now,
    };

    if (credInfo?.path) {
      providerAuth.credentialPath = credInfo.path;
    }
    if (credInfo?.expiresAt) {
      providerAuth.expiresAt = credInfo.expiresAt;
    }

    const profile: Profile = {
      name,
      providers: {
        [providerId]: providerAuth
      },
      lastProvider: providerId,
      model: options?.model,
      permissionMode: options?.permissionMode ?? this.defaultPermissionMode,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(name, profile);
    return profile;
  }

  /**
   * Create a profile from current native credentials
   */
  async createProfileFromNative(
    name: string,
    providerId: string,
    options?: {
      model?: string;
      permissionMode?: 'ask' | 'allow' | 'deny';
      copyToManaged?: boolean;
    }
  ): Promise<Profile> {
    if (this.profiles.has(name)) {
      throw new Error(`Profile ${name} already exists`);
    }

    const credInfo = await this.credentialManager.getCredentialInfo(providerId, name);
    let credentialSource: 'native' | 'managed' = 'native';

    // Optionally copy native credentials to managed storage
    if (options?.copyToManaged) {
      await this.credentialManager.copyNativeToManaged(providerId, name);
      credentialSource = 'managed';
    }

    const now = Date.now();
    const providerAuth: Profile['providers'][string] = {
      credentialSource,
      lastAuth: now,
      expiresAt: credInfo?.expiresAt,
    };

    if (credInfo?.path) {
      providerAuth.credentialPath = credInfo.path;
    }

    const profile: Profile = {
      name,
      providers: {
        [providerId]: providerAuth
      },
      lastProvider: providerId,
      model: options?.model,
      permissionMode: options?.permissionMode ?? this.defaultPermissionMode,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(name, profile);
    return profile;
  }

  /**
   * Get credential info for a profile (for display/debugging)
   */
  async getCredentialInfo(profileName: string): Promise<Record<string, any>> {
    const profile = this.profiles.get(profileName);
    if (!profile || Object.keys(profile.providers).length === 0) {
      return {};
    }

    const credentialInfo: Record<string, any> = {};

    for (const [providerId, authInfo] of Object.entries(profile.providers)) {
      try {
        const credInfo = await this.credentialManager.getCredentialInfo(providerId, profile.name);
        credentialInfo[providerId] = {
          ...credInfo,
          authInfo
        };
      } catch (error) {
        credentialInfo[providerId] = {
          error: error instanceof Error ? error.message : String(error),
          authInfo
        };
      }
    }

    return credentialInfo;
  }

  /**
   * Get credential info for a specific provider in a profile
   */
  async getCredentialInfoForProvider(profileName: string, providerId: string): Promise<any> {
    const profile = this.profiles.get(profileName);
    if (!profile?.providers[providerId]) {
      return null;
    }

    try {
      const credInfo = await this.credentialManager.getCredentialInfo(providerId, profile.name);
      return {
        ...credInfo,
        authInfo: profile.providers[providerId]
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        authInfo: profile.providers[providerId]
      };
    }
  }

  getCredentialManager(): CredentialManager {
    return this.credentialManager;
  }

  /**
   * Clean up existing environment variables to avoid conflicts
   * Clean up ALL possible conflicting environment variables, not just profile-specific ones
   */
  private cleanupExistingCredentials(profileName: string): void {
    // List of ALL possible environment variables that could cause conflicts
    const allConflictingEnvVars = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'GOOGLE_API_KEY',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'AZURE_OPENAI_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN'
    ];

    // Check for OS-level environment variables that need to be cleared
    const osLevelConflicts: string[] = [];
    for (const envVar of allConflictingEnvVars) {
      if (process.env[envVar]) {
        osLevelConflicts.push(envVar);
      }
    }

    // Clear ALL conflicting environment variables from current process
    // This ensures a clean slate for the new profile
    for (const envVar of allConflictingEnvVars) {
      if (process.env[envVar]) {
        delete process.env[envVar];
      }
    }

    // If there are OS-level conflicts, provide guidance to the user
    if (osLevelConflicts.length > 0) {
      console.log(`\n⚠️  Detected OS-level environment variables that may cause conflicts:`);
      for (const envVar of osLevelConflicts) {
        console.log(`   • ${envVar}`);
      }
      console.log(`\n💡 To avoid conflicts, consider clearing these environment variables:`);
      console.log(`   PowerShell: Remove-Item Env:${osLevelConflicts[0]}`);
      console.log(`   CMD: set ${osLevelConflicts[0]}=`);
      console.log(`   Or restart your terminal to clear all environment variables.\n`);
    }
  }

  /**
   * Get environment variables for a specific provider
   */
  private getProviderEnvVars(providerId: string): string[] {
    const providerEnvVarMap: Record<string, string[]> = {
      'claude': ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
      'anthropic': ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
      'gemini': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      'google': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      'codex': ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY'],
      'openai': ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY'],
      'amazon-q': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'],
      'aws': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']
    };

    return providerEnvVarMap[providerId] || [];
  }

  /**
   * Add a provider to an existing profile
   */
  async addProviderToProfile(
    profileName: string,
    providerId: string,
    credentialSource: 'native' | 'managed' | 'env',
    options?: {
      apiKey?: string;
      copyToManaged?: boolean;
    }
  ): Promise<void> {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new Error(`Profile ${profileName} not found`);
    }

    if (profile.providers[providerId]) {
      throw new Error(`Provider ${providerId} already exists in profile ${profileName}`);
    }

    // Handle different credential sources
    if (credentialSource === 'managed' && options?.apiKey) {
      await this.credentialManager.saveApiKey(providerId, profileName, options.apiKey);
    } else if (credentialSource === 'native' && options?.copyToManaged) {
      await this.credentialManager.copyNativeToManaged(providerId, profileName);
    }

    // Add provider to profile
    const providerAuth: Profile['providers'][string] = {
      credentialSource,
      lastAuth: Date.now(),
    };

    try {
      const credInfo = await this.credentialManager.getCredentialInfo(
        providerId,
        profile.name
      );
      if (credInfo?.path) {
        providerAuth.credentialPath = credInfo.path;
      }
      if (credInfo?.expiresAt) {
        providerAuth.expiresAt = credInfo.expiresAt;
      }
    } catch {
      // Ignore metadata lookup errors
    }

    profile.providers[providerId] = providerAuth;

    // Update last provider if this is the first provider
    if (!profile.lastProvider) {
      profile.lastProvider = providerId;
    }

    this.update(profile);
  }

  /**
   * Link an existing credential (native or managed) to a profile without prompting the user
   */
  async linkExistingCredential(
    profileName: string,
    providerId: string,
    options?: {
      copyToManaged?: boolean;
    }
  ): Promise<Profile> {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new Error(`Profile ${profileName} not found`);
    }

    if (profile.providers[providerId]) {
      throw new Error(`Provider ${providerId} is already linked to profile ${profileName}`);
    }

    const credInfo = await this.credentialManager.getCredentialInfo(providerId, profileName);
    if (!credInfo) {
      throw new Error(`No existing credentials found for provider ${providerId}`);
    }

    const shouldCopyToManaged = options?.copyToManaged ?? false;
    let credentialSource: 'native' | 'managed';

    if (credInfo.source === 'managed') {
      credentialSource = 'managed';
    } else if (shouldCopyToManaged) {
      await this.credentialManager.copyNativeToManaged(providerId, profileName);
      credentialSource = 'managed';
    } else {
      credentialSource = 'native';
    }

    await this.addProviderToProfile(profileName, providerId, credentialSource, {
      copyToManaged: shouldCopyToManaged && credentialSource === 'native',
    });

    const updatedProfile = this.profiles.get(profileName);
    if (!updatedProfile) {
      throw new Error(`Failed to refresh profile ${profileName} after linking credentials`);
    }

    return updatedProfile;
  }

  /**
   * Get available authentication options and credential status for a provider
   */
  async getAuthOptions(
    profileName: string,
    providerId: string
  ): Promise<{
    supportsOAuth: boolean;
    supportsApiKey: boolean;
    hasNativeCredentialPath: boolean;
    existingCredential: {
      source: 'native' | 'managed';
      path?: string;
      expiresAt?: number;
      valid: boolean;
    } | null;
    linkedCredential: Profile['providers'][string] | null;
    canLinkExistingCredential: boolean;
  }> {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new Error(`Profile ${profileName} not found`);
    }

    const providerConfig = this.credentialManager.getAuthenticationOptions(providerId);

    let existingCredential: {
      source: 'native' | 'managed';
      path?: string;
      expiresAt?: number;
      valid: boolean;
    } | null = null;

    try {
      const credInfo = await this.credentialManager.getCredentialInfo(providerId, profileName);
      if (credInfo) {
        existingCredential = {
          source: credInfo.source as 'native' | 'managed',
          path: credInfo.path,
          expiresAt: credInfo.expiresAt,
          valid: this.credentialManager.isCredentialValid(credInfo),
        };
      }
    } catch {
      existingCredential = null;
    }

    const linkedCredential = profile.providers[providerId] ?? null;

    return {
      supportsOAuth: providerConfig.hasOAuth,
      supportsApiKey: providerConfig.hasApiKey,
      hasNativeCredentialPath: providerConfig.hasNativeCredentials,
      existingCredential,
      linkedCredential,
      canLinkExistingCredential: Boolean(existingCredential) && !linkedCredential,
    };
  }

  /**
   * Remove a provider from a profile
   */
  removeProviderFromProfile(profileName: string, providerId: string): void {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new Error(`Profile ${profileName} not found`);
    }

    if (!profile.providers[providerId]) {
      throw new Error(`Provider ${providerId} not found in profile ${profileName}`);
    }

    delete profile.providers[providerId];

    // Update last provider if it was the removed one
    if (profile.lastProvider === providerId) {
      const remainingProviders = Object.keys(profile.providers);
      profile.lastProvider = remainingProviders.length > 0 ? remainingProviders[0] : undefined;
    }

    this.update(profile);
  }

  /**
   * Set the last used provider for a profile
   */
  setLastProvider(profileName: string, providerId: string): void {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new Error(`Profile ${profileName} not found`);
    }

    if (!profile.providers[providerId]) {
      throw new Error(`Provider ${providerId} not found in profile ${profileName}`);
    }

    profile.lastProvider = providerId;
    this.update(profile);
  }

  /**
   * Save all profiles to profiles.json
   */
  async save(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const data = {
      current: this.current?.name ?? null,
      profiles: this.list(),
    };
    const profilesPath = path.join(this.configDir, 'profiles.json');
    await fs.writeFile(profilesPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /**
   * Load profiles from profiles.json
   */
  async load(): Promise<void> {
    const profilesPath = path.join(this.configDir, 'profiles.json');
    try {
      const content = await fs.readFile(profilesPath, 'utf-8');
      const data = JSON.parse(content);

      // Clear existing profiles
      this.profiles.clear();

      // Load profiles
      for (const profile of data.profiles) {
        this.profiles.set(profile.name, profile);
      }

      // Restore current profile
      if (data.current) {
        const currentProfile = this.profiles.get(data.current);
        if (currentProfile) {
          this.current = currentProfile;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // Only throw if it's not a "file not found" error
        throw error;
      }
      // File doesn't exist yet, which is fine for first run
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
