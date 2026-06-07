/**
 * Account/provider brand configuration.
 *
 * Centralizes the brand display name and the openclaw.json provider key so they
 * aren't hardcoded across the UI. Both now derive from the active white-label
 * brand ([[@shared/brand]]). The service URL is user-editable in the login
 * dialog (and persisted per connection); the default URL is only the initial
 * placeholder/fallback.
 */
import { BRAND } from '@shared/brand';

/** Display name shown in the UI ("连接 {brand}", "登录 {brand}", etc.). */
export const ACCOUNT_BRAND = BRAND.appName;

/** openclaw.json provider key under models.providers.* for this brand. */
export const ACCOUNT_PROVIDER_KEY = BRAND.providerKey;
