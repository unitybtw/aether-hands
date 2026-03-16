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

class AetherCommandRenderer {
    private video: HTMLVideoElement;
    private tracker: HandTracker;
    private gesture: GestureEngine;
    private statusEl: HTMLElement;
    private logEl: HTMLElement;

    private isRunning: boolean = false;
    private lerpAmount: number = 0.5;
    
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
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480, facingMode: "user" } 
            });
            this.video.srcObject = stream;
            
            this.video.onloadeddata = async () => {
                this.statusEl.innerText = "Initializing Machine Learning...";
                await this.tracker.initialize();
                this.statusEl.innerText = "Tracking Active";
                this.isRunning = true;
                this.loop();
            };
        } catch (error) {
            this.statusEl.innerText = "Camera Denied";
            this.statusEl.style.color = "#ff4b2b";
            this.log('Error: Camera permissions not granted.');
        }
    }

    private async loop() {
        if (!this.isRunning) return;

        try {
            const result = await this.tracker.detect(this.video);
            if (result && result.landmarks && result.landmarks.length > 0) {
                // We currently use the first hand detected
                const state = this.gesture.process(result.landmarks[0]);
                this.handleGestureState(state);
            }
        } catch (e) {
            console.error('[Tracker] Error in loop:', e);
        }

        requestAnimationFrame(() => this.loop());
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
        const entry = document.createElement('div');
        entry.style.fontSize = '0.75rem';
        entry.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        entry.style.padding = '4px 0';
        entry.style.color = '#8892b0';
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        
        this.logEl.prepend(entry);
        
        // Keep only last 15 logs
        while (this.logEl.children.length > 15) {
            this.logEl.removeChild(this.logEl.lastChild!);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new AetherCommandRenderer();
});
