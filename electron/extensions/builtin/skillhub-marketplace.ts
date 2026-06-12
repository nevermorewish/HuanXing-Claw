/**
 * SkillHub Marketplace Extension
 *
 * Provides in-app skill search and install backed by SkillHub (https://skillhub.cn).
 *
 * APIs (verified):
 *   - Search:   GET https://api.skillhub.cn/api/v1/search?q=<query>&limit=<n>
 *               -> { results: [{ slug, displayName|name, summary|description, version, downloads, stars, ... }] }
 *   - Download: GET https://api.skillhub.cn/api/v1/download?slug=<slug>   (primary, returns a .zip)
 *               fallback: https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/<slug>.zip
 *
 * Installed skills land in ~/.openclaw/skills/<slug> (scanned as `openclaw-managed`,
 * so the existing uninstall path works). We also drop a `.clawhub/origin.json` so the
 * local scanner can surface the installed version.
 *
 * The download is a zip; `extract-zip`/`yauzl` are only transitive dev-deps of Electron
 * and get pruned from the packaged app, so we extract with a small self-contained
 * parser over `node:zlib`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getOpenClawSkillsDir, ensureDir } from '../../utils/paths';
import { logger } from '../../utils/logger';
import type {
  Extension,
  ExtensionContext,
  MarketplaceProviderExtension,
  MarketplaceCapability,
} from '../types';
import type {
  MarketplaceSearchParams,
  MarketplaceInstallParams,
  MarketplaceSkillResult,
} from '../../gateway/clawhub';

const SEARCH_URL = 'https://api.skillhub.cn/api/v1/search';
const PRIMARY_DOWNLOAD_TEMPLATE = 'https://api.skillhub.cn/api/v1/download?slug={slug}';
const FALLBACK_DOWNLOAD_TEMPLATE =
  'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/{slug}.zip';

const SEARCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_SEARCH_LIMIT = 30;
const USER_AGENT = 'account-claw-skillhub/1.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Map an HTTP/network failure to a message the renderer's error model understands. */
function describeHttpError(status: number, url: string): string {
  if (status === 429) return `rate limit exceeded (429) for ${url}`;
  return `HTTP ${status} for ${url}`;
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`request timed out for ${url}`, { cause: error });
    }
    throw new Error(`request failed for ${url}: ${reason}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(describeHttpError(response.status, url));
  }
  return response.json();
}

async function downloadZip(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/zip,application/octet-stream,*/*' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`download timed out for ${url}`, { cause: error });
    }
    throw new Error(`download failed for ${url}: ${reason}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(describeHttpError(response.status, url));
  }
  return Buffer.from(await response.arrayBuffer());
}

// ----------------------------------------------------------------------------
// Minimal zip reader (store + deflate) over node:zlib — no native deps.
// ----------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  // Locate the End Of Central Directory record by scanning backwards.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('downloaded file is not a valid zip archive (no EOCD)');

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== SIG_LOCAL) throw new Error('corrupt zip local header');
  // Local header name/extra lengths can differ from the central directory, so read them here.
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return Buffer.from(data); // stored
  if (entry.method === 8) return zlib.inflateRawSync(data); // deflate
  throw new Error(`unsupported zip compression method ${entry.method}`);
}

/** Reject path-traversal / absolute entries before writing anything to disk. */
function isSafeEntryName(name: string): boolean {
  if (!name) return false;
  if (path.isAbsolute(name)) return false;
  const normalized = path.normalize(name).replace(/\\/g, '/');
  return !normalized.split('/').some((seg) => seg === '..');
}

function extractZipToDir(buf: Buffer, targetDir: string): void {
  const entries = readCentralDirectory(buf);
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/');
    if (name.endsWith('/')) continue; // directory marker
    if (!isSafeEntryName(name)) {
      throw new Error(`unsafe zip entry path: ${entry.name}`);
    }
    const destPath = path.join(targetDir, name);
    ensureDir(path.dirname(destPath));
    fs.writeFileSync(destPath, inflateEntry(buf, entry));
  }
}

function fillSlug(template: string, slug: string): string {
  return template.replace('{slug}', encodeURIComponent(slug));
}

class SkillHubMarketplaceExtension implements MarketplaceProviderExtension {
  readonly id = 'builtin/skillhub-marketplace';

  setup(_ctx: ExtensionContext): void {
    // Stateless — exposed via the ClawHubService marketplace provider hook.
  }

  async getCapability(): Promise<MarketplaceCapability> {
    return {
      mode: 'skillhub-marketplace',
      canSearch: true,
      canInstall: true,
    };
  }

  async search(params: MarketplaceSearchParams): Promise<MarketplaceSkillResult[]> {
    const query = asString(params?.query);
    const limit = Math.max(1, Math.min(params?.limit ?? DEFAULT_SEARCH_LIMIT, 100));
    if (!query) {
      // SkillHub's search endpoint requires a query; an empty box just shows the prompt.
      return [];
    }

    const url = `${SEARCH_URL}?${new URLSearchParams({ q: query, limit: String(limit) }).toString()}`;
    const raw = await fetchJson(url);
    if (!isRecord(raw) || !Array.isArray(raw.results)) {
      return [];
    }

    const out: MarketplaceSkillResult[] = [];
    for (const item of raw.results) {
      if (!isRecord(item)) continue;
      const slug = asString(item.slug);
      if (!slug) continue;
      out.push({
        slug,
        name: asString(item.displayName) || asString(item.name) || slug,
        description: asString(item.summary) || asString(item.description),
        version: asString(item.version),
        author: asString(item.owner_name) || asString(item.publisher) || undefined,
        downloads: asNumber(item.downloads),
        stars: asNumber(item.stars),
      });
    }
    return out;
  }

  async install(params: MarketplaceInstallParams): Promise<void> {
    const slug = asString(params?.slug);
    if (!slug) throw new Error('Missing skill slug');

    const skillsRoot = getOpenClawSkillsDir();
    ensureDir(skillsRoot);
    const targetDir = path.join(skillsRoot, slug);

    const candidates = [
      fillSlug(PRIMARY_DOWNLOAD_TEMPLATE, slug),
      fillSlug(FALLBACK_DOWNLOAD_TEMPLATE, slug),
    ];

    let zipBuf: Buffer | null = null;
    let lastError = '';
    for (const url of candidates) {
      try {
        zipBuf = await downloadZip(url);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn(`[skillhub] download failed, trying next source: ${lastError}`);
      }
    }
    if (!zipBuf) {
      throw new Error(`Failed to download "${slug}": ${lastError}`);
    }

    // Stage into a sibling temp dir, then swap, so a partial extract never
    // leaves a half-written skill behind.
    const stageDir = path.join(skillsRoot, `.${slug}.installing`);
    fs.rmSync(stageDir, { recursive: true, force: true });
    ensureDir(stageDir);
    try {
      extractZipToDir(zipBuf, stageDir);

      // Record install origin so the local scanner can show the version and
      // the managed-skill uninstall path applies.
      const originDir = path.join(stageDir, '.clawhub');
      ensureDir(originDir);
      fs.writeFileSync(
        path.join(originDir, 'origin.json'),
        JSON.stringify(
          {
            slug,
            provider: 'skillhub',
            source: 'openclaw-managed',
            installedVersion: asString(params?.version) || undefined,
          },
          null,
          2,
        ),
      );

      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(stageDir, targetDir);
    } catch (error) {
      fs.rmSync(stageDir, { recursive: true, force: true });
      throw error;
    }
  }
}

export function createSkillHubMarketplaceExtension(): Extension {
  return new SkillHubMarketplaceExtension();
}
