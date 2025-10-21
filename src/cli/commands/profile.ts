import type { CliContext } from '../context.js';
import { formatAuthMethod } from '../utils/format.js';

export async function handleProfileCommand(
  context: CliContext,
  subcommand: string,
  args: string[]
): Promise<void> {
  const { profileStore: store, profileService, registry } = context;

  switch (subcommand) {
    case 'list': {
      const profiles = store.list();
      const current = store.getCurrentName();

      if (profiles.length === 0) {
        console.log('No profiles found. Create one with: coders profile create <name>');
        return;
      }

      console.log('Profiles:');
      for (const profile of profiles) {
        const marker = profile.name === current ? '* ' : '  ';
        const providerIds = Object.keys(profile.providers);
        console.log(`${marker}${profile.name} (${providerIds.length} provider(s) configured)`);

        if (providerIds.length === 0) {
          continue;
        }

        try {
          const credentialInfo = await profileService.getProfileCredentialInfo(profile.name);
          for (const providerId of providerIds) {
            const providerCred = credentialInfo[providerId];
            const authInfo = profile.providers[providerId];
            const authMethod = formatAuthMethod(authInfo?.credentialSource || 'unknown', providerCred);
            console.log(`    - ${providerId}: ${authMethod}`);
          }
        } catch (error) {
          for (const providerId of providerIds) {
            const authInfo = profile.providers[providerId];
            const authMethod = formatAuthMethod(authInfo?.credentialSource || 'unknown');
            console.log(`    - ${providerId}: ${authMethod}`);
          }
          console.warn(
            `    Warning: unable to load credential details (${error instanceof Error ? error.message : String(error)})`
          );
        }
      }
      break;
    }

    case 'create': {
      const name = args[0];
      if (!name) {
        console.error('Profile name is required');
        console.error('Usage: coders profile create <name>');
        process.exit(1);
      }

      store.create(name);
      console.log(`Profile '${name}' created`);

      if (store.list().length === 1) {
        console.log('Set as current profile');
      }
      break;
    }

    case 'create-from-env': {
      await handleCreateFromEnvCommand(context, args);
      break;
    }

    case 'create-from-config': {
      await handleCreateFromConfigCommand(context, args);
      break;
    }

    case 'migrate-to-managed': {
      await handleMigrateToManagedCommand(context);
      break;
    }

    case 'migrate-native': {
      await handleMigrateNativeCommand(context);
      break;
    }

    case 'switch': {
      const name = args[0];
      if (!name) {
        console.error('Profile name is required');
        console.error('Usage: coders profile switch <name>');
        process.exit(1);
      }

      store.setCurrent(name);
      console.log(`Switched to profile '${name}'`);
      await applyProfileCredentials(context, name);
      break;
    }

    case 'delete': {
      const name = args[0];
      if (!name) {
        console.error('Profile name is required');
        console.error('Usage: coders profile delete <name>');
        process.exit(1);
      }

      await store.delete(name);
      console.log(`Profile '${name}' deleted`);

      const newCurrent = store.getCurrentName();
      if (newCurrent) {
        console.log(`Switched to profile '${newCurrent}'`);
      }
      break;
    }

    case 'current': {
      const current = store.getCurrentName();
      if (!current) {
        console.log('No profile selected');
        console.log('Create one with: coders profile create <name>');
        return;
      }

      const profile = store.getCurrent();
      console.log(`Current profile: ${current}`);
      if (!profile) {
        return;
      }

      const providerIds = Object.keys(profile.providers);
      console.log(`  Configured providers: ${providerIds.length}`);
      console.log(`  Created: ${new Date(profile.createdAt).toLocaleString()}`);
      console.log(`  Updated: ${new Date(profile.updatedAt).toLocaleString()}`);

      if (providerIds.length > 0) {
        console.log('\n  Providers:');
        for (const providerId of providerIds) {
          const authInfo = profile.providers[providerId];
          const provider = registry.get(providerId);
          const providerName = provider ? provider.name : providerId;

          console.log(`    - ${providerName}`);
          console.log(`      Auth Method: ${formatAuthMethod(authInfo?.credentialSource || 'unknown')}`);

          if (authInfo?.credentialPath) {
            console.log(`      Credential Path: ${authInfo.credentialPath}`);
          }

          if (authInfo?.lastAuth) {
            console.log(`      Last Auth: ${new Date(authInfo.lastAuth).toLocaleString()}`);
          }

          if (authInfo?.expiresAt) {
            const expiryDate = new Date(authInfo.expiresAt);
            const isValid = Date.now() < authInfo.expiresAt;
            console.log(`      Expires: ${expiryDate.toLocaleString()} ${isValid ? '' : '(expired)'}`);
          }
        }
      }
      break;
    }

    default:
      console.error(`Unknown profile subcommand: ${subcommand}`);
      console.error('Run "coders --help" for usage information');
      process.exit(1);
  }
}

