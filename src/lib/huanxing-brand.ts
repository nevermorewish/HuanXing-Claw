/**
 * Huanxing brand configuration.
 *
 * Centralizes the brand display name and the openclaw.json provider key so they
 * aren't hardcoded across the UI. The service URL is user-editable in the login
 * dialog (and persisted per connection); DEFAULT_HUANXING_URL is only the
 * initial placeholder/fallback.
 */

/** Display name shown in the UI ("连接 {brand}", "登录 {brand}", etc.). */
export const HUANXING_BRAND = 'Huanxing';

/** openclaw.json provider key under models.providers.* for this brand. */
export const HUANXING_PROVIDER_KEY = 'huanxing';
