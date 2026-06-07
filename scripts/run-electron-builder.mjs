#!/usr/bin/env node

/**
 * electron-builder launcher with white-label brand merge.
 *
 * Loads the active brand (brands/<BRAND>.json), deep-merges its identity fields
 * onto the base electron-builder.yml, writes electron-builder.generated.yml, and
 * runs electron-builder with `--config electron-builder.generated.yml`.
 *
 * This is what makes `BRAND=frogclaw pnpm package:win` produce frogclaw.exe with
 * appId app.frogclaw.desktop, while the base electron-builder.yml stays a clean
 * brand-neutral template.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { loadBrand } from './brand.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ELECTRON_BUILDER_BIN = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd')
  : path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
const BASE_CONFIG = path.join(ROOT, 'electron-builder.yml');
const GENERATED_CONFIG = path.join(ROOT, 'electron-builder.generated.yml');

const passthroughArgs = process.argv.slice(2);

/**
 * Resolve a brand icon path with placeholder fallback.
 * Uses <assetsDir>/<file> when the brand ships it, else the base resources/icons/<file>.
 */
function brandIcon(brand, file, fallback) {
  const branded = path.join(ROOT, brand.assetsDir, file);
  return existsSync(branded) ? `${brand.assetsDir}/${file}` : fallback;
}

function buildBrandedConfig(brand) {
  const base = YAML.parse(readFileSync(BASE_CONFIG, 'utf-8'));

  // ── Identity ──────────────────────────────────────────────────
  base.appId = brand.appId;
  base.productName = brand.productName;
  base.copyright = brand.copyright;

  // ── Icons (placeholder fallback to base resources/icons) ──────
  const icnsIcon = brandIcon(brand, 'icon.icns', 'resources/icons/icon.icns');
  const icoIcon = brandIcon(brand, 'icon.ico', 'resources/icons/icon.ico');
  const linuxIconDir = existsSync(path.join(ROOT, brand.assetsDir, 'icons'))
    ? `${brand.assetsDir}/icons`
    : 'resources/icons';

  // ── macOS ─────────────────────────────────────────────────────
  base.mac = base.mac ?? {};
  base.mac.icon = icnsIcon;
  base.mac.extendInfo = {
    ...(base.mac.extendInfo ?? {}),
    NSMicrophoneUsageDescription: `${brand.appName} requires microphone access for voice features`,
    NSCameraUsageDescription: `${brand.appName} requires camera access for video features`,
  };
  if (base.dmg) {
    base.dmg.icon = icnsIcon;
  }

  // ── Windows ───────────────────────────────────────────────────
  base.win = base.win ?? {};
  base.win.icon = icoIcon;
  base.win.executableName = brand.executableName;
  base.nsis = base.nsis ?? {};
  base.nsis.shortcutName = brand.productName;
  base.nsis.uninstallDisplayName = brand.productName;
  base.nsis.installerIcon = icoIcon;
  base.nsis.uninstallerIcon = icoIcon;

  // ── Linux ─────────────────────────────────────────────────────
  base.linux = base.linux ?? {};
  base.linux.icon = linuxIconDir;
  base.linux.maintainer = brand.maintainer;
  base.linux.vendor = brand.vendor;
  base.linux.synopsis = `${brand.tagline} powered by OpenClaw`;
  base.linux.description = `${brand.appName} is a graphical AI assistant application that integrates with OpenClaw Gateway to provide intelligent automation and assistance across multiple messaging platforms.`;
  base.linux.desktop = base.linux.desktop ?? {};
  base.linux.desktop.entry = {
    ...(base.linux.desktop.entry ?? {}),
    Name: brand.appName,
    Comment: `${brand.tagline} powered by OpenClaw`,
    StartupWMClass: brand.linuxWMClass,
  };

  return base;
}

const brand = loadBrand();
const branded = buildBrandedConfig(brand);
writeFileSync(GENERATED_CONFIG, YAML.stringify(branded), 'utf-8');
console.log(`[electron-builder] brand "${brand.id}" → ${brand.executableName} (appId ${brand.appId}); wrote electron-builder.generated.yml`);

const args = ['--config', GENERATED_CONFIG, ...passthroughArgs];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function spawnElectronBuilder() {
  if (process.platform === 'darwin') {
    const command = [
      'ulimit -n 65536 >/dev/null 2>&1 || ulimit -n 32768 >/dev/null 2>&1 || ulimit -n 16384 >/dev/null 2>&1 || true',
      `exec ${shellQuote(ELECTRON_BUILDER_BIN)}${args.length > 0 ? ` ${args.map(shellQuote).join(' ')}` : ''}`,
    ].join('; ');

    return spawn('/bin/bash', ['-lc', command], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  }

  return spawn(ELECTRON_BUILDER_BIN, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
}

const child = spawnElectronBuilder();
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
