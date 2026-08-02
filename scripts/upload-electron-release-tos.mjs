#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { basename, extname, join, resolve } from 'node:path';
import YAML from 'yaml';

const SOURCE_DIR = resolve(process.env.RELEASE_SOURCE_DIR || 'release');
const BRAND = requiredEnv('BRAND');
const REQUESTED_VERSION = process.env.RELEASE_VERSION?.replace(/^v/u, '');
const TOS_BASE_URL = requiredHttpsUrl(
  process.env.RELEASE_TOS_BASE_URL
    || process.env.UPDATE_FEED_BASE_URL
    || 'https://huanxing.tos-cn-beijing.volces.com/package/huanxingclaw',
);
const DRY_RUN = process.env.RELEASE_TOS_DRY_RUN === '1';
const UPLOAD_CONCURRENCY = positiveIntegerEnv('RELEASE_TOS_UPLOAD_CONCURRENCY', 3);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredHttpsUrl(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== 'https:') throw new Error(`TOS URL must use https: ${value}`);
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url;
}

function positiveIntegerEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, received: ${raw}`);
  }
  return value;
}

function publicUrl(objectPath) {
  const url = new URL(TOS_BASE_URL);
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/${objectPath.split('\\').join('/')}`;
  return url.toString();
}

function contentType(fileName) {
  switch (extname(fileName).toLowerCase()) {
    case '.yml': return 'text/yaml; charset=utf-8';
    case '.exe': return 'application/vnd.microsoft.portable-executable';
    case '.dmg': return 'application/x-apple-diskimage';
    case '.zip': return 'application/zip';
    case '.blockmap': return 'application/octet-stream';
    default: return 'application/octet-stream';
  }
}

function assetName(value) {
  const text = String(value || '').split('?')[0].split('#')[0];
  return basename(text.replaceAll('\\', '/'));
}

export function rewriteUpdaterManifest(text, versionedUrlFor) {
  const document = YAML.parseDocument(text);
  const root = document.toJS();
  if (!root || typeof root !== 'object') throw new Error('updater manifest must be a YAML object');

  if (Array.isArray(root.files)) {
    for (const file of root.files) {
      if (!file || typeof file !== 'object' || !file.url) continue;
      file.url = versionedUrlFor(assetName(file.url));
    }
  }
  if (root.path) root.path = versionedUrlFor(assetName(root.path));
  return `${YAML.stringify(root).trimEnd()}\n`;
}

function uploadFile(filePath, objectPath, contentLength) {
  return new Promise((resolveUpload, rejectUpload) => {
    let body = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) rejectUpload(error);
      else resolveUpload();
    };

    const url = new URL(publicUrl(objectPath));
    const request = httpsRequest(url, {
      method: 'PUT',
      headers: {
        'cache-control': objectPath.includes('/latest/') || objectPath.endsWith('.yml')
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=31536000, immutable',
        'content-length': String(contentLength),
        'content-type': contentType(filePath),
      },
    }, (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 8192) body += chunk;
      });
      response.on('error', finish);
      response.on('aborted', () => finish(new Error(`TOS response aborted for ${url}`)));
      response.on('end', () => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          finish(new Error(`TOS upload HTTP ${status}${body.trim() ? `: ${body.trim()}` : ''}`));
        } else finish();
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error(`TOS upload timed out for ${url}`)));
    request.on('error', finish);
    const source = createReadStream(filePath);
    source.on('error', (error) => request.destroy(error));
    source.pipe(request);
  });
}

async function upload(filePath, objectPath) {
  if (DRY_RUN) {
    console.log(`[TOS dry-run] ${filePath} -> ${publicUrl(objectPath)}`);
    return;
  }
  const { size } = await stat(filePath);
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await uploadFile(filePath, objectPath, size);
      console.log(`Uploaded ${objectPath}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 5000));
    }
  }
  throw new Error(`TOS upload failed for ${objectPath}: ${lastError?.message || lastError}`);
}

async function mapWithConcurrency(items, concurrency, task) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await task(item);
      }
    },
  );
  await Promise.all(workers);
}

async function packageVersion() {
  if (REQUESTED_VERSION) return REQUESTED_VERSION;
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
  return String(packageJson.version).replace(/^v/u, '');
}

async function main() {
  const version = await packageVersion();
  const channel = process.env.RELEASE_CHANNEL || (/-([a-z]+)(?:\.|$)/iu.exec(version)?.[1] || 'latest');
  const files = (await readdir(SOURCE_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== 'builder-debug.yml')
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error(`No release files found under ${SOURCE_DIR}`);

  const root = `${BRAND}`;
  const latestRoot = `${root}/${channel}`;
  const versionRoot = `${root}/releases/v${version}`;
  const versionedUrlFor = (fileName) => publicUrl(`${versionRoot}/${fileName}`);

  const manifests = files.filter((fileName) => fileName.toLowerCase().endsWith('.yml'));
  const assets = files.filter((fileName) => !fileName.toLowerCase().endsWith('.yml'));
  if (manifests.length === 0) throw new Error(`No updater manifest found under ${SOURCE_DIR}`);

  // Manifests contain absolute versioned URLs, so large immutable assets only
  // need one upload. Upload independent assets concurrently, then publish the
  // small manifests last so clients never discover an incomplete release.
  await mapWithConcurrency(assets, UPLOAD_CONCURRENCY, async (fileName) => {
    const filePath = join(SOURCE_DIR, fileName);
    await upload(filePath, `${versionRoot}/${fileName}`);
  });

  for (const fileName of manifests) {
    const filePath = join(SOURCE_DIR, fileName);
    const rewritten = rewriteUpdaterManifest(await readFile(filePath, 'utf8'), versionedUrlFor);
    await writeFile(filePath, rewritten, 'utf8');
    await upload(filePath, `${versionRoot}/${fileName}`);
    await upload(filePath, `${latestRoot}/${fileName}`);
  }

  console.log(`Published ${BRAND} ${version} (${channel}) update feed to ${publicUrl(`${latestRoot}/`)}`);
}

main().catch((error) => {
  console.error(`[TOS] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
