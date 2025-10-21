/**
 * Credential Manager
 *
 * Manages provider credentials with support for multiple authentication methods:
 * - OAuth tokens stored in native credential files
 * - API keys stored in managed credential files or environment variables
 * - Profile-based switching with automatic credential isolation
 *
 * Key features:
 * - Mixed strategy: native credentials (read-only reference) + managed credentials (full control)
 * - Credential validation and expiry detection
 * - Secure storage with appropriate file permissions
 * - Environment variable management for API key based providers
 */
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { computeAzureBaseUrl, type CodexEnvConfig } from '../system/codexEnv.js';

export interface CredentialInfo {
  source: 'native' | 'managed' | 'env';
  path?: string;
  envVar?: string;
  providerId: string;
  profileName: string;
  expiresAt?: number;
}

export interface ProviderConfig {
  providerId: string;
  nativeCredentialPath?: string;
  envVarName?: string;
  envVarNameAlt?: string;
  supportsApiKey: boolean;
  supportsOAuth: boolean;
  oauthCachePath?: string;
}

export interface AuthenticationOptions {
  hasOAuth: boolean;
  hasApiKey: boolean;
  hasNativeCredentials: boolean;
  nativeCredentialPath?: string;
}

// Provider credential configurations
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    providerId: 'claude',
    nativeCredentialPath: path.join(os.homedir(), '.claude', '.credentials.json'),
    envVarName: 'ANTHROPIC_API_KEY',
    envVarNameAlt: 'ANTHROPIC_AUTH_TOKEN',
    supportsApiKey: true,
    supportsOAuth: true,
  },
  anthropic: {
    providerId: 'anthropic',
    envVarName: 'ANTHROPIC_API_KEY',
    envVarNameAlt: 'ANTHROPIC_AUTH_TOKEN',
    supportsApiKey: true,
    supportsOAuth: false,
  },
  gemini: {
    providerId: 'gemini',
    nativeCredentialPath: path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
    envVarName: 'GOOGLE_API_KEY',
    supportsApiKey: true,
    supportsOAuth: true,
  },
  codex: {
    providerId: 'codex',
    nativeCredentialPath: path.join(os.homedir(), '.codex', 'auth.json'),
    supportsApiKey: true,
    supportsOAuth: true,
  },
  q: {
    providerId: 'q',
    nativeCredentialPath: path.join(os.homedir(), '.aws', 'credentials'),
    oauthCachePath: path.join(os.homedir(), '.aws', 'sso', 'cache'),
    supportsApiKey: true,
    supportsOAuth: true,
  },
};

export class CredentialManager {
  private readonly configDir: string;
  private readonly hasCustomBaseDir: boolean;
  managedCredentialsDir: string;

  constructor(baseDir?: string) {
    const envConfigDir = process.env.UNYCODING_CONFIG_DIR;
    const resolvedEnvDir = envConfigDir ? path.resolve(envConfigDir) : null;
    this.hasCustomBaseDir = Boolean(baseDir ?? resolvedEnvDir);
    const configDir = baseDir ?? resolvedEnvDir ?? this.getDefaultConfigDir();
    this.configDir = configDir;
    this.managedCredentialsDir = path.join(configDir, 'credentials');
  }

  getDefaultConfigDir(): string {
    return path.join(os.homedir(), '.unycode');
  }

  private getLegacyConfigDirs(): string[] {
    const homeDir = os.homedir();
    return [
      path.join(homeDir, '.config', 'unycoding'),
      path.join(homeDir, 'AppData', 'Roaming', 'unycoding'),
      path.join(homeDir, 'Library', 'Application Support', 'unycoding')
    ];
  }

  /**
   * Initialize credential manager (create directories)
   */
  async initialize(): Promise<void> {
    if (!this.hasCustomBaseDir) {
      await this.migrateLegacyConfigDir();
    }
    await fs.mkdir(this.managedCredentialsDir, { recursive: true, mode: 0o700 });
  }

