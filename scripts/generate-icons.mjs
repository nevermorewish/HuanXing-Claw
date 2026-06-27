#!/usr/bin/env zx

import 'zx/globals';
import sharp from 'sharp';
import png2icons from 'png2icons';
import { fileURLToPath } from 'url';
import { loadBrand } from './brand.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FALLBACK_ICONS_DIR = path.join(PROJECT_ROOT, 'resources', 'icons');
// Brand-neutral fallback source, used only when a brand declares no logoPng.
// (The former root favicon.svg was removed; brands now own their logos.)
const FALLBACK_SVG_SOURCE = path.join(FALLBACK_ICONS_DIR, 'icon.svg');
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];

function repoPath(...parts) {
  return path.join(PROJECT_ROOT, ...parts);
}

function pathForLog(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, '/');
}

function resolveSource(brand) {
  if (brand.logoPng) {
    const logoPng = repoPath(brand.logoPng);
    if (fs.existsSync(logoPng)) {
      return logoPng;
    }
    echo(chalk.yellow`  Brand logo source not found: ${pathForLog(logoPng)}; falling back to ${pathForLog(FALLBACK_SVG_SOURCE)}`);
  }

  if (!fs.existsSync(FALLBACK_SVG_SOURCE)) {
    echo(chalk.red`  No brand logo source and fallback SVG not found: ${pathForLog(FALLBACK_SVG_SOURCE)}`);
    process.exit(1);
  }
  return FALLBACK_SVG_SOURCE;
}

async function generateTrayIcon(brand, outDir) {
  const brandedTray = repoPath(brand.assetsDir, 'tray-icon-template.svg');
  const fallbackTray = path.join(FALLBACK_ICONS_DIR, 'tray-icon-template.svg');
  const traySource = fs.existsSync(brandedTray) ? brandedTray : fallbackTray;

  if (!fs.existsSync(traySource)) {
    echo`  tray-icon-template.svg not found, skipping tray icon generation`;
    return;
  }

  await sharp(traySource)
    .resize(22, 22)
    .png()
    .toFile(path.join(outDir, 'tray-icon-Template.png'));
  echo`  Created tray-icon-Template.png (22x22)`;
}

const brand = loadBrand();
const outDir = repoPath(brand.assetsDir);
const iconsDir = path.join(outDir, 'icons');
const source = resolveSource(brand);

echo`Generating ${brand.appName} icons from ${pathForLog(source)}...`;

await fs.ensureDir(outDir);
await fs.ensureDir(iconsDir);

try {
  const masterPngBuffer = await sharp(source)
    .resize(1024, 1024, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  await sharp(masterPngBuffer)
    .resize(512, 512)
    .toFile(path.join(outDir, 'icon.png'));
  echo`  Created icon.png (512x512)`;

  const icoBuffer = png2icons.createICO(masterPngBuffer, png2icons.HERMITE, 0, false);
  if (!icoBuffer) {
    throw new Error('png2icons failed to create icon.ico');
  }
  fs.writeFileSync(path.join(outDir, 'icon.ico'), icoBuffer);
  echo`  Created icon.ico`;

  const icnsBuffer = png2icons.createICNS(masterPngBuffer, png2icons.HERMITE, 0);
  if (!icnsBuffer) {
    throw new Error('png2icons failed to create icon.icns');
  }
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icnsBuffer);
  echo`  Created icon.icns`;

  for (const size of LINUX_SIZES) {
    const fileName = `${size}x${size}.png`;
    const resized = await sharp(masterPngBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    await fs.writeFile(path.join(iconsDir, fileName), resized);
    await fs.writeFile(path.join(outDir, fileName), resized);
  }
  echo`  Created ${LINUX_SIZES.length} Linux PNG icons`;

  await generateTrayIcon(brand, outDir);

  echo`\nIcon generation complete for ${brand.id}: ${pathForLog(outDir)}`;
} catch (error) {
  echo(chalk.red`\nFatal error: ${error.message}`);
  process.exit(1);
}
