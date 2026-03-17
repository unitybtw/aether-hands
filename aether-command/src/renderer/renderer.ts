import { HandTracker } from '../core/HandTracker';
import { GestureEngine } from '../core/GestureEngine';
import { VFXManager } from './VFXManager';

declare global {
  interface Window {
    electronAPI: {
      triggerGestureAction: (action: string) => void;
      setLoginItem: (openAtLogin: boolean) => void;
      getLoginItem: () => Promise<{ openAtLogin: boolean }>;
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => void;
      log: (level: string, msg: string) => void;
      getActivationState: () => Promise<boolean>;
      onActivationStateChanged: (callback: (state: boolean) => void) => () => void;
    };
  }
}

// Bridge all console logs to the main process for easier debugging
const originalLog = console.log;
console.log = (...args: any[]) => {
    const msg = args.map(a => {
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
        return typeof a === 'object' ? JSON.stringify(a) : a;
    }).join(' ');
    window.electronAPI.log('info', msg);
    originalLog.apply(console, args);
};

const originalError = console.error;
console.error = (...args: any[]) => {
    const msg = args.map(a => {
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
        return typeof a === 'object' ? JSON.stringify(a) : a;
    }).join(' ');
    window.electronAPI.log('error', msg);
    originalError.apply(console, args);
};

class AudioManager {
    private ctx: AudioContext | null = null;

    constructor() {}

    private init() {
        if (!this.ctx) this.ctx = new AudioContext();
    }

    public playSuccess() {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880.00, this.ctx.currentTime + 0.1); // A5

        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    }
}

class AetherCommandRenderer {
    private audio = new AudioManager();
    private video: HTMLVideoElement;
    private tracker: HandTracker;
    private gesture: GestureEngine;
    private vfx: VFXManager;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private statusEl: HTMLElement;
    private logEl: HTMLElement;

    private isRunning: boolean = false;
    private lerpAmount: number = 0.5;
    private frameCount = 0;
    private lastHandDetectionTime = 0;
    private gestureTimeout: any = null;
    private isActivated = true;
    private leftHandMode = false;
    
    // State to handle debouncing and duplicate triggers
    private lastActionTimes: Map<string, number> = new Map();
    private lastGlobalActionTime: number = 0;
    private lastFrameTime = 0;
    private fpsEl: HTMLElement;
    private confEl: HTMLElement;
    private readonly GLOBAL_DEBOUNCE_MS = 800; // Global cooldown between ANY gesture
    private readonly DEBOUNCE_MS = 1500; // Cooldown for the SAME gesture

