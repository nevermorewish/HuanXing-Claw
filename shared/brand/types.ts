/**
 * Brand configuration types.
 *
 * A "brand" is the white-label identity of the app (display name, executable
 * name, app id, data dir, account/provider key, …). The active brand is
 * selected at build time via the `BRAND` env var and codegen'd into
 * `active.generated.ts` by `scripts/generate-brand.mjs`.
 *
 * NOTE: This is the app/product + account brand only. The underlying engine
 * ("openclaw") is NOT a brand and must never be parameterized here.
 */

export interface BrandUrls {
  /** Public source/marketing repo or site. */
  github: string;
  /** Issue tracker / support link surfaced in the Help menu. */
  issues: string;
  /** Auto-update feed base URL (generic provider). */
  updateFeed: string;
}

export interface BrandConfig {
  /** Stable lowercase identifier; matches the `brands/<id>.json` filename. */
  id: string;
  /** User-facing product name (UI, window title, tray, account/login). */
  appName: string;
  /** electron-builder productName (installer + app bundle display name). */
  productName: string;
  /** Executable base name → `<executableName>.exe` / Linux binary. */
  executableName: string;
  /** electron-builder appId + Windows AppUserModelID. */
  appId: string;
  /** User-data directory name under home (e.g. `.deepclaw`). */
  dataDirName: string;
  /** Single-instance lock name + lock schema prefix. */
  instanceLockName: string;
  /** openclaw.json `models.providers.*` key for the account brand. */
  providerKey: string;
  /** Copyright line for installers/app metadata. */
  copyright: string;
  /** Vendor name (Linux packaging). */
  vendor: string;
  /** Maintainer "Name <email>" (Linux packaging). */
  maintainer: string;
  /** Linux desktop StartupWMClass. */
  linuxWMClass: string;
  /** Short tagline ("AI Assistant"). */
  tagline: string;
  /** Brand URLs. */
  urls: BrandUrls;
  /** Directory (repo-relative) holding this brand's icons + logo.svg. */
  assetsDir: string;
}
