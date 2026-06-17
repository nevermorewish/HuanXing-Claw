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
  /** Default account/login service address (the login dialog's prefilled server URL). Also the "官网" (official site) link. */
  serviceUrl: string;
  /** Recharge / top-up page URL opened by the "充值" button. */
  rechargeUrl: string;
  /** Base update feed URL; the updater appends the release channel such as `/latest` or `/alpha`. */
  updateFeedBaseUrl: string;
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
  /** Repo-relative PNG source used to generate this brand's app icons. */
  logoPng: string;
  /** Directory (repo-relative) holding this brand's generated icons + optional logo.svg. */
  assetsDir: string;
}
