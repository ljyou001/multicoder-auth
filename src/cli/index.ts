import { createCliContext } from './context.js';
import { handleProfileCommand } from './commands/profile.js';
import {
  handleLoginCommand,
  handleLogoutCommand,
  handleStatusCommand,
  handleWhoamiCommand,
} from './commands/auth.js';

function showHelp(providerIds: string[]): void {
  const providers = providerIds.join(', ');
  console.log(`
coders - Authentication and Profile Management

PROFILE COMMANDS:
  profile list                 List all profiles
  profile create <name>        Create a new profile
  profile create-from-env      Create profile from environment variable
  profile create-from-config   Create profile from local configuration
  profile switch <name>        Switch to a profile
  profile delete <name>        Delete a profile
  profile current              Show current profile

AUTH COMMANDS:
  login <provider>             Login to a provider (${providers})
  logout <provider>            Logout from a provider
  status                       Show authentication status for all providers
  whoami                       Show current profile and auth info

OPTIONS:
  --profile <name>             Use specific profile for auth commands
  --google-api-key <key>       Use Google API key for Gemini authentication
  --gemini-api-key <key>       Use Gemini API key for Gemini authentication
  --anthropic-api-key <key>    Use Anthropic API key for Claude authentication
  --openai-api-key <key>       Use OpenAI API key for Codex authentication
  --openai-base-url <url>      Override OpenAI API base URL for Codex (optional)
  --azure-openai-api-key <key> Use Azure OpenAI API key for Codex authentication
  --azure-resource-name <name> Azure resource name for Codex (requires --azure-openai-api-key)
  -h, --help                   Show this help message
`);
}

export async function runCli(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  const context = createCliContext();

  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    showHelp(context.registry.listIds());
    return;
  }

  const [command, subcommand, ...rest] = rawArgs;

  try {
    switch (command) {
      case 'profile': {
        if (!subcommand) {
          console.error('Profile subcommand is required');
          process.exit(1);
        }
        await handleProfileCommand(context, subcommand, rest);
        break;
      }

      case 'login':
        await handleLoginCommand(context, subcommand, rest);
        break;

      case 'logout':
        await handleLogoutCommand(context, subcommand, rest);
        break;

      case 'status':
        await handleStatusCommand(context);
        break;

      case 'whoami':
        await handleWhoamiCommand(context);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "coders --help" for usage information');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
