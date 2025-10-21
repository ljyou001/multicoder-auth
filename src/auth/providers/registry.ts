/**
 * Provider Authenticator Registry
 *
 * Central registry for all provider authenticators.
 * Add new providers here.
 */

import type { ProviderAuthenticator } from './base.js';
import { CodexAuthenticator } from './codex.js';
import { ClaudeAuthenticator } from './claude.js';
import { GeminiAuthenticator } from './gemini.js';
import { AmazonQAuthenticator } from './amazonq.js';
import type { ProviderDependencies } from './dependencies.js';
import { createDefaultProviderDependencies } from './dependencies.js';

export class ProviderAuthRegistry {
  private readonly providers = new Map<string, ProviderAuthenticator>();
  private readonly dependencies: ProviderDependencies;

  constructor(dependencies: ProviderDependencies = createDefaultProviderDependencies()) {
    this.dependencies = dependencies;

    // Register all providers
    this.register(new CodexAuthenticator(dependencies));
    this.register(new ClaudeAuthenticator(dependencies));
    this.register(new GeminiAuthenticator(dependencies));
    this.register(new AmazonQAuthenticator(dependencies));
  }

  /**
   * Register a provider authenticator
   */
  register(provider: ProviderAuthenticator): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Get a provider authenticator by ID
   */
  get(id: string): ProviderAuthenticator | undefined {
    return this.providers.get(id);
  }

  /**
   * Check if a provider is registered
   */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * List all registered provider IDs
   */
  listIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * List all registered providers
   */
  listAll(): ProviderAuthenticator[] {
    return Array.from(this.providers.values());
  }
}

// Export singleton instance
export const authRegistry = new ProviderAuthRegistry();
