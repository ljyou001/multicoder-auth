import { SystemEnvironmentManager } from './systemEnvironmentManager.js';

export type CodexEnvMode = 'openai' | 'azure';

export interface CodexEnvConfig {
  mode: CodexEnvMode;
  baseUrl?: string;
  azureResourceName?: string;
}

export const CODEX_ENV_VARS = ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL'] as const;

export function computeAzureBaseUrl(resourceName: string): string {
  return `https://${resourceName}.openai.azure.com/openai/deployments/gpt-5-codex`;
}

export async function clearCodexEnvironment(
  manager: SystemEnvironmentManager
): Promise<string[]> {
  const cleared: string[] = [];
  for (const envVar of CODEX_ENV_VARS) {
    try {
      await manager.remove(envVar);
      cleared.push(envVar);
    } catch {
      // Ignore removal failures; variable may not exist yet or be read-only.
    }
  }
  return cleared;
}

export async function applyCodexEnvironment(
  manager: SystemEnvironmentManager,
  apiKey: string,
  config: CodexEnvConfig
): Promise<string[]> {
  await clearCodexEnvironment(manager);

  const updated: string[] = [];

  await manager.set('OPENAI_API_KEY', apiKey);
  updated.push('OPENAI_API_KEY');

  if (config.mode === 'azure') {
    await manager.set('AZURE_OPENAI_API_KEY', apiKey);
    updated.push('AZURE_OPENAI_API_KEY');
  }

  if (config.baseUrl) {
    await manager.set('OPENAI_BASE_URL', config.baseUrl);
    updated.push('OPENAI_BASE_URL');
  }

  return updated;
}
