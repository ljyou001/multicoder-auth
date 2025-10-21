/**
 * Codex Provider Authentication
 *
 * Supports:
 * - OAuth browser login via `codex login`
 * - Native credential detection from ~/.codex/
 */

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ProviderAuthenticator, AuthOption, CredentialInfo } from './base.js';
import type { ProviderDependencies } from './dependencies.js';
import { createDefaultProviderDependencies } from './dependencies.js';

export class CodexAuthenticator implements ProviderAuthenticator {
  readonly id = 'codex';
  readonly name = 'OpenAI Codex';
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
        description: `Already authenticated (expires: ${credInfo.expiresAt ? new Date(credInfo.expiresAt).toLocaleString() : 'unknown'})`,
      });
    }

    // OAuth login option
    options.push({
      id: 'oauth',
      label: 'Browser login (OAuth)',
      description: 'Open browser to authenticate with Codex',
    });

    return options;
  }

  async authenticate(optionId: string, profileName: string): Promise<void> {
    switch (optionId) {
      case 'use-existing':
        // No action needed - credentials already exist
        console.log('Using existing Codex credentials');
        // Still save to profile to mark as authenticated
        await this.saveCredentialToProfile(profileName);
        break;

      case 'oauth':
        await this.executeOAuthLogin();
        
        // Verify credentials were created
        const credInfo = await this.checkAuth(profileName);
        if (!credInfo.valid) {
          throw new Error('Authentication failed: credentials are invalid. Please try again.');
        }
        
        // Save credential info to profile after successful login
        await this.saveCredentialToProfile(profileName);
        break;

      default:
        throw new Error(`Unknown auth option: ${optionId}`);
    }
  }

  async checkAuth(profileName: string): Promise<CredentialInfo> {
    // Codex stores credentials in ~/.codex/auth.json
    const credPaths = [
      join(homedir(), '.codex', 'auth.json'),
      join(homedir(), '.codex', 'credentials'),
      join(homedir(), '.codex', 'credentials.json'),
    ];

    for (const credPath of credPaths) {
      if (!existsSync(credPath)) {
        continue;
      }

      try {
        // Try to read and parse credential file
        const content = readFileSync(credPath, 'utf-8');
        const creds = JSON.parse(content);

        // Check if credentials have required fields
        // Codex stores tokens in nested 'tokens' object
        const tokens = creds.tokens || creds;
        const hasToken =
          tokens.sessionKey ||
          tokens.session_key ||
          tokens.accessToken ||
          tokens.access_token ||
          tokens.id_token ||
          tokens.token ||
          tokens.authToken ||
          tokens.OPENAI_API_KEY ||
          tokens.apiKey;

        if (!hasToken) {
          continue;
        }

        // Check if credentials have expiry
        const expiresAt = creds.expires_at || creds.expiresAt || creds.expiry;
        const valid = expiresAt ? Date.now() < expiresAt : true;

        return {
          source: 'native',
          path: credPath,
          expiresAt: expiresAt,
          valid,
        };
      } catch (error) {
        // Failed to parse - try next path
        continue;
      }
    }

    return {
      source: 'native',
      valid: false,
    };
  }

  async logout(profileName: string): Promise<void> {
    console.log('To logout from Codex, run: codex logout');
    console.log('Note: This will affect all profiles using Codex');
  }

  private async saveCredentialToProfile(profileName: string): Promise<void> {
    const profileStore = this.dependencies.getProfileStore();

    // Check for existing credentials
    const credInfo = await this.checkAuth(profileName);

    if (credInfo.valid && credInfo.path) {
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
          credentialPath: credInfo.path,
          lastAuth: Date.now(),
          expiresAt: credInfo.expiresAt,
        });
      }
    }
  }
  private async executeOAuthLogin(): Promise<void> {
    console.log('\nOpening browser for Codex authentication...');
    console.log('Please complete the login process in your browser.\n');

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'codex.cmd' : 'codex';

      const child = spawn(command, ['login'], {
        stdio: 'inherit',
        shell: isWindows,
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute codex login: ${error.message}`));
      });

      child.on('exit', (code) => {
        if (code === 0) {
          console.log('\n✓ Authentication completed!');
          resolve();
        } else {
          reject(new Error(`Authentication failed with exit code ${code}`));
        }
      });
    });
  }
}
