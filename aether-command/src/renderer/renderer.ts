import { HandTracker } from '../core/HandTracker';
import { GestureEngine } from '../core/GestureEngine';

declare global {
  interface Window {
    electronAPI: {
      triggerGestureAction: (action: string) => void;
      setLoginItem: (openAtLogin: boolean) => void;
      getLoginItem: () => Promise<{ openAtLogin: boolean }>;
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => void;
    };
  }
}

const { ipcRenderer } = require('electron');

// Initialize the API bridge if it hasn't been set up via preload
if (!window.electronAPI) {
    window.electronAPI = {
        triggerGestureAction: (action: string) => ipcRenderer.send('gesture-action', action),
        setLoginItem: (openAtLogin: boolean) => ipcRenderer.send('set-login-item', openAtLogin),
        getLoginItem: () => ipcRenderer.invoke('get-login-item'),
        getSettings: () => ipcRenderer.invoke('get-settings'),
        saveSettings: (settings: any) => ipcRenderer.send('save-settings', settings)
    };
}

// Bridge all console logs to the main process for easier debugging
const originalLog = console.log;
console.log = (...args: any[]) => {
    const msg = args.map(a => {
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
        return typeof a === 'object' ? JSON.stringify(a) : a;
    }).join(' ');
    ipcRenderer.send('renderer-log', 'info', msg);
    originalLog.apply(console, args);
};

const originalError = console.error;
console.error = (...args: any[]) => {
    const msg = args.map(a => {
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
        return typeof a === 'object' ? JSON.stringify(a) : a;
    }).join(' ');
    ipcRenderer.send('renderer-log', 'error', msg);
    originalError.apply(console, args);
};

class AetherCommandRenderer {
    private video: HTMLVideoElement;
    private tracker: HandTracker;
    private gesture: GestureEngine;
    private statusEl: HTMLElement;
    private logEl: HTMLElement;

    private isRunning: boolean = false;
    private lerpAmount: number = 0.5;
    private frameCount = 0;
    private lastHandDetectionTime = 0;
    private gestureTimeout: any = null;
    
    // State to handle debouncing and duplicate triggers
    private lastActionTimes: Map<string, number> = new Map();
    private readonly DEBOUNCE_MS = 1000;

    constructor() {
        this.video = document.getElementById('webcam') as HTMLVideoElement;
        this.statusEl = document.getElementById('status-overlay')!;
        this.logEl = document.getElementById('log')!;
        
        this.tracker = new HandTracker();
        this.gesture = new GestureEngine();

        this.init();
    }

    private async init() {
        await this.loadSettings();
        this.setupEventListeners();
        await this.initCamera();
    }

    private async loadSettings() {
        try {
            const settings = await window.electronAPI.getSettings();
            this.lerpAmount = settings.smoothing;
            this.updateUIFromSettings(settings);
            this.log('Settings synchronized.');
        } catch (e) {
            this.log('Failed to load settings.');
        }
    }

    private updateUIFromSettings(settings: any) {
        const uiMap: Record<string, any> = {
            'setting-smoothing': settings.smoothing,
            'setting-autolaunch': settings.openAtLogin,
            'map-pinch': settings.mappings.pinch,
            'map-fist': settings.mappings.fist,
            'map-palm': settings.mappings.palm,
            'map-swipe': settings.mappings.swipe
        };

        for (const [id, value] of Object.entries(uiMap)) {
            const el = document.getElementById(id) as any;
            if (el) {
                if (el.type === 'checkbox') el.checked = value;
                else el.value = value.toString();
            }
        }
    }

