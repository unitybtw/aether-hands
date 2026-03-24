import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, systemPreferences, session, globalShortcut, powerMonitor, screen } from 'electron';
import { exec } from 'child_process';
import * as path from 'path';
import { SettingsManager } from './SettingsManager';
import { SystemService } from './SystemService';
// Optimization Flags
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128'); // Restrict V8 heap for background process
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');
app.commandLine.appendSwitch('enable-accelerated-video');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-gpu-rasterization');

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
        // Ignore broken pipe errors which occur when writing to console but stdout is closed
        return;
    }
    console.error('Uncaught Exception:', err);
});

let mainWindow: BrowserWindow | null = null;
let hudWindow: BrowserWindow | null = null;
let laserWindow: BrowserWindow | null = null;
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

    // Crucial: Check for Accessibility Privileges for Mouse/Keyboard Event posting
    // Without this, the C-Daemon will flood syslogs and bloat the CPU if it tries to move the mouse
    const isAccessibilityGranted = systemPreferences.isTrustedAccessibilityClient(true);
    console.log(`[Main] Accessibility Privileges: ${isAccessibilityGranted ? 'Granted' : 'Denied/Prompted'}`);

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
        const icon = nativeImage.createFromPath(iconPath)
            .resize({ width: 18, height: 18 });
        icon.setTemplateImage(true);
        
        tray = new Tray(icon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Aether Command v1.8', enabled: false },
            { type: 'separator' },
            { label: 'Toggle Tracking (Arm/Disarm)', click: () => {
                isKeyHeld = !isKeyHeld;
                mainWindow?.webContents.send('activation-state-changed', isKeyHeld);
            }},
            { type: 'separator' },
            { label: 'Show Dashboard', click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            }},
            { label: 'Hide Dashboard', click: () => mainWindow?.hide() },
            { type: 'separator' },
            { label: 'Quit Aether', click: () => {
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
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    hudWindow = new BrowserWindow({
        width: 500,
        height: 350,
        x: Math.floor(width / 2) - 250,
        y: Math.floor(height / 2) - 175,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        type: 'panel', // Float above full screen apps on Mac
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false
        }
    });

    hudWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'hud.html'));
    hudWindow.setIgnoreMouseEvents(true);
    hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // Make sure HUD shows on all desktops
};

const createLaserWindow = () => {
    laserWindow = new BrowserWindow({
        width: screen.getPrimaryDisplay().bounds.width,
        height: screen.getPrimaryDisplay().bounds.height,
        x: screen.getPrimaryDisplay().bounds.x,
        y: screen.getPrimaryDisplay().bounds.y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        focusable: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false
        }
    });

    laserWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'laser.html'));
    laserWindow.setIgnoreMouseEvents(true, { forward: true });
    laserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
};

app.on('before-quit', () => {
    isQuiting = true;
    globalShortcut.unregisterAll();
    if (systemService) systemService.cleanup();
});

app.whenReady().then(async () => {
    settingsManager = new SettingsManager();
    systemService = new SystemService();

    if (process.platform === 'darwin') {
        const iconPath = path.join(__dirname, '..', '..', 'src', 'assets', 'icon.png');
        app.dock?.setIcon(nativeImage.createFromPath(iconPath));
        app.dock?.hide();
    }
    
    await checkPermissions();
    createTray();
    createWindow();
    createHudWindow();
    createLaserWindow();
    updateActivationPolling();

    // Start App Monitoring for Smart Profiles
    systemService.startAppMonitor((appName) => {
        if (mainWindow) {
            mainWindow.webContents.send('active-app-changed', appName);
        }
    });

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
let currentToggleShortcut = 'Option+Space';

const stopActivationPolling = () => {
    isKeyHeld = true; 
    mainWindow?.webContents.send('activation-state-changed', true);
};

const updateActivationPolling = () => {
    const settings = settingsManager.getSettings();
    
    // Unregister previously active toggle
    try { globalShortcut.unregister(currentToggleShortcut); } catch (e) {}
    
    if (settings.requireKey) {
        // We map modifier settings to a solid toggle shortcut:
        // Command -> Command+Shift+A
        // Option -> Option+Shift+A
        // Control -> Control+Shift+A
        const maskMap: Record<string, string> = {
            'Command': 'Command+Shift+A',
            'Option': 'Option+Shift+A',
            'Control': 'Control+Shift+A'
        };
        currentToggleShortcut = maskMap[settings.activationKey] || 'Option+Shift+A';
        
        console.log(`[Main] Registering Tracking Toggle Shortcut: ${currentToggleShortcut}`);
        globalShortcut.register(currentToggleShortcut, () => {
            isKeyHeld = !isKeyHeld; // Toggle On/Off instead of "Press & Hold"
            mainWindow?.webContents.send('activation-state-changed', isKeyHeld);
            console.log(`[Main] Tracking locked state: ${isKeyHeld ? 'ON' : 'OFF'}`);
        });

        // Initialize tracking to OFF until they toggle it ON.
        isKeyHeld = false;
        mainWindow?.webContents.send('activation-state-changed', false);
    } else {
        isKeyHeld = true; // IMPORTANT: Must be true if no key is required
        mainWindow?.webContents.send('activation-state-changed', true);
    }
};

ipcMain.on('renderer-log', (_event, level, msg) => {
    console.log(`[Renderer ${level.toUpperCase()}] ${msg}`);
});

ipcMain.on('gesture-action', async (_event, action) => {
    systemService.execute(action);
    let hudSubtitle = undefined;

    if (['PLAY_PAUSE', 'NEXT_TRACK', 'PREV_TRACK'].includes(action)) {
        await new Promise(r => setTimeout(r, 400));
        hudSubtitle = await systemService.getMediaInfo();
    } else if (['VOLUME_UP', 'VOLUME_DOWN', 'MUTE_TOGGLE', 'BRIGHTNESS_UP', 'BRIGHTNESS_DOWN', 'MIC_MUTE'].includes(action)) {
        await new Promise(r => setTimeout(r, 200));
        hudSubtitle = await systemService.getVolumeInfo();
    }

    if (hudWindow) {
        if (!hudWindow.isVisible()) hudWindow.showInactive();
        hudWindow.webContents.send('show-hud', action, hudSubtitle);
    }
});

ipcMain.on('hide-hud', () => {
    if (hudWindow && hudWindow.isVisible()) hudWindow.hide();
});

ipcMain.on('mouse-move', (_event, { x, y }) => {
    systemService.updateMousePosition(x, y);
});

ipcMain.on('mouse-drag', (_event, { x, y }) => {
    systemService.mouseDrag(x, y);
});

ipcMain.on('mouse-scroll', (_event, deltaY) => {
    systemService.mouseScroll(deltaY);
});

ipcMain.on('mouse-down', () => {
    systemService.mouseDown();
});

ipcMain.on('mouse-up', () => {
    systemService.mouseUp();
});

ipcMain.on('mouse-click', (_event, button) => {
    systemService.clickMouse(button);
});

ipcMain.on('toggle-laser-mode', (_event, active) => {
    if (active) {
        laserWindow?.showInactive();
    } else {
        laserWindow?.hide();
    }
});

ipcMain.on('draw-laser-point', (_event, x, y, isDrawing, isClearing) => {
    if (laserWindow && laserWindow.isVisible()) {
        laserWindow.webContents.send('draw-laser-point', x, y, isDrawing, isClearing);
    }
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
