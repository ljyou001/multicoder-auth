import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import type { CliContext } from '../context.js';
import { formatAuthMethod } from '../utils/format.js';
import { computeAzureBaseUrl } from '../../system/codexEnv.js';
import { promptCodexApiKey } from '../utils/prompt.js';
import type { CodexEnvConfig } from '../../system/codexEnv.js';

export async function handleLoginCommand(
  context: CliContext,
  providerId: string | undefined,
  args: string[]
): Promise<void> {
  const { profileStore: store, registry, credentialManager } = context;

  if (!providerId) {
    console.error('Provider is required');
    console.error('Usage: unycode-auth login <provider>');
    console.error(`Providers: ${registry.listIds().join(', ')}`);
    process.exit(1);
  }

  const provider = registry.get(providerId);
  if (!provider) {
    console.error(`Unknown provider: ${providerId}`);
    console.error(`Available providers: ${registry.listIds().join(', ')}`);
    process.exit(1);
  }

  let profileName = store.getCurrentName();
  const profileIndex = args.indexOf('--profile');
  if (profileIndex !== -1 && args[profileIndex + 1]) {
    profileName = args[profileIndex + 1];
  }

  // Parse API key flags
  let apiKey: string | undefined;
  let vertexConfig: any = {};
  let apiKeyType: string = 'google';
  let codexConfig: CodexEnvConfig | undefined;

  if (providerId === 'gemini') {
    const googleApiIndex = args.indexOf('--google-api-key');
    if (googleApiIndex !== -1 && args[googleApiIndex + 1]) {
      apiKey = args[googleApiIndex + 1];
      apiKeyType = 'google';
    }

    const geminiApiIndex = args.indexOf('--gemini-api-key');
    if (geminiApiIndex !== -1 && args[geminiApiIndex + 1]) {
      apiKey = args[geminiApiIndex + 1];
      apiKeyType = 'gemini';
    }

    const projectIndex = args.indexOf('--project-id');
    if (projectIndex !== -1 && args[projectIndex + 1]) {
      vertexConfig.projectId = args[projectIndex + 1];
      apiKeyType = 'vertex';
    }

    const locationIndex = args.indexOf('--location');
    if (locationIndex !== -1 && args[locationIndex + 1]) {
      vertexConfig.location = args[locationIndex + 1];
      apiKeyType = 'vertex';
    }

    const useVertexIndex = args.indexOf('--use-vertex-ai');
    if (useVertexIndex !== -1) {
      vertexConfig.useVertexAi = true;
      apiKeyType = 'vertex';
    }
  } else if (providerId === 'claude') {
    const anthropicApiIndex = args.indexOf('--anthropic-api-key');
    if (anthropicApiIndex !== -1 && args[anthropicApiIndex + 1]) {
      apiKey = args[anthropicApiIndex + 1];
    }
  } else if (providerId === 'codex') {
    const openaiApiIndex = args.indexOf('--openai-api-key');
    const azureApiIndex = args.indexOf('--azure-openai-api-key');

    if (openaiApiIndex !== -1 && azureApiIndex !== -1) {
      console.error('Specify either --openai-api-key or --azure-openai-api-key, not both.');
      process.exit(1);
    }

    if (openaiApiIndex !== -1) {
      if (!args[openaiApiIndex + 1]) {
        console.error('--openai-api-key requires a value');
        process.exit(1);
      }
      apiKey = args[openaiApiIndex + 1];
      codexConfig = { mode: 'openai' };

      const baseUrlIndex = args.indexOf('--openai-base-url');
      if (baseUrlIndex !== -1) {
        const baseUrlValue = args[baseUrlIndex + 1];
        if (!baseUrlValue) {
          console.error('--openai-base-url requires a value');
          process.exit(1);
        }
        codexConfig.baseUrl = baseUrlValue;
      }
    } else {
      const baseUrlIndex = args.indexOf('--openai-base-url');
      if (baseUrlIndex !== -1) {
        console.error('--openai-base-url can only be used with --openai-api-key');
        process.exit(1);
      }
    }

    if (azureApiIndex !== -1) {
      if (!args[azureApiIndex + 1]) {
        console.error('--azure-openai-api-key requires a value');
        process.exit(1);
      }
      apiKey = args[azureApiIndex + 1];

      const resourceIndex = args.indexOf('--azure-resource-name');
      if (resourceIndex === -1 || !args[resourceIndex + 1]) {
        console.error('--azure-resource-name is required when using --azure-openai-api-key');
        process.exit(1);
      }

      const resourceName = args[resourceIndex + 1];
      codexConfig = {
        mode: 'azure',
        azureResourceName: resourceName,
        baseUrl: computeAzureBaseUrl(resourceName),
      };
    } else {
      const resourceIndex = args.indexOf('--azure-resource-name');
      if (resourceIndex !== -1) {
        console.error('--azure-resource-name can only be used with --azure-openai-api-key');
        process.exit(1);
      }
    }
  }

  if (!profileName) {
    console.error('No profile selected');
    console.error('Create one with: unycode-auth profile create <name>');
    process.exit(1);
  }

  console.log(`Authenticating ${provider.name} for profile '${profileName}'...\n`);
  await credentialManager.initialize();

  try {
    let selectedId = 'api-key';
    let handledByCli = false;

    if (apiKey) {
      console.log('Using API key from command line...');
      await authenticateWithApiKey(context, providerId, profileName, apiKey, {
        vertexConfig,
        apiKeyType,
        codexConfig,
      });
      handledByCli = true;
    } else {
      let options = await provider.getAuthOptions(profileName);

      if (providerId === 'codex') {
        const apiKeyOptions = [
          {
            id: 'api-openai',
            label: 'API Key (OpenAI)',
            description: 'Provide an OpenAI API key and optional base URL to inject as environment variables',
          },
          {
            id: 'api-azure',
            label: 'API Key (Azure OpenAI)',
            description: 'Provide an Azure OpenAI API key and resource name to inject environment variables',
          },
        ];
        options = [...apiKeyOptions, ...options];
      }

      if (options.length === 0) {
        console.error('No authentication options available');
        process.exit(1);
      }

      if (options.length === 1) {
        selectedId = options[0].id;
        console.log(`Using: ${options[0].label}`);
      } else {
        console.log('Select authentication method:');
        options.forEach((opt, index) => {
          console.log(`  ${index + 1}. ${opt.label} - ${opt.description}`);
        });
        console.log();

        const rl = createInterface({ input: stdin, output: stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Enter choice (1-${options.length}): `, (value) => {
            rl.close();
            resolve(value);
          });
        });

        const choice = parseInt(answer.trim(), 10);
        if (Number.isNaN(choice) || choice < 1 || choice > options.length) {
          console.error(`Invalid choice: ${answer}`);
          process.exit(1);
        }

        selectedId = options[choice - 1].id;
      }

      if (providerId === 'codex' && (selectedId === 'api-openai' || selectedId === 'api-azure')) {
        const interactiveMode = selectedId === 'api-openai' ? 'openai' : 'azure';
        const { apiKey: collectedKey, config } = await promptCodexApiKey(interactiveMode);
        await authenticateWithApiKey(context, 'codex', profileName, collectedKey, { codexConfig: config });
        selectedId = 'api-key';
        handledByCli = true;
      } else {
        await provider.authenticate(selectedId, profileName);
      }
    }

    if (!handledByCli) {
      const credInfo = await provider.checkAuth(profileName);
      if (credInfo.valid) {
        store.setProviderAuth(profileName, providerId, {
          credentialSource: credInfo.source,
          credentialPath: credInfo.path,
          lastAuth: Date.now(),
          expiresAt: credInfo.expiresAt,
        });
      }
    }

    console.log(`\nApplying credentials to configuration files...`);
    const applyResult = await credentialManager.applyCredentials(providerId, profileName);
    if (applyResult.needsRestart) {
      console.log(`${providerId} requires restart to apply native credentials`);
    }

    console.log(`\nSuccessfully authenticated ${provider.name}`);
  } catch (error) {
    console.error(`\nAuthentication failed:`, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function handleLogoutCommand(
  context: CliContext,
  providerId: string | undefined,
  args: string[]
): Promise<void> {
  const { profileStore: store, registry, credentialManager } = context;

  if (!providerId) {
    console.error('Provider is required');
    console.error('Usage: unycode-auth logout <provider>');
    process.exit(1);
  }

  await credentialManager.initialize();

  const provider = registry.get(providerId);
  if (!provider) {
    console.error(`Unknown provider: ${providerId}`);
    process.exit(1);
  }

  let profileName = store.getCurrentName();
  const profileIndex = args.indexOf('--profile');
  if (profileIndex !== -1 && args[profileIndex + 1]) {
    profileName = args[profileIndex + 1];
  }

  if (!profileName) {
    console.error('No profile selected');
    process.exit(1);
  }

  console.log(`Logging out ${provider.name} for profile '${profileName}'...`);
  await provider.logout(profileName);
  await credentialManager.clearCredentials(providerId, profileName);
  store.removeProviderAuth(profileName, providerId);
  console.log('Logout complete.');
}

export async function handleStatusCommand(context: CliContext): Promise<void> {
  const { profileStore: store, registry, credentialManager } = context;
  const profiles = store.list();
  const currentName = store.getCurrentName();

  console.log('Authentication status:');

  if (profiles.length === 0) {
    console.log('  No profiles found.');
    return;
  }

  for (const profile of profiles) {
    const marker = profile.name === currentName ? '* ' : '  ';
    console.log(`${marker}${profile.name}`);

    for (const providerId of registry.listIds()) {
      const provider = registry.get(providerId);
      const displayName = provider ? provider.name : providerId;

      try {
        await credentialManager.initialize();
        const credInfo = await credentialManager.getCredentialInfo(providerId, profile.name);
        if (!credInfo) {
          console.log(`    - ${displayName}: Not authenticated`);
          continue;
        }

        const valid = credentialManager.isCredentialValid(credInfo);
        const authMethod = formatAuthMethod(credInfo.source, credInfo);
        const status = valid ? 'Valid' : 'Expired';
        console.log(`    - ${displayName}: ${status} (${authMethod})`);
        if (credInfo.expiresAt) {
          console.log(`      Expires: ${new Date(credInfo.expiresAt).toLocaleString()}`);
        }
      } catch (error) {
        console.log(
          `    - ${displayName}: Error ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

export async function handleWhoamiCommand(context: CliContext): Promise<void> {
  const { profileStore: store, registry, profileService } = context;
  const current = store.getCurrent();

  if (!current) {
    console.log('No profile selected');
    return;
  }

  console.log(`Current profile: ${current.name}`);
  console.log(`Providers configured: ${Object.keys(current.providers).length}`);

  try {
    const credentialInfo = await profileService.getProfileCredentialInfo(current.name);
    for (const [providerId, info] of Object.entries(credentialInfo)) {
      const provider = registry.get(providerId);
      const providerName = provider ? provider.name : providerId;
      const authMethod = formatAuthMethod(info?.source || 'unknown', info);
      console.log(`  - ${providerName}: ${authMethod}`);
    }
  } catch (error) {
    console.warn(
      `  Warning: Unable to read detailed credential information (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

export async function authenticateWithApiKey(
  context: CliContext,
  providerId: string,
  profileName: string,
  apiKey: string,
  options: {
    vertexConfig?: any;
    apiKeyType?: string;
    codexConfig?: CodexEnvConfig;
  } = {}
): Promise<void> {
  const { profileStore: store, credentialManager } = context;
  await credentialManager.initialize();

  if (providerId === 'gemini' && !apiKey.startsWith('AIza')) {
    console.log('Warning: API key format may be incorrect (expected to start with "AIza")');
  } else if (providerId === 'claude' && !apiKey.startsWith('sk-ant-') && !apiKey.startsWith('sk-')) {
    console.log('Warning: API key format may be incorrect (expected to start with "sk-ant-" or "sk-")');
  } else if (providerId === 'codex' && !apiKey.startsWith('sk-')) {
    console.log('Warning: API key format may be incorrect (expected to start with "sk-")');
  }

  const credentialData: Record<string, any> = { apiKey };

  if (providerId === 'gemini') {
    if (options.apiKeyType) {
      credentialData.apiKeyType = options.apiKeyType;
    }
    if (options.vertexConfig) {
      Object.assign(credentialData, options.vertexConfig);
    }
  }

  if (providerId === 'codex' && options.codexConfig) {
    Object.assign(credentialData, options.codexConfig);
  }

  await credentialManager.saveCredentialData(providerId, profileName, credentialData);
  store.setProviderAuth(profileName, providerId, {
    credentialSource: 'managed',
    lastAuth: Date.now(),
  });
}

