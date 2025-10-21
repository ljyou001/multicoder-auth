/**
 * Claude Provider Authentication
 *
 * Supports:
 * - OAuth browser login via `claude login`
 * - Native credential detection from ~/.claude/
 */

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ProviderAuthenticator, AuthOption, CredentialInfo } from './base.js';

import type { ProviderDependencies } from './dependencies.js';
import { createDefaultProviderDependencies } from './dependencies.js';
export class ClaudeAuthenticator implements ProviderAuthenticator {
  readonly id = 'claude';
  readonly name = 'Anthropic Claude';
  private readonly dependencies: ProviderDependencies;

  constructor(dependencies: ProviderDependencies = createDefaultProviderDependencies()) {
    this.dependencies = dependencies;
  }

  async getAuthOptions(profileName: string): Promise<AuthOption[]> {
    const options: AuthOption[] = [];

    // Check for existing native credentials
    const credInfo = await this.checkAuth(profileName);
    if (credInfo.valid) {
      options.push({
        id: 'use-existing',
        label: 'Use existing credentials',
        description: 'Already authenticated with Claude',
      });
    }

    // API Key login option
    options.push({
      id: 'api-key',
      label: 'API Key login',
      description: 'Enter API key manually',
    });

    // OAuth login option
    options.push({
      id: 'oauth',
      label: 'Browser login (OAuth)',
      description: 'Open browser to authenticate with Claude',
    });

    return options;
  }

  async authenticate(optionId: string, profileName: string): Promise<void> {
    switch (optionId) {
      case 'use-existing':
        console.log('Using existing Claude credentials');
        // Still save to profile to mark as authenticated
        await this.saveCredentialToProfile(profileName);
        break;

      case 'api-key':
        await this.executeApiKeyLogin(profileName);
        break;

      case 'oauth':
        await this.executeOAuthLogin();

        // Verify credentials were created
        const credPath = join(homedir(), '.claude', '.credentials.json');
        if (!existsSync(credPath)) {
          throw new Error('Authentication failed: credentials file not found. Please try again.');
        }

        // Save credential info to profile after successful login
        await this.saveCredentialToProfile(profileName);

        // Double-check that credentials are valid
        const credInfo = await this.checkAuth(profileName);
        if (!credInfo.valid) {
          throw new Error('Authentication failed: credentials are invalid. Please try again.');
        }
        break;

      default:
        throw new Error(`Unknown auth option: ${optionId}`);
    }
  }

  private async saveCredentialToProfile(profileName: string): Promise<void> {
    const profileStore = this.dependencies.getProfileStore();
    const credPath = join(homedir(), '.claude', '.credentials.json');

    // Read credentials directly without triggering checkAuth to avoid recursion
    const credInfo = this.readCredentialFile();

    if (credInfo.valid) {
      try {
        // Try to copy to managed storage first
        const credentialManager = this.dependencies.credentialManager;
        await credentialManager.initialize();
        await credentialManager.copyNativeToManaged(this.id, profileName);
        
        // Save credential info to profile with managed source
        profileStore.setProviderAuth(profileName, this.id, {
          credentialSource: 'managed',
          credentialPath: credentialManager.getManagedCredentialPath(this.id, profileName),
          lastAuth: Date.now(),
          expiresAt: credInfo.expiresAt,
        });
      } catch (error) {
        // Fallback to native storage if managed storage fails
        console.warn(`Could not save to managed storage: ${error instanceof Error ? error.message : String(error)}`);
        profileStore.setProviderAuth(profileName, this.id, {
          credentialSource: 'native',
          credentialPath: credPath,
          lastAuth: Date.now(),
          expiresAt: credInfo.expiresAt,
        });
      }
    }
  }

  /**
   * Internal method to read credential file without triggering profile save
   * This prevents infinite recursion between checkAuth and saveCredentialToProfile
   */
  private readCredentialFile(): CredentialInfo {
    const credPath = join(homedir(), '.claude', '.credentials.json');

    if (existsSync(credPath)) {
      try {
        const content = readFileSync(credPath, 'utf-8');
        const creds = JSON.parse(content);

        // Check if credentials exist and have a token
        // Claude Code 2.0+ stores: { claudeAiOauth: { accessToken, refreshToken, expiresAt } }
        const oauth = creds.claudeAiOauth;
        const hasToken = oauth?.accessToken || oauth?.refreshToken;

        if (hasToken) {
          // Check expiry if present
          const expiresAt = oauth?.expiresAt;
          const valid = expiresAt ? Date.now() < expiresAt : true;

          return {
            source: 'native',
            path: credPath,
            expiresAt: expiresAt,
            valid,
          };
        }
      } catch (error) {
        // Failed to parse or read credentials
        return {
          source: 'native',
          valid: false,
        };
      }
    }

    // No valid credentials found
    return {
      source: 'native',
      valid: false,
    };
  }

