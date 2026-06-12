#!/usr/bin/env node
/**
 * Brand loader — single source of truth for the active white-label brand.
 *
 * The active brand is selected by the `BRAND` env var (defaults to "huanxingclaw").
 * Concrete values live in `brands/<id>.json`. Shared by all build-time
 * generators (generate-brand.mjs, run-electron-builder.mjs, CLI/NSIS tooling).
 *
 * NOTE: This is the app/product + account brand. The underlying engine
 * ("openclaw") is NOT a brand and must never be parameterized here.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');
export const BRANDS_DIR = resolve(ROOT, 'brands');
export const DEFAULT_BRAND_ID = 'huanxingclaw';

const REQUIRED_FIELDS = [
  'id',
  'appName',
  'productName',
  'executableName',
  'appId',
  'dataDirName',
  'instanceLockName',
  'providerKey',
  'serviceUrl',
  'rechargeUrl',
  'updateFeedBaseUrl',
  'copyright',
  'vendor',
  'maintainer',
  'linuxWMClass',
  'tagline',
  'assetsDir',
];

/** List available brand ids (filenames without .json) under brands/. */
export function listBrands() {
  if (!existsSync(BRANDS_DIR)) return [];
  return readdirSync(BRANDS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * Resolve and validate the active brand config.
 * @param {string} [id] explicit brand id; falls back to env BRAND, then default.
 * @returns {object} the validated brand config object.
 */
export function loadBrand(id) {
  const brandId = (id || process.env.BRAND || DEFAULT_BRAND_ID).trim();
  const file = join(BRANDS_DIR, `${brandId}.json`);

  if (!existsSync(file)) {
    const available = listBrands();
    throw new Error(
      `[brand] Unknown brand "${brandId}". Expected brands/${brandId}.json.` +
        (available.length ? ` Available: ${available.join(', ')}.` : ''),
    );
  }

  let brand;
  try {
    brand = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`[brand] Failed to parse ${file}: ${err.message}`);
  }

  const missing = REQUIRED_FIELDS.filter((k) => brand[k] === undefined || brand[k] === null);
  if (missing.length) {
    throw new Error(`[brand] ${file} is missing required field(s): ${missing.join(', ')}.`);
  }
  if (brand.id !== brandId) {
    throw new Error(`[brand] ${file} declares id "${brand.id}" but filename is "${brandId}.json".`);
  }

  return brand;
}
