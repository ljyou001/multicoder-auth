/**
 * Interactive Authentication Service
 *
 * Handles interactive login flows for different providers:
 * - OAuth browser login (spawn CLI commands)
 * - API Key input and validation
 * - Native credential detection and import
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { CredentialManager } from './credentialManager.js';

export interface AuthOption {
  id: string;
  label: string;
  description: string;
}

export interface InteractiveAuthOptions {
  credentialManager: CredentialManager;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class InteractiveAuthService {
  credManager: CredentialManager;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;

  constructor(options: InteractiveAuthOptions) {
    this.credManager = options.credentialManager;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  /**
   * Get available authentication options for a provider
   */
  async getAuthOptions(providerId: string, profileName: string): Promise<AuthOption[]> {
    const options: AuthOption[] = [];
    const authOpts = this.credManager.getAuthenticationOptions(providerId);

    // Check for native credentials first
    const nativeCredInfo = await this.credManager.getCredentialInfo(providerId, profileName);
    if (nativeCredInfo && nativeCredInfo.source === 'native') {
      options.push({
        id: 'use-native',
        label: 'Use existing credentials',
        description: `Use credentials from ${nativeCredInfo.path}`,
      });
    }

    // OAuth option
    if (authOpts.hasOAuth) {
      options.push({
        id: 'oauth',
        label: 'Browser login (OAuth)',
        description: 'Open browser to authenticate',
      });
    }

    // API Key option
    if (authOpts.hasApiKey) {
      options.push({
        id: 'apikey',
        label: 'API Key',
        description: 'Enter API key manually',
      });
    }

    return options;
  }

  /**
   * Prompt user to select authentication method
   */
  async promptAuthMethod(options: AuthOption[]): Promise<string> {
    this.output.write('\nSelect authentication method:\n');
    options.forEach((opt, index) => {
      this.output.write(`  ${index + 1}. ${opt.label} - ${opt.description}\n`);
    });
    this.output.write('\n');

    // Use a single readline instance that auto-closes
    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
      terminal: false, // Prevent duplicate input on Windows
    });

    try {
      const answer = await rl.question('Enter choice (1-' + options.length + '): ');
      const trimmed = answer.trim();

      // Parse and validate
      const choiceNum = parseInt(trimmed, 10);
      if (isNaN(choiceNum)) {
        throw new Error(`Invalid input: "${trimmed}". Please enter a number.`);
      }

      const choiceIndex = choiceNum - 1;
      if (choiceIndex < 0 || choiceIndex >= options.length) {
        throw new Error(`Invalid choice: ${choiceNum}. Please choose 1-${options.length}.`);
      }

      return options[choiceIndex].id;
    } finally {
      rl.close();
    }
  }

  /**
   * Execute OAuth login flow
   */
  async executeOAuthLogin(providerId: string, profileName: string): Promise<void> {
    const command = this.getOAuthCommand(providerId);
    if (!command) {
      throw new Error(`OAuth not supported for provider: ${providerId}`);
    }

    const fullCmd = `${command.cmd} ${command.args.join(' ')}`;
    this.output.write(`\nExecuting: ${fullCmd}\n`);
    this.output.write('Please complete authentication in the browser...\n\n');

    return new Promise((resolve, reject) => {
      // Windows-specific handling
      const isWindows = process.platform === 'win32';
      const spawnCmd = isWindows ? process.env.comspec || 'cmd.exe' : command.cmd;
      const spawnArgs = isWindows ? ['/c', fullCmd] : command.args;

      const proc = spawn(spawnCmd, spawnArgs, {
        stdio: 'inherit',
        shell: false, // We handle shell ourselves
        windowsHide: false, // Show window for user interaction
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to execute ${command.cmd}: ${error.message}`));
      });

      proc.on('exit', (code) => {
        if (code === 0 || code === null) {
          this.output.write('\n✓ Authentication completed!\n');
          resolve();
        } else {
          reject(new Error(`Authentication failed with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Execute API Key login flow
   */
  async executeApiKeyLogin(providerId: string, profileName: string): Promise<void> {
    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
    });

    const config = this.credManager.getProviderConfig(providerId);
    if (!config?.envVarName) {
      rl.close();
      throw new Error(`API Key authentication not supported for ${providerId}`);
    }

    this.output.write(`\n📝 Enter API Key for ${providerId}:\n`);
    this.output.write(`   (This will be saved securely to managed credentials)\n\n`);

    const apiKey = await rl.question('API Key: ');
    rl.close();

    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error('API Key cannot be empty');
    }

    // Validate API key format based on provider
    this.validateApiKeyFormat(providerId, trimmed);

    // Save to managed credentials
    await this.credManager.saveApiKey(providerId, profileName, trimmed);
    this.output.write('\n✓ API Key saved successfully!\n');
  }

  /**
   * Execute "use native credentials" flow
   */
  async executeUseNative(providerId: string, profileName: string): Promise<void> {
    const credInfo = await this.credManager.getCredentialInfo(providerId, profileName);
    if (!credInfo || credInfo.source !== 'native') {
      throw new Error('No native credentials found');
    }

    // Check if valid
    const isValid = this.credManager.isCredentialValid(credInfo);
    if (!isValid) {
      throw new Error('Native credentials have expired. Please choose another method.');
    }

    this.output.write(`\n✓ Using native credentials from: ${credInfo.path}\n`);
    if (credInfo.expiresAt) {
      const expiryDate = new Date(credInfo.expiresAt);
      this.output.write(`  Expires: ${expiryDate.toLocaleString()}\n`);
    }
    this.output.write('\nNote: Credentials will be referenced directly, not copied.\n');
  }

  /**
   * Full interactive login flow
   */
  async interactiveLogin(providerId: string, profileName: string): Promise<void> {
    const options = await this.getAuthOptions(providerId, profileName);
    if (options.length === 0) {
      throw new Error(`No authentication methods available for ${providerId}`);
    }

    // If only one option, use it directly
    let selectedMethod: string;
    if (options.length === 1) {
      selectedMethod = options[0].id;
      this.output.write(`\nUsing: ${options[0].label}\n`);
    } else {
      selectedMethod = await this.promptAuthMethod(options);
    }

    // Execute the selected method
    switch (selectedMethod) {
      case 'oauth':
        await this.executeOAuthLogin(providerId, profileName);
        break;
      case 'apikey':
        await this.executeApiKeyLogin(providerId, profileName);
        break;
      case 'use-native':
        await this.executeUseNative(providerId, profileName);
        break;
      default:
        throw new Error(`Unknown authentication method: ${selectedMethod}`);
    }
  }

  // Private helper methods
  private getOAuthCommand(providerId: string): { cmd: string; args: string[] } | null {
    switch (providerId) {
      case 'claude':
        return { cmd: 'claude', args: ['login'] };
      case 'gemini':
        return { cmd: 'gemini', args: [] };
      case 'codex':
        return { cmd: 'codex', args: ['login'] };
      case 'q':
        return { cmd: 'q', args: ['login', '--license', 'free'] };
      default:
        return null;
    }
  }

  private validateApiKeyFormat(providerId: string, apiKey: string): void {
    switch (providerId) {
      case 'anthropic':
        if (!apiKey.startsWith('sk-ant-api')) {
          throw new Error('Invalid Anthropic API key format (should start with sk-ant-api)');
        }
        break;
      case 'gemini':
        if (!apiKey.startsWith('AIza')) {
          throw new Error('Invalid Google API key format (should start with AIza)');
        }
        break;
      // Add more validations as needed
    }
  }
}

