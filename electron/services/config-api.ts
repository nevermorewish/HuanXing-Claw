/**
 * Config Management API
 *
 * Ports clawpanel's "service management" config features to DeepClaw:
 *   - read / write the OpenClaw config file (openclaw.json)
 *   - validate the config (JSON + UI-field diagnostics)
 *   - calibrate the config (inherit / reset modes)
 *   - backup management (list / create / restore / delete)
 *   - custom OpenClaw config directory (get / set)
 *
 * All paths resolve through getOpenClawConfigDir() so a user-configured custom
 * directory is honored everywhere. Logic mirrors clawpanel's
 * src-tauri/src/commands/config.rs.
 */
import { copyFile, mkdir, readdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import {
  getDefaultOpenClawConfigDir,
  getOpenClawConfigDir,
  isOpenClawConfigDirCustom,
  normalizeOpenClawConfigDir,
  setOpenClawConfigDirOverride,
} from '../utils/paths';
import { setSetting } from '../utils/store';
import { logger } from '../utils/logger';
import { isRecord } from './payload-utils';

type JsonValue = unknown;
type JsonObject = Record<string, JsonValue>;

const CONFIG_FILE_NAME = 'openclaw.json';
const BACKUP_FILE_NAME = 'openclaw.json.bak';
const BACKUPS_DIR_NAME = 'backups';

/** Keys inherited from the seed config in calibrate "reset" mode. */
const CALIBRATION_RESET_INHERIT_KEYS = [
  'agents', 'auth', 'bindings', 'browser', 'channels', 'commands', 'env', 'hooks',
  'models', 'plugins', 'session', 'skills', 'wizard',
];

/** Root-level (and nested model) fields that are UI pollution, stripped on write. */
const KNOWN_UI_FIELDS = [
  'current', 'latest', 'recommended', 'update_available', 'latest_update_available',
  'is_recommended', 'ahead_of_recommended', 'panel_version', 'source',
  'lastTestAt', 'latency', 'testStatus', 'testError', 'profiles',
];

const CALIBRATION_LAST_TOUCHED_VERSION = '2026.1.1';

// ── Path helpers ──────────────────────────────────────────────────

function configPath(): string {
  return join(getOpenClawConfigDir(), CONFIG_FILE_NAME);
}
function backupSidecarPath(): string {
  return join(getOpenClawConfigDir(), BACKUP_FILE_NAME);
}
function backupsDir(): string {
  return join(getOpenClawConfigDir(), BACKUPS_DIR_NAME);
}

// ── JSON helpers (BOM strip + relaxed parse) ──────────────────────

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Best-effort fix for common hand-edit JSON mistakes: trailing commas and
 * doubled commas. Mirrors clawpanel's fix_common_json_errors (conservative subset).
 */
function fixCommonJsonErrors(content: string): string {
  return content
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/,\s*,/g, ',');
}

function parseJsonRelaxed(content: string): JsonValue | undefined {
  try {
    return JSON.parse(content);
  } catch {
    try {
      return JSON.parse(fixCommonJsonErrors(content));
    } catch {
      return undefined;
    }
  }
}

async function readJsonFileRelaxed(path: string): Promise<JsonValue | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    return parseJsonRelaxed(stripBom(raw));
  } catch {
    return undefined;
  }
}

