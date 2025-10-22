import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile } from '@/types';

interface ProfileState {
  profiles: Profile[];
  currentProfileName: string | null;

  // Actions
  setProfiles: (profiles: Profile[]) => void;
  setCurrentProfile: (name: string | null) => void;
  updateProfile: (name: string, updates: Partial<Profile>) => void;

  // Getters
  getCurrentProfile: () => Profile | null;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profiles: [],
      currentProfileName: null,

      setProfiles: (profiles) => {
        set({ profiles });
      },

      setCurrentProfile: (name) => {
        set({ currentProfileName: name });
      },

      updateProfile: (name, updates) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.name === name ? { ...p, ...updates, updatedAt: Date.now() } : p
          ),
        })),

      getCurrentProfile: () => {
        const state = get();
        return state.profiles.find((p) => p.name === state.currentProfileName) || null;
      },
    }),
    {
      name: 'unycode-auth-profiles',
    }
  )
);