export async function handleCreateFromEnvCommand(context: CliContext, args: string[]): Promise<void> {
  const { profileStore: store, profileService } = context;
  const [envVarArg, profileName] = args;

  let selectedEnvVar = envVarArg;
  if (!selectedEnvVar) {
    const availableEnvVars = profileService.detectAvailableEnvVars();
    if (availableEnvVars.length === 0) {
      console.log('No API key environment variables found.');
      console.log(
        'Available variables: ANTHROPIC_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, AZURE_OPENAI_API_KEY'
      );
      return;
    }

    if (availableEnvVars.length === 1) {
      selectedEnvVar = availableEnvVars[0];
      console.log(`Using environment variable: ${selectedEnvVar}`);
    } else {
      console.log('Available environment variables:');
      availableEnvVars.forEach((env, index) => {
        const value = process.env[env];
        const preview = value ? `${value.substring(0, 20)}...` : 'not set';
        console.log(`  ${index + 1}. ${env} (${preview})`);
      });
      console.log(
        'Please specify the environment variable: coders profile create-from-env <env-var> [profile-name]'
      );
      return;
    }
  }

  const result = await profileService.createProfileFromEnv(selectedEnvVar, profileName);
  if (!result.success) {
    console.log(`Failed to create profile: ${result.error}`);
    return;
  }

  console.log(`Created profile: ${result.profileName}`);
  console.log(`  Provider: ${result.providerId}`);
  console.log(`  API Key: ${result.apiKey.substring(0, 20)}...`);
  console.log(`  Auth Method: ${formatAuthMethod('env')}`);

  store.setCurrent(result.profileName);
  console.log(`Switched to profile: ${result.profileName}`);
}

export async function handleCreateFromConfigCommand(context: CliContext, args: string[]): Promise<void> {
  const { profileStore: store, profileService } = context;
  const profileName = args[0];

  if (!profileName) {
    console.error('Profile name is required');
    console.error('Usage: coders profile create-from-config <name>');
    process.exit(1);
  }

  if (store.exists(profileName)) {
    console.error(`Profile '${profileName}' already exists`);
    process.exit(1);
  }

  console.log(`Creating profile '${profileName}' from configuration...`);

  const result = await profileService.createProfileFromConfig(profileName);
  if (!result.success) {
    console.log(`Failed to create profile: ${result.error}`);
    return;
  }

  console.log(`Profile '${profileName}' created successfully`);
  if (result.providers?.length) {
    console.log(`  Providers configured: ${result.providers.join(', ')}`);
  }

  store.setCurrent(profileName);
  console.log(`Set '${profileName}' as current profile`);
}

export async function handleMigrateToManagedCommand(context: CliContext): Promise<void> {
  const { profileService } = context;
  console.log('Migrating environment variable credentials to managed storage...');
  await profileService.migrateEnvProfilesToManaged();
}

export async function handleMigrateNativeCommand(context: CliContext): Promise<void> {
  const { profileService } = context;
  console.log('Migrating native credentials to managed storage...');
  await profileService.migrateNativeCredentialsToManaged();
}

export async function applyProfileCredentials(context: CliContext, profileName: string): Promise<void> {
  const { profileService } = context;
  const result = await profileService.switchProfile(profileName);

  if (result.appliedCredentials.length > 0) {
    console.log(`Applied credentials for: ${result.appliedCredentials.join(', ')}`);
  }

  if (result.needsRestart.length > 0) {
    console.log(
      `The following providers require a restart to pick up new credentials: ${result.needsRestart.join(', ')}`
    );
  }

  if (result.errors.length > 0) {
    console.log(`Errors while applying credentials:`);
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }
}