  async checkAuth(profileName: string): Promise<CredentialInfo> {
    // First check if we have saved auth info in profile
    const profileStore = this.dependencies.getProfileStore();
    const savedAuth = profileStore.getProviderAuth(profileName, this.id);

    // Check environment variables first
    const envVars = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        return {
          source: 'env',
          envVar: envVar,
          valid: true,
        };
      }
    }

    // Read credential file
    const credInfo = this.readCredentialFile();

    // If valid but not saved in profile, save it now
    if (credInfo.valid && !savedAuth) {
      await this.saveCredentialToProfile(profileName);
    }

    return credInfo;
  }

  async logout(profileName: string): Promise<void> {
    console.log('To logout from Claude, run: claude logout');
    console.log('Note: This will affect all profiles using Claude');
  }

  /**
   * Apply credentials for Claude profile
   * This method handles the specific logic for Claude credential application
   */
  async applyCredentials(profileName: string): Promise<{ needsRestart: boolean }> {
    const credentialManager = this.dependencies.credentialManager;
    await credentialManager.initialize();

    const credInfo = await credentialManager.getCredentialInfo('claude', profileName);
    if (!credInfo) {
      throw new Error(`No credentials found for profile: ${profileName}`);
    }

    if (!credentialManager.isCredentialValid(credInfo)) {
      throw new Error(`Credentials for profile ${profileName} have expired. Please re-login.`);
    }

    let needsRestart = false;

    // Handle based on credential source
    if (credInfo.source === 'managed') {
      const data = JSON.parse(await (await import('node:fs')).promises.readFile(credInfo.path!, 'utf-8'));
      
      // Check if this is an API key credential
      if (data.apiKey) {
        // For API key: write to settings.json, clean .credentials.json
        await this.applyApiKeyToSettings(profileName, data);
        needsRestart = true;
      } else if (data.claudeAiOauth) {
        // For OAuth: write to .credentials.json, clean settings.json
        await this.applyOAuthToCredentials(profileName, data);
        needsRestart = true;
      }
    } else if (credInfo.source === 'native') {
      // Native credentials are already in place
      // No action needed
    }

    return { needsRestart };
  }

  /**
   * Apply API key to settings.json and clean .credentials.json
   */
  private async applyApiKeyToSettings(profileName: string, data: any): Promise<void> {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    
    // Update settings.json
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    await this.updateSettingsJson(settingsPath, data.apiKey, data.baseUrl);
    
    // Clean .credentials.json
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    await this.cleanCredentialsJson(credentialsPath);
  }

  /**
   * Apply OAuth to .credentials.json and clean settings.json
   */
  private async applyOAuthToCredentials(profileName: string, data: any): Promise<void> {
    const os = await import('node:os');
    const path = await import('node:path');
    
    // Write OAuth to .credentials.json
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    await this.writeOAuthToCredentials(credentialsPath, data.claudeAiOauth);
    
    // Clean settings.json env section
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    await this.cleanSettingsJson(settingsPath);
  }

  /**
   * Update settings.json with API key and base URL
   */
  private async updateSettingsJson(settingsPath: string, apiKey: string, baseUrl?: string): Promise<void> {
    const fs = await import('node:fs');
    let settings: any = {};
    
    // Read existing settings if file exists
    if (await this.fileExists(settingsPath)) {
      const content = await fs.promises.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }
    
    // Ensure env section exists
    if (!settings.env) {
      settings.env = {};
    }
    
    // Update API key and base URL
    settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
    if (baseUrl) {
      settings.env.ANTHROPIC_BASE_URL = baseUrl;
    }
    
    // Write updated settings
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  }

  /**
   * Clean .credentials.json file
   */
  private async cleanCredentialsJson(credentialsPath: string): Promise<void> {
    const fs = await import('node:fs');
    if (await this.fileExists(credentialsPath)) {
      // Backup existing file
      const backupPath = `${credentialsPath}.backup.${Date.now()}`;
      await fs.promises.copyFile(credentialsPath, backupPath);
      
      // Remove the file
      await fs.promises.unlink(credentialsPath);
    }
  }

  /**
   * Write OAuth data to .credentials.json
   */
  private async writeOAuthToCredentials(credentialsPath: string, oauthData: any): Promise<void> {
    const fs = await import('node:fs');
    // Backup existing file if it exists
    if (await this.fileExists(credentialsPath)) {
      const backupPath = `${credentialsPath}.backup.${Date.now()}`;
      await fs.promises.copyFile(credentialsPath, backupPath);
    }
    
    // Write OAuth data
    const credentialData = {
      claudeAiOauth: oauthData
    };
    
    await fs.promises.writeFile(credentialsPath, JSON.stringify(credentialData, null, 2), { mode: 0o600 });
  }

  /**
   * Clean settings.json env section
   */
  private async cleanSettingsJson(settingsPath: string): Promise<void> {
    const fs = await import('node:fs');
    if (await this.fileExists(settingsPath)) {
      const content = await fs.promises.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      
      // Remove API key related env vars
      if (settings.env) {
        delete settings.env.ANTHROPIC_AUTH_TOKEN;
        delete settings.env.ANTHROPIC_BASE_URL;
        
        // If env section is empty, remove it
        if (Object.keys(settings.env).length === 0) {
          delete settings.env;
        }
      }
      
      // Write updated settings
      await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
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

  private async executeOAuthLogin(): Promise<void> {
    console.log('\nSetting up Claude authentication token...');
    console.log('This will open your browser to authenticate with Claude.');
    console.log('After authenticating in your browser, you can close the Claude CLI.\n');

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'claude.cmd' : 'claude';

      // Use setup-token command for Claude Code 2.0+
      const child = spawn(command, ['setup-token'], {
        stdio: 'inherit',
        shell: isWindows,
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute claude setup-token: ${error.message}`));
      });

      child.on('exit', (code) => {
        // Always resolve - user may have authenticated successfully even if they exited
        // We'll verify credentials exist in the next step
        console.log('\n✓ Claude setup-token completed');
        resolve();
      });
    });
  }

  /**
   * Execute API Key login flow
   */
  private async executeApiKeyLogin(profileName: string): Promise<void> {
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\n📝 Enter API Key for Claude:');
      console.log('   (This will be saved securely to managed credentials)\n');

      const apiKey = await new Promise<string>((resolve) => {
        rl.question('API Key: ', (answer) => {
          resolve(answer);
        });
      });
      const trimmed = apiKey.trim();

      if (!trimmed) {
        throw new Error('API Key cannot be empty');
      }

      // Validate API key format
      if (!trimmed.startsWith('sk-ant-') && !trimmed.startsWith('sk-')) {
        console.log('⚠️  Warning: API key format may be incorrect');
        console.log('   Claude API keys typically start with "sk-ant-" or "sk-"');
      }

      // Ask for optional base URL
      console.log('\n🌐 Base URL (optional):');
      console.log('   Leave empty to use default Anthropic API endpoint\n');

      const baseUrl = await new Promise<string>((resolve) => {
        rl.question('Base URL (optional): ', (answer) => {
          resolve(answer);
        });
      });
      const trimmedBaseUrl = baseUrl.trim();

      // Save to managed credentials with optional base URL
      const credentialManager = this.dependencies.credentialManager;
      await credentialManager.initialize();
      
      // Create credential data with optional base URL
      const credentialData: any = {
        apiKey: trimmed
      };
      
      if (trimmedBaseUrl) {
        credentialData.baseUrl = trimmedBaseUrl;
        console.log(`✓ Using custom base URL: ${trimmedBaseUrl}`);
      }

      // Save the credential data
      await credentialManager.saveCredentialData('claude', profileName, credentialData);

      // Update profile
      const profileStore = this.dependencies.getProfileStore();
      profileStore.setProviderAuth(profileName, 'claude', {
        credentialSource: 'managed',
        lastAuth: Date.now(),
      });

      console.log('\n✓ API Key saved successfully!');
    } finally {
      rl.close();
    }
  }
}