/** Derive a 1-based line/column from a JSON.parse error position. */
function jsonErrorLocation(content: string, err: unknown): { line: number; column: number } {
  const message = err instanceof Error ? err.message : String(err);
  const match = /position (\d+)/.exec(message);
  if (!match) return { line: 0, column: 0 };
  const pos = Number(match[1]);
  let line = 1;
  let column = 1;
  for (let i = 0; i < pos && i < content.length; i += 1) {
    if (content[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

// ── UI-field stripping (ported from strip_ui_fields) ──────────────

function stripUiFields(value: JsonValue): JsonValue {
  if (!isRecord(value)) return value;
  const obj = value as JsonObject;

  for (const key of [
    'current', 'latest', 'recommended', 'update_available', 'latest_update_available',
    'is_recommended', 'ahead_of_recommended', 'panel_version', 'source', 'qqbot', 'profiles',
  ]) {
    delete obj[key];
  }

  if (isRecord(obj.auth)) {
    delete (obj.auth as JsonObject).profiles;
  }

  if (isRecord(obj.models)) {
    const providers = (obj.models as JsonObject).providers;
    if (isRecord(providers)) {
      for (const provider of Object.values(providers as JsonObject)) {
        if (isRecord(provider) && Array.isArray((provider as JsonObject).models)) {
          for (const model of (provider as JsonObject).models as JsonValue[]) {
            if (isRecord(model)) {
              const m = model as JsonObject;
              delete m.lastTestAt;
              delete m.latency;
              delete m.testStatus;
              delete m.testError;
              if (m.name === undefined && typeof m.id === 'string') {
                m.name = m.id;
              }
            }
          }
        }
      }
    }
  }

  if (isRecord(obj.agents)) {
    const agents = obj.agents as JsonObject;
    delete agents.profiles;
    if (Array.isArray(agents.list)) {
      for (const agent of agents.list as JsonValue[]) {
        if (isRecord(agent)) {
          const a = agent as JsonObject;
          delete a.current;
          delete a.latest;
          delete a.update_available;
        }
      }
    }
  }

  return obj;
}

// ── Calibration helpers (ported from config.rs) ───────────────────

function calibrationRequiredOrigins(): string[] {
  // DeepClaw control-UI origins (replaces clawpanel's tauri:// origins).
  return [
    'http://localhost',
    'http://localhost:1420',
    'http://127.0.0.1:1420',
    'http://localhost:18777',
    'http://127.0.0.1:18777',
  ];
}

function calibrationDefaultWorkspace(): string {
  return join(getOpenClawConfigDir(), 'workspace');
}

function generateCalibrationToken(): string {
  return `cp-${randomBytes(16).toString('hex')}`;
}

function hasUsableGatewayAuth(auth: JsonValue): boolean {
  if (!isRecord(auth)) return false;
  const a = auth as JsonObject;
  const mode = typeof a.mode === 'string' ? a.mode : '';
  if (mode === 'token') return typeof a.token === 'string' && a.token.trim().length > 0;
  if (mode === 'password') return typeof a.password === 'string' && a.password.trim().length > 0;
  return false;
}

function nonEmptyObject(value: JsonValue): boolean {
  return isRecord(value) && Object.keys(value as JsonObject).length > 0;
}
function nonEmptyArray(value: JsonValue): boolean {
  return Array.isArray(value) && value.length > 0;
}

function pointer(obj: JsonValue, ...path: string[]): JsonValue | undefined {
  let cur: JsonValue = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = (cur as JsonObject)[key];
  }
  return cur;
}

function calibrationRichnessScore(config: JsonValue): number {
  let score = 0;
  if (nonEmptyObject(pointer(config, 'models', 'providers'))) score += 4;
  if (pointer(config, 'agents', 'defaults') !== undefined) score += 2;
  if (nonEmptyArray(pointer(config, 'agents', 'list'))) score += 3;
  if (nonEmptyObject(pointer(config, 'channels'))) score += 2;
  if (nonEmptyArray(pointer(config, 'bindings'))) score += 2;
  if (nonEmptyObject(pointer(config, 'plugins', 'entries')) || nonEmptyObject(pointer(config, 'plugins', 'installs'))) score += 2;
  if (nonEmptyObject(pointer(config, 'env'))) score += 1;
  if (hasUsableGatewayAuth(pointer(config, 'gateway', 'auth'))) score += 3;
  if (nonEmptyArray(pointer(config, 'gateway', 'controlUi', 'allowedOrigins'))) score += 1;
  return score;
}

function selectCalibrationSource(
  current: JsonValue | undefined,
  backup: JsonValue | undefined,
): { source: string; seed: JsonValue } {
  if (current !== undefined && backup !== undefined) {
    return calibrationRichnessScore(backup) > calibrationRichnessScore(current)
      ? { source: 'backup', seed: backup }
      : { source: 'current', seed: current };
  }
  if (current !== undefined) return { source: 'current', seed: current };
  if (backup !== undefined) return { source: 'backup', seed: backup };
  return { source: 'empty', seed: {} };
}

function buildCalibrationBaseline(): JsonObject {
  return {
    $schema: 'https://openclaw.ai/schema/config.json',
    meta: { lastTouchedVersion: CALIBRATION_LAST_TOUCHED_VERSION },
    models: { providers: {} },
    agents: { defaults: { workspace: calibrationDefaultWorkspace() }, list: [] },
    bindings: [],
    channels: {},
    commands: { native: 'auto', nativeSkills: 'auto', ownerDisplay: 'raw', restart: true },
    plugins: {},
    session: { dmScope: 'per-channel-peer' },
    skills: { entries: {} },
    tools: { profile: 'minimal', sessions: { visibility: 'all' } },
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port: 18789,
      auth: { mode: 'token', token: generateCalibrationToken() },
      controlUi: { enabled: true, allowedOrigins: calibrationRequiredOrigins(), allowInsecureAuth: true },
    },
  };
}

/** Shallow object merge that preserves existing sub-keys (ported from merge_configs_preserving_fields). */
function mergeConfigsPreservingFields(existing: JsonValue, next: JsonValue): JsonValue {
  if (!isRecord(existing) || !isRecord(next)) return next;
  const merged: JsonObject = { ...(existing as JsonObject) };
  for (const [key, nextValue] of Object.entries(next as JsonObject)) {
    const existingValue = (existing as JsonObject)[key];
    if (isRecord(existingValue) && isRecord(nextValue)) {
      merged[key] = { ...(existingValue as JsonObject), ...(nextValue as JsonObject) };
    } else {
      merged[key] = nextValue;
    }
  }
  return merged;
}

function applyResetInheritance(baseline: JsonObject, seed: JsonValue): { config: JsonObject; inherited: string[] } {
  const inherited: string[] = [];
  if (!isRecord(seed)) return { config: baseline, inherited };
  const seedObj = seed as JsonObject;
  for (const key of CALIBRATION_RESET_INHERIT_KEYS) {
    if (seedObj[key] !== undefined) {
      baseline[key] = seedObj[key];
      inherited.push(key);
    }
  }
  const web = pointer(seed, 'tools', 'web');
  if (web !== undefined) {
    if (!isRecord(baseline.tools)) baseline.tools = {};
    (baseline.tools as JsonObject).web = web;
    inherited.push('tools.web');
  }
  return { config: baseline, inherited };
}

function normalizeCalibratedConfig(config: JsonValue): JsonObject {
  if (!isRecord(config)) return buildCalibrationBaseline();
  const root = config as JsonObject;

  root.$schema = 'https://openclaw.ai/schema/config.json';

  if (!isRecord(root.meta)) root.meta = {};
  (root.meta as JsonObject).lastTouchedVersion = CALIBRATION_LAST_TOUCHED_VERSION;
  (root.meta as JsonObject).lastTouchedAt = new Date().toISOString();

  if (!isRecord(root.models)) root.models = {};
  if (!isRecord((root.models as JsonObject).providers)) (root.models as JsonObject).providers = {};

  if (!isRecord(root.agents)) root.agents = {};
  const agents = root.agents as JsonObject;
  if (!isRecord(agents.defaults)) agents.defaults = {};
  const defaults = agents.defaults as JsonObject;
  if (typeof defaults.workspace !== 'string' || !defaults.workspace.trim()) {
    defaults.workspace = calibrationDefaultWorkspace();
  }
  if (!Array.isArray(agents.list)) agents.list = [];

  if (!Array.isArray(root.bindings)) root.bindings = [];
  if (!isRecord(root.channels)) root.channels = {};
  if (!isRecord(root.plugins)) root.plugins = {};

  if (!isRecord(root.tools)) root.tools = {};
  const tools = root.tools as JsonObject;
  if (typeof tools.profile !== 'string' || !tools.profile.trim()) tools.profile = 'minimal';
  if (!isRecord(tools.sessions)) tools.sessions = {};
  const sessions = tools.sessions as JsonObject;
  if (typeof sessions.visibility !== 'string' || !sessions.visibility.trim()) sessions.visibility = 'all';

  if (!isRecord(root.gateway)) root.gateway = {};
  const gateway = root.gateway as JsonObject;
  if (typeof gateway.mode !== 'string' || !gateway.mode.trim()) gateway.mode = 'local';
  const portValid = typeof gateway.port === 'number' && Number.isInteger(gateway.port) && gateway.port >= 1 && gateway.port <= 65535;
  if (!portValid) gateway.port = 18789;
  if (typeof gateway.bind !== 'string' || !gateway.bind.trim()) gateway.bind = 'loopback';
  if (!hasUsableGatewayAuth(gateway.auth)) {
    gateway.auth = { mode: 'token', token: generateCalibrationToken() };
  }
  if (!isRecord(gateway.controlUi)) gateway.controlUi = {};
  const controlUi = gateway.controlUi as JsonObject;
  const existingOrigins = Array.isArray(controlUi.allowedOrigins)
    ? (controlUi.allowedOrigins as JsonValue[]).filter((o): o is string => typeof o === 'string')
    : [];
  const merged = [...existingOrigins];
  for (const origin of calibrationRequiredOrigins()) {
    if (!merged.includes(origin)) merged.push(origin);
  }
  controlUi.allowedOrigins = merged;
  controlUi.enabled = true;
  controlUi.allowInsecureAuth = true;

  return root;
}

// ── Backup helpers ────────────────────────────────────────────────

/** Reject backup names that could traverse outside the backups directory. */
function isUnsafeBackupName(name: string): boolean {
  return name.includes('..') || name.includes('/') || name.includes('\\');
}

function backupTimestamp(): string {
  // Local-time YYYYMMDD-HHMMSS (mirrors clawpanel's chrono::Local formatting).
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function createBackupInternal(): Promise<{ name: string; size: number }> {
  const dir = backupsDir();
  await mkdir(dir, { recursive: true });
  const src = configPath();
  if (!existsSync(src)) {
    throw new Error(`${CONFIG_FILE_NAME} 不存在`);
  }
  const name = `openclaw-${backupTimestamp()}.json`;
  const dest = join(dir, name);
  await copyFile(src, dest);
  const size = (await stat(dest)).size;
  return { name, size };
}

// ── API factory ───────────────────────────────────────────────────

export function createConfigApi(
  deps: { gatewayManager: GatewayManager },
): CompleteHostServiceRegistry['config'] {
  const { gatewayManager } = deps;

  const restartGatewayIfRunning = async (): Promise<void> => {
    try {
      if (gatewayManager.getStatus().state === 'running') {
        await gatewayManager.restart();
      }
    } catch (err) {
      logger.warn('[config-api] gateway restart failed:', err);
    }
  };

  return {
    read: async () => {
      const path = configPath();
      if (!existsSync(path)) {
        return { content: '', exists: false, path };
      }
      const raw = await readFile(path, 'utf8');
      return { content: stripBom(raw), exists: true, path };
    },

    write: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as Record<string, unknown>;
      const content = typeof body.content === 'string' ? body.content : '';
      // Validate JSON before touching disk.
      try {
        JSON.parse(stripBom(content));
      } catch (err) {
        const loc = jsonErrorLocation(content, err);
        return { success: false, error: `JSON 语法错误 (行: ${loc.line}, 列: ${loc.column})` };
      }
      const path = configPath();
      try {
        // Auto-backup the existing file before overwriting.
        if (existsSync(path)) {
          try {
            await createBackupInternal();
          } catch (err) {
            logger.warn('[config-api] pre-write backup failed:', err);
          }
        } else {
          await mkdir(getOpenClawConfigDir(), { recursive: true });
        }
        await writeFile(path, content, 'utf8');
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    validate: async () => {
      const path = configPath();
      if (!existsSync(path)) {
        return { valid: false, error: `${CONFIG_FILE_NAME} 不存在`, warnings: [], uiFields: [] };
      }
      const raw = await readFile(path, 'utf8');
      const content = stripBom(raw);
      let config: JsonValue;
      try {
        config = JSON.parse(content);
      } catch (err) {
        const loc = jsonErrorLocation(content, err);
        const backupExists = existsSync(backupSidecarPath());
        return {
          valid: false,
          error: `JSON 解析失败 (行: ${loc.line}, 列: ${loc.column})`,
          backupExists,
          warnings: backupExists
            ? ['配置文件损坏，建议使用备份恢复']
            : ['配置文件严重损坏且无有效备份'],
          uiFields: [],
        };
      }

      const uiFields: string[] = [];
      const warnings: string[] = [];
      if (isRecord(config)) {
        const obj = config as JsonObject;
        for (const key of Object.keys(obj)) {
          if (KNOWN_UI_FIELDS.includes(key)) uiFields.push(`根层级.${key}`);
        }
        const models = obj.models;
        if (isRecord(models) && isRecord((models as JsonObject).providers)) {
          const providers = (models as JsonObject).providers as JsonObject;
          for (const [providerName, provider] of Object.entries(providers)) {
            if (isRecord(provider) && Array.isArray((provider as JsonObject).models)) {
              (provider as JsonObject).models as JsonValue[];
              ((provider as JsonObject).models as JsonValue[]).forEach((model, idx) => {
                if (isRecord(model)) {
                  for (const field of ['lastTestAt', 'latency', 'testStatus', 'testError']) {
                    if ((model as JsonObject)[field] !== undefined) {
                      uiFields.push(`models.providers.${providerName}.models[${idx}].${field}`);
                    }
                  }
                }
              });
            }
          }
        }
        if (uiFields.length > 0) {
          warnings.push(`发现 ${uiFields.length} 个 UI 专属字段，保存时将被自动清理`);
        }
      }

      return { valid: true, warnings, uiFields };
    },

    calibrate: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as Record<string, unknown>;
      const rawMode = typeof body.mode === 'string' ? body.mode.trim() : '';
      const mode = rawMode === 'inherit' ? 'inherit' : rawMode === 'reset' || rawMode === 'reinitialize' ? 'reset' : null;
      if (!mode) {
        return {
          mode: 'inherit',
          source: 'empty',
          backup: null,
          inheritedKeys: [],
          warnings: ['mode 必须是 inherit 或 reset'],
          message: 'mode 必须是 inherit 或 reset',
          success: false,
        };
      }

      const dir = getOpenClawConfigDir();
      await mkdir(dir, { recursive: true });
      const cfgPath = configPath();
      const bakPath = backupSidecarPath();

      const warnings: string[] = [];
      let preBackup: string | null = null;
      if (existsSync(cfgPath)) {
        try {
          preBackup = (await createBackupInternal()).name;
        } catch (err) {
          warnings.push(`修复前备份失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const current = await readJsonFileRelaxed(cfgPath);
      const backup = await readJsonFileRelaxed(bakPath);
      const { source, seed } = selectCalibrationSource(current, backup);

      let calibrated: JsonObject;
      let inheritedKeys: string[];
      if (mode === 'inherit') {
        inheritedKeys = isRecord(seed) ? Object.keys(seed as JsonObject) : [];
        calibrated = mergeConfigsPreservingFields(buildCalibrationBaseline(), seed) as JsonObject;
      } else {
        const result = applyResetInheritance(buildCalibrationBaseline(), seed);
        calibrated = result.config;
        inheritedKeys = result.inherited;
      }
      inheritedKeys = [...new Set(inheritedKeys)].sort();

      const finalConfig = stripUiFields(normalizeCalibratedConfig(calibrated));
      const json = JSON.stringify(finalConfig, null, 2);

      try {
        await writeFile(cfgPath, json, 'utf8');
        await writeFile(bakPath, json, 'utf8');
      } catch (err) {
        return {
          mode,
          source,
          backup: preBackup,
          inheritedKeys,
          warnings: [...warnings, `写入校准配置失败: ${err instanceof Error ? err.message : String(err)}`],
          message: '写入校准配置失败',
          success: false,
        };
      }

      return {
        mode,
        source,
        backup: preBackup,
        inheritedKeys,
        warnings,
        message: mode === 'inherit' ? '配置已按继承模式校准' : '配置已按完全初始化修复模式校准',
        success: true,
      };
    },

    listBackups: async () => {
      const dir = backupsDir();
      if (!existsSync(dir)) return { backups: [] };
      const entries = await readdir(dir);
      const backups: Array<{ name: string; size: number; createdAt: number }> = [];
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        try {
          const meta = await stat(join(dir, name));
          const created = meta.birthtimeMs || meta.mtimeMs;
          backups.push({ name, size: meta.size, createdAt: Math.floor(created / 1000) });
        } catch {
          // skip unreadable entries
        }
      }
      backups.sort((a, b) => b.createdAt - a.createdAt);
      return { backups };
    },

    createBackup: async () => {
      try {
        const result = await createBackupInternal();
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    restoreBackup: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name : '';
      if (isUnsafeBackupName(name)) return { success: false, error: '非法文件名' };
      const backupPath = join(backupsDir(), name);
      if (!existsSync(backupPath)) return { success: false, error: `备份文件不存在: ${name}` };
      const target = configPath();
      try {
        // Auto-backup current config before restoring over it.
        if (existsSync(target)) {
          try {
            await createBackupInternal();
          } catch (err) {
            logger.warn('[config-api] pre-restore backup failed:', err);
          }
        }
        await copyFile(backupPath, target);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    deleteBackup: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name : '';
      if (isUnsafeBackupName(name)) return { success: false, error: '非法文件名' };
      const path = join(backupsDir(), name);
      if (!existsSync(path)) return { success: false, error: `备份文件不存在: ${name}` };
      try {
        await rm(path, { force: true });
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    getConfigDir: () => ({
      dir: getOpenClawConfigDir(),
      defaultDir: getDefaultOpenClawConfigDir(),
      isCustom: isOpenClawConfigDirCustom(),
    }),

    setConfigDir: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as Record<string, unknown>;
      const rawDir = typeof body.dir === 'string' ? body.dir : '';
      const normalized = normalizeOpenClawConfigDir(rawDir);
      try {
        await setSetting('openClawConfigDir', normalized);
        setOpenClawConfigDirOverride(normalized);
        await restartGatewayIfRunning();
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
