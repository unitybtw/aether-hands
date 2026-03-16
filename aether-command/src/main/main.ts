import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, systemPreferences } from 'electron';
import { exec } from 'child_process';
import * as path from 'path';
import { SettingsManager } from './SettingsManager';
import { SystemService } from './SystemService';

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

let settingsManager: SettingsManager;
let systemService: SystemService;

const checkPermissions = async () => {
  if (process.platform !== 'darwin') return;
  
  const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
  console.log(`[Main] Current Camera Status: ${cameraStatus}`);
  
  if (cameraStatus !== 'granted') {
    console.log('[Main] Requesting Camera Access...');
    const granted = await systemPreferences.askForMediaAccess('camera');
    console.log(`[Main] Camera Access Result: ${granted}`);
  }

  // Explicitly handle renderer permission requests
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_webContents: any, permission: string, callback: (granted: boolean) => void) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((_webContents: any, permission: string) => {
    if (permission === 'media') return true;
    return false;
  });
};

const createTray = () => {
    try {
        const iconPath = path.join(__dirname, '..', '..', 'src', 'assets', 'iconTemplate.png');
        const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
        
        // Removed setTemplateImage(true) to support color icons
        tray = new Tray(icon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Aether Control v1.5', enabled: false },
            { type: 'separator' },
            { label: 'Dashboard', click: () => mainWindow?.show() },
            { label: 'Quit', click: () => app.quit() }
        ]);

        tray.setToolTip('Aether Command');
        tray.setContextMenu(contextMenu);
    } catch (error) {
        console.error('[Main] Tray creation failed:', error);
    }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: true, // Explicitly show on launch so user knows it's working
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));
};

const createHudWindow = () => {
  hudWindow = new BrowserWindow({
      width: 400,
      height: 300,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
      }
  });

  hudWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'hud.html'));
  hudWindow.setIgnoreMouseEvents(true);
};

app.whenReady().then(async () => {
  // Initialize services after app is ready
  settingsManager = new SettingsManager();
  systemService = new SystemService();

  app.dock.hide();
  
  await checkPermissions();
  createTray();
  createWindow();
  createHudWindow();
  updateActivationPolling();
});

// IPC Handlers
let isKeyHeld = false;
let activationPollTimer: NodeJS.Timeout | null = null;

const stopActivationPolling = () => {
    if (activationPollTimer) {
        clearInterval(activationPollTimer);
        activationPollTimer = null;
    }
    isKeyHeld = true; // Always on when not polling
    mainWindow?.webContents.send('activation-state-changed', true);
};

const startActivationPolling = () => {
    if (activationPollTimer) return;
    
    activationPollTimer = setInterval(() => {
        const settings = settingsManager.getSettings();
        if (!settings.requireKey) {
            stopActivationPolling();
            return;
        }

        const maskMap: Record<string, number> = {
            'Command': 1048576,
            'Option': 524288,
            'Control': 262144
        };
        const mask = maskMap[settings.activationKey] || 1048576;
        
        exec("osascript -e 'use framework \"AppKit\"' -e \"current application's |NSEvent|'s modifierFlags()\"", (err, stdout) => {
            if (!err) {
                const flags = parseInt(stdout.trim());
                if (isNaN(flags)) return;

                const held = (flags & mask) !== 0;
                if (held !== isKeyHeld) {
                    isKeyHeld = held;
                    mainWindow?.webContents.send('activation-state-changed', held);
                }
            }
        });
    }, 150);
};

const updateActivationPolling = () => {
    const settings = settingsManager.getSettings();
    if (settings.requireKey) {
        startActivationPolling();
    } else {
        stopActivationPolling();
    }
};

ipcMain.on('renderer-log', (event, level, msg) => {
    console.log(`[Renderer ${level.toUpperCase()}] ${msg}`);
});

ipcMain.on('gesture-action', (event, action) => {
    if (!isKeyHeld) {
        console.log('[Main] Gesture blocked: Activation key NOT held.');
        return;
    }
    if (hudWindow) {
        if (!hudWindow.isVisible()) hudWindow.showInactive();
        hudWindow.webContents.send('show-hud', action);
    }
    systemService.execute(action);
});

ipcMain.handle('get-settings', () => {
    console.log('[Main] IPC: get-settings requested');
    const s = settingsManager.getSettings();
    console.log('[Main] IPC: get-settings responding with:', JSON.stringify(s));
    return s;
});

ipcMain.on('save-settings', (event, settings) => {
    settingsManager.updateSettings(settings);
    updateActivationPolling();
});

ipcMain.on('set-login-item', (event, openAtLogin) => {
    app.setLoginItemSettings({
        openAtLogin: openAtLogin,
        openAsHidden: true
    });
});

ipcMain.handle('get-login-item', () => {
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('get-activation-state', () => isKeyHeld);

// Window management
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
