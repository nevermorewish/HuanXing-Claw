/**
 * Active brand accessor.
 *
 * Import `BRAND` anywhere (main process or renderer, via the `@shared` alias)
 * to read the white-label identity selected at build time. The concrete values
 * live in `active.generated.ts`, regenerated from `brands/<BRAND>.json` by
 * `scripts/generate-brand.mjs`.
 */
import { ACTIVE_BRAND } from './active.generated';
import type { BrandConfig } from './types';

export type { BrandConfig, BrandUrls } from './types';

export const BRAND: BrandConfig = ACTIVE_BRAND;

export default BRAND;
