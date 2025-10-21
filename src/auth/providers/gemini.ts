/**
 * Gemini Provider Authentication
 *
 * Supports:
 * - OAuth via `gemini` CLI (automatic on first run)
 * - Native credential detection from ~/.gemini/oauth_creds.json
 */

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ProviderAuthenticator, AuthOption, CredentialInfo } from './base.js';

import type { ProviderDependencies } from './dependencies.js';
import { createDefaultProviderDependencies } from './dependencies.js';
let geminiHomeOverride: string | null = null;

export function setGeminiHomeDirOverride(dir: string | null): void {
  geminiHomeOverride = dir;
}

export class GeminiAuthenticator implements ProviderAuthenticator {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  private readonly dependencies: ProviderDependencies;

  constructor(dependencies: ProviderDependencies = createDefaultProviderDependencies()) {
    this.dependencies = dependencies;
  }

  private getGeminiHomeDir(): string {
    if (geminiHomeOverride) {
      return geminiHomeOverride;
    }
    return process.env.GEMINI_HOME_DIR ?? process.env.UNYCODING_GEMINI_HOME ?? homedir();
  }

  async getAuthOptions(profileName: string): Promise<AuthOption[]> {
    const options: AuthOption[] = [];

    // Check for existing credentials (both native and managed)
    const credInfo = await this.checkAuth(profileName);
    if (credInfo.valid) {
      options.push({
        id: 'use-existing',
        label: 'Use existing credentials',
        description: `Already authenticated (expires: ${credInfo.expiresAt ? new Date(credInfo.expiresAt).toLocaleString() : 'unknown'})`,
      });
    }

    // OAuth login option (automatic on first gemini run)
    options.push({
      id: 'oauth',
      label: 'Browser login (OAuth)',
      description: 'Gemini CLI will open browser automatically',
    });

    // GEMINI_API_KEY login option
    options.push({
      id: 'gemini-api-key',
      label: 'GEMINI_API_KEY login',
      description: 'Enter GEMINI_API_KEY manually',
    });

    // Vertex AI login option
    options.push({
      id: 'vertex-ai',
      label: 'Vertex AI login',
      description: 'Enter GOOGLE_API_KEY with Vertex AI configuration',
    });

    return options;
  }

  async authenticate(optionId: string, profileName: string): Promise<void> {
    switch (optionId) {
      case 'use-existing':
        console.log('Using existing Gemini credentials');
        await this.saveCredentialToProfile(profileName);
        break;

      case 'oauth':
        await this.executeOAuthLogin();
        await this.saveCredentialToProfile(profileName);
        break;

      case 'gemini-api-key':
        await this.executeGeminiApiKeyLogin(profileName);
        break;

      case 'vertex-ai':
        await this.executeVertexAiLogin(profileName);
        break;

      default:
        throw new Error(`Unknown auth option: ${optionId}`);
    }
  }

  async checkAuth(profileName: string): Promise<CredentialInfo> {
    // First check managed credentials
    try {
      const credentialManager = this.dependencies.credentialManager;
      await credentialManager.initialize();
      
      const managedCredInfo = await credentialManager.getCredentialInfo('gemini', profileName);
      if (managedCredInfo) {
        // Convert CredentialManager's CredentialInfo to base CredentialInfo
        const isValid = credentialManager.isCredentialValid(managedCredInfo);
        return {
          source: managedCredInfo.source,
          path: managedCredInfo.path,
          envVar: managedCredInfo.envVar,
          expiresAt: managedCredInfo.expiresAt,
          valid: isValid,
        };
      }
    } catch (error) {
      // Ignore managed credential errors, fall back to native
    }

    // Fall back to native credentials
    const credPath = join(this.getGeminiHomeDir(), '.gemini', 'oauth_creds.json');

    if (!existsSync(credPath)) {
      return {
        source: 'native',
        valid: false,
      };
    }

    try {
      const content = readFileSync(credPath, 'utf-8');
      const creds = JSON.parse(content);

      // Check expiry_date field
      const expiresAt = creds.expiry_date;
      const valid = expiresAt ? Date.now() < expiresAt : false;

      return {
        source: 'native',
        path: credPath,
        expiresAt: expiresAt,
        valid,
      };
    } catch (error) {
      return {
        source: 'native',
        path: credPath,
        valid: false,
      };
    }
  }

