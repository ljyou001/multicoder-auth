import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { computeAzureBaseUrl, type CodexEnvConfig } from '../../system/codexEnv.js';

export async function promptInput(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, (value) => {
      rl.close();
      resolve(value);
    });
  });
  return answer.trim();
}

export async function promptRequiredInput(question: string): Promise<string> {
  while (true) {
    const answer = await promptInput(question);
    if (answer.length > 0) {
      return answer;
    }
    console.log('Value cannot be empty. Please try again.');
  }
}

export async function promptCodexApiKey(
  mode: 'openai' | 'azure'
): Promise<{ apiKey: string; config: CodexEnvConfig }> {
  if (mode === 'openai') {
    const apiKey = await promptRequiredInput('Enter OPENAI_API_KEY: ');
    const baseUrl = await promptInput("OPENAI_BASE_URL (optional, press Enter if you don't know): ");
    if (baseUrl) {
      console.log(`Will set OPENAI_BASE_URL to ${baseUrl}`);
    } else {
      console.log('Keeping default OpenAI endpoint (OPENAI_BASE_URL will be unset).');
    }
    return {
      apiKey,
      config: {
        mode: 'openai',
        baseUrl: baseUrl || undefined,
      },
    };
  }

  const apiKey = await promptRequiredInput('Enter AZURE_OPENAI_API_KEY: ');
  const resourceName = await promptRequiredInput('Azure resource name (YOUR_RESOURCE_NAME): ');
  const baseUrl = computeAzureBaseUrl(resourceName);
  console.log(`Will set OPENAI_BASE_URL to ${baseUrl}`);
  return {
    apiKey,
    config: {
      mode: 'azure',
      azureResourceName: resourceName,
      baseUrl,
    },
  };
}
