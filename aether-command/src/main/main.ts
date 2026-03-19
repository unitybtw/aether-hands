import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, systemPreferences, session, globalShortcut, powerMonitor } from 'electron';
import { exec } from 'child_process';
import * as path from 'path';
import { SettingsManager } from './SettingsManager';
import { SystemService } from './SystemService';
// Optimization Flags
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128'); // Restrict V8 heap for background process

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
        // Ignore broken pipe errors which occur when writing to console but stdout is closed
        return;
    }
    console.error('Uncaught Exception:', err);
});

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isTracking = false;
let isQuiting = false;

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
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        if (permission === 'media') {
            callback(true);
        } else {
            callback(false);
        }
    });

    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        if (permission === 'media') return true;
        return false;
    });
};

const createTray = () => {
    try {
        const iconPath = path.join(__dirname, '..', '..', 'src', 'assets', 'iconTemplate.png');
        const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
        
        tray = new Tray(icon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Aether Control v1.7', enabled: false },
            { type: 'separator' },
            { label: 'Show Dashboard', click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            }},
            { label: 'Hide Dashboard', click: () => mainWindow?.hide() },
            { type: 'separator' },
            { label: 'Quit', click: () => {
                isQuiting = true;
                app.quit();
            }}
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
        show: true, 
        frame: true,
        titleBarStyle: 'hiddenInset',
        transparent: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));

    mainWindow.on('close', (event) => {
        if (!isQuiting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });

    mainWindow.on('show', () => {
        app.dock?.show();
        mainWindow?.webContents.send('window-visibility', true);
    });
    
    mainWindow.on('hide', () => {
        app.dock?.hide();
        mainWindow?.webContents.send('window-visibility', false);
    });
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
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false
        }
    });

    hudWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'hud.html'));
    hudWindow.setIgnoreMouseEvents(true);
};

app.on('before-quit', () => {
    isQuiting = true;
    globalShortcut.unregisterAll();
});

app.whenReady().then(async () => {
    settingsManager = new SettingsManager();
    systemService = new SystemService();

    if (process.platform === 'darwin') {
        app.dock?.hide();
    }
    
    await checkPermissions();
    createTray();
    createWindow();
    createHudWindow();
    updateActivationPolling();

    // Power Monitor
    powerMonitor.on('suspend', () => {
        console.log('[Main] System suspending, stopping polling.');
        stopActivationPolling();
        mainWindow?.webContents.send('window-visibility', false);
    });

    powerMonitor.on('resume', () => {
        console.log('[Main] System resumed, restarting polling.');
        updateActivationPolling();
        mainWindow?.webContents.send('window-visibility', true);
    });

    // Register Global Shortcut
    globalShortcut.register('Alt+A', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
});

// IPC Handlers
let isKeyHeld = false;
let activationPollTimer: NodeJS.Timeout | null = null;

const stopActivationPolling = () => {
    if (activationPollTimer) {
        clearInterval(activationPollTimer);
        activationPollTimer = null;
    }
    isKeyHeld = true; 
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

ipcMain.on('renderer-log', (_event, level, msg) => {
    console.log(`[Renderer ${level.toUpperCase()}] ${msg}`);
});

ipcMain.on('gesture-action', (_event, action) => {
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
    return settingsManager.getSettings();
});

ipcMain.on('save-settings', (_event, settings) => {
    settingsManager.updateSettings(settings);
    updateActivationPolling();
});

ipcMain.on('set-login-item', (_event, openAtLogin) => {
    app.setLoginItemSettings({
        openAtLogin: openAtLogin,
        openAsHidden: true
    });
});

ipcMain.on('set-tracking-status', (_event, active) => {
    if (tray && active !== isTracking) {
        isTracking = active;
        tray.setToolTip(`Aether Command ${active ? '[LIVE]' : '[IDLE]'}`);
        if (process.platform === 'darwin') {
            tray.setTitle(active ? '●' : ''); 
        }
    }
});

ipcMain.handle('get-login-item', () => {
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('get-activation-state', () => isKeyHeld);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