    constructor() {
        this.video = document.getElementById('webcam') as HTMLVideoElement;
        this.canvas = document.getElementById('vfx-canvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        this.statusEl = document.getElementById('status-overlay')!;
        this.logEl = document.getElementById('log')!;
        
        this.tracker = new HandTracker();
        this.gesture = new GestureEngine();
        this.vfx = new VFXManager(this.ctx);
        
        // Debug tracking
        this.lastFrameTime = performance.now();
        this.fpsEl = document.getElementById('debug-fps')!;
        this.confEl = document.getElementById('debug-conf')!;

        this.initialize();
    }

    async initialize() {
        try {
            // 1. Initial State Sync
            const settings = await window.electronAPI.getSettings();
            this.updateUIFromSettings(settings);
            this.lerpAmount = settings.smoothing;
            this.setupEventListeners();

            // Initial activation state
            const initialState = await (window.electronAPI as any).getActivationState();
            this.isActivated = initialState !== false;
            this.updateActivationStatusUI(this.isActivated);

            // Listen for changes
            (window.electronAPI as any).onActivationStateChanged((state: boolean) => {
                this.isActivated = state;
                this.updateActivationStatusUI(state);
            });

            // 2. Camera setup
            const hasCamera = await this.initCamera();
            if (!hasCamera) {
                this.log('Critical: Camera initialization failed.');
                return;
            }

            // 3. MediaPipe setup
            await this.tracker.initialize();
            this.log('Aether-Command: Ready.');

            // 4. Start loop
            this.isRunning = true;
            this.loop();
        } catch (err: any) {
            this.log(`Initialize Error: ${err.message}`);
            console.error('Initialization Failed:', err);
        }
    }

    private updateActivationStatusUI(active: boolean) {
        const dot = document.getElementById('activation-dot');
        const text = document.getElementById('activation-text');
        if (!dot || !text) return;

        dot.style.background = active ? '#4CAF50' : '#FF5252';
        dot.style.boxShadow = active ? '0 0 8px #4CAF50' : '0 0 8px #FF5252';
        text.innerText = active ? 'Tracking Active' : 'Tracking Suspended (Hold Key)';
    }

    private async loadSettings() {
        // This method is now largely superseded by the initial settings load in initialize()
        // but kept for potential future direct calls or clarity.
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
        const uiMap: any = {
            'setting-smoothing': settings.smoothing,
            'setting-autolaunch': settings.openAtLogin,
            'setting-require-key': settings.requireKey,
            'setting-activation-key': settings.activationKey,
            'map-pinch': settings.mappings.pinch,
            'map-fist': settings.mappings.fist,
            'map-palm': settings.mappings.palm,
            'map-peace': settings.mappings.peace,
            'map-swipe': settings.mappings.swipe,
            'setting-sensitivity': settings.sensitivity,
            'setting-theme': settings.theme,
            'setting-hand-preference': settings.leftHandMode
        };

        for (const [id, value] of Object.entries(uiMap)) {
            const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
            if (el) {
                if (el.type === 'checkbox') (el as HTMLInputElement).checked = value as boolean;
                else el.value = (value as any).toString();
            }
        }
        this.applyTheme(settings.theme);
        this.updateActivationUIState(settings.requireKey);
        this.leftHandMode = settings.leftHandMode;
        if (this.tracker) this.tracker.updateOptions(settings.sensitivity);
    }

    private applyTheme(theme: string) {
        document.body.classList.remove('theme-minimal', 'theme-emerald');
        if (theme !== 'cyberpunk') {
            document.body.classList.add(`theme-${theme}`);
        }
        
        // Update VFX colors
        const colors: any = {
            'cyberpunk': '#00e5ff',
            'minimal': '#3b82f6',
            'emerald': '#10b981'
        };
        if (this.vfx) (this.vfx as any).baseColor = colors[theme] || '#00e5ff';
    }

    private updateActivationUIState(enabled: boolean) {
        const group = document.getElementById('group-activation-key');
        if (group) {
            group.style.opacity = enabled ? '1' : '0.5';
            group.style.pointerEvents = enabled ? 'all' : 'none';
        }
    }

    private setupEventListeners() {
        const uiElements = [
            'setting-smoothing', 'setting-autolaunch', 
            'setting-require-key', 'setting-activation-key',
            'setting-sensitivity', 'setting-theme', 'setting-hand-preference',
            'map-pinch', 'map-fist', 'map-palm', 'map-peace', 'map-swipe'
        ];
        uiElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    if (id === 'setting-require-key') {
                        this.updateActivationUIState((el as HTMLInputElement).checked);
                    }
                    this.handleSettingChange();
                });
            }
        });
    }

    private handleSettingChange() {
        const settings = {
            mappings: {
                pinch: (document.getElementById('map-pinch') as HTMLSelectElement).value,
                fist: (document.getElementById('map-fist') as HTMLSelectElement).value,
                palm: (document.getElementById('map-palm') as HTMLSelectElement).value,
                peace: (document.getElementById('map-peace') as HTMLSelectElement).value,
                swipe: (document.getElementById('map-swipe') as HTMLSelectElement).value,
            },
            smoothing: parseFloat((document.getElementById('setting-smoothing') as HTMLInputElement).value),
            openAtLogin: (document.getElementById('setting-autolaunch') as HTMLInputElement).checked,
            requireKey: (document.getElementById('setting-require-key') as HTMLInputElement).checked,
            activationKey: (document.getElementById('setting-activation-key') as HTMLSelectElement).value,
            sensitivity: parseFloat((document.getElementById('setting-sensitivity') as HTMLInputElement).value),
            theme: (document.getElementById('setting-theme') as HTMLSelectElement).value,
            leftHandMode: (document.getElementById('setting-hand-preference') as HTMLInputElement).checked
        };

        this.lerpAmount = settings.smoothing;
        this.leftHandMode = settings.leftHandMode;
        this.applyTheme(settings.theme as string);
        this.tracker.updateOptions(settings.sensitivity);
        
        window.electronAPI.saveSettings(settings);
        window.electronAPI.setLoginItem(settings.openAtLogin);
        this.log('Settings saved.');
    }

    private async initCamera(): Promise<boolean> {
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
            
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    this.log('Camera Error: Timeout waiting for video data.');
                    resolve(false);
                }, 5000);

                this.video.onloadeddata = () => {
                    clearTimeout(timeout);
                    this.log('Camera: Video data loaded.');
                    this.video.play().catch(e => this.log(`Camera: Play failed - ${e.message}`));
                    resolve(true);
                };

                this.video.onerror = (e) => {
                    clearTimeout(timeout);
                    this.log('Camera Error: Video element error.');
                    console.error('Video Error:', e);
                    resolve(false);
                };
            });
        } catch (error: any) {
            this.log(`Camera Error: ${error.name} - ${error.message}`);
            this.statusEl.innerText = "Camera Denied/Error";
            this.statusEl.style.color = "#ff4b2b";
            console.error('Camera Access Error:', error);
            return false;
        }
    }

    async loop() {
        if (!this.isRunning) return;
        
        // Clear and Update VFX
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.vfx.update();

        try {
            const result = this.tracker.detect(this.video, performance.now());
            
            if (result && result.landmarks && result.landmarks.length > 0) {
                // Filter by Hand Preference
                const handednessInfo = result.handedness?.[0]?.[0] || result.handedness?.[0];
                const handedness = (handednessInfo as any)?.categoryName || 'Unknown';

                // Update Debug Info
                const confidence = (handednessInfo as any)?.score || 0;
                if (this.frameCount % 10 === 0) {
                    this.confEl.innerText = `CONF: ${(confidence * 100).toFixed(0)}%`;
                }
                
                // Debug log (can be seen in log area)
                if (this.frameCount % 60 === 0) {
                    console.log(`Detected: ${handedness} | Target: ${this.leftHandMode ? 'Left' : 'Right'}`);
                    if (handedness === 'Unknown') {
                        console.log('Handedness Structure:', JSON.stringify(result.handedness));
                    }
                }

                // If we can't determine handedness, we allow it (safety)
                const isRequestedHand = (handedness === 'Unknown') || 
                                       (this.leftHandMode ? (handedness === 'Left') : (handedness === 'Right'));
                
                if (isRequestedHand) {
                    // Draw Skeleton
                    this.vfx.drawSkeleton(result.landmarks[0], this.canvas.width, this.canvas.height);

                    // Only process gestures if activated (key held or feature off)
                    if (this.isActivated) {
                        const state = this.gesture.process(result.landmarks[0]);
                        this.handleGestureState(state);
                        this.updateGestureUI(state);
                    } else {
                        this.updateGestureUI(null);
                    }
                } else {
                    this.updateGestureUI(null);
                }
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

        this.vfx.draw();

        // FPS Calculation
        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.lastFrameTime = now;
        if (this.frameCount % 30 === 0) {
            this.fpsEl.innerText = `FPS: ${Math.round(1000 / delta)}`;
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
        else if (state.isPeace) name = 'PEACE ✌️';
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
        else if (state.isPeace) action = (document.getElementById('map-peace') as HTMLSelectElement).value;
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

        // Apply global debounce (prevents multiple DIFFERENT shortcuts from firing together)
        if (now - this.lastGlobalActionTime < this.GLOBAL_DEBOUNCE_MS) {
            return;
        }

        // Debounce to prevent multiple triggers for the SAME continuous gesture
        if (now - lastTime > this.DEBOUNCE_MS) {
            // Visual feedback burst
            const videoRect = this.video.getBoundingClientRect();
            this.vfx.createBurst(this.canvas.width / 2, this.canvas.height / 2, 30);
            this.audio.playSuccess();

            window.electronAPI.triggerGestureAction(action);
            this.lastActionTimes.set(action, now);
            this.lastGlobalActionTime = now;
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
            window.electronAPI.log('info', msg);
        } catch (e) {
            console.log('[Fallback Log]', msg);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new AetherCommandRenderer();
});