  private async migrateLegacyConfigDir(): Promise<void> {
    const targetDir = this.configDir;
    const legacyDirs = this.getLegacyConfigDirs();

    for (const legacyDir of legacyDirs) {
      if (legacyDir === targetDir) {
        continue;
      }

      if (!(await this.directoryExists(legacyDir))) {
        continue;
      }

      const targetExists = await this.directoryExists(targetDir);
      if (!targetExists) {
        const parentDir = path.dirname(targetDir);
        await fs.mkdir(parentDir, { recursive: true, mode: 0o700 });
        try {
          await fs.rename(legacyDir, targetDir);
        } catch {
          await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
          await fs.cp(legacyDir, targetDir, { recursive: true });
        }
        break;
      }

      const legacyCredentialsDir = path.join(legacyDir, 'credentials');
      if (!(await this.directoryExists(legacyCredentialsDir))) {
        continue;
      }

      const targetCredentialsDir = path.join(targetDir, 'credentials');
      if (await this.directoryExists(targetCredentialsDir)) {
        continue;
      }

      await fs.mkdir(targetCredentialsDir, { recursive: true, mode: 0o700 });
      await fs.cp(legacyCredentialsDir, targetCredentialsDir, { recursive: true });
      break;
    }
  }

  /**
   * Get credential info for a profile
   */
  async getCredentialInfo(providerId: string, profileName: string): Promise<CredentialInfo | null> {
    const config = PROVIDER_CONFIGS[providerId];
    if (!config) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    // Check managed credentials first
    const managedPath = this.getManagedCredentialPath(providerId, profileName);
    if (await this.fileExists(managedPath)) {
      return {
        source: 'managed',
        path: managedPath,
        providerId,
        profileName,
      };
    }

    // Check if we have stored environment variable values in managed storage
    const envVarPath = this.getManagedEnvVarPath(providerId, profileName);
    if (await this.fileExists(envVarPath)) {
      return {
        source: 'managed',
        path: envVarPath,
        providerId,
        profileName,
      };
    }

    // Check OAuth cache (for AWS SSO-style authentication like Amazon Q)
    if (config.oauthCachePath && (await this.directoryExists(config.oauthCachePath))) {
      // Check if there are any cache files
      try {
        const cacheFiles = await fs.readdir(config.oauthCachePath);
        if (cacheFiles.length > 0) {
          // Use the most recent cache file
          const latestCache = cacheFiles.sort().pop();
          const cachePath = path.join(config.oauthCachePath, latestCache!);
          const expiresAt = await this.extractExpiresAt(providerId, cachePath);
          return {
            source: 'native',
            path: cachePath,
            providerId,
            profileName,
            expiresAt,
          };
        }
      } catch {
        // Ignore errors reading cache directory
      }
    }

    // Check native credentials
    if (config.nativeCredentialPath && (await this.fileExists(config.nativeCredentialPath))) {
      const expiresAt = await this.extractExpiresAt(providerId, config.nativeCredentialPath);
      return {
        source: 'native',
        path: config.nativeCredentialPath,
        providerId,
        profileName,
        expiresAt,
      };
    }

    return null;
  }

  /**
   * Check if credentials are valid (not expired)
   */
  isCredentialValid(credInfo: CredentialInfo): boolean {
    if (!credInfo.expiresAt) {
      return true; // No expiry info, assume valid
    }
    return Date.now() < credInfo.expiresAt;
  }

