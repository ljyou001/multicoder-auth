/**
 * Profile Service
 * 
 * Handles profile-related business logic including:
 * - Profile switching with credential application
 * - Environment variable management
 * - Cross-platform credential persistence
 */
import { ProfileStore } from '../profile/store.js';
import { CredentialManager } from './credentialManager.js';
import { SystemEnvironmentManager } from '../system/systemEnvironmentManager.js';

export interface ProfileSwitchResult {
  success: boolean;
  appliedCredentials: string[];
  needsRestart: string[];
  errors: string[];
}

export interface ProfileServiceDependencies {
  credentialManager?: CredentialManager;
  systemEnvManager?: SystemEnvironmentManager;
}

export class ProfileService {
  private readonly credentialManager: CredentialManager;
  private readonly profileStore: ProfileStore;
  private readonly systemEnvManager: SystemEnvironmentManager;

  constructor(profileStore: ProfileStore, dependencies: ProfileServiceDependencies = {}) {
    this.profileStore = profileStore;
    this.credentialManager = dependencies.credentialManager ?? new CredentialManager();
    this.systemEnvManager = dependencies.systemEnvManager ?? new SystemEnvironmentManager();
  }

  /**
   * Switch to a profile and apply all credentials
   */
  async switchProfile(profileName: string): Promise<ProfileSwitchResult> {
    const profile = this.profileStore.get(profileName);
    if (!profile) {
      throw new Error(`Profile '${profileName}' not found`);
    }

    await this.credentialManager.initialize();

    const result: ProfileSwitchResult = {
      success: true,
      appliedCredentials: [],
      needsRestart: [],
      errors: []
    };

    // Step 1: Clean up existing environment variables to avoid conflicts
    await this.cleanupExistingCredentials(profileName);

    // Step 2: Apply credentials for each configured provider
    for (const [providerId, authInfo] of Object.entries(profile.providers)) {
      try {
        const providerResult = await this.applyProviderCredentials(providerId, profileName);
        
        if (providerResult.envVars && Object.keys(providerResult.envVars).length > 0) {
          result.appliedCredentials.push(providerId);
        }

        if (providerResult.needsRestart) {
          result.needsRestart.push(providerId);
        }

      } catch (error) {
        result.errors.push(`${providerId}: ${error instanceof Error ? error.message : String(error)}`);
        result.success = false;
      }
    }

    return result;
  }

  /**
   * Check for OS-level environment variables that might interfere with profile switching
   */
  private async cleanupExistingCredentials(profileName: string): Promise<void> {
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

    // Check for OS-level environment variables that might interfere
    const osLevelConflicts: string[] = [];
    for (const envVar of allConflictingEnvVars) {
      if (process.env[envVar]) {
        osLevelConflicts.push(envVar);
      }
    }

    // Warn about OS-level environment variables that might interfere with profile switching
    if (osLevelConflicts.length > 0) {
      console.log('\nWarning: OS-level environment variables detected that may interfere with profile switching:');
      for (const envVar of osLevelConflicts) {
        console.log(`   - ${envVar}`);
      }
      const cleared = await this.clearOSLevelEnvVars(osLevelConflicts);
      if (cleared.length > 0) {
        console.log(`   Cleared from current process: ${cleared.join(', ')}`);
      }
      console.log(`   These values may still persist at the OS level; rerun the command with elevated permissions if conflicts remain.`);
      console.log('');
    }
  }