    private setupEventListeners() {
        const uiElements = ['setting-smoothing', 'setting-autolaunch', 'map-pinch', 'map-fist', 'map-palm', 'map-swipe'];
        uiElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => this.handleSettingChange());
            }
        });
    }

    private handleSettingChange() {
        const settings = {
            mappings: {
                pinch: (document.getElementById('map-pinch') as HTMLSelectElement).value,
                fist: (document.getElementById('map-fist') as HTMLSelectElement).value,
                palm: (document.getElementById('map-palm') as HTMLSelectElement).value,
                swipe: (document.getElementById('map-swipe') as HTMLSelectElement).value,
            },
            smoothing: parseFloat((document.getElementById('setting-smoothing') as HTMLInputElement).value),
            openAtLogin: (document.getElementById('setting-autolaunch') as HTMLInputElement).checked
        };

        this.lerpAmount = settings.smoothing;
        window.electronAPI.saveSettings(settings);
        window.electronAPI.setLoginItem(settings.openAtLogin);
        this.log('Settings saved.');
    }

    private async initCamera() {
        this.log('Camera: Enumerating devices...');
        
        // Global error capture for the renderer
        window.onerror = (message, source, lineno, colno, error) => {
            this.log(`JS Error: ${message}`);
            console.error('Renderer Error:', { message, source, lineno, colno, error });
        };

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(d => d.kind === 'videoinput');
            this.log(`Camera: Found ${cameras.length} device(s).`);
            cameras.forEach(c => this.log(`- ${c.label || 'Unnamed Device'}`));

            this.log('Camera: Requesting access (HD)...');
            let stream: MediaStream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { width: 640, height: 480, facingMode: "user" } 
                });
            } catch (e) {
                this.log('Camera: Preferred constraints failed. Falling back...');
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
            this.log('Camera: Stream obtained.');
            this.video.srcObject = stream;
            
            this.video.onloadeddata = async () => {
                this.log('Camera: Video data loaded.');
                this.statusEl.innerText = "Initializing Machine Learning...";
                try {
                    await this.tracker.initialize();
                    this.log('Tracker: Machine Learning ready.');
                    this.statusEl.innerText = "Tracking Active";
                    this.isRunning = true;
                    this.loop();
                } catch (trackerError) {
                    this.log('Tracker Error: initialization failed.');
                    console.error('Tracker Error:', trackerError);
                }
            };

            this.video.onerror = (e) => {
                this.log('Camera Error: Video element error.');
                console.error('Video Error:', e);
            };
        } catch (error: any) {
            this.log(`Camera Error: ${error.name} - ${error.message}`);
            this.statusEl.innerText = "Camera Denied/Error";
            this.statusEl.style.color = "#ff4b2b";
            console.error('Camera Access Error:', error);
        }
    }

    async loop() {
        if (!this.isRunning) return;
        
        try {
            const result = this.tracker.detect(this.video, performance.now());
            
            if (result && result.landmarks && result.landmarks.length > 0) {
                const state = this.gesture.process(result.landmarks[0]);
                this.handleGestureState(state);
                this.updateGestureUI(state);
                this.lastHandDetectionTime = Date.now();
            } else {
                // If hand lost for more than 2 seconds, log once
                if (Date.now() - this.lastHandDetectionTime > 2000 && this.lastHandDetectionTime !== 0) {
                    this.log('Tracking: Hand lost.');
                    this.lastHandDetectionTime = 0;
                    this.updateGestureUI(null);
                }
            }
        } catch (e) {
            console.error('[Tracker] Error in loop:', e);
        }
        requestAnimationFrame(() => this.loop());
    }

    private updateGestureUI(state: any) {
        const feedbackEl = document.getElementById('gesture-feedback');
        const gestureSpan = document.getElementById('last-gesture');
        
        if (!feedbackEl || !gestureSpan) return;

        if (!state) {
            feedbackEl.style.opacity = '0';
            return;
        }

        let name = 'NONE';
        if (state.isPinching) name = 'PINCH 🤏';
        else if (state.isFist) name = 'FIST ✊';
        else if (state.isOpenPalm) name = 'PALM ✋';
        else if (state.swipeDirection) name = `SWIPE ${state.swipeDirection.toUpperCase()}`;

        if (name !== 'NONE') {
            gestureSpan.innerText = name;
            feedbackEl.style.opacity = '1';
            
            // Clear after 1 second if no new gesture
            if (this.gestureTimeout) {
                clearTimeout(this.gestureTimeout);
            }
            this.gestureTimeout = setTimeout(() => {
                feedbackEl.style.opacity = '0';
                this.gestureTimeout = null;
            }, 1000);
        }
    }

    private handleGestureState(state: any) {
        let action: string | null = null;

        if (state.isPinching) action = (document.getElementById('map-pinch') as HTMLSelectElement).value;
        else if (state.isFist) action = (document.getElementById('map-fist') as HTMLSelectElement).value;
        else if (state.isOpenPalm) action = (document.getElementById('map-palm') as HTMLSelectElement).value;
        else if (state.swipeDirection) {
            const swipeBase = (document.getElementById('map-swipe') as HTMLSelectElement).value;
            if (swipeBase === 'SPACES') {
                action = state.swipeDirection === 'left' ? 'SPACE_LEFT' : 'SPACE_RIGHT';
            } else {
                action = swipeBase;
            }
        }

        if (action && action !== 'NONE') {
            this.triggerAction(action);
        }
    }

    private triggerAction(action: string) {
        const now = Date.now();
        const lastTime = this.lastActionTimes.get(action) || 0;

        // Debounce to prevent multiple triggers for the same continuous gesture
        if (now - lastTime > this.DEBOUNCE_MS) {
            window.electronAPI.triggerGestureAction(action);
            this.lastActionTimes.set(action, now);
            this.log(`Action: ${action}`);
        }
    }

    private log(msg: string) {
        // UI log
        const entry = document.createElement('div');
        entry.style.fontSize = '0.75rem';
        entry.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        entry.style.padding = '4px 0';
        entry.style.color = '#8892b0';
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        
        if (this.logEl) {
            this.logEl.prepend(entry);
            while (this.logEl.children.length > 20) {
                this.logEl.removeChild(this.logEl.lastChild!);
            }
        }

        // Main Process terminal bridge
        try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('renderer-log', 'info', msg);
        } catch (e) {
            console.log('[Fallback Log]', msg);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new AetherCommandRenderer();
});
