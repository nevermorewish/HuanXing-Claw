#!/usr/bin/env zx

import 'zx/globals';
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');

// SkillHub (https://skillhub.cn) download endpoint. Returns a zip whose
// SKILL.md sits at the archive root. Used as the primary source for skills
// SkillHub serves correctly; the rest fall back to a GitHub git checkout.
const SKILLHUB_DOWNLOAD_URL_TEMPLATE = 'https://api.skillhub.cn/api/v1/download?slug={slug}';

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug) {
      throw new Error(`Invalid manifest entry (missing slug): ${JSON.stringify(item)}`);
    }
    const source = item.source || 'github';
    if (source === 'github') {
      if (!item.repo || !item.repoPath) {
        throw new Error(`Invalid github manifest entry (needs repo + repoPath): ${JSON.stringify(item)}`);
      }
    } else if (source === 'skillhub') {
      // The skill `slug` is the download key unless `skillhubSlug` overrides it.
    } else {
      throw new Error(`Unknown source "${source}" for skill ${item.slug}`);
    }
  }
  return parsed.skills;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  // Git on Windows accepts forward slashes and avoids backslash escape quirks.
  return inputPath.replace(/\\/g, '/');
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

async function extractArchive(archiveFileName, cwd) {
  const prevCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`tar -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32') {
        // Some Windows images expose bsdtar instead of tar.
        await $`bsdtar -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = prevCwd;
  }
}

/** Extract a .zip archive into destDir (created if missing). */
async function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    const { execFileSync } = await import('node:child_process');
    // Windows PowerShell 5.1 (.NET Framework) lacks the 3-arg
    // ExtractToDirectory(src, dest, overwrite) overload — destDir was just
    // removed by the caller, so the 2-arg form into a fresh dir is safe.
    const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${destDir.replace(/'/g, "''")}')`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
  } else {
    await $`unzip -q -o ${zipPath} -d ${destDir}`;
  }
}

/** Read the `name:` field from a SKILL.md frontmatter block, if present. */
function readSkillManifestName(skillManifestPath) {
  try {
    const raw = readFileSync(skillManifestPath, 'utf8');
    const frontmatter = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatter) return null;
    const nameMatch = frontmatter[1].match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
    return nameMatch ? nameMatch[1].trim() : null;
  } catch {
    return null;
  }
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  await $`git init ${gitCheckoutDir}`;
  await $`git -C ${gitCheckoutDir} remote add origin ${remote}`;
  await $`git -C ${gitCheckoutDir} fetch --depth 1 origin ${ref}`;
  // Do not checkout working tree on Windows: upstream repos may contain
  // Windows-invalid paths. Export only requested directories via git archive.
  await $`git -C ${gitCheckoutDir} archive --format=tar --output ${archiveFileName} FETCH_HEAD ${archivePaths}`;
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = (await $`git -C ${gitCheckoutDir} rev-parse FETCH_HEAD`).stdout.trim();
  return commit;
}

/**
 * Download a single skill from SkillHub and extract it into targetDir.
 * Validates that SKILL.md exists at the archive root and (when an expected
 * name is given) that its frontmatter name matches — SkillHub occasionally
 * serves mismatched content for missing slugs, so we reject those rather than
 * silently bundling the wrong skill.
 */
async function fetchSkillHubSkill(entry, targetDir) {
  const slug = (entry.skillhubSlug || entry.slug).trim();
  const downloadUrl = SKILLHUB_DOWNLOAD_URL_TEMPLATE.replace('{slug}', encodeURIComponent(slug));
  const zipPath = join(TMP_ROOT, `skillhub-${entry.slug}.zip`);

  echo`   ⬇️  SkillHub: ${downloadUrl}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`SkillHub download failed for "${slug}": HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.subarray(0, 2).toString('latin1') !== 'PK') {
    const contentType = response.headers.get('content-type') || 'unknown';
    throw new Error(`SkillHub returned non-zip for "${slug}" (content-type: ${contentType})`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
  writeFileSync(zipPath, buffer);
  try {
    await extractZip(zipPath, targetDir);
  } finally {
    rmSync(zipPath, { force: true });
  }

  const skillManifest = join(targetDir, 'SKILL.md');
  if (!existsSync(skillManifest)) {
    throw new Error(`SkillHub skill "${slug}" is missing SKILL.md at archive root`);
  }

  // Guard against SkillHub serving mismatched content for a missing slug.
  const expectedName = (entry.expectName || '').trim().toLowerCase();
  if (expectedName) {
    const actualName = (readSkillManifestName(skillManifest) || '').toLowerCase();
    if (actualName && actualName !== expectedName) {
      throw new Error(
        `SkillHub content mismatch for "${slug}": SKILL.md name is "${actualName}", expected "${expectedName}"`,
      );
    }
  }

  // Best-effort version from SkillHub's _meta.json sidecar.
  let version = (entry.version || '').trim() || 'skillhub';
  const metaPath = join(targetDir, '_meta.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta && typeof meta.version === 'string' && meta.version.trim()) {
        version = meta.version.trim();
      }
    } catch {
      // Ignore malformed _meta.json.
    }
  }
  return version;
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch.`;
  process.exit(0);
}

const manifestSkills = loadManifest();

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

const githubSkills = manifestSkills.filter((entry) => (entry.source || 'github') === 'github');
const skillhubSkills = manifestSkills.filter((entry) => entry.source === 'skillhub');

// ── SkillHub-sourced skills (primary source) ─────────────────────────
for (const entry of skillhubSkills) {
  const targetDir = join(OUTPUT_ROOT, entry.slug);
  echo`Fetching ${entry.slug} from SkillHub`;
  const version = await fetchSkillHubSkill(entry, targetDir);
  lock.skills.push({
    slug: entry.slug,
    version,
    source: 'skillhub',
    skillhubSlug: entry.skillhubSlug || entry.slug,
  });
  echo`   OK ${entry.slug}`;
}

// ── GitHub-sourced skills (for slugs SkillHub can't serve) ───────────
const groups = groupByRepoRef(githubSkills);
for (const group of groups) {
  const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
  const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

  echo`Fetching ${group.repo} @ ${group.ref} (GitHub)`;
  const commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
  echo`   commit ${commit}`;

  for (const entry of group.entries) {
    const sourceDir = join(repoDir, entry.repoPath);
    const targetDir = join(OUTPUT_ROOT, entry.slug);

    if (!existsSync(sourceDir)) {
      throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
    }

    const requestedVersion = (entry.version || '').trim();
    const resolvedVersion = !requestedVersion || requestedVersion === 'main'
      ? commit
      : requestedVersion;
    lock.skills.push({
      slug: entry.slug,
      version: resolvedVersion,
      source: 'github',
      repo: entry.repo,
      repoPath: entry.repoPath,
      ref: group.ref,
      commit,
    });

    echo`   OK ${entry.slug}`;
  }
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
rmSync(TMP_ROOT, { recursive: true, force: true });
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
