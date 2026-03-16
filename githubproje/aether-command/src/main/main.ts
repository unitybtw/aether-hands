import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, systemPreferences } from 'electron';
import * as path from 'path';
import { SettingsManager } from './SettingsManager';
import { SystemService } from './SystemService';

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const settingsManager = new SettingsManager();
const systemService = new SystemService();

const checkPermissions = async () => {
  if (process.platform !== 'darwin') return;
  
  const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
  if (cameraStatus !== 'granted') {
    await systemPreferences.askForMediaAccess('camera');
  }
};

const createTray = () => {
    const iconPath = path.join(__dirname, '..', '..', 'src', 'assets', 'iconTemplate.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
    icon.setTemplateImage(true);

    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Aether Control', enabled: false },
        { type: 'separator' },
        { label: 'Dashboard', click: () => mainWindow?.show() },
        { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setToolTip('Aether Command');
    tray.setContextMenu(contextMenu);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simplicity in this build
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
          nodeIntegration: true,
          contextIsolation: false
      }
  });

  hudWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'hud.html'));
  hudWindow.setIgnoreMouseEvents(true);
};

app.whenReady().then(async () => {
  app.dock.hide();
  
  await checkPermissions();
  createTray();
  createWindow();
  createHudWindow();
});

// IPC Handlers
ipcMain.on('gesture-action', (event, action) => {
    // 1. Trigger HUD
    if (hudWindow) {
        if (!hudWindow.isVisible()) hudWindow.showInactive();
        hudWindow.webContents.send('show-hud', action);
    }

    // 2. Execute System Action
    systemService.execute(action);
});

ipcMain.handle('get-settings', () => settingsManager.getSettings());
ipcMain.on('save-settings', (event, settings) => settingsManager.updateSettings(settings));

ipcMain.on('set-login-item', (event, openAtLogin) => {
    app.setLoginItemSettings({
        openAtLogin: openAtLogin,
        openAsHidden: true
    });
});

ipcMain.handle('get-login-item', () => {
    return app.getLoginItemSettings().openAtLogin;
});

// Window management
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
