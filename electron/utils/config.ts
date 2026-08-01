/**
 * Application Configuration
 * Centralized configuration constants and helpers
 */
import { BRAND } from '@shared/brand';

/**
 * Port configuration
 */
export const PORTS = {
  /** App GUI development server port */
  APP_DEV: 5173,

  /** App GUI production port (for reference) */
  APP_GUI: 23333,

  /** Local host API server port */
  APP_HOST_API: 13210,

  /** OpenClaw Gateway port */
  OPENCLAW_GATEWAY: 18789,
} as const;

/**
 * Get port from environment or default
 */
export function getPort(key: keyof typeof PORTS): number {
  const envKey = `DEEPCLAW_PORT_${key}`;
  const envValue = process.env[envKey];
  return envValue ? parseInt(envValue, 10) : PORTS[key];
}

/**
 * Application paths
 */
export const APP_PATHS = {
  /** OpenClaw configuration directory (brand-specific, e.g. ~/.frogclaw) */
  OPENCLAW_CONFIG: `~/${BRAND.dataDirName}`,

  /** Brand configuration directory */
  BRAND_CONFIG: `~/${BRAND.dataDirName}`,

  /** Log files directory */
  LOGS: `~/${BRAND.dataDirName}/logs`,
} as const;

/**
 * Update channels
 */
export const UPDATE_CHANNELS = ['stable', 'beta', 'dev'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/**
 * Default update configuration
 */
export const UPDATE_CONFIG = {
  /** Check interval in milliseconds (6 hours) */
  CHECK_INTERVAL: 6 * 60 * 60 * 1000,
  
  /** Default update channel */
  DEFAULT_CHANNEL: 'stable' as UpdateChannel,
  
  /** Auto download updates */
  AUTO_DOWNLOAD: false,
  
  /** Show update notifications */
  SHOW_NOTIFICATION: true,
};

/**
 * Gateway configuration
 */
export const GATEWAY_CONFIG = {
  /** WebSocket reconnection delay (ms) */
  RECONNECT_DELAY: 5000,
  
  /** RPC call timeout (ms) */
  RPC_TIMEOUT: 30000,
  
  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL: 30000,
  
  /** Maximum startup retries */
  MAX_STARTUP_RETRIES: 30,
  
  /** Startup retry interval (ms) */
  STARTUP_RETRY_INTERVAL: 1000,
};

/**
 * Managed Tavily-compatible search service used by branded desktop builds.
 * The credential is restricted by TavilyProxyManager to search/extract only.
 */
export const TAVILY_CONFIG = {
  baseUrl: 'https://tavily.fengchiyun.com',
  apiKey: '3JElum7mkWtDU8IzA8rZERBekzzcYyNkW-v0iAhArkI',
  provider: 'tavily',
} as const;
