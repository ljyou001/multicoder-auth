#!/usr/bin/env node

/**
 * Provider Bridge Service
 *
 * This is a JSON-RPC bridge service that connects the Tauri Rust backend
 * with the Node.js profile management and provider authentication system.
 *
 * Communication Protocol:
 * - Input: JSON-RPC requests via stdin (one per line)
 * - Output: JSON-RPC responses via stdout (one per line)
 * - Events: JSON events via stdout (one per line)
 */

import * as readline from 'node:readline';
import { ProfileManager } from '../profile/profileManager.js';
import { CredentialManager } from '../auth/credentialManager.js';

// ============================================================================
// Types
// ============================================================================

interface JsonRpcRequest {
  id: number;
  method: string;
  params: Record<string, any>;
}

interface JsonRpcResponse {
  id: number;
  result?: any;
  error?: string;
}

interface JsonRpcEvent {
  event: string;
  data: any;
}

// ============================================================================
// Bridge Service
// ============================================================================

class BridgeService {
  private profileManager: ProfileManager;
  private credentialManager: CredentialManager;

  constructor() {
    this.profileManager = new ProfileManager();
    this.credentialManager = this.profileManager.getCredentialManager();
  }

  async initialize(): Promise<void> {
    await this.profileManager.initialize();
    this.sendEvent('ready', { status: 'initialized' });
  }

  /**
   * Send a JSON-RPC response
   */
  private sendResponse(id: number, result?: any, error?: string): void {
    const response: JsonRpcResponse = { id };
    if (error) {
      response.error = error;
    } else {
      response.result = result;
    }
    console.log(JSON.stringify(response));
  }

  /**
   * Send a JSON event
   */
  private sendEvent(event: string, data: any): void {
    const eventMessage: JsonRpcEvent = { event, data };
    console.log(JSON.stringify(eventMessage));
  }

  /**
   * Handle incoming JSON-RPC requests
   */
  async handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'listProfiles':
          await this.handleListProfiles(id);
          break;

        case 'createProfile':
          await this.handleCreateProfile(id, params);
          break;

        case 'switchProfile':
          await this.handleSwitchProfile(id, params);
          break;

        case 'deleteProfile':
          await this.handleDeleteProfile(id, params);
          break;

        case 'getCurrentProfile':
          await this.handleGetCurrentProfile(id);
          break;

        case 'checkAuth':
          await this.handleCheckAuth(id, params);
          break;

        case 'loginWithApiKey':
          await this.handleLoginWithApiKey(id, params);
          break;

        default:
          this.sendResponse(id, undefined, `Unknown method: ${method}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendResponse(id, undefined, errorMessage);
    }
  }

  // ============================================================================
  // Profile Commands
  // ============================================================================

  private async handleListProfiles(id: number): Promise<void> {
    const profiles = this.profileManager.list();
    this.sendResponse(id, { profiles });
  }

  private async handleCreateProfile(id: number, params: Record<string, any>): Promise<void> {
    const { name, provider } = params as { name: string; provider: string };

    // Create profile (without credentials initially)
    const profile = this.profileManager.ensure(name);

    this.sendResponse(id, { profile });
  }

  private async handleSwitchProfile(id: number, params: Record<string, any>): Promise<void> {
    const { profileId } = params as { profileId: string };

    const result = await this.profileManager.switchProfile(profileId);
    this.sendResponse(id, result);
  }

  private async handleDeleteProfile(id: number, params: Record<string, any>): Promise<void> {
    const { profileId } = params as { profileId: string };

    const success = this.profileManager.delete(profileId);
    this.sendResponse(id, { success });
  }

  private async handleGetCurrentProfile(id: number): Promise<void> {
    const profile = this.profileManager.getCurrent();
    this.sendResponse(id, { profile });
  }

  // ============================================================================
  // Auth Commands
  // ============================================================================

  private async handleCheckAuth(id: number, params: Record<string, any>): Promise<void> {
    const { provider, profileName } = params as { provider: string; profileName: string };

    try {
      const valid = await this.profileManager.hasValidCredentialsForProvider(profileName, provider);
      this.sendResponse(id, { valid });
    } catch (error) {
      this.sendResponse(id, { valid: false });
    }
  }

  private async handleLoginWithApiKey(
    id: number,
    params: Record<string, any>
  ): Promise<void> {
    const { profileName, provider, apiKey, metadata } = params as {
      profileName: string;
      provider: string;
      apiKey: string;
      metadata?: any
    };

    try {
      // Check if profile exists, if not create it
      let profile = this.profileManager.get(profileName);
      if (!profile) {
        profile = await this.profileManager.createProfileWithApiKey(profileName, provider, apiKey, {
          permissionMode: 'ask',
        });
      } else {
        // Add provider to existing profile
        await this.profileManager.addProviderToProfile(profileName, provider, 'managed', { apiKey });
      }

      this.sendResponse(id, { success: true, profile });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendResponse(id, { success: false }, errorMessage);
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const bridge = new BridgeService();

  try {
    await bridge.initialize();
  } catch (error) {
    console.error('[Bridge] Failed to initialize:', error);
    process.exit(1);
  }

  // Set up stdin/stdout for JSON-RPC communication
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      await bridge.handleRequest(request);
    } catch (error) {
      console.error('[Bridge] Error processing request:', error);
    }
  });

  rl.on('close', () => {
    console.error('[Bridge] stdin closed, exiting...');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[Bridge] Fatal error:', error);
  process.exit(1);
});
