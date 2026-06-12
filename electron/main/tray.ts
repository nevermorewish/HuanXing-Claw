/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';
import { BRAND } from '@shared/brand';
import { MENU_LABELS } from '@shared/i18n/resources';
import { resolveSupportedLanguage, type LanguageCode } from '@shared/language';
import { getSetting } from '../utils/store';

let tray: Tray | null = null;
// Keep the window the tray drives so the menu can be rebuilt on language change.
let trayWindow: BrowserWindow | null = null;

function applyAppName(label: string): string {
  return label.replaceAll('{{appName}}', BRAND.appName);
}

async function resolveTrayLanguage(language?: string): Promise<LanguageCode> {
  if (language) return resolveSupportedLanguage(language);
  try {
    return resolveSupportedLanguage(await getSetting('language'));
  } catch {
    return resolveSupportedLanguage(app.getLocale());
  }
}

/** Build the localized tray context menu for the given window. */
function buildTrayMenu(mainWindow: BrowserWindow, labels: typeof MENU_LABELS[LanguageCode]): Menu {
  const tray = labels.tray;
  return Menu.buildFromTemplate([
    {
      label: applyAppName(tray.show),
      click: () => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      type: 'separator',
    },
    {
      label: tray.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${tray.running}`,
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: tray.quickActions,
      submenu: [
        {
          label: tray.openChat,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/');
          },
        },
        {
          label: tray.openSettings,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: tray.checkForUpdates,
      click: () => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: applyAppName(tray.quit),
      click: () => {
        app.quit();
      },
    },
  ]);
}

/**
 * Rebuild the tray context menu in the current/given language.
 * No-op when the tray hasn't been created (e.g. E2E mode).
 */
export async function refreshTrayMenu(language?: string): Promise<void> {
  if (!tray || !trayWindow || trayWindow.isDestroyed()) return;
  const labels = MENU_LABELS[await resolveTrayLanguage(language)];
  tray.setContextMenu(buildTrayMenu(trayWindow, labels));
}

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use Template.png for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  
  tray = new Tray(icon);
  trayWindow = mainWindow;

  // Set tooltip
  tray.setToolTip(`${BRAND.appName} - ${BRAND.tagline}`);

  // Build an initial menu synchronously from the app locale so the tray is
  // usable immediately, then refresh from the persisted language setting.
  tray.setContextMenu(
    buildTrayMenu(mainWindow, MENU_LABELS[resolveSupportedLanguage(app.getLocale())]),
  );
  void refreshTrayMenu();

  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  
  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  
  return tray;
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  if (tray) {
    tray.setToolTip(`${BRAND.appName} - ${status}`);
  }
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
