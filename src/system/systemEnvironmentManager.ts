import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';

const execFileAsync = promisify(execFile);

export type EnvScope = 'user' | 'system';

export interface EnvMutationOptions {
  scope?: EnvScope;
  persist?: boolean;
  updateProcess?: boolean;
}

export interface EnvQueryOptions {
  scope?: EnvScope;
  preferProcess?: boolean;
}

const POSIX_HEADER = '# Managed by multicoder-auth SystemEnvironmentManager';
const CONFIG_ROOT = path.join(os.homedir(), '.multicoder');
const USER_ENV_FILE = path.join(CONFIG_ROOT, 'env.sh');
const LEGACY_CONFIG_ROOTS = [
  path.join(os.homedir(), '.unycode'),
  path.join(os.homedir(), '.config', 'unycoding'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'unycoding'),
  path.join(os.homedir(), 'Library', 'Application Support', 'unycoding'),
  path.join(os.homedir(), '.config', 'multicoder'),
];
const LEGACY_USER_ENV_FILES = LEGACY_CONFIG_ROOTS.map((root) => path.join(root, 'env.sh'));
const LEGACY_MAC_LAUNCHCTL_SCRIPTS = LEGACY_CONFIG_ROOTS.map((root) => path.join(root, 'mac-launchctl-env.sh'));
const SYSTEM_ENV_FILE = '/etc/profile.d/multicoder.sh';
const LEGACY_SYSTEM_ENV_FILES = ['/etc/profile.d/unycode.sh', '/etc/profile.d/unycoding.sh'];
const MAC_LAUNCH_AGENT_LABEL = 'com.multicoder.env';
const MAC_LAUNCH_AGENT_PATH = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${MAC_LAUNCH_AGENT_LABEL}.plist`
);
const MAC_LAUNCHCTL_SCRIPT = path.join(CONFIG_ROOT, 'mac-launchctl-env.sh');
const POSIX_SHELL_SENTINEL_BEGIN = '# >>> multicoder-auth env >>>';
const POSIX_SHELL_SENTINEL_END = '# <<< multicoder-auth env <<<';

/**
 * SystemEnvironmentManager encapsulates cross-platform environment variable persistence.
 * - Windows: leverages PowerShell's [Environment] API to modify user/system scopes.
 * - macOS: persists to ~/.multicoder/env.sh, ensures shells source it, and mirrors values with launchctl so GUI apps receive them.
 * - Linux: writes export statements to managed profile files (user: ~/.multicoder/env.sh, system: /etc/profile.d/multicoder.sh) and injects sourcing blocks into common shell startup files.
 *
 * Note: mutating system-level values typically requires elevated permissions.
 */
export class SystemEnvironmentManager {
  private readonly systemEnvFile: string;
  private legacyMigrationPerformed = false;

  constructor() {
    this.performLegacyMigration();
    const candidateSystemFiles = [SYSTEM_ENV_FILE, ...LEGACY_SYSTEM_ENV_FILES];
    const existingSystemFile = candidateSystemFiles.find((file) => fsSync.existsSync(file));
    this.systemEnvFile = existingSystemFile ?? SYSTEM_ENV_FILE;
  }

  private performLegacyMigration(): void {
    if (this.legacyMigrationPerformed) {
      return;
    }
    this.legacyMigrationPerformed = true;

    try {
      if (!fsSync.existsSync(CONFIG_ROOT)) {
        fsSync.mkdirSync(CONFIG_ROOT, { recursive: true, mode: 0o700 });
      }
    } catch {
      // Ignore directory creation errors; later operations will surface issues if needed.
    }

    for (const legacyEnvFile of LEGACY_USER_ENV_FILES) {
      this.migrateFile(legacyEnvFile, USER_ENV_FILE, 0o600);
    }

    for (const legacyLaunchctlScript of LEGACY_MAC_LAUNCHCTL_SCRIPTS) {
      this.migrateFile(legacyLaunchctlScript, MAC_LAUNCHCTL_SCRIPT, 0o755);
    }

    for (const legacySystemFile of LEGACY_SYSTEM_ENV_FILES) {
      this.migrateFile(legacySystemFile, SYSTEM_ENV_FILE, 0o644);
    }
  }

  private migrateFile(source: string, target: string, mode: number): void {
    if (!source || source === target) {
      return;
    }
    if (!fsSync.existsSync(source)) {
      return;
    }
    if (fsSync.existsSync(target)) {
      return;
    }

    try {
      const targetDir = path.dirname(target);
      fsSync.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      fsSync.renameSync(source, target);
      fsSync.chmodSync(target, mode);
      return;
    } catch {
      // Fall back to copy
    }

    try {
      const buffer = fsSync.readFileSync(source);
      const targetDir = path.dirname(target);
      fsSync.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      fsSync.writeFileSync(target, buffer, { mode });
    } catch {
      // Ignore copy failure; caller will continue using legacy paths if necessary.
    }
  }

  async get(name: string, options: EnvQueryOptions = {}): Promise<string | null> {
    const scope = options.scope ?? 'user';
    const preferProcess = options.preferProcess !== false;

    if (preferProcess) {
      const immediate = process.env[name];
      if (typeof immediate === 'string') {
        return immediate;
      }
    }

    if (process.platform === 'win32') {
      return await this.getWindowsEnv(name, scope);
    }

    return await this.getPosixEnv(name, scope);
  }

  async list(options: EnvQueryOptions = {}): Promise<Record<string, string>> {
    const scope = options.scope ?? 'user';
    let persisted: Record<string, string>;

    if (process.platform === 'win32') {
      persisted = await this.listWindowsEnv(scope);
    } else {
      persisted = await this.readPosixEnvFile(this.getPosixFilePath(scope));
    }

    if (options.preferProcess === false) {
      return persisted;
    }

    // Overlay with current process values so callers can see latest state.
    const combined = { ...persisted };
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        combined[key] = value;
      }
    }
    return combined;
  }

  async set(name: string, value: string, options: EnvMutationOptions = {}): Promise<void> {
    const scope = options.scope ?? 'user';
    const updateProcess = options.updateProcess !== false;

    if (updateProcess) {
      process.env[name] = value;
    }

    if (options.persist === false) {
      return;
    }

    if (process.platform === 'win32') {
      await this.setWindowsEnv(name, value, scope);
      return;
    }

    if (process.platform === 'darwin') {
      await this.setMacOSEnv(name, value, scope);
      return;
    }

    if (process.platform === 'linux') {
      await this.setLinuxEnv(name, value, scope);
      return;
    }

    await this.setPosixEnv(name, value, scope);
  }

  async remove(name: string, options: EnvMutationOptions = {}): Promise<void> {
    const scope = options.scope ?? 'user';
    const updateProcess = options.updateProcess !== false;

    if (updateProcess && Object.prototype.hasOwnProperty.call(process.env, name)) {
      delete process.env[name];
    }

    if (options.persist === false) {
      return;
    }

    if (process.platform === 'win32') {
      await this.removeWindowsEnv(name, scope);
      return;
    }

    if (process.platform === 'darwin') {
      await this.removeMacOSEnv(name, scope);
      return;
    }

    if (process.platform === 'linux') {
      await this.removeLinuxEnv(name, scope);
      return;
    }

    await this.removePosixEnv(name, scope);
  }

  private async runPowerShell(command: string): Promise<string> {
    const { stdout, stderr } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command
    ], { windowsHide: true });

    if (stderr && stderr.trim().length > 0) {
      throw new Error(stderr.trim());
    }

    return this.trimTrailingNewlines(stdout ?? '');
  }

  private async setWindowsEnv(name: string, value: string, scope: EnvScope): Promise<void> {
    const target = scope === 'system' ? 'Machine' : 'User';
    const escapedName = this.escapeForPowerShell(name);
    const escapedValue = this.escapeForPowerShell(value);
    await this.runPowerShell(`[Environment]::SetEnvironmentVariable('${escapedName}', '${escapedValue}', '${target}')`);
  }

  private async removeWindowsEnv(name: string, scope: EnvScope): Promise<void> {
    const target = scope === 'system' ? 'Machine' : 'User';
    const escapedName = this.escapeForPowerShell(name);
    await this.runPowerShell(`[Environment]::SetEnvironmentVariable('${escapedName}', $null, '${target}')`);
  }

  private async getWindowsEnv(name: string, scope: EnvScope): Promise<string | null> {
    const target = scope === 'system' ? 'Machine' : 'User';
    const escapedName = this.escapeForPowerShell(name);
    const output = await this.runPowerShell(`[Environment]::GetEnvironmentVariable('${escapedName}', '${target}')`);
    return output.length > 0 ? output : null;
  }

  private async listWindowsEnv(scope: EnvScope): Promise<Record<string, string>> {
    const target = scope === 'system' ? 'Machine' : 'User';
    const script = `
