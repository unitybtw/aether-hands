import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    triggerGestureAction: (action: string) => ipcRenderer.send('gesture-action', action),
    setLoginItem: (openAtLogin: boolean) => ipcRenderer.send('set-login-item', openAtLogin),
    getLoginItem: () => ipcRenderer.invoke('get-login-item'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: any) => ipcRenderer.send('save-settings', settings),
    getActivationState: () => ipcRenderer.invoke('get-activation-state'),
    onActivationStateChanged: (callback: (state: boolean) => void) => {
        const subscription = (_event: any, state: boolean) => callback(state);
        ipcRenderer.on('activation-state-changed', subscription);
        return () => ipcRenderer.removeListener('activation-state-changed', subscription);
    },
    onShowHud: (callback: (action: string) => void) => {
        const subscription = (_event: any, action: string) => callback(action);
        ipcRenderer.on('show-hud', subscription);
        return () => ipcRenderer.removeListener('show-hud', subscription);
    },
    log: (level: string, msg: string) => ipcRenderer.send('renderer-log', level, msg)
});
