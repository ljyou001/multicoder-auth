/**
 * Base interface for provider authentication
 *
 * Each provider implements this interface to provide:
 * - Authentication method detection
 * - Interactive login flow
 * - Credential validation
 */

export interface AuthOption {
  id: string;
  label: string;
  description: string;
}

export interface CredentialInfo {
  source: 'native' | 'managed' | 'env';
  path?: string;
  envVar?: string;
  expiresAt?: number;
  valid: boolean;
}

export interface ProviderAuthenticator {
  /**
   * Provider ID (e.g., 'codex', 'claude', 'gemini')
   */
  readonly id: string;

  /**
   * Provider display name
   */
  readonly name: string;

  /**
   * Get available authentication options for this provider
   */
  getAuthOptions(profileName: string): Promise<AuthOption[]>;

  /**
   * Execute authentication flow based on selected option
   */
  authenticate(optionId: string, profileName: string): Promise<void>;

  /**
   * Check current authentication status
   */
  checkAuth(profileName: string): Promise<CredentialInfo>;

  /**
   * Logout / remove credentials
   */
  logout(profileName: string): Promise<void>;
}
