import {
  X,
  Plus,
  Minus,
  Maximize2,
  Minimize2,
  PencilLine,
} from 'lucide-react';
import clsx from 'clsx';
import {
  useState,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { useProfileStore } from '@/stores/profileStore';
import {
  listProfiles,
  createProfile,
  switchProfile,
  deleteProfile,
  loginWithApiKey,
  triggerProviderLogin,
  getCurrentProfile,
  getAuthOptions as fetchAuthOptions,
  linkExistingCredential,
  type AuthOptions as ServiceAuthOptions,
} from '@/services/profileService';
import type { ProviderId, Profile } from '@/types';

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'gemini'];

type ApiKeyType = 'gemini' | 'vertex';
type CodexApiType = 'openai' | 'azure';
type AuthOptions = ServiceAuthOptions;

interface ProfileManagerProps {
  onClose?: () => void;
}

export function ProfileManager({ onClose }: ProfileManagerProps) {
  const appWindowRef = useRef<TauriWindow | null>(null);
  const windowEventUnlisten = useRef<(() => void) | null>(null);
  const windowControlsAvailable = useRef(false);
  const { profiles, currentProfileName, setProfiles, setCurrentProfile } = useProfileStore();
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [profileName, setProfileName] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [authOptions, setAuthOptions] = useState<AuthOptions | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKeyType, setApiKeyType] = useState<ApiKeyType>('gemini');
  const [codexApiType, setCodexApiType] = useState<CodexApiType>('openai');
  const [azureResourceName, setAzureResourceName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [location, setLocation] = useState('us-central1');
  const [editMode, setEditMode] = useState(false);
  const [showProviderMenu, setShowProviderMenu] = useState<string | null>(null);
  const [isLocallyCollapsed, setIsLocallyCollapsed] = useState(false);
  const [isLocallyClosed, setIsLocallyClosed] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    loadProfiles();

    let isMounted = true;

    async function initializeWindowControls() {
      console.log('[ProfileManager] Initializing window controls...');

      try {
        console.log('[ProfileManager] Importing Tauri window API...');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        console.log('[ProfileManager] Got current window:', !!currentWindow);
        appWindowRef.current = currentWindow;
        windowControlsAvailable.current = true;
        setIsLocallyCollapsed(false);
        setIsLocallyClosed(false);
        console.log('[ProfileManager] Window controls initialized successfully');

        try {
          const maximizedState = await currentWindow.isMaximized();
          if (isMounted) {
            setIsMaximized(maximizedState);
          }
        } catch (error) {
          console.error('[ProfileManager] Failed to read maximize state:', error);
        }

        try {
          const unlisten = await currentWindow.onResized(() => {
            currentWindow
              .isMaximized()
              .then((maximizedState) => {
                if (isMounted) {
                  setIsMaximized(maximizedState);
                }
              })
              .catch((error) => {
                console.error('[ProfileManager] Failed to read maximize state:', error);
              });
          });
          windowEventUnlisten.current = unlisten;
        } catch (error) {
          console.error('[ProfileManager] Failed to subscribe to resize events:', error);
        }
      } catch (error) {
        console.error('[ProfileManager] Failed to initialize window controls:', error);
        windowControlsAvailable.current = false;
      }
    }

    initializeWindowControls();

    return () => {
      isMounted = false;
      windowEventUnlisten.current?.();
      windowEventUnlisten.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProfiles = async () => {
    try {
      const { profile: currentProfile } = await getCurrentProfile();
      const { profiles: loadedProfiles } = await listProfiles();
      setProfiles(loadedProfiles);

      if (currentProfile) {
        setCurrentProfile(currentProfile.name);
      } else {
        setCurrentProfile(null);
      }
    } catch (error) {
      console.error('Failed to load profiles:', error);
    }
  };

  const refreshAuthOptions = async (profileName: string, provider: ProviderId) => {
    try {
      const result = await fetchAuthOptions(profileName, provider);
      setAuthOptions(result?.options ?? null);
    } catch (error) {
      console.error('[ProfileManager] Failed to fetch auth options:', error);
      setAuthOptions(null);
    }
  };

  const attemptAutoLinkExistingCredential = async (
    profileName: string,
    provider: ProviderId,
    maxAttempts = 20,
    delayMs = 1500
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await fetchAuthOptions(profileName, provider);
        const options = result?.options ?? null;
        setAuthOptions(options);

        if (options?.linkedCredential) {
          return true;
        }

        if (options?.canLinkExistingCredential && options.existingCredential?.valid) {
          try {
            const linkResult = await linkExistingCredential(profileName, provider);
            if (linkResult?.success) {
              return true;
            }
          } catch (linkError) {
            const message = String(linkError);
            if (message.includes('already linked') || message.includes('already exists')) {
              return true;
            }
            console.warn('[ProfileManager] Failed to link existing credential:', linkError);
          }
        }
      } catch (error) {
        console.warn('[ProfileManager] Auto-link auth options fetch failed:', error);
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return false;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-window-control="true"]')) {
      return;
    }

    const currentWindow = appWindowRef.current;
    if (!currentWindow) return;

    // Don't start dragging if maximized
    if (isMaximized) return;

    currentWindow.startDragging().catch((error) => {
      console.error('[ProfileManager] Failed to start window drag:', error);
    });
  };
  const handleMinimizeWindow = async () => {
    const currentWindow = appWindowRef.current;
    console.log('[ProfileManager] handleMinimizeWindow called', {
      currentWindow: !!currentWindow,
      windowControlsAvailable: windowControlsAvailable.current,
    });
    if (currentWindow && windowControlsAvailable.current) {
      try {
        console.log('[ProfileManager] Calling currentWindow.minimize()');
        await currentWindow.minimize();
        console.log('[ProfileManager] Window minimized successfully');
      } catch (error) {
        console.error('[ProfileManager] Failed to minimize window:', error);
      }
      return;
    }

    console.log('[ProfileManager] Falling back to local collapse');
    setIsLocallyCollapsed((prev) => !prev);
  };

  const handleToggleMaximize = async () => {
    const currentWindow = appWindowRef.current;
    console.log('[ProfileManager] handleToggleMaximize called', {
      currentWindow: !!currentWindow,
      windowControlsAvailable: windowControlsAvailable.current,
    });
    if (!currentWindow || !windowControlsAvailable.current) {
      console.log('[ProfileManager] Falling back to local maximize toggle');
      setIsMaximized((prev) => !prev);
      return;
    }

    try {
      console.log('[ProfileManager] Calling currentWindow.toggleMaximize()');
      await currentWindow.toggleMaximize();
      const maximizedState = await currentWindow.isMaximized();
      console.log('[ProfileManager] Window maximize toggled, new state:', maximizedState);
      setIsMaximized(maximizedState);
    } catch (error) {
      console.error('[ProfileManager] Failed to toggle maximize:', error);
    }
  };

  const handleCloseWindow = async () => {
    const currentWindow = appWindowRef.current;
    console.log('[ProfileManager] handleCloseWindow called', {
      currentWindow: !!currentWindow,
      windowControlsAvailable: windowControlsAvailable.current,
    });
    if (currentWindow && windowControlsAvailable.current) {
      try {
        console.log('[ProfileManager] Calling currentWindow.close()');
        await currentWindow.close();
        console.log('[ProfileManager] Window closed successfully');
      } catch (error) {
        console.error('[ProfileManager] Failed to close window:', error);
      }
      return;
    }

    console.log('[ProfileManager] Falling back to local close');
    if (onClose) {
      onClose();
      return;
    }

    if (typeof window !== 'undefined') {
      window.close();
    }
    setIsLocallyClosed(true);
  };

  const handleSelectProfile = async (profile: Profile) => {
    try {
      await switchProfile(profile.name);
      setCurrentProfile(profile.name);
      await loadProfiles();
    } catch (error) {
      console.error('[ProfileManager] Failed to switch profile:', error);
      alert(`Failed to switch profile: ${error}`);
    }
  };

  const handleDeleteProfile = async (profile: Profile, event: ReactMouseEvent) => {
    event.stopPropagation();
    if (confirm(`Delete profile "${profile.name}"?`)) {
      try {
        await deleteProfile(profile.name);
        await loadProfiles();
      } catch (error) {
        alert(`Failed to delete profile: ${error}`);
      }
    }
  };

  const handleCreateProfile = async () => {
    const trimmedName = profileName.trim();

    if (!trimmedName) {
      alert('Please enter a profile name');
      return;
    }

    if (profiles.some((profile) => profile.name === trimmedName)) {
      alert(`Profile "${trimmedName}" already exists`);
      return;
    }

    setLoading(true);
    try {
      await createProfile({ name: trimmedName, provider: 'claude' });
      await loadProfiles();
      setShowCreateDialog(false);
      setProfileName('');
    } catch (error) {
      alert(`Failed to create profile: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenLoginDialog = (
    profile: Profile,
    provider: ProviderId,
    event: ReactMouseEvent,
  ) => {
    event.stopPropagation();
    setSelectedProfile(profile);
    setSelectedProvider(provider);
    setAuthOptions(null);
    setShowLoginDialog(true);
    setShowProviderMenu(null);
    void refreshAuthOptions(profile.name, provider);
  };

  const handleLoginWithApiKey = async () => {
    if (!selectedProfile || !apiKey.trim()) return;

    setLoading(true);
    try {
      let metadata: Record<string, unknown> | undefined;

      if (selectedProvider === 'codex') {
        metadata = {
          provider: codexApiType,
          baseUrl: baseUrl || undefined,
          azureResourceName: codexApiType === 'azure' ? azureResourceName : undefined,
        };
      } else if (selectedProvider === 'gemini') {
        metadata = {
          apiKeyType,
          projectId: apiKeyType === 'vertex' ? projectId : undefined,
          location: apiKeyType === 'vertex' ? location : undefined,
        };
      } else if (selectedProvider === 'claude') {
        metadata = {
          baseUrl: baseUrl || undefined,
        };
      }

      await loginWithApiKey(selectedProfile.name, selectedProvider, apiKey, metadata);
      await loadProfiles();
      setShowLoginDialog(false);
      setAuthOptions(null);
      setApiKey('');
      setBaseUrl('');
      setAzureResourceName('');
      alert('Login successful!');
    } catch (error) {
      alert(`Login failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyExistingCredential = async () => {
    if (!selectedProfile) return;

    setLoading(true);
    try {
      const result = await linkExistingCredential(selectedProfile.name, selectedProvider);
      if (result?.success) {
        await loadProfiles();
        alert('Credential linked successfully!');
        setShowLoginDialog(false);
        setAuthOptions(null);
      } else {
        alert('Failed to link credential. Please try again.');
      }
    } catch (error) {
      alert(`Failed to link credential: ${error}`);
    } finally {
      setLoading(false);
      if (selectedProfile) {
        void refreshAuthOptions(selectedProfile.name, selectedProvider);
      }
    }
  };

  const handleBrowserLogin = async () => {
    if (!selectedProfile) return;

    setLoading(true);
    try {
      const message = await triggerProviderLogin(selectedProvider);

      let linked = false;
      try {
        linked = await attemptAutoLinkExistingCredential(selectedProfile.name, selectedProvider);
        if (linked) {
          await loadProfiles();
          alert('Login successful!');
          setShowLoginDialog(false);
          setAuthOptions(null);
        }
      } catch (error) {
        console.warn('[ProfileManager] Automatic credential link failed:', error);
      }

      if (!linked) {
        alert(`${message}\n\nWhen the browser flow is finished, click "Apply Existing Credential" to complete the link.`);
        void refreshAuthOptions(selectedProfile.name, selectedProvider);
      }
    } catch (error) {
      alert(`Login failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const renderProviderSource = (source: Profile['providers'][string]['credentialSource']) => {
    if (source === 'native') return 'OAuth';
    if (source === 'managed') return 'API Key';
    return 'Env';
  };

  if (isLocallyClosed) {
    return null;
  }

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
        <WindowControls
          onPointerDown={handlePointerDown}
          onToggleMaximize={handleToggleMaximize}
          onCreateProfile={() => setShowCreateDialog(true)}
          onToggleEditMode={() => setEditMode((prev) => !prev)}
          onMinimize={handleMinimizeWindow}
          onClose={handleCloseWindow}
          editMode={editMode}
          isMaximized={isMaximized}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {!isLocallyCollapsed && (
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <ProfileList
                profiles={profiles}
                currentProfileName={currentProfileName}
                editMode={editMode}
                showProviderMenu={showProviderMenu}
                onToggleProviderMenu={(profileName) =>
                  setShowProviderMenu((current) => (current === profileName ? null : profileName))
                }
                onOpenLoginDialog={handleOpenLoginDialog}
                onSelectProfile={handleSelectProfile}
                onDeleteProfile={handleDeleteProfile}
                renderProviderSource={renderProviderSource}
              />
            </div>
          )}
          <div className="border-t border-white/10 bg-white/5 px-6 py-4 text-xs text-neutral-500">
            Built with ❤️ for the AI development community by ljyou001
          </div>
        </div>
      </div>

      <CreateProfileDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        profileName={profileName}
        onProfileNameChange={setProfileName}
        onCreateProfile={handleCreateProfile}
        loading={loading}
      />

      <ProviderLoginDialog
        isOpen={showLoginDialog && !!selectedProfile}
        onClose={() => {
          setShowLoginDialog(false);
          setShowProviderMenu(null);
          setAuthOptions(null);
        }}
        selectedProfile={selectedProfile}
        selectedProvider={selectedProvider}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        baseUrl={baseUrl}
        onBaseUrlChange={setBaseUrl}
        azureResourceName={azureResourceName}
        onAzureResourceNameChange={setAzureResourceName}
        apiKeyType={apiKeyType}
        onApiKeyTypeChange={setApiKeyType}
        codexApiType={codexApiType}
        onCodexApiTypeChange={setCodexApiType}
        projectId={projectId}
        onProjectIdChange={setProjectId}
        location={location}
        onLocationChange={setLocation}
        loading={loading}
        authOptions={authOptions}
        onApplyExistingCredential={handleApplyExistingCredential}
        onLoginWithApiKey={handleLoginWithApiKey}
        onBrowserLogin={handleBrowserLogin}
      />
    </>
  );
}

interface ExistingCredentialCardProps {
  authOptions: AuthOptions | null;
  loading: boolean;
  onApplyExistingCredential: () => void | Promise<void>;
}

function ExistingCredentialCard({ authOptions, loading, onApplyExistingCredential }: ExistingCredentialCardProps) {
  if (!authOptions) {
    return (
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
        Checking for existing credentials...
      </div>
    );
  }

  const credential = authOptions.existingCredential;

  if (authOptions.linkedCredential) {
    const sourceLabel =
      authOptions.linkedCredential.credentialSource === 'managed'
        ? 'API Key'
        : authOptions.linkedCredential.credentialSource === 'native'
          ? 'OAuth'
          : 'Environment';

    return (
      <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
        <p>
          An existing {sourceLabel} credential is already linked. You can close this dialog and start
          using the provider.
        </p>
      </div>
    );
  }

  if (authOptions.canLinkExistingCredential && credential) {
    const expiresLabel =
      credential.expiresAt != null ? new Date(credential.expiresAt).toLocaleString() : null;

    return (
      <div className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        <div className="space-y-2">
          <p>
            Found an existing {credential.source === 'native' ? 'OAuth' : 'API Key'} credential
            {credential.path ? ` · ${credential.path}` : ''}
          </p>
          {expiresLabel && <p className="text-xs text-amber-200/80">Expires at: {expiresLabel}</p>}
          {!credential.valid && (
            <p className="text-xs text-red-200">
              The credential looks expired. Please re-run the browser login before applying it.
            </p>
          )}
          <button
            onClick={onApplyExistingCredential}
            disabled={loading || !credential.valid}
            className="w-full rounded-xl border border-amber-400/60 bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-100 transition hover:border-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
          >
            Apply Existing Credential
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
      {authOptions.supportsOAuth
        ? 'No existing credential detected. Use browser OAuth or an API key to continue.'
        : 'This provider currently supports API key authentication only.'}
    </div>
  );
}

interface WindowControlsProps {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleMaximize: () => void;
  onCreateProfile: () => void | Promise<void>;
  onToggleEditMode: () => void;
  onMinimize: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
  editMode: boolean;
  isMaximized: boolean;
}

function WindowControls({
  onPointerDown,
  onToggleMaximize,
  onCreateProfile,
  onToggleEditMode,
  onMinimize,
  onClose,
  editMode,
  isMaximized,
}: WindowControlsProps) {
  return (
    <div
      className="flex cursor-grab select-none items-center justify-between border-b border-white/10 px-6 py-4 active:cursor-grabbing"
      onPointerDown={onPointerDown}
      data-tauri-drag-region
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-xs uppercase tracking-[0.4em] text-neutral-500">Auth</span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white">Profile Manager</h2>
      </div>

      <div className="flex items-center gap-3" data-window-control="true">
        <button
          onClick={onCreateProfile}
          className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-neutral-100 transition hover:border-white/20 hover:bg-white/20"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
        <button
          onClick={onToggleEditMode}
          className={clsx(
            'flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition',
            editMode
              ? 'border-amber-400/60 bg-amber-500/20 text-amber-100 hover:border-amber-400 hover:bg-amber-500/30'
              : 'border-white/10 bg-white/10 text-neutral-200 hover:border-white/20 hover:bg-white/20',
          )}
        >
          <PencilLine className="h-3.5 w-3.5" />
          Edit
        </button>
        <div className="ml-2 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1">
          <button
            onClick={onMinimize}
            className="rounded-md p-1 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"
            aria-label="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onToggleMaximize}
            className="rounded-md p-1 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 transition hover:bg-red-500/20 hover:text-red-200"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
interface ProfileListProps {
  profiles: Profile[];
  currentProfileName: string | null;
  editMode: boolean;
  showProviderMenu: string | null;
  onToggleProviderMenu: (profileName: string) => void;
  onOpenLoginDialog: (profile: Profile, provider: ProviderId, event: ReactMouseEvent) => void;
  onSelectProfile: (profile: Profile) => void | Promise<void>;
  onDeleteProfile: (profile: Profile, event: ReactMouseEvent) => void | Promise<void>;
  renderProviderSource: (source: Profile['providers'][string]['credentialSource']) => string;
}

function ProfileList({
  profiles,
  currentProfileName,
  editMode,
  showProviderMenu,
  onToggleProviderMenu,
  onOpenLoginDialog,
  onSelectProfile,
  onDeleteProfile,
  renderProviderSource,
}: ProfileListProps) {
  if (profiles.length === 0) {
    return <EmptyProfilesState />;
  }

  return (
    <div className="space-y-4">
      {profiles.map((profile) => (
        <div
          key={profile.name}
          className={clsx(
            'cursor-pointer rounded-2xl border px-5 py-5 transition-all duration-200 ease-out',
            profile.name === currentProfileName
              ? 'border-emerald-400/70 bg-emerald-500/15 shadow-[0_25px_55px_-25px_rgba(16,185,129,0.5)]'
              : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10',
          )}
          onClick={() => onSelectProfile(profile)}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-lg font-semibold text-white">{profile.name}</h3>
                {profile.name === currentProfileName && (
                  <span className="rounded-full border border-emerald-400/50 bg-emerald-500/20 px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-200">
                    Active
                  </span>
                )}
                <span className="text-xs uppercase tracking-wide text-neutral-500">
                  Last used {profile.lastUsedAt ? new Date(profile.lastUsedAt).toLocaleString() : '-'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(profile.providers).map(([providerId, providerInfo]) => (
                  <span
                    key={providerId}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-200"
                  >
                    {providerId}
                    <span className="text-[10px] font-normal text-neutral-400">
                      {renderProviderSource(providerInfo.credentialSource)}
                    </span>
                  </span>
                ))}
                <div className="relative">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleProviderMenu(profile.name);
                    }}
                    className="flex items-center justify-center gap-1 rounded-full border border-white/10 bg-white/10 p-2 text-sm text-neutral-200 transition hover:border-white/20 hover:bg-white/20"
                    aria-label="Add provider"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  {showProviderMenu === profile.name && (
                    <div className="absolute left-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 p-1 shadow-xl backdrop-blur">
                      {PROVIDERS.map((provider) => (
                        <button
                          key={provider}
                          onClick={(event) => onOpenLoginDialog(profile, provider, event)}
                          className="w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-200 transition hover:bg-white/10"
                        >
                          {provider.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {editMode && (
              <button
                onClick={(event) => onDeleteProfile(profile, event)}
                className="self-start rounded-full border border-red-400/60 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-200 transition hover:border-red-400 hover:bg-red-500/25"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyProfilesState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/5 px-6 py-16 text-center text-neutral-400">
      <span className="rounded-full border border-white/10 bg-white/10 p-4 text-neutral-200">
        <Plus className="h-6 w-6" />
      </span>
      <p className="text-lg font-medium text-neutral-100">No profiles yet</p>
      <p className="max-w-sm text-sm text-neutral-400">
        Create your first profile to start linking providers and credentials.
      </p>
    </div>
  );
}
interface CreateProfileDialogProps {
  isOpen: boolean;
  onClose: () => void | Promise<void>;
  profileName: string;
  onProfileNameChange: (value: string) => void;
  onCreateProfile: () => void | Promise<void>;
  loading: boolean;
}

function CreateProfileDialog({
  isOpen,
  onClose,
  profileName,
  onProfileNameChange,
  onCreateProfile,
  loading,
}: CreateProfileDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/90 p-6 text-neutral-100 shadow-2xl backdrop-blur"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Create New Profile</h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/10 p-1.5 text-neutral-300 transition hover:border-white/25 hover:bg-white/25 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-300">Profile Name</label>
            <input
              type="text"
              value={profileName}
              onChange={(event) => onProfileNameChange(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/25"
              placeholder="e.g., Workspace, Production"
              autoFocus
            />
            <p className="mt-1 text-xs text-neutral-500">You can link providers after creation.</p>
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <button
            onClick={onCreateProfile}
            disabled={loading}
            className="flex-1 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/20 hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
interface ProviderLoginDialogProps {
  isOpen: boolean;
  onClose: () => void | Promise<void>;
  selectedProfile: Profile | null;
  selectedProvider: ProviderId;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  azureResourceName: string;
  onAzureResourceNameChange: (value: string) => void;
  apiKeyType: ApiKeyType;
  onApiKeyTypeChange: (value: ApiKeyType) => void;
  codexApiType: CodexApiType;
  onCodexApiTypeChange: (value: CodexApiType) => void;
  projectId: string;
  onProjectIdChange: (value: string) => void;
  location: string;
  onLocationChange: (value: string) => void;
  loading: boolean;
  authOptions: AuthOptions | null;
  onApplyExistingCredential: () => void | Promise<void>;
  onLoginWithApiKey: () => void | Promise<void>;
  onBrowserLogin: () => void | Promise<void>;
}

function ProviderLoginDialog({
  isOpen,
  onClose,
  selectedProfile,
  selectedProvider,
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  azureResourceName,
  onAzureResourceNameChange,
  apiKeyType,
  onApiKeyTypeChange,
  codexApiType,
  onCodexApiTypeChange,
  projectId,
  onProjectIdChange,
  location,
  onLocationChange,
  loading,
  authOptions,
  onApplyExistingCredential,
  onLoginWithApiKey,
  onBrowserLogin,
}: ProviderLoginDialogProps) {
  if (!isOpen || !selectedProfile) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-900/95 p-6 text-neutral-100 shadow-2xl backdrop-blur"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              Connect {selectedProvider.toUpperCase()} for {selectedProfile.name}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Choose how you'd like to authenticate this provider.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/10 p-1.5 text-neutral-300 transition hover:border-white/25 hover:bg-white/25 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ExistingCredentialCard
          authOptions={authOptions}
          loading={loading}
          onApplyExistingCredential={onApplyExistingCredential}
        />

        {selectedProvider === 'codex' && (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-300">API Type</label>
              <select
                value={codexApiType}
                onChange={(event) => onCodexApiTypeChange(event.target.value as CodexApiType)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/25"
              >
                <option value="openai">OpenAI (api.openai.com)</option>
                <option value="azure">Azure OpenAI</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-300">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/25"
                placeholder="sk-..."
              />
            </div>
            {codexApiType === 'azure' ? (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-300">Azure Resource Name</label>
                  <input
                    type="text"
                    value={azureResourceName}
                    onChange={(event) => onAzureResourceNameChange(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/25"
                    placeholder="my-resource"
                  />
                  <p className="mt-1 text-xs text-neutral-500">The resource name from your Azure OpenAI endpoint.</p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-300">Base URL (Optional)</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(event) => onBaseUrlChange(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/25"
                    placeholder="https://my-resource.openai.azure.com/..."
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="mb-2 block text-sm font-medium text-neutral-300">Base URL (Optional)</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(event) => onBaseUrlChange(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/25"
                  placeholder="https://api.openai.com/v1"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={onLoginWithApiKey}
                disabled={loading || !apiKey || (codexApiType === 'azure' && !azureResourceName)}
                className="w-full rounded-xl border border-blue-400/60 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 transition hover:border-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
              >
                {loading ? 'Logging in...' : 'Login with API Key'}
              </button>
              <button
                onClick={onBrowserLogin}
                disabled={loading || (authOptions !== null && !authOptions.supportsOAuth)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
              >
                {loading ? 'Opening...' : 'Browser Login (OAuth)'}
              </button>
            </div>
          </div>
        )}

        {selectedProvider === 'gemini' && (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-300">API Key Type</label>
              <select
                value={apiKeyType}
                onChange={(event) => onApiKeyTypeChange(event.target.value as ApiKeyType)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/25"
              >
                <option value="gemini">Gemini API Key</option>
                <option value="vertex">Vertex AI API Key</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-300">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/25"
                placeholder="AI... or ya29..."
              />
            </div>
            {apiKeyType === 'vertex' && (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-300">Project ID</label>
                  <input
                    type="text"
                    value={projectId}
                    onChange={(event) => onProjectIdChange(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/25"
                    placeholder="my-project-id"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-300">Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(event) => onLocationChange(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/25"
                    placeholder="us-central1"
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={onLoginWithApiKey}
                disabled={loading || !apiKey || (apiKeyType === 'vertex' && !projectId)}
                className="w-full rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {loading ? 'Logging in...' : 'Login with API Key'}
              </button>
              <button
                onClick={onBrowserLogin}
                disabled={loading || (authOptions !== null && !authOptions.supportsOAuth)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
              >
                {loading ? 'Opening...' : 'Browser Login (OAuth)'}
              </button>
            </div>
          </div>
        )}

        {selectedProvider === 'claude' && (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-300">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/25"
                placeholder="sk-ant-..."
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-300">Base URL (Optional)</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(event) => onBaseUrlChange(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/25"
                placeholder="https://api.anthropic.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={onLoginWithApiKey}
                disabled={loading || !apiKey}
                className="w-full rounded-xl border border-violet-400/60 bg-violet-500/20 px-4 py-2 text-sm font-medium text-violet-100 transition hover:border-violet-400 hover:bg-violet-500/30 disabled:opacity-50"
              >
                {loading ? 'Logging in...' : 'Login with API Key'}
              </button>
              <button
                onClick={onBrowserLogin}
                disabled={loading || (authOptions !== null && !authOptions.supportsOAuth)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
              >
                {loading ? 'Opening...' : 'Browser Login (OAuth)'}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/20 hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