$vars = [Environment]::GetEnvironmentVariables('${target}');
$vars.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }
`.trim();

    const output = await this.runPowerShell(script);
    if (!output) {
      return {};
    }

    return output.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
      const index = line.indexOf('=');
      if (index > 0) {
        const key = line.slice(0, index);
        const value = line.slice(index + 1);
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  private escapeForPowerShell(value: string): string {
    return value.replace(/'/g, "''");
  }

  private trimTrailingNewlines(value: string): string {
    return value.replace(/[\r\n]+$/g, '');
  }

  private getPosixFilePath(scope: EnvScope): string {
    if (scope === 'system') {
      return this.systemEnvFile;
    }

    return USER_ENV_FILE;
  }

  private async setPosixEnv(name: string, value: string, scope: EnvScope): Promise<void> {
    const filePath = this.getPosixFilePath(scope);
    const envVars = await this.readPosixEnvFile(filePath);
    envVars[name] = value;

    await this.ensurePosixDirectory(filePath, scope);
    await this.writePosixEnvFile(filePath, envVars, scope);
  }

  private async removePosixEnv(name: string, scope: EnvScope): Promise<void> {
    const filePath = this.getPosixFilePath(scope);
    const envVars = await this.readPosixEnvFile(filePath);

    if (!Object.prototype.hasOwnProperty.call(envVars, name)) {
      return;
    }

    delete envVars[name];

    if (Object.keys(envVars).length === 0) {
      await fs.rm(filePath, { force: true });
      return;
    }

    await this.writePosixEnvFile(filePath, envVars, scope);
  }

  private async getPosixEnv(name: string, scope: EnvScope): Promise<string | null> {
    const filePath = this.getPosixFilePath(scope);
    const envVars = await this.readPosixEnvFile(filePath);
    return envVars[name] ?? null;
  }

  private async readPosixEnvFile(filePath: string): Promise<Record<string, string>> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return this.parsePosixExports(content);
    } catch (error: any) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return {};
      }
      throw error;
    }
  }

  private async writePosixEnvFile(
    filePath: string,
    envVars: Record<string, string>,
    scope: EnvScope
  ): Promise<void> {
    const lines = [POSIX_HEADER];
    const keys = Object.keys(envVars).sort();
    for (const key of keys) {
      lines.push(this.formatPosixExport(key, envVars[key]));
    }
    lines.push(''); // ensure trailing newline

    await fs.writeFile(filePath, lines.join('\n'), { mode: scope === 'system' ? 0o644 : 0o600 });
  }

  private async ensurePosixDirectory(filePath: string, scope: EnvScope): Promise<void> {
    const dir = path.dirname(filePath);
    if (scope === 'system') {
      // /etc/profile.d usually exists; if not, attempt creation.
      if (dir !== '/' && dir.length > 1) {
        await fs.mkdir(dir, { recursive: true });
      }
      return;
    }

    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  private formatPosixExport(name: string, value: string): string {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
    return `export ${name}="${escaped}"`;
  }

  private parsePosixExports(content: string): Record<string, string> {
    return content.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('export ')) {
        return acc;
      }

      const withoutExport = trimmed.slice('export '.length);
      const eqIndex = withoutExport.indexOf('=');
      if (eqIndex === -1) {
        return acc;
      }

      const key = withoutExport.slice(0, eqIndex).trim();
      let rawValue = withoutExport.slice(eqIndex + 1).trim();

      if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        rawValue = rawValue.slice(1, -1);
      } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
        rawValue = rawValue.slice(1, -1);
      }

      const value = rawValue
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

      acc[key] = value;
      return acc;
    }, {});
  }

  private async setLinuxEnv(name: string, value: string, scope: EnvScope): Promise<void> {
    await this.setPosixEnv(name, value, scope);

    if (scope !== 'user') {
      return;
    }

    const envVars = await this.readPosixEnvFile(this.getPosixFilePath(scope));
    const hasEnv = Object.keys(envVars).length > 0;
    await this.ensureLinuxShellIntegration(hasEnv);
  }

  private async removeLinuxEnv(name: string, scope: EnvScope): Promise<void> {
    await this.removePosixEnv(name, scope);

    if (scope !== 'user') {
      return;
    }

    const envVars = await this.readPosixEnvFile(this.getPosixFilePath(scope));
    const hasEnv = Object.keys(envVars).length > 0;
    await this.ensureLinuxShellIntegration(hasEnv);
  }

  private async ensureLinuxShellIntegration(hasEnvVars: boolean): Promise<void> {
    const homeDir = os.homedir();
    const targets = ['.profile', '.bash_profile', '.bashrc', '.zshrc'];
    const block = this.buildShellBlock();

    await Promise.all(targets.map(async (file) => {
      const filePath = path.join(homeDir, file);
      if (hasEnvVars) {
        await this.addShellBlock(filePath, block);
      } else {
        await this.removeShellBlock(filePath);
      }
    }));
  }

  private async setMacOSEnv(name: string, value: string, scope: EnvScope): Promise<void> {
    if (scope === 'system') {
      throw new Error('System scope environment variable persistence is not supported on macOS.');
    }

    await this.setPosixEnv(name, value, scope);
    const envVars = await this.readPosixEnvFile(this.getPosixFilePath(scope));
    const hasEnv = Object.keys(envVars).length > 0;

    await this.ensureMacShellIntegration(hasEnv);
    if (hasEnv) {
      await this.writeMacLaunchctlArtifacts(envVars);
    } else {
      await this.cleanupMacLaunchArtifacts();
    }

    await this.invokeLaunchctl(['setenv', name, value], true);
    // Note: existing GUI processes keep their current environment; new GUI apps inherit updates.
  }

  private async removeMacOSEnv(name: string, scope: EnvScope): Promise<void> {
    if (scope === 'system') {
      throw new Error('System scope environment variable persistence is not supported on macOS.');
    }

    await this.removePosixEnv(name, scope);
    const envVars = await this.readPosixEnvFile(this.getPosixFilePath(scope));
    const hasEnv = Object.keys(envVars).length > 0;

    await this.ensureMacShellIntegration(hasEnv);
    if (hasEnv) {
      await this.writeMacLaunchctlArtifacts(envVars);
    } else {
      await this.cleanupMacLaunchArtifacts();
    }

    await this.invokeLaunchctl(['unsetenv', name], true);
    // GUI apps already running keep prior values; relaunch to pick up removal.
  }

  private async ensureMacShellIntegration(hasEnvVars: boolean): Promise<void> {
    const homeDir = os.homedir();
    const targets = ['.zprofile', '.bash_profile'];
    const block = this.buildShellBlock();

    await Promise.all(targets.map(async (file) => {
      const filePath = path.join(homeDir, file);
      if (hasEnvVars) {
        await this.addShellBlock(filePath, block);
      } else {
        await this.removeShellBlock(filePath);
      }
    }));
  }

  private buildShellBlock(): string {
    const envRef = '$HOME/.multicoder/env.sh';
    return [
      POSIX_SHELL_SENTINEL_BEGIN,
      `ENV_FILE="${envRef}"`,
      'if [ -f "$ENV_FILE" ]; then',
      '  # shellcheck disable=SC1090',
      '  . "$ENV_FILE"',
      'fi',
      POSIX_SHELL_SENTINEL_END
    ].join('\n');
  }

  private async addShellBlock(filePath: string, block: string): Promise<void> {
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error: any) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
      await fs.writeFile(filePath, `${block}\n`, { mode: 0o600 });
      return;
    }

    if (content.includes(POSIX_SHELL_SENTINEL_BEGIN)) {
      return;
    }

    const needsNewline = content.length > 0 && !content.endsWith('\n');
    const updated = `${content}${needsNewline ? '\n' : ''}${block}\n`;
    await fs.writeFile(filePath, updated);
  }

  private async removeShellBlock(filePath: string): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error: any) {
      if (error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const start = content.indexOf(POSIX_SHELL_SENTINEL_BEGIN);
    if (start === -1) {
      return;
    }

    const end = content.indexOf(POSIX_SHELL_SENTINEL_END);
    if (end === -1) {
      return;
    }

    const afterEnd = content.indexOf('\n', end);
    const removalEnd = afterEnd === -1 ? content.length : afterEnd + 1;

    const before = content.slice(0, start).replace(/\s*$/, '');
    const after = content.slice(removalEnd);
    const updated = [before, after].filter(Boolean).join('\n');

    if (updated.trim().length === 0) {
      await fs.rm(filePath, { force: true });
    } else {
      await fs.writeFile(filePath, updated.endsWith('\n') ? updated : `${updated}\n`);
    }
  }

  private async writeMacLaunchctlArtifacts(envVars: Record<string, string>): Promise<void> {
    if (Object.keys(envVars).length === 0) {
      await this.cleanupMacLaunchArtifacts();
      return;
    }

    const configDir = path.dirname(MAC_LAUNCHCTL_SCRIPT);
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    const script = this.buildMacLaunchctlScript(envVars);
    await fs.writeFile(MAC_LAUNCHCTL_SCRIPT, script, { mode: 0o755 });

    const agentDir = path.dirname(MAC_LAUNCH_AGENT_PATH);
    await fs.mkdir(agentDir, { recursive: true, mode: 0o755 });
    const plist = this.buildMacLaunchAgentPlist(MAC_LAUNCHCTL_SCRIPT);
    await fs.writeFile(MAC_LAUNCH_AGENT_PATH, plist, { mode: 0o644 });

    await this.reloadMacLaunchAgent();
  }

  private buildMacLaunchctlScript(envVars: Record<string, string>): string {
    const lines = [
      '#!/bin/sh',
      '# Managed by multicoder-auth SystemEnvironmentManager',
      'ENV_FILE="$HOME/.multicoder/env.sh"',
      'if [ -f "$ENV_FILE" ]; then',
      '  # shellcheck disable=SC1090',
      '  . "$ENV_FILE"',
      'fi',
      ''
    ];

    const keys = Object.keys(envVars).sort();
    for (const key of keys) {
      const expansion = `\\\${${key}:-}`;
      lines.push(`launchctl unsetenv ${key}`);
      lines.push(`launchctl setenv ${key} "${expansion}"`);
    }

    lines.push('exit 0', '');
    return lines.join('\n');
  }

  private buildMacLaunchAgentPlist(scriptPath: string): string {
    const escapedScript = this.escapeXml(scriptPath);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      `  <string>${MAC_LAUNCH_AGENT_LABEL}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      '    <string>/bin/sh</string>',
      `    <string>${escapedScript}</string>`,
      '  </array>',
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '</dict>',
      '</plist>',
      ''
    ].join('\n');
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async reloadMacLaunchAgent(): Promise<void> {
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    if (uid < 0) {
      return;
    }

    const target = `gui/${uid}`;
    await this.invokeLaunchctl(['bootout', target, MAC_LAUNCH_AGENT_PATH], true);
    await this.invokeLaunchctl(['bootstrap', target, MAC_LAUNCH_AGENT_PATH], true);
    await this.invokeLaunchctl(['kickstart', '-k', `${target}/${MAC_LAUNCH_AGENT_LABEL}`], true);
  }

  private async cleanupMacLaunchArtifacts(): Promise<void> {
    await this.invokeLaunchctlBootout();
    await fs.rm(MAC_LAUNCHCTL_SCRIPT, { force: true });
    await fs.rm(MAC_LAUNCH_AGENT_PATH, { force: true });
  }

  private async invokeLaunchctlBootout(): Promise<void> {
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    if (uid < 0) {
      return;
    }
    const target = `gui/${uid}`;
    await this.invokeLaunchctl(['bootout', target, MAC_LAUNCH_AGENT_PATH], true);
    await this.invokeLaunchctl(['remove', MAC_LAUNCH_AGENT_LABEL], true);
  }

  private async invokeLaunchctl(args: string[], ignoreErrors = false): Promise<void> {
    try {
      await execFileAsync('launchctl', args);
    } catch (error: any) {
      if (ignoreErrors) {
        return;
      }
      throw error;
    }
  }
}
