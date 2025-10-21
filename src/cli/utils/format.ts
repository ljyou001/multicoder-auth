export function formatAuthMethod(source: string, credentialInfo?: any): string {
  const apiKeyType = (credentialInfo?.apiKeyType || '').toLowerCase();
  const envVarName = (credentialInfo?.envVarName || credentialInfo?.envVar || '').toUpperCase();
  const usesVertex = credentialInfo?.useVertexAi === true || apiKeyType === 'vertex';
  const isGeminiKey =
    apiKeyType === 'gemini' ||
    apiKeyType === 'google' ||
    envVarName === 'GEMINI_API_KEY' ||
    envVarName === 'GOOGLE_API_KEY';

  switch (source) {
    case 'native':
      return 'OAuth (Browser Login)';
    case 'managed':
      if (credentialInfo?.claudeAiOauth || credentialInfo?.geminiOauth) {
        return 'OAuth (Browser Login)';
      }
      if (usesVertex) {
        return 'Vertex AI API Key';
      }
      if (isGeminiKey) {
        return 'Gemini API Key';
      }
      if (credentialInfo?.envVarName) {
        return `API Key (${credentialInfo.envVarName})`;
      }
      if (credentialInfo?.apiKey) {
        return 'API Key';
      }
      return 'API Key';
    case 'env':
      if (usesVertex) {
        return `Vertex AI API Key (${credentialInfo?.envVar || 'Environment'})`;
      }
      if (isGeminiKey) {
        return `Gemini API Key (${credentialInfo?.envVar || 'Environment'})`;
      }
      return `API Key (${credentialInfo?.envVar || 'Environment'})`;
    default:
      return 'Unknown';
  }
}
