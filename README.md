# multicoder

<div align="center">

<img src="./asset/icon.png" alt="multicoder icon" width="160" />

**Unified Authentication & Profile Management for Multi-Provider AI Development**

[![npm version](https://img.shields.io/npm/v/multicoder.svg)](https://www.npmjs.com/package/multicoder)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

[English](./README.md) | [简体中文](./readme_zh.md)

</div>

---

## Overview

**multicoder** is a comprehensive authentication and profile management solution designed for developers working with multiple AI providers. It provides a unified interface to manage credentials, switch between profiles, and maintain consistent authentication state across Anthropic Claude, Google Gemini, OpenAI/Codex, Amazon Q, and more.

Whether you're building automation tools, desktop applications, or command-line utilities, multicoder eliminates the complexity of managing multiple API keys and OAuth flows across different providers.

## Why multicoder?

- **🔐 Unified Authentication**: One consistent API for all AI providers
- **👤 Profile Management**: Easily switch between different development contexts
- **🔄 Auto Migration**: Seamlessly migrates from legacy configurations
- **🌍 Cross-Platform**: Works on Windows, macOS, and Linux
- **🛠️ Developer-Friendly**: CLI tools, programmatic API, and rich examples
- **🔌 Extensible**: Plugin-based architecture for adding new providers

## Key Features

### Profile-Aware Credential Management
Isolate credentials by profile with automatic migration from legacy `multicoder` and `unycode` configurations. Each profile maintains its own set of provider credentials, making it easy to manage multiple accounts or environments.

### Universal Credential Manager
The `CredentialManager` intelligently handles:
- Native OAuth token caches
- Secure API key storage
- Environment variable integration
- Automatic credential refresh

### Multi-Provider Support
Built-in authenticators for major AI platforms:
- **Anthropic Claude** - API key and OAuth support
- **Google Gemini** - API key authentication
- **OpenAI/Codex** - OAuth with automatic token refresh
- **Amazon Q** - Native credential integration

### Cross-Platform Environment Management
`SystemEnvironmentManager` provides unified environment variable persistence across platforms:
- **Windows**: User and system-level registry management
- **macOS/Linux**: Shell integration (bash, zsh, fish)
- Automatic shell profile detection and updates

### Command-Line Interface
Full-featured CLI (`coders`) for interactive authentication management:
```bash
coders profile create my-dev-profile
coders login gemini
coders switch my-dev-profile
coders status
```

## Installation

```bash
npm install multicoder
```

Or install globally to use the CLI anywhere:

```bash
npm install -g multicoder
```

## Quick Start

### Programmatic Usage

```typescript
import { ProfileManager, authRegistry } from 'multicoder';

// Initialize profile manager
const profileManager = new ProfileManager();
await profileManager.initialize();

// Create a profile with API key
await profileManager.createProfileWithApiKey(
  'gemini-dev',
  'gemini',
  process.env.GOOGLE_API_KEY
);

// Switch to the profile
const result = await profileManager.switchProfile('gemini-dev');
console.log(`Applied credentials:`, result.appliedCredentials);

// Use provider-specific authenticator
const geminiAuth = authRegistry.get('gemini');
const authResult = await geminiAuth?.authenticate({
  profile: 'gemini-dev'
});
```

### CLI Usage

After installation, use the `coders` command:

```bash
# List all profiles
coders profile list

# Create a new profile
coders profile create my-profile

# Create profile from environment variables
coders profile create-from-env dev-env

# Login to a provider
coders login gemini
coders login claude

# Switch active profile
coders switch my-profile

# Check authentication status
coders status
coders whoami

# Logout from a provider
coders logout gemini

# Delete a profile
coders profile delete my-profile
```

## Configuration & Storage

### Configuration Directory

Default: `~/.multicoder`
Override: Set `MULTICODER_CONFIG_DIR` environment variable

### Directory Structure

```
~/.multicoder/
├── credentials/          # Managed provider credentials
│   ├── gemini/
│   ├── claude/
│   └── codex/
├── profiles.json         # Profile configurations
├── env.sh               # POSIX environment variables
└── config.json          # Global settings
```

### Legacy Migration

The module automatically migrates configurations from:
- `~/.config/multicoder`
- `~/.config/unycoding`
- `%APPDATA%\multicoder` (Windows)
- `%APPDATA%\unycoding` (Windows)
- `~/Library/Application Support/multicoder` (macOS)
- `~/Library/Application Support/unycoding` (macOS)

## Advanced Usage

### Creating Custom Authenticators

```typescript
import { BaseAuthenticator, authRegistry } from 'multicoder';

class MyCustomAuth extends BaseAuthenticator {
  async authenticate(options) {
    // Your authentication logic
  }

  async getCredentials(options) {
    // Retrieve credentials
  }
}

// Register your authenticator
authRegistry.register('my-provider', new MyCustomAuth());
```

### Environment Variable Management

```typescript
import { SystemEnvironmentManager } from 'multicoder';

const envManager = new SystemEnvironmentManager();

// Set persistent environment variable
await envManager.setEnvironmentVariable(
  'MY_API_KEY',
  'secret-value',
  { persistent: true }
);

// Get current environment
const env = await envManager.getCurrentEnvironment();
```

## Development

### Build from Source

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

### Testing

```bash
# Run all tests
npm test

# Provider-specific tests
npm run test:gemini
npm run test:claude
npm run test:codex

# Quick smoke test
npm run test:quick
```

### Examples

Explore the `examples/` directory for practical use cases:

- `create-profile-from-env.js` - Bootstrap profiles from existing environment
- `quick-auth-check.js` - Validate authentication status
- `simple-env-profile.js` - Basic profile creation workflow
- `test-cli-v2-auth-status.js` - CLI integration patterns

## Troubleshooting

### Codex/OpenAI OAuth Issues

If you encounter OAuth-related problems with Codex, refer to `docs/CODEX_OAUTH_FIX.md` for detailed troubleshooting steps.

### Environment Variables Not Persisting

Make sure to reload your shell after setting environment variables:

```bash
# For bash/zsh
source ~/.bashrc  # or ~/.zshrc

# Or open a new terminal window
```

### Permission Issues

On Unix systems, ensure the configuration directory has proper permissions:

```bash
chmod 700 ~/.multicoder
```

## API Documentation

### ProfileManager

```typescript
class ProfileManager {
  initialize(): Promise<void>
  createProfile(name: string, providers: string[]): Promise<void>
  createProfileWithApiKey(name: string, provider: string, apiKey: string): Promise<void>
  switchProfile(name: string): Promise<SwitchResult>
  deleteProfile(name: string): Promise<void>
  listProfiles(): Promise<Profile[]>
  getCurrentProfile(): Promise<Profile | null>
}
```

### CredentialManager

```typescript
class CredentialManager {
  storeCredential(provider: string, credential: any): Promise<void>
  getCredential(provider: string): Promise<any>
  deleteCredential(provider: string): Promise<void>
  listCredentials(): Promise<string[]>
}
```

### AuthRegistry

```typescript
class AuthRegistry {
  register(provider: string, authenticator: BaseAuthenticator): void
  get(provider: string): BaseAuthenticator | undefined
  list(): string[]
}
```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

ISC License - see [LICENSE](LICENSE) file for details.

## Support

- Issues: [GitHub Issues](https://github.com/ljyou001/multicoder-auth/issues)
- Documentation: [npm Package](https://www.npmjs.com/package/multicoder)

---

<div align="center">

**Built with ❤️ for the AI development community**

</div>