  async logout(profileName: string): Promise<void> {
    const credPath = join(this.getGeminiHomeDir(), '.gemini', 'oauth_creds.json');
    console.log(`To logout from Gemini, delete: ${credPath}`);
    console.log('Note: This will affect all profiles using Gemini');
  }

  /**
   * Apply credentials for Gemini profile
   * This method handles the specific logic for Gemini credential application
   */
  async applyCredentials(profileName: string, credentialData?: any): Promise<{ needsRestart: boolean }> {
    let data = credentialData;
    
    // If no credential data provided, try to get it from managed storage
    if (!data) {
      const credentialManager = this.dependencies.credentialManager;
      await credentialManager.initialize();
      
      const credInfo = await credentialManager.getCredentialInfo('gemini', profileName);
      if (!credInfo) {
        throw new Error(`No credentials found for profile: ${profileName}`);
      }

      if (!credentialManager.isCredentialValid(credInfo)) {
        throw new Error(`Credentials for profile ${profileName} have expired. Please re-login.`);
      }

      // Handle based on credential source
      if (credInfo.source === 'managed') {
        data = JSON.parse(await (await import('node:fs')).promises.readFile(credInfo.path!, 'utf-8'));
      } else if (credInfo.source === 'native') {
        // Native credentials are already in place
        return { needsRestart: false };
      }
    }

    let needsRestart = false;

    // Check if this is an API key credential
    if (data.apiKey) {
      // For API key: write to config file
      await this.applyApiKeyToConfig(profileName, data);
      needsRestart = true;
    } else {
      // For OAuth: copy to native location
      await this.applyOAuthToNative(profileName, data);
      needsRestart = true;
    }

    return { needsRestart };
  }

  /**
   * Apply API key to .env file
   */
  private async applyApiKeyToConfig(profileName: string, data: any): Promise<void> {
    const path = await import('node:path');
    const fs = await import('node:fs');
    
    // Write API key to ~/.gemini/.env
    const envPath = path.join(this.getGeminiHomeDir(), '.gemini', '.env');
    
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(envPath), { recursive: true, mode: 0o700 });
    
    // Read existing .env file if it exists
    let envContent = '';
    if (await this.fileExists(envPath)) {
      envContent = await fs.promises.readFile(envPath, 'utf-8');
    }
    
