import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    triggerGestureAction: (action: string) => ipcRenderer.send('gesture-action', action),
    setLoginItem: (openAtLogin: boolean) => ipcRenderer.send('set-login-item', openAtLogin),
    getLoginItem: () => ipcRenderer.invoke('get-login-item'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: any) => ipcRenderer.send('save-settings', settings),
    getActivationState: () => ipcRenderer.invoke('get-activation-state'),
    onActivationStateChanged: (callback: (state: boolean) => void) => {
        ipcRenderer.on('activation-state-changed', (_event, state) => callback(state));
    }
});