  /**
   * Clear environment variables in current process only
   * Returns the list of successfully cleared environment variables
   */
  private async clearOSLevelEnvVars(envVars: string[]): Promise<string[]> {
    const clearedVars: string[] = [];
    
    // Clear environment variables in current process only
    // This ensures a clean environment for the current Node.js process
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        delete process.env[envVar];
        clearedVars.push(envVar);
      }
    }
    
    return clearedVars;
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
   * Apply credentials for a specific provider
   */
  private async applyProviderCredentials(
    providerId: string, 
    profileName: string
  ): Promise<{ envVars: Record<string, string>; needsRestart: boolean }> {
    const result = await this.credentialManager.applyCredentials(providerId, profileName);
    
    // No longer apply environment variables - all credentials are managed through config files
    // Return empty envVars since we're using configuration files instead
    return { envVars: {}, needsRestart: result.needsRestart };
  }

  /**
   * Get user-level environment variable
   */
  async getUserLevelEnvVar(envVar: string): Promise<string | null> {
    try {
      return await this.systemEnvManager.get(envVar, { scope: 'user' });
    } catch {
      return null;
    }
  }

  /**
   * Set user-level environment variable
   */
  async setUserLevelEnvVar(envVar: string, value: string): Promise<void> {
    await this.systemEnvManager.set(envVar, value, { scope: 'user' });
  }

  /**
   * Get credential information for a profile
   */
  async getProfileCredentialInfo(profileName: string): Promise<Record<string, any>> {
    const profile = this.profileStore.get(profileName);
    if (!profile) {
      throw new Error(`Profile '${profileName}' not found`);
    }

    await this.credentialManager.initialize();

    const credentialInfo: Record<string, any> = {};

    for (const [providerId, authInfo] of Object.entries(profile.providers)) {
      try {
        const credInfo = await this.credentialManager.getCredentialInfo(providerId, profileName);
        
        // If this is a managed credential, read the file to get more details
        let detailedInfo: any = { ...credInfo };
        if (credInfo?.source === 'managed' && credInfo?.path) {
          try {
            const fs = await import('node:fs');
            const content = await fs.promises.readFile(credInfo.path, 'utf-8');
            const data = JSON.parse(content);
            
            // Add environment variable info if available
            if (data.envVarName) {
              detailedInfo.envVarName = data.envVarName;
            }
            
            // Add API key info if available
            if (data.apiKey) {
              detailedInfo.apiKey = data.apiKey;
            }
            
            // Add OAuth info if available
            if (data.claudeAiOauth) {
              detailedInfo.claudeAiOauth = data.claudeAiOauth;
            }

            // Add Gemini OAuth info if available
            if (data.access_token && data.refresh_token) {
              detailedInfo.geminiOauth = true;
            }

            // Add Gemini/Vertex API key metadata
            if (data.apiKeyType) {
              detailedInfo.apiKeyType = data.apiKeyType;
            }

            if (typeof data.useVertexAi === 'boolean') {
              detailedInfo.useVertexAi = data.useVertexAi;
            }

            if (data.projectId) {
              detailedInfo.projectId = data.projectId;
            }

            if (data.location) {
              detailedInfo.location = data.location;
            }
          } catch (fileError) {
            // Ignore file read errors
          }
        }

        credentialInfo[providerId] = {
          ...detailedInfo,
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
   * Create a profile from Claude settings.json configuration
   */
  async createProfileFromConfig(profileName: string): Promise<{ success: boolean; error?: string; providers?: string[] }> {
    try {
      // Check if profile already exists
      if (this.profileStore.get(profileName)) {
        return {
          success: false,
          error: `Profile '${profileName}' already exists`
        };
      }

      const providers: string[] = [];
      const profile = this.profileStore.create(profileName);

      // Read Claude settings.json file
      const os = await import('node:os');
      const path = await import('node:path');
      const fs = await import('node:fs');
      
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      
      if (!await this.fileExists(settingsPath)) {
        return {
          success: false,
          error: 'Claude settings.json file not found'
        };
      }

      const settingsContent = await fs.promises.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);

      // Check for API key in env section
      if (settings.env && settings.env.ANTHROPIC_AUTH_TOKEN) {
        const claudeToken = settings.env.ANTHROPIC_AUTH_TOKEN;
        const baseUrl = settings.env.ANTHROPIC_BASE_URL;
        
        // Create credential data with optional base URL
        const credentialData: any = {
          apiKey: claudeToken
        };
        
        if (baseUrl) {
          credentialData.baseUrl = baseUrl;
          console.log(`✓ Using custom base URL: ${baseUrl}`);
        }
        
        // Save credential data to managed storage
        await this.credentialManager.saveCredentialData('claude', profileName, credentialData);
        
        // Set profile auth info
        this.profileStore.setProviderAuth(profileName, 'claude', {
          credentialSource: 'managed',
          lastAuth: Date.now(),
        });
        
        providers.push('claude');
        console.log(`✓ Configured Claude with API key from settings.json`);
      }

      if (providers.length === 0) {
        return {
          success: false,
          error: 'No supported API keys found in settings.json'
        };
      }

      return {
        success: true,
        providers
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const fs = await import('node:fs');
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create profile from environment variable
   * Now stores the environment variable value in managed storage
   */
  async createProfileFromEnv(envVar: string, profileName?: string): Promise<{
    success: boolean;
    profileName: string;
    providerId: string;
    apiKey: string;
    error?: string;
  }> {
    // Validate environment variable exists
    const apiKey = process.env[envVar];
    if (!apiKey) {
      return {
        success: false,
        profileName: '',
        providerId: '',
        apiKey: '',
        error: `Environment variable ${envVar} is not set`
      };
    }

    // Determine provider
    const providerId = this.getProviderFromEnvVar(envVar);
    if (!providerId) {
      return {
        success: false,
        profileName: '',
        providerId: '',
        apiKey: '',
        error: `Unknown environment variable: ${envVar}`
      };
    }

    // Generate profile name
    let finalProfileName = profileName;
    if (!finalProfileName) {
      const baseName = providerId;
      let counter = 1;
      finalProfileName = baseName;
      while (this.profileStore.exists(finalProfileName)) {
        finalProfileName = `${baseName}-${counter}`;
        counter++;
      }
    }

    if (this.profileStore.exists(finalProfileName)) {
      return {
        success: false,
        profileName: finalProfileName,
        providerId,
        apiKey,
        error: `Profile '${finalProfileName}' already exists`
      };
    }

    // Create profile
    this.profileStore.create(finalProfileName);
    
    // Store the environment variable value in managed storage
    await this.credentialManager.saveEnvVar(providerId, finalProfileName, envVar, apiKey);
    
    // Set profile to use managed credentials
    this.profileStore.setProviderAuth(finalProfileName, providerId, {
      credentialSource: 'managed',
      lastAuth: Date.now(),
    });

    return {
      success: true,
      profileName: finalProfileName,
      providerId,
      apiKey
    };
  }

  /**
   * Detect available environment variables
   */
  detectAvailableEnvVars(): string[] {
    const envVars = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'GOOGLE_API_KEY',
      'OPENAI_API_KEY',
      'AZURE_OPENAI_API_KEY',
      'GEMINI_API_KEY'
    ];
    return envVars.filter(envVar => process.env[envVar]);
  }

  /**
   * Get provider from environment variable
   */
  private getProviderFromEnvVar(envVar: string): string | null {
    const mapping: Record<string, string> = {
      'ANTHROPIC_API_KEY': 'claude',
      'ANTHROPIC_AUTH_TOKEN': 'claude',
      'GOOGLE_API_KEY': 'gemini',
      'GEMINI_API_KEY': 'gemini',
      'OPENAI_API_KEY': 'codex',
      'AZURE_OPENAI_API_KEY': 'codex'
    };
    return mapping[envVar] || null;
  }

  /**
   * Migrate existing environment variable profiles to managed storage
   */
  async migrateEnvProfilesToManaged(): Promise<void> {
    const profiles = this.profileStore.list();
    
    for (const profile of profiles) {
      for (const [providerId, authInfo] of Object.entries(profile.providers)) {
        if (authInfo.credentialSource === 'env') {
          // This profile uses environment variables, migrate to managed storage
          const envVars = this.getProviderEnvVars(providerId);
          
          for (const envVar of envVars) {
            const value = process.env[envVar];
            if (value) {
              // Store the environment variable value in managed storage
              await this.credentialManager.saveEnvVar(providerId, profile.name, envVar, value);
              
              // Update profile to use managed credentials
              this.profileStore.setProviderAuth(profile.name, providerId, {
                credentialSource: 'managed',
                lastAuth: authInfo.lastAuth || Date.now(),
              });
              
              console.log(`✓ Migrated ${profile.name}/${providerId} from env to managed storage`);
              break; // Only migrate the first available environment variable
            }
          }
        }
      }
    }
  }

  /**
   * Migrate native OAuth credentials to managed storage
   */
  async migrateNativeCredentialsToManaged(): Promise<void> {
    const profiles = this.profileStore.list();
    
    for (const profile of profiles) {
      for (const [providerId, authInfo] of Object.entries(profile.providers)) {
        if (authInfo.credentialSource === 'native') {
          try {
            // Try to copy native credentials to managed storage
            await this.credentialManager.copyNativeToManaged(providerId, profile.name);
            
            // Update profile to use managed credentials
            this.profileStore.setProviderAuth(profile.name, providerId, {
              credentialSource: 'managed',
              lastAuth: authInfo.lastAuth || Date.now(),
            });
            
            console.log(`✓ Migrated ${profile.name}/${providerId} from native to managed storage`);
          } catch (error) {
            console.log(`⚠️  Could not migrate ${profile.name}/${providerId}: ${error instanceof Error ? error.message : String(error)}`);
            console.log(`   You may need to re-login for this profile`);
          }
        }
      }
    }
  }
}




