// ============================================================================
// Core Types for Unycode Frontend
// ============================================================================

// Provider Types
export type ProviderId = 'gemini' | 'claude' | 'codex';

export type AuthStrategy = 'existing' | 'browser';

// Profile structure matching auth module
export interface Profile {
  name: string;
  providers: {
    [providerId: string]: {
      credentialSource: 'native' | 'managed' | 'env';
      credentialPath?: string;
      lastAuth?: number;
      expiresAt?: number;
    };
  };
  lastProvider?: string;
  model?: string;
  permissionMode: PermissionMode;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

// Permission Types
export type PermissionMode = 'ask' | 'allow' | 'deny';

export type ActionType = 'file_write' | 'file_delete' | 'shell_exec';

export interface PermissionRequest {
  id: string;
  type: ActionType;
  details: string;
  path?: string;
  command?: string;
  preview?: string;
  timestamp: Date;
}

// Message Types
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

// Context Types
export type ContextItemType = 'file' | 'directory';

export interface ContextItem {
  id: string;
  path: string;
  type: ContextItemType;
  size?: number;
}

// Provider Event Types (从 CLI 项目的 ProviderEvent 改编)
export type ProviderEvent =
  | { type: 'text'; content: string }
  | { type: 'file'; path: string; contents: string }
  | { type: 'shell'; command: string }
  | { type: 'ask'; reason: string; action: ActionType }
  | { type: 'progress'; message: string }
  | { type: 'error'; message: string; recoverable?: boolean }
  | { type: 'done' };

// Model Types
export interface Model {
  id: string;
  name: string;
  provider: ProviderId;
}

// Settings Types
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  defaultPermissionMode: PermissionMode;
}
