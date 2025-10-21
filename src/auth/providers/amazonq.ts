/**
 * Amazon Q Provider Authentication
 *
 * Supports:
 * - OAuth via `q login`
 * - Native credential detection
 */

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ProviderAuthenticator, AuthOption, CredentialInfo } from './base.js';
import type { ProviderDependencies } from './dependencies.js';

export class AmazonQAuthenticator implements ProviderAuthenticator {
  readonly id = 'q';
  readonly name = 'Amazon Q';
  
  constructor(_dependencies?: ProviderDependencies) {
    // Amazon Q authenticator currently has no external dependencies.
  }

  async getAuthOptions(profileName: string): Promise<AuthOption[]> {
    const options: AuthOption[] = [];

    // Check for existing native credentials
    const credInfo = await this.checkAuth(profileName);
    if (credInfo.valid) {
      options.push({
        id: 'use-existing',
        label: 'Use existing credentials',
        description: 'Already authenticated with Amazon Q',
      });
    }

    // OAuth login option
    options.push({
      id: 'oauth',
      label: 'Browser login (OAuth)',
      description: 'Open browser to authenticate with Amazon Q',
    });

    return options;
  }

  async authenticate(optionId: string, profileName: string): Promise<void> {
    switch (optionId) {
      case 'use-existing':
        console.log('Using existing Amazon Q credentials');
        break;

      case 'oauth':
        await this.executeOAuthLogin();
        break;

      default:
        throw new Error(`Unknown auth option: ${optionId}`);
    }
  }

  async checkAuth(profileName: string): Promise<CredentialInfo> {
    // Amazon Q stores credentials in various locations
    const credPaths = [
      join(homedir(), '.q', 'credentials.json'),
      join(homedir(), '.q', 'credentials'),
      join(homedir(), '.amazon-q', 'credentials.json'),
      join(homedir(), '.amazon-q', 'credentials'),
    ];

    // Check file paths
    for (const credPath of credPaths) {
      if (existsSync(credPath)) {
        try {
          const content = readFileSync(credPath, 'utf-8');
          const creds = JSON.parse(content);

          // Check if credentials have required fields
          const hasToken = creds.accessToken || creds.access_token || creds.token;
          if (!hasToken) {
            continue;
          }

          const expiresAt = creds.expires_at || creds.expiresAt || creds.expiry;
          const valid = expiresAt ? Date.now() < expiresAt : true;

          return {
            source: 'native',
            path: credPath,
            expiresAt: expiresAt,
            valid,
          };
        } catch (error) {
          continue;
        }
      }
    }

    // Check AWS SSO cache directory for valid session files
    const ssoCacheDir = join(homedir(), '.aws', 'sso', 'cache');
    if (existsSync(ssoCacheDir)) {
      try {
        const files = require('fs').readdirSync(ssoCacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = join(ssoCacheDir, file);
            try {
              const content = readFileSync(filePath, 'utf-8');
              const creds = JSON.parse(content);

              // Check for valid access token
              const hasToken = creds.accessToken || creds.access_token;
              if (!hasToken) {
                continue;
              }

              const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : undefined;
              const valid = expiresAt ? Date.now() < expiresAt : false;

              if (valid) {
                return {
                  source: 'native',
                  path: filePath,
                  expiresAt: expiresAt,
                  valid: true,
                };
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        // Failed to read SSO cache directory
      }
    }

    return {
      source: 'native',
      valid: false,
    };
  }

  async logout(profileName: string): Promise<void> {
    console.log('To logout from Amazon Q, run: q logout');
    console.log('Note: This will affect all profiles using Amazon Q');
  }

  private async executeOAuthLogin(): Promise<void> {
    console.log('\nOpening browser for Amazon Q authentication...');
    console.log('Please complete the login process in your browser.\n');

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'q.cmd' : 'q';

      const child = spawn(command, ['login', '--license', 'free'], {
        stdio: 'inherit',
        shell: isWindows,
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute q login: ${error.message}`));
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