  /**
   * Save API key as managed credential
   */
  async saveApiKey(
    providerId: string,
    profileName: string,
    apiKey: string,
    metadata?: any
  ): Promise<void> {
    const credPath = this.getManagedCredentialPath(providerId, profileName);
    // Ensure provider directory exists
    const providerDir = path.dirname(credPath);
    await fs.mkdir(providerDir, { recursive: true, mode: 0o700 });

    const data = {
      providerId,
      profileName,
      apiKey,
      createdAt: Date.now(),
      metadata,
    };

    await fs.writeFile(credPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /**
   * Save credential data (API key with optional base URL and other settings)
   */
  async saveCredentialData(
    providerId: string,
    profileName: string,
    credentialData: any
  ): Promise<void> {
    const credPath = this.getManagedCredentialPath(providerId, profileName);
    // Ensure provider directory exists
    const providerDir = path.dirname(credPath);
    await fs.mkdir(providerDir, { recursive: true, mode: 0o700 });

    const data = {
      providerId,
      profileName,
      ...credentialData,
      createdAt: Date.now(),
    };

    await fs.writeFile(credPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /**
   * Save environment variable as managed credential
   */
  async saveEnvVar(
    providerId: string,
    profileName: string,
    envVarName: string,
    envVarValue: string,
    metadata?: any
  ): Promise<void> {
    const envPath = this.getManagedEnvVarPath(providerId, profileName);
    // Ensure provider directory exists
    const providerDir = path.dirname(envPath);
    await fs.mkdir(providerDir, { recursive: true, mode: 0o700 });

    const data = {
      providerId,
      profileName,
      envVarName,
      envVarValue,
      createdAt: Date.now(),
      metadata,
    };

    await fs.writeFile(envPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /**
   * Copy native credential to managed storage
   * Used when user wants to create a new profile from current native credentials
   */
  async copyNativeToManaged(providerId: string, profileName: string): Promise<void> {
    const config = PROVIDER_CONFIGS[providerId];
    if (!config?.nativeCredentialPath) {
      throw new Error(`Provider ${providerId} does not have native credentials`);
    }

    const nativePath = config.nativeCredentialPath;
    if (!(await this.fileExists(nativePath))) {
      throw new Error(`Native credential file not found: ${nativePath}`);
    }

    const managedPath = this.getManagedCredentialPath(providerId, profileName);
    // Ensure managed directory exists
    const managedDir = path.dirname(managedPath);
    await fs.mkdir(managedDir, { recursive: true, mode: 0o700 });

    await fs.copyFile(nativePath, managedPath);
    await fs.chmod(managedPath, 0o600);
  }

  /**
   * Remove managed credential (without touching profile metadata)
   */
  /**
   * Apply credentials for a profile
   * This sets up configuration files so the provider CLI can use these credentials
   */
  async applyCredentials(
    providerId: string,
    profileName: string
  ): Promise<{ needsRestart: boolean }> {
    const credInfo = await this.getCredentialInfo(providerId, profileName);
    if (!credInfo) {
      throw new Error(`No credentials found for profile: ${profileName}`);
    }

    if (!this.isCredentialValid(credInfo)) {
      throw new Error(`Credentials for profile ${profileName} have expired. Please re-login.`);
    }

    // For Claude, use the provider-specific applyCredentials method
    if (providerId === 'claude') {
      const { ClaudeAuthenticator } = await import('./providers/claude.js');
      const claudeAuth = new ClaudeAuthenticator();
      return await claudeAuth.applyCredentials(profileName);
    }

    // For Gemini, use the provider-specific applyCredentials method
    if (providerId === 'gemini') {
      const { GeminiAuthenticator } = await import('./providers/gemini.js');
      const geminiAuth = new GeminiAuthenticator();

      let credentialData: any | undefined;
      if (credInfo.source === 'managed' && credInfo.path) {
        try {
          const content = await fs.readFile(credInfo.path, 'utf-8');
          credentialData = JSON.parse(content);
        } catch {
          // If we can't read the managed credential, fall back to lookup inside the authenticator
        }
      }

      return await geminiAuth.applyCredentials(profileName, credentialData);
    }

    if (providerId === 'codex') {
      this.warnCodexEnvironment();

      if (credInfo.source === 'managed') {
        const codexData = await this.loadCodexCredentialData(credInfo);

        if (codexData.tokens && (codexData.tokens.access_token || codexData.tokens.id_token)) {
          await this.copyManagedToNative(providerId, profileName);
          console.log('-> Codex OAuth credentials copied to ~/.codex/auth.json');
          return { needsRestart: false };
        }

        if (codexData.apiKey) {
          const codexConfig = this.toCodexEnvConfig(codexData);
          await this.writeCodexApiCredential(codexData.apiKey, codexConfig);
          console.log('-> Codex API key written to ~/.codex/auth.json');
          if (codexConfig.baseUrl) {
            console.log(`   OPENAI_BASE_URL=${codexConfig.baseUrl}`);
          }
          return { needsRestart: false };
        }
      } else if (credInfo.source === 'native') {
        console.log('-> Codex is using native OAuth credentials from ~/.codex/');
      }

      return { needsRestart: false };
    }

    // For other providers, use the generic approach
    const config = PROVIDER_CONFIGS[providerId];
    let needsRestart = false;

    // Handle based on credential source
    if (credInfo.source === 'managed') {
      const data = JSON.parse(await fs.readFile(credInfo.path!, 'utf-8'));
      
      // Check if this is an API key credential
      if (data.apiKey && config.supportsApiKey && config.nativeCredentialPath) {
        // Copy managed API key to native location
        await this.copyManagedToNative(providerId, profileName);
        needsRestart = true;
      } else if (data.envVarName && data.envVarValue) {
        // This is a stored environment variable - convert to config file
        await this.convertEnvVarToConfigFile(providerId, profileName, data.envVarName, data.envVarValue);
        needsRestart = true;
      } else if (config.nativeCredentialPath) {
        // This is an OAuth credential or other managed credential - copy to native location
        await this.copyManagedToNative(providerId, profileName);
        needsRestart = true;
      }
    } else if (credInfo.source === 'native') {
      // Native credentials are already in place
      // No action needed
    }

    return { needsRestart };
  }


  /**
   * Convert environment variable credential to configuration file
   */
  private async convertEnvVarToConfigFile(
    providerId: string,
    profileName: string,
    envVarName: string,
    envVarValue: string
  ): Promise<void> {
    const config = PROVIDER_CONFIGS[providerId];
    if (!config.nativeCredentialPath) {
      throw new Error(`Provider ${providerId} does not support configuration files`);
    }

    // Create the native credential directory
    const nativeDir = path.dirname(config.nativeCredentialPath);
    await fs.mkdir(nativeDir, { recursive: true, mode: 0o700 });

    // Create configuration file based on provider
    if (providerId === 'claude' || providerId === 'anthropic') {
      // Claude uses ~/.claude/.credentials.json
      const credData = {
        apiKey: envVarValue,
        createdAt: Date.now(),
        source: 'managed',
        profileName: profileName
      };
      await fs.writeFile(config.nativeCredentialPath, JSON.stringify(credData, null, 2), { mode: 0o600 });
    } else if (providerId === 'codex') {
      // Codex uses ~/.codex/auth.json
      const credData = {
        tokens: {
          sessionKey: envVarValue,
          session_key: envVarValue
        },
        createdAt: Date.now(),
        source: 'managed',
        profileName: profileName
      };
      await fs.writeFile(config.nativeCredentialPath, JSON.stringify(credData, null, 2), { mode: 0o600 });
    } else if (providerId === 'gemini') {
      // Gemini uses ~/.gemini/oauth_creds.json
      const credData = {
        apiKey: envVarValue,
        createdAt: Date.now(),
        source: 'managed',
        profileName: profileName
      };
      await fs.writeFile(config.nativeCredentialPath, JSON.stringify(credData, null, 2), { mode: 0o600 });
    }
  }

  /**
   * Clear managed credentials for a profile
   */
  async clearCredentials(providerId: string, profileName: string): Promise<void> {
    // Delete regular credential file
    const managedPath = this.getManagedCredentialPath(providerId, profileName);
    if (await this.fileExists(managedPath)) {
      await fs.unlink(managedPath);
    }

    // Delete environment variable credential file
    const envVarPath = this.getManagedEnvVarPath(providerId, profileName);
    if (await this.fileExists(envVarPath)) {
      await fs.unlink(envVarPath);
    }
  }

  private warnCodexEnvironment(): void {
    const conflicting = ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL'].filter(
      (envVar) => typeof process.env[envVar] === 'string' && process.env[envVar]!.length > 0
    );

    if (conflicting.length === 0) {
      return;
    }

    console.log('??  Warning: Detected existing OpenAI-related environment variables:');
    for (const envVar of conflicting) {
      console.log(`   - ${envVar}`);
    }
    console.log('    These are no longer managed automatically. Update or clear them manually if needed.');
  }

  private async writeCodexApiCredential(apiKey: string, config: CodexEnvConfig): Promise<void> {
    const codexConfig = PROVIDER_CONFIGS['codex'];
    if (!codexConfig?.nativeCredentialPath) {
      throw new Error('Codex provider is missing native credential path');
    }

    const nativePath = codexConfig.nativeCredentialPath;
    const nativeDir = path.dirname(nativePath);
    await fs.mkdir(nativeDir, { recursive: true, mode: 0o700 });

    const payload: Record<string, any> = {
      type: 'api-key',
      provider: config.mode,
      updatedAt: Date.now(),
      apiKey,
      OPENAI_API_KEY: apiKey,
      OPENAI_BASE_URL: config.baseUrl ?? null,
    };

    if (config.mode === 'azure') {
      payload.azureResourceName = config.azureResourceName ?? null;
    }

    await fs.writeFile(nativePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  /**
   * List all managed profiles for a provider
   */
  async listManagedProfiles(providerId: string): Promise<string[]> {
    const providerDir = path.join(this.managedCredentialsDir, providerId);
    if (!(await this.fileExists(providerDir))) {
      return [];
    }

    const files = await fs.readdir(providerDir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(providerId: string): ProviderConfig | null {
    return PROVIDER_CONFIGS[providerId] || null;
  }

  /**
   * Get all authentication options for a provider
   */
  getAuthenticationOptions(providerId: string): AuthenticationOptions {
    const config = PROVIDER_CONFIGS[providerId];
    if (!config) {
      return {
        hasOAuth: false,
        hasApiKey: false,
        hasNativeCredentials: false,
      };
    }

    return {
      hasOAuth: config.supportsOAuth,
      hasApiKey: config.supportsApiKey,
      hasNativeCredentials: !!config.nativeCredentialPath,
      nativeCredentialPath: config.nativeCredentialPath,
    };
  }

  /**
   * Save OAuth token as managed credential
   */
  async saveOAuthToken(
    providerId: string,
    profileName: string,
    tokenData: any
  ): Promise<void> {
    const credPath = this.getManagedCredentialPath(providerId, profileName);
    // Ensure provider directory exists
    const providerDir = path.dirname(credPath);
    await fs.mkdir(providerDir, { recursive: true, mode: 0o700 });

    const data = {
      providerId,
      profileName,
      ...tokenData,
      createdAt: Date.now(),
    };

    await fs.writeFile(credPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /**
   * Load managed credential data (for reading API keys or tokens)
   */
  async loadManagedCredential(providerId: string, profileName: string): Promise<any> {
    const credPath = this.getManagedCredentialPath(providerId, profileName);
    if (!(await this.fileExists(credPath))) {
      return null;
    }

    try {
      const content = await fs.readFile(credPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get managed credential path (public method for external use)
   */
  public getManagedCredentialPath(providerId: string, profileName: string): string {
    return path.join(this.managedCredentialsDir, providerId, `${profileName}.json`);
  }

  /**
   * Get managed environment variable path for a provider and profile
   */
  private getManagedEnvVarPath(providerId: string, profileName: string): string {
    return path.join(this.managedCredentialsDir, providerId, `${profileName}.env.json`);
  }

  private async copyManagedToNative(providerId: string, profileName: string): Promise<void> {
    const config = PROVIDER_CONFIGS[providerId];
    if (!config?.nativeCredentialPath) {
      throw new Error(`Provider ${providerId} does not have native credential path`);
    }

    const managedPath = this.getManagedCredentialPath(providerId, profileName);
    const nativePath = config.nativeCredentialPath;

    // Backup existing native credential
    if (await this.fileExists(nativePath)) {
      const backupPath = `${nativePath}.backup.${Date.now()}`;
      await fs.copyFile(nativePath, backupPath);
    }

    // Ensure native directory exists
    await fs.mkdir(path.dirname(nativePath), { recursive: true, mode: 0o700 });

    // Read managed credential data
    const managedData = JSON.parse(await fs.readFile(managedPath, 'utf-8'));

    // For Claude, handle OAuth format specifically
    if (providerId === 'claude') {
      // For Claude, keep the original OAuth format
      if (managedData.claudeAiOauth) {
        // Keep the original claudeAiOauth format that Claude CLI expects
        await fs.writeFile(nativePath, JSON.stringify(managedData, null, 2), { mode: 0o600 });
      } else {
        // Direct copy for other formats
        await fs.copyFile(managedPath, nativePath);
        await fs.chmod(nativePath, 0o600);
      }
    } else if (providerId === 'gemini') {
      // For Gemini, use the provider-specific logic
      const { GeminiAuthenticator } = await import('./providers/gemini.js');
      const geminiAuth = new GeminiAuthenticator();
      await geminiAuth.applyCredentials(profileName);
      return;
    } else {
      // For other providers, direct copy
      await fs.copyFile(managedPath, nativePath);
      await fs.chmod(nativePath, 0o600);
    }
  }

  private async extractExpiresAt(providerId: string, credPath: string): Promise<number | undefined> {
    try {
      const content = await fs.readFile(credPath, 'utf-8');
      const data = JSON.parse(content);

      // Provider-specific expiry extraction
      // For Claude OAuth, check claudeAiOauth structure
      if (providerId === 'claude' && data.claudeAiOauth?.expiresAt) {
        return data.claudeAiOauth.expiresAt;
      }

      if (providerId === 'gemini' && data.expiry_date) {
        // Gemini stores expiry_date as Unix timestamp in milliseconds
        return data.expiry_date;
      }

      if (providerId === 'codex' && data.expiresAt) {
        return data.expiresAt;
      }

      if (providerId === 'q') {
        // AWS SSO cache format
        if (data.expiresAt) {
          // ISO 8601 date string -> timestamp
          return new Date(data.expiresAt).getTime();
        }
      }

      // Generic check
      if (data.expiresAt) {
        return data.expiresAt;
      }
    } catch {
      // Ignore parsing errors
    }

    return undefined;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async loadCodexCredentialData(credInfo: CredentialInfo): Promise<Record<string, any>> {
    if (credInfo.source === 'managed' && credInfo.path) {
      const content = await fs.readFile(credInfo.path, 'utf-8');
      const data = JSON.parse(content);
      
      // Check if this is OAuth tokens (not API key)
      if (data.tokens && (data.tokens.access_token || data.tokens.id_token)) {
        // This is OAuth credential stored in managed storage
        // We need to copy it to native location
        return data;
      }
      
      if (!data.apiKey) {
        throw new Error('Codex managed credential is missing an API key. Please re-authenticate with --openai-api-key or --azure-openai-api-key.');
      }
      return data;
    }

    throw new Error('Codex credential must be managed (API key) for environment variable injection. Native OAuth credentials do not require environment variables.');
  }

  private toCodexEnvConfig(data: Record<string, any>): CodexEnvConfig {
    const provider = typeof data.provider === 'string' ? data.provider.toLowerCase() : 'openai';
    const mode: CodexEnvConfig['mode'] = provider === 'azure' ? 'azure' : 'openai';

    let baseUrl: string | undefined =
      typeof data.baseUrl === 'string' && data.baseUrl.length > 0 ? data.baseUrl : undefined;
    const azureResourceName: string | undefined =
      typeof data.azureResourceName === 'string' && data.azureResourceName.length > 0
        ? data.azureResourceName
        : undefined;

    if (mode === 'azure') {
      if (!baseUrl && azureResourceName) {
        baseUrl = computeAzureBaseUrl(azureResourceName);
      }
      if (!baseUrl) {
        throw new Error('Azure OpenAI configuration is missing the deployment URL. Please re-authenticate.');
      }
      return {
        mode: 'azure',
        baseUrl,
        azureResourceName,
      };
    }

    return {
      mode: 'openai',
      baseUrl,
    };
  }

  /**
   * Get user-level environment variable
   */
  private getUserLevelEnvVar(envVar: string): string | null {
    try {
      if (process.platform === 'win32') {
        // PowerShell command to get user-level environment variable
        const result = execSync(`powershell -Command "[Environment]::GetEnvironmentVariable('${envVar}', 'User')"`, { encoding: 'utf8' });
        return result.trim() || null;
      } else {
        // Unix-like systems - check shell profile
        const homeDir = os.homedir();
        const shellProfiles = ['.bashrc', '.zshrc', '.profile'];
        
        for (const profile of shellProfiles) {
          const profilePath = path.join(homeDir, profile);
          if (existsSync(profilePath)) {
            const content = readFileSync(profilePath, 'utf8');
            const match = content.match(new RegExp(`export\\s+${envVar}=['"]?([^'"]+)['"]?`));
            if (match) {
              return match[1];
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }
}