    // Parse existing environment variables
    const envVars: Record<string, string> = {};
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const equalIndex = trimmedLine.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmedLine.substring(0, equalIndex).trim();
          const value = trimmedLine.substring(equalIndex + 1).trim();
          envVars[key] = value;
        }
      }
    }
    
    // Clear existing API key configurations first
    delete envVars['GOOGLE_API_KEY'];
    delete envVars['GEMINI_API_KEY'];
    delete envVars['GOOGLE_CLOUD_PROJECT'];
    delete envVars['GOOGLE_CLOUD_LOCATION'];

    for (const key of Object.keys(envVars)) {
      if (key !== 'GEMINI_API_KEY' && key.endsWith('GEMINI_API_KEY')) {
        delete envVars[key];
      }
    }

    // Update environment variables based on API key type
    if (data.apiKeyType === 'gemini') {
      // For GEMINI_API_KEY, use GEMINI_API_KEY environment variable
      envVars['GEMINI_API_KEY'] = data.apiKey;
    } else if (data.apiKeyType === 'vertex' || data.useVertexAi) {
      // For Vertex AI, use GOOGLE_API_KEY and related variables
      envVars['GOOGLE_API_KEY'] = data.apiKey;
      if (data.projectId) {
        envVars['GOOGLE_CLOUD_PROJECT'] = data.projectId;
      }
      if (data.location) {
        envVars['GOOGLE_CLOUD_LOCATION'] = data.location;
      }
    } else {
      // Default to GOOGLE_API_KEY for backward compatibility
      envVars['GOOGLE_API_KEY'] = data.apiKey;
    }
    
    // Write updated .env file
    const newEnvContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';

    await fs.promises.writeFile(envPath, newEnvContent, { mode: 0o600 });
    console.log('✓ Applied API key to ~/.gemini/.env');
    
    // Update settings.json to change authentication type
    await this.updateSettingsForAuthType(data.apiKeyType);
  }

  /**
   * Update settings.json to change authentication type
   */
  private async updateSettingsForAuthType(apiKeyType?: string): Promise<void> {
    const path = await import('node:path');
    const fs = await import('node:fs');
    
    const settingsPath = path.join(this.getGeminiHomeDir(), '.gemini', 'settings.json');
    
    // Read existing settings
    let settings: any = {};
    if (await this.fileExists(settingsPath)) {
      const content = await fs.promises.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }
    
    // Ensure security.auth structure exists
    if (!settings.security) {
      settings.security = {};
    }
    if (!settings.security.auth) {
      settings.security.auth = {};
    }
    
    // Set the appropriate authentication type
    if (apiKeyType === 'gemini') {
      settings.security.auth.selectedType = 'gemini-api-key';
    } else if (apiKeyType === 'vertex') {
      settings.security.auth.selectedType = 'vertex-ai';
    } else {
      // Default to gemini-api-key for any API key authentication
      settings.security.auth.selectedType = 'gemini-api-key';
    }
    
    // Write updated settings
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    console.log('✓ Updated authentication type in ~/.gemini/settings.json');
  }

  /**
   * Apply OAuth to native location
   */
  private async applyOAuthToNative(profileName: string, data: any): Promise<void> {
    const path = await import('node:path');
    const fs = await import('node:fs');
    
    // Write OAuth to ~/.gemini/oauth_creds.json
    const credentialsPath = path.join(this.getGeminiHomeDir(), '.gemini', 'oauth_creds.json');
    
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });
    
    // Write OAuth data
    await fs.promises.writeFile(credentialsPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    console.log('✓ Applied OAuth credentials to ~/.gemini/oauth_creds.json');
    
    // Update google_accounts.json with the current account
    await this.updateGoogleAccounts(data);
    
    // Clean API key from config file
    await this.cleanApiKeyFromConfig();
    
    // Update settings.json to use OAuth authentication
    await this.updateSettingsForOAuth();
  }

  /**
   * Update settings.json to use OAuth authentication
   */
  private async updateSettingsForOAuth(): Promise<void> {
    const path = await import('node:path');
    const fs = await import('node:fs');
    
    const settingsPath = path.join(this.getGeminiHomeDir(), '.gemini', 'settings.json');
    
    // Read existing settings
    let settings: any = {};
    if (await this.fileExists(settingsPath)) {
      const content = await fs.promises.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }
    
    // Ensure security.auth structure exists
    if (!settings.security) {
      settings.security = {};
    }
    if (!settings.security.auth) {
      settings.security.auth = {};
    }
    
    // Set to OAuth authentication type
    settings.security.auth.selectedType = 'oauth-personal';
    
    // Write updated settings
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    console.log('✓ Updated authentication type to OAuth in ~/.gemini/settings.json');
  }

  /**
   * Update google_accounts.json with the current account
   */
  private async updateGoogleAccounts(oauthData: any): Promise<void> {
    const path = await import('node:path');
    const fs = await import('node:fs');
    
    const accountsPath = path.join(this.getGeminiHomeDir(), '.gemini', 'google_accounts.json');
    
    try {
      // Extract email from id_token
      const payload = JSON.parse(Buffer.from(oauthData.id_token.split('.')[1], 'base64').toString());
      const currentEmail = payload.email;
      
      // Read existing accounts file
      let accountsData: any = { active: '', old: [] };
      if (await this.fileExists(accountsPath)) {
        const content = await fs.promises.readFile(accountsPath, 'utf-8');
        accountsData = JSON.parse(content);
      }
      
      // Update active account
      const previousActive = accountsData.active;
      accountsData.active = currentEmail;
      
      // Move previous active to old if it's different and not already in old
      if (previousActive && previousActive !== currentEmail && !accountsData.old.includes(previousActive)) {
        accountsData.old.push(previousActive);
      }
      
      // Write updated accounts file
      await fs.promises.writeFile(accountsPath, JSON.stringify(accountsData, null, 2), { mode: 0o600 });
      console.log(`✓ Updated active account to: ${currentEmail}`);
    } catch (error) {
      console.log('⚠️  Warning: Could not update google_accounts.json');
    }
  }

  /**
   * Clean API key from .env file
   */
  private async cleanApiKeyFromConfig(): Promise<void> {
    const path = await import('node:path');
    const fs = await import('node:fs');
    
    const envPath = path.join(this.getGeminiHomeDir(), '.gemini', '.env');
    
    if (await this.fileExists(envPath)) {
      const content = await fs.promises.readFile(envPath, 'utf-8');
      
      // Parse existing environment variables
      const envVars: Record<string, string> = {};
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const equalIndex = trimmedLine.indexOf('=');
          if (equalIndex > 0) {
            const key = trimmedLine.substring(0, equalIndex).trim();
            const value = trimmedLine.substring(equalIndex + 1).trim();
            envVars[key] = value;
          }
        }
      }
      
      // Remove API key and Vertex AI related variables
      delete envVars['GOOGLE_API_KEY'];
      delete envVars['GEMINI_API_KEY'];
      delete envVars['GOOGLE_CLOUD_PROJECT'];
      delete envVars['GOOGLE_CLOUD_LOCATION'];
      
      // If no environment variables left, remove the file
      if (Object.keys(envVars).length === 0) {
        await fs.promises.unlink(envPath);
        console.log('✓ Cleaned API key from ~/.gemini/.env');
      } else {
        // Write updated .env file
        const newEnvContent = Object.entries(envVars)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n') + '\n';
        await fs.promises.writeFile(envPath, newEnvContent, { mode: 0o600 });
        console.log('✓ Cleaned API key from ~/.gemini/.env');
      }
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

  private async executeGeminiApiKeyLogin(profileName: string): Promise<void> {
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\n📝 Enter GEMINI_API_KEY:');
      console.log('   (This will be saved securely to managed credentials)\n');

      const apiKey = await new Promise<string>((resolve) => {
        rl.question('GEMINI_API_KEY: ', (answer) => {
          resolve(answer);
        });
      });
      const trimmed = apiKey.trim();

      if (!trimmed) {
        throw new Error('GEMINI_API_KEY cannot be empty');
      }

      // Validate API key format (Google API keys typically start with AIza)
      if (!trimmed.startsWith('AIza')) {
        console.log('⚠️  Warning: API key format may be incorrect');
        console.log('   Google API keys typically start with "AIza"');
      }

      // Save to managed credentials
      const credentialManager = this.dependencies.credentialManager;
      await credentialManager.initialize();
      
      // Create credential data for GEMINI_API_KEY
      const credentialData = {
        apiKey: trimmed,
        apiKeyType: 'gemini'
      };

      // Save the credential data
      await credentialManager.saveCredentialData('gemini', profileName, credentialData);

      // Update profile
      const profileStore = this.dependencies.getProfileStore();
      profileStore.setProviderAuth(profileName, 'gemini', {
        credentialSource: 'managed',
        lastAuth: Date.now(),
      });

      console.log('\n✓ GEMINI_API_KEY saved successfully!');
    } finally {
      rl.close();
    }
  }

  private async executeVertexAiLogin(profileName: string): Promise<void> {
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\n📝 Enter GOOGLE_API_KEY for Vertex AI:');
      console.log('   (This will be saved securely to managed credentials)\n');

      const apiKey = await new Promise<string>((resolve) => {
        rl.question('GOOGLE_API_KEY: ', (answer) => {
          resolve(answer);
        });
      });
      const trimmed = apiKey.trim();

      if (!trimmed) {
        throw new Error('GOOGLE_API_KEY cannot be empty');
      }

      // Validate API key format (Google API keys typically start with AIza)
      if (!trimmed.startsWith('AIza')) {
        console.log('⚠️  Warning: API key format may be incorrect');
        console.log('   Google API keys typically start with "AIza"');
      }

      const projectId = await new Promise<string>((resolve) => {
        rl.question('\nGoogle Cloud Project ID: ', (answer) => {
          resolve(answer);
        });
      });
      if (!projectId.trim()) {
        throw new Error('Google Cloud Project ID is required for Vertex AI');
      }

      const location = await new Promise<string>((resolve) => {
        rl.question('Google Cloud Location (e.g., us-central1): ', (answer) => {
          resolve(answer);
        });
      });
      if (!location.trim()) {
        throw new Error('Google Cloud Location is required for Vertex AI');
      }

      // Save to managed credentials
      const credentialManager = this.dependencies.credentialManager;
      await credentialManager.initialize();
      
      // Create credential data for Vertex AI
      const credentialData = {
        apiKey: trimmed,
        projectId: projectId.trim(),
        location: location.trim(),
        useVertexAi: true,
        apiKeyType: 'vertex'
      };

      // Save the credential data
      await credentialManager.saveCredentialData('gemini', profileName, credentialData);

      // Update profile
      const profileStore = this.dependencies.getProfileStore();
      profileStore.setProviderAuth(profileName, 'gemini', {
        credentialSource: 'managed',
        lastAuth: Date.now(),
      });

      console.log('\n✓ Vertex AI configuration saved successfully!');
    } finally {
      rl.close();
    }
  }

  private async saveCredentialToProfile(profileName: string): Promise<void> {
    const credentialsPath = join(this.getGeminiHomeDir(), '.gemini', 'oauth_creds.json');

    try {
      await this.waitForOAuthCredentialFile(credentialsPath);

      const credentialManager = this.dependencies.credentialManager;
      await credentialManager.initialize();

      await credentialManager.copyNativeToManaged('gemini', profileName);

      const profileStore = this.dependencies.getProfileStore();
      profileStore.setProviderAuth(profileName, 'gemini', {
        credentialSource: 'managed',
        lastAuth: Date.now(),
      });
      console.log('Credentials saved to managed storage');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('Warning: ' + message);
      throw new Error('Failed to save Gemini OAuth credentials. Please complete the browser login and try again.');
    }
  }

  private async waitForOAuthCredentialFile(credentialsPath: string, timeoutMs = 30000, pollMs = 500): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (await this.fileExists(credentialsPath)) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error('OAuth credentials not found at ' + credentialsPath + '. Please finish the browser login and retry.');
  }

  private async executeOAuthLogin(): Promise<void> {
    console.log('\nGemini CLI will open browser for authentication...');
    console.log('Clearing cached credentials to force new OAuth flow...\n');

    // First, try to clear cached credentials
    await this.clearCachedCredentials();

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'gemini.cmd' : 'gemini';

      // Run a simple query to trigger OAuth if needed
      const child = spawn(command, ['hello'], {
        stdio: 'inherit',
        shell: isWindows,
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute gemini: ${error.message}`));
      });

      child.on('exit', (code) => {
        if (code === 0) {
          console.log('\n✓ Authentication completed!');
          resolve();
        } else {
          // Even if query fails, OAuth might have succeeded
          console.log('\nNote: If browser opened and you authenticated, that\'s all you need.');
          resolve();
        }
      });
    });
  }

  private async clearCachedCredentials(): Promise<void> {
    const path = await import('node:path');
    const fs = await import('node:fs');

    // Clear OAuth credentials
    const oauthPath = path.join(this.getGeminiHomeDir(), '.gemini', 'oauth_creds.json');
    if (await this.fileExists(oauthPath)) {
      await fs.promises.unlink(oauthPath);
      console.log('✓ Cleared cached OAuth credentials');
    }

    // Clear .env file API key
    const envPath = path.join(this.getGeminiHomeDir(), '.gemini', '.env');
    if (await this.fileExists(envPath)) {
      const content = await fs.promises.readFile(envPath, 'utf-8');
      
      // Parse existing environment variables
      const envVars: Record<string, string> = {};
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const equalIndex = trimmedLine.indexOf('=');
          if (equalIndex > 0) {
            const key = trimmedLine.substring(0, equalIndex).trim();
            const value = trimmedLine.substring(equalIndex + 1).trim();
            envVars[key] = value;
          }
        }
      }
      
      // Remove API key and Vertex AI related variables
      const hasApiKey = envVars['GOOGLE_API_KEY'] || envVars['GEMINI_API_KEY'] || envVars['GOOGLE_CLOUD_PROJECT'] || envVars['GOOGLE_CLOUD_LOCATION'];
      if (hasApiKey) {
        delete envVars['GOOGLE_API_KEY'];
        delete envVars['GEMINI_API_KEY'];
        delete envVars['GOOGLE_CLOUD_PROJECT'];
        delete envVars['GOOGLE_CLOUD_LOCATION'];
        
        // If no environment variables left, remove the file
        if (Object.keys(envVars).length === 0) {
          await fs.promises.unlink(envPath);
        } else {
          // Write updated .env file
          const newEnvContent = Object.entries(envVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + '\n';
          await fs.promises.writeFile(envPath, newEnvContent, { mode: 0o600 });
        }
        console.log('✓ Cleared cached API key from .env');
      }
    }

    // Ensure the Gemini CLI will trigger OAuth rather than Vertex AI on the next launch
    await this.updateSettingsForOAuth();
  }
}

