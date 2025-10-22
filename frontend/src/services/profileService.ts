import { invoke } from '@tauri-apps/api/core';
import type { Profile, ProviderId, Model } from '@/types';

export interface CreateProfileParams {
  name: string;
  provider: ProviderId;
}

/**
 * Create a new profile
 */
export async function createProfile(params: CreateProfileParams): Promise<{ profile: Profile }> {
  return await invoke('create_profile', params as unknown as Record<string, unknown>);
}

/**
 * Switch to a different profile
 */
export async function switchProfile(profileId: string): Promise<void> {
  await invoke('switch_profile', { profileId });
}

/**
 * Get all available profiles
 */
export async function listProfiles(): Promise<{ profiles: Profile[] }> {
  return await invoke('list_profiles');
}

/**
 * Delete a profile
 */
export async function deleteProfile(profileId: string): Promise<void> {
  await invoke('delete_profile', { profileId });
}

/**
 * Get current profile
 */
export async function getCurrentProfile(): Promise<{ profile: Profile | null }> {
  return await invoke('get_current_profile');
}

/**
 * Login with API key
 */
export async function loginWithApiKey(
  profileName: string,
  provider: ProviderId,
  apiKey: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean }> {
  return await invoke('login_with_api_key', { profileName, provider, apiKey, metadata });
}

/**
 * Check if a provider is logged in
 */
export async function checkProviderLogin(provider: ProviderId, profileName: string): Promise<boolean> {
  return await invoke('check_provider_login', { provider, profileName });
}

/**
 * Trigger native provider login
 */
export async function triggerProviderLogin(provider: ProviderId): Promise<string> {
  return await invoke('trigger_provider_login', { provider });
}

/**
 * Get available models for a provider
 */
export async function getAvailableModels(provider: ProviderId): Promise<Model[]> {
  return await invoke('get_available_models', { provider });
}

/**
 * Switch model for current profile
 */
export async function switchModel(modelId: string): Promise<void> {
  await invoke('switch_model', { modelId });
}
