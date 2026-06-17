# DeepClaw Application Icons

This directory contains the default application icons. White-label brand icons
are generated under `resources/brands/<brand>/` and are selected during
packaging by `scripts/run-electron-builder.mjs`.

## Brand Sources

Each brand declares its PNG icon source in `brands/<brand>.json`:

```json
{
  "logoPng": "brands/frogclawlogo.png",
  "assetsDir": "resources/brands/frogclaw"
}
```

The source PNG should be a square `1024x1024` image. `pnpm run icons` converts it
into the platform assets electron-builder needs:

| Output | Platform | Description |
|--------|----------|-------------|
| `resources/brands/<brand>/icon.icns` | macOS | Apple Icon Image format |
| `resources/brands/<brand>/icon.ico` | Windows | Windows ICO format |
| `resources/brands/<brand>/icon.png` | All | 512x512 PNG fallback |
| `resources/brands/<brand>/16x16.png` - `512x512.png` | Linux/fallback | Root PNG set |
| `resources/brands/<brand>/icons/16x16.png` - `512x512.png` | Linux | Icon directory used by electron-builder |
| `resources/brands/<brand>/tray-icon-Template.png` | macOS | 22x22 status bar icon |

## Generating Icons

```bash
# Default brand, currently huanxingclaw
pnpm run icons

# Specific brand
BRAND=frogclaw pnpm run icons
BRAND=fengchiclaw pnpm run icons
BRAND=huanxingclaw pnpm run icons
```

On Windows PowerShell:

```powershell
$env:BRAND = 'frogclaw'
pnpm run icons
```

Packaging runs icon generation automatically through `pnpm package`, and the
GitHub release/manual package workflows run it for each matrix brand before
calling electron-builder.

## Packaging Selection

`scripts/run-electron-builder.mjs` loads the active `BRAND` and points
electron-builder at:

- `resources/brands/<brand>/icon.ico` for Windows
- `resources/brands/<brand>/icon.icns` for macOS and DMG
- `resources/brands/<brand>/icons` for Linux

If a brand asset is missing, packaging falls back to the default
`resources/icons` files.

## Tray Icon

The macOS tray icon uses `tray-icon-template.svg` from the brand asset directory
when present, otherwise it falls back to `resources/icons/tray-icon-template.svg`.
The generated file must be named `tray-icon-Template.png` so Electron treats it
as a template image.
