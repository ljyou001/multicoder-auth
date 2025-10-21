# Authentication Unit Tests

This directory contains comprehensive unit tests for the authentication system, specifically designed to prevent regressions of the credential application bug that was fixed.

## Bug Description

The original bug was that when users logged in interactively (not via command line), the system would save credentials to managed storage but would not apply them to the actual configuration files (`.env` and `settings.json`). This meant that Gemini CLI would not recognize the new authentication method.

## Test Files

### 1. `credentialManager.test.js`
Tests the core credential management functionality:
- Credential storage and retrieval
- API key management
- Native credential detection
- Credential validation and expiry

### 2. `geminiAuthenticator.test.js`
Tests the Gemini-specific authentication logic:
- API key authentication (GEMINI_API_KEY and Vertex AI)
- OAuth authentication
- Credential application to `.env` and `settings.json` files
- Settings.json authentication type updates

### 3. `cliLoginFlow.test.js`
Tests the CLI login flow and the specific bug fix:
- Interactive login with credential application
- Command line login with credential application
- Profile switching with credential application
- The bug fix for credentials not being applied to files

### 4. `settingsUpdate.test.js`
Tests the settings.json update logic:
- Authentication type switching
- Settings file creation and modification
- Preserving existing settings
- Error handling for malformed settings

### 5. `integration.test.js`
Tests the complete authentication flow:
- End-to-end login process
- Credential application to files
- Profile switching
- The specific bug fix for credentials not being applied

## Running the Tests

### Run Individual Test Files
```bash
# Run a specific test file
node tests/unit/auth/credentialManager.test.js
node tests/unit/auth/geminiAuthenticator.test.js
node tests/unit/auth/cliLoginFlow.test.js
node tests/unit/auth/settingsUpdate.test.js
node tests/unit/auth/integration.test.js
```

### Run All Auth Tests
```bash
# Run all authentication tests
node tests/unit/auth/run-auth-tests.js
```

### Run with Node.js Test Runner
```bash
# Run all tests in the auth directory
node --test tests/unit/auth/
```

## Test Coverage

These tests cover:

1. **Credential Storage**: Saving and retrieving API keys and OAuth tokens
2. **File Application**: Writing credentials to `.env` and `settings.json` files
3. **Settings Management**: Updating authentication types in settings
4. **Profile Switching**: Switching between different credential types
5. **Error Handling**: Graceful handling of missing or malformed files
6. **Integration**: End-to-end authentication flows

## Key Test Scenarios

### GEMINI_API_KEY Authentication
- Saves API key to managed storage
- Applies API key to `.env` file as `GEMINI_API_KEY=...`
- Updates `settings.json` to `"selectedType": "gemini-api-key"`

### Vertex AI Authentication
- Saves API key and project configuration to managed storage
- Applies configuration to `.env` file:
  ```
  GOOGLE_API_KEY=...
  GOOGLE_CLOUD_PROJECT=...
  GOOGLE_CLOUD_LOCATION=...
  ```
- Updates `settings.json` to `"selectedType": "gemini-api-key"`

### OAuth Authentication
- Saves OAuth tokens to managed storage
- Applies OAuth credentials to native location
- Updates `settings.json` to `"selectedType": "oauth-personal"`

### Profile Switching
- Clears old credentials from files
- Applies new credentials to files
- Preserves other environment variables

## Preventing Regressions

These tests specifically prevent the regression where:
1. User logs in interactively
2. Credentials are saved to managed storage
3. **BUT** credentials are not applied to configuration files
4. Gemini CLI continues to use old authentication method

The tests ensure that every login method (interactive, command line, profile switching) properly applies credentials to the configuration files.

## Maintenance

When adding new authentication methods or modifying existing ones:

1. Add tests for the new functionality
2. Ensure existing tests still pass
3. Update this README if needed
4. Run the full test suite before committing changes

## Dependencies

These tests use:
- Node.js built-in `test` module
- Temporary directories for isolation
- Mocked home directories to avoid affecting real user data
- File system operations to verify file contents

