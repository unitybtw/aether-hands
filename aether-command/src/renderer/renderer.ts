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
      setTrackingStatus: (active: boolean) => void;
      onVisibilityChanged: (callback: (visible: boolean) => void) => () => void;
      mouseMove: (x: number, y: number) => void;
      mouseClick: (button: 'left' | 'right') => void;
    };
  }
}

// Low-pass filter for landmark smoothing
class LandmarkSmoother {
    private lastLandmarks: any[] = [];
    private factor: number;

    constructor(factor: number = 0.35) {
        this.factor = factor;
    }

    public smooth(newLandmarks: any[]): any[] {
        if (this.lastLandmarks.length === 0) {
            this.lastLandmarks = newLandmarks.map(pt => ({ ...pt }));
            return newLandmarks;
        }

        const smoothed = newLandmarks.map((pt, i) => {
            const last = this.lastLandmarks[i];
            if (!last) return pt;
            return {
                x: pt.x * (1 - this.factor) + last.x * this.factor,
                y: pt.y * (1 - this.factor) + last.y * this.factor,
                z: pt.z * (1 - this.factor) + last.z * this.factor
            };
        });

        this.lastLandmarks = smoothed;
        return smoothed;
    }

    public setFactor(f: number) { this.factor = f; }
}

class AudioManager {
    private ctx: AudioContext | null = null;
    constructor() {}
    private init() { if (!this.ctx) this.ctx = new AudioContext(); }
    public playSuccess(x = 0.5, y = 0.5) {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const panner = this.ctx.createPanner();
        
        panner.panningModel = 'equalpower';
        panner.positionX.setValueAtTime((x - 0.5) * 2, this.ctx.currentTime);
        panner.positionY.setValueAtTime((0.5 - y) * 2, this.ctx.currentTime);

        osc.type = 'sine';
        // Modal pitch based on vertical position
        const baseFreq = 440 + (1 - y) * 440; 
        osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);

        osc.connect(panner);
        panner.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);

        osc.onended = () => {
            osc.disconnect();
            panner.disconnect();
            gain.disconnect();
        };
    }
}

class AetherCommandRenderer {
    private audio = new AudioManager();
    private video: HTMLVideoElement;
    private tracker: HandTracker;
    private gesture: GestureEngine;
    private vfx: VFXManager;
    private smoother = new LandmarkSmoother();
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
    private customGestures: any[] = [];
    
    private lastActionTimes: Map<string, number> = new Map();
    private lastGlobalActionTime: number = 0;
    private lastFrameTime = 0;
    private fpsEl: HTMLElement;
    private confEl: HTMLElement;
    private stabilityCanvas: HTMLCanvasElement;
    private stabilityCtx: CanvasRenderingContext2D;
    private stabilityData = new Float32Array(50);
    private lastFps: number = 0;
    private gestureLocked: boolean = false;
    private readonly GLOBAL_DEBOUNCE_MS = 800;
    private readonly DEBOUNCE_MS = 1500;
    
    private pinchAnchorY: number | null = null;
    private readonly CONTINUOUS_THRESH = 0.05;
    
    private lastInteractionTime: number = Date.now();
    private isSuspended: boolean = false;
    private isVisible: boolean = true;
    private panels: NodeListOf<Element> | null = null;
    private proxEl: HTMLElement | null = null;
    private lightWarnEl: HTMLElement | null = null;
    private velWarnEl: HTMLElement | null = null;
    private signalPillEl: HTMLElement | null = null;
    private readonly SUSPEND_TIMEOUT_MS = 300000;
    private currentBrightness: number = 0;
    private brightnessCanvas = document.createElement('canvas');
    private statusPills: NodeListOf<Element>;
    private uiElements: Record<string, HTMLElement> = {};
    private mapElements: Record<string, HTMLSelectElement> = {};
    private isMouseModeActive: boolean = false;
    private isLaserModeActive: boolean = false;
    private screenWidth: number = 2560; // Fallback
    private screenHeight: number = 1440; // Fallback
    private lastMouseUpdate: number = 0;
    private isPinchHeld: boolean = false;
    private isFistHeld: boolean = false;
    private lastLaserAction: 'draw' | 'move' | 'clear' = 'move';
    private lastX: number = 0;
    private lastY: number = 0;
    private pinchStartTime: number = 0;
    private lastDetectedLandmarks: any[] | null = null;
    private lastWristPos = { x: 0.5, y: 0.5 };
    private lastPointerPos = { x: 0.5, y: 0.5 };
    private lastMultiHandDist: number = 0;
    private diagnosticMode: boolean = false;

    constructor() {
        this.video = document.getElementById('webcam') as HTMLVideoElement;
        this.canvas = document.getElementById('vfx-canvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        this.stabilityCanvas = document.getElementById('stability-canvas') as HTMLCanvasElement;
        this.stabilityCtx = this.stabilityCanvas.getContext('2d')!;
        this.statusEl = document.getElementById('status-overlay')!;
        this.logEl = document.getElementById('log')!;
        
        this.tracker = new HandTracker();
        this.gesture = new GestureEngine();
        this.vfx = new VFXManager(this.ctx);
        this.statusPills = document.querySelectorAll('.status-pill');
        this.brightnessCanvas.width = 20;
        this.brightnessCanvas.height = 15;
        
        this.lastFrameTime = performance.now();
        this.fpsEl = document.getElementById('debug-fps')!;
        this.confEl = document.getElementById('debug-conf')!;

        // Sync real screen size for mouse mapping
        this.screenWidth = window.screen.width * window.devicePixelRatio;
        this.screenHeight = window.screen.height * window.devicePixelRatio;

        // Cache frequent DOM lookups
        this.uiElements['gesture-feedback'] = document.getElementById('gesture-feedback')!;
        this.uiElements['last-gesture'] = document.getElementById('last-gesture')!;
        this.uiElements['gesture-status-overlay'] = document.getElementById('gesture-status-overlay')!;
        this.uiElements['quality-text'] = document.getElementById('quality-text')!;
        this.panels = document.querySelectorAll('.panel');
        this.proxEl = document.getElementById('proximity-warning');
        this.lightWarnEl = document.getElementById('light-warning');
        this.velWarnEl = document.getElementById('velocity-warning');
        this.signalPillEl = document.getElementById('status-signal');
        
        const mapIds = ['map-pinch', 'map-fist', 'map-palm', 'map-peace', 'map-swipe'];
        mapIds.forEach(id => this.mapElements[id] = document.getElementById(id) as HTMLSelectElement);

        this.initialize();
        this.setupInactivityListeners();

        window.electronAPI.onVisibilityChanged((visible) => {
            this.isVisible = visible;
            this.log(`System: ${visible ? 'Dashboard Visible' : 'Dashboard Hidden'}.`);
        });

        // Diagnostic Toggle
        const diagToggle = document.getElementById('status-activation');
        if (diagToggle) {
            diagToggle.addEventListener('click', () => {
                this.diagnosticMode = !this.diagnosticMode;
                const text = document.getElementById('activation-text');
                const dot = document.getElementById('activation-dot');
                if (text) text.innerText = `Aether Vision: ${this.diagnosticMode ? 'ON' : 'OFF'}`;
                if (dot) {
                    dot.style.background = this.diagnosticMode ? 'var(--accent-primary)' : '#4CAF50';
                    dot.style.boxShadow = `0 0 15px ${this.diagnosticMode ? 'var(--accent-primary)' : '#4CAF50'}`;
                }
                this.log(`Diagnostic: Aether Vision ${this.diagnosticMode ? 'Engaged' : 'Disengaged'}`);
                this.audio.playSuccess(0.5, this.diagnosticMode ? 0.8 : 0.4);
            });
        }
    }

    private setupInactivityListeners() {
        window.addEventListener('mousemove', (e) => {
            this.wakeUp();
        });
        window.addEventListener('keydown', () => this.wakeUp());
        window.addEventListener('click', () => this.wakeUp());
    }

    private currentTilt = { x: 0, y: 0 };
    private updateTilt(hx: number, hy: number) {
        if (!this.isVisible) return;
        const targetX = (hx - 0.5) * 4; // Reduced from 12
        const targetY = (hy - 0.5) * 4;
        
        // Dynamic Smoothing
        this.currentTilt.x += (targetX - this.currentTilt.x) * 0.1;
        this.currentTilt.y += (targetY - this.currentTilt.y) * 0.1;
        
        if (this.panels) {
            const transform = `perspective(1500px) rotateX(${-this.currentTilt.y}deg) rotateY(${this.currentTilt.x}deg)`;
            this.panels.forEach((panel: any) => {
                panel.style.transform = transform;
            });
        }
    }

    private estimateBrightness() {
        if (!this.video.videoWidth) return;
        const tempCtx = this.brightnessCanvas.getContext('2d');
        if (!tempCtx) return;
        
        tempCtx.drawImage(this.video, 0, 0, 20, 15);
        const data = tempCtx.getImageData(0, 0, 20, 15).data;
        let brightness = 0;
        for (let i = 0; i < data.length; i += 4) {
            brightness += (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
        }
        this.currentBrightness = brightness / (20 * 15);
        
        // Auto-Gain: Adjust video filter if light is poor
        if (this.currentBrightness < 30) {
            this.video.style.filter = `brightness(2.2) contrast(1.5) saturate(1.2)`;
        } else if (this.currentBrightness < 50) {
            this.video.style.filter = `brightness(1.5) contrast(1.2)`;
        } else {
            this.video.style.filter = `none`;
        }
    }

    private updateQualityUI(confidence: number, isHandFound: boolean) {
        const qualityText = this.uiElements['quality-text'];
        if (!qualityText) return;
        
        if (!isHandFound) {
            qualityText.innerText = 'SEARCHING...';
            qualityText.style.color = 'rgba(255,255,255,0.4)';
            return;
        }

        if (confidence < 0.6) {
            qualityText.innerText = 'POOR';
            qualityText.style.color = '#ff4b2b';
        } else if (confidence < 0.8) {
            qualityText.innerText = 'FAIR';
            qualityText.style.color = '#ff9800';
        } else {
            qualityText.innerText = 'EXCELLENT';
            qualityText.style.color = '#00ffcc';
        }
    }



    private drawStabilityGraph(stability: number) {
        if (!this.isVisible) return;
        this.stabilityData.copyWithin(0, 1);
        this.stabilityData[49] = stability;

        if (this.stabilityCanvas.width !== this.stabilityCanvas.clientWidth || 
            this.stabilityCanvas.height !== this.stabilityCanvas.clientHeight) {
            this.stabilityCanvas.width = this.stabilityCanvas.clientWidth;
            this.stabilityCanvas.height = this.stabilityCanvas.clientHeight;
        }
        const w = this.stabilityCanvas.width;
        const h = this.stabilityCanvas.height;
        const ctx = this.stabilityCtx;

        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        ctx.strokeStyle = this.vfx.baseColor;
        ctx.lineWidth = 1.5;
        
        for (let i = 0; i < 50; i++) {
            const val = this.stabilityData[i];
            const x = (i / 49) * w;
            const y = h - (val * (h * 0.8));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Gradient Fill
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, this.vfx.baseColor + '33');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fill();
    }

    private wakeUp() {
        this.lastInteractionTime = Date.now();
        if (this.isSuspended) {
            this.isSuspended = false;
            document.body.classList.remove('battery-saver');
            this.log('Status: Wake up signal received.');
        }
    }

    async initialize() {
        try {
            // Priority 1: Instant UI Response
            const settings = await window.electronAPI.getSettings();
            this.updateUIFromSettings(settings);
            this.lerpAmount = settings.smoothing;
            this.smoother.setFactor(settings.smoothing);
            this.setupEventListeners();

            const initialState = await (window.electronAPI as any).getActivationState();
            this.isActivated = initialState !== false;
            this.updateActivationStatusUI(this.isActivated);

            (window.electronAPI as any).onActivationStateChanged((state: boolean) => {
                this.isActivated = state;
                this.updateActivationStatusUI(state);
            });

            if ((window.electronAPI as any).onActiveAppChanged) {
                (window.electronAPI as any).onActiveAppChanged((appName: string) => {
                    this.handleSmartProfileSwitch(appName);
                });
            }

            // Priority 2: Instant Feed Vision
            const hasCamera = await this.initCamera();
            if (!hasCamera) return;

            // UNBLOCK: Start UI loop immediately after camera
            this.isRunning = true;
            this.loop(); 

            // Priority 3: Asynchronous Neural Core Loading
            if (this.uiElements['quality-text']) {
                this.uiElements['quality-text'].innerText = 'INITIALIZING CORE...';
                this.uiElements['quality-text'].style.color = 'var(--accent-primary)';
            }
            
            this.log('System: Initializing Aether Neural Core (MediaPipe V3)...');
            await this.tracker.initialize();
            
            this.log('System: Neural Core Ready. Hand tracking engaged.');
            if (this.uiElements['quality-text']) {
               this.uiElements['quality-text'].innerText = 'CORE READY';
            }
        } catch (err: any) {
            this.log(`Critical Error: ${err.message}`);
            if (this.uiElements['quality-text']) {
                this.uiElements['quality-text'].innerText = 'CORE ERROR';
                this.uiElements['quality-text'].style.color = '#ff4b2b';
            }
        }
    }

    private updateActivationStatusUI(active: boolean) {
        const dot = document.getElementById('activation-dot');
        const text = document.getElementById('activation-text');
        const keySel = document.getElementById('setting-activation-key') as HTMLSelectElement;
        
        if (dot && text) {
            dot.style.background = active ? '#00e5ff' : '#ff4b2b';
            dot.style.boxShadow = active ? '0 0 10px #00e5ff' : '0 0 10px #ff4b2b';
            
            const reqKey = (document.getElementById('setting-require-key') as HTMLInputElement)?.checked;
            if (!reqKey) {
                text.innerText = 'ARMED & TRACKING';
            } else {
                const modifier = keySel ? keySel.value : 'Option';
                const keyName = modifier === 'Command' ? 'CMD+SHIFT+A' : 
                                modifier === 'Option' ? 'OPT+SHIFT+A' : 'CTRL+SHIFT+A';
                text.innerText = active ? `ARMED (READY)` : `DISARMED (PRESS ${keyName})`;
            }
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
            'setting-hand-preference': settings.leftHandMode,
            'setting-cursor-speed': settings.cursorSpeed,
            'setting-vfx-extra': settings.extraVfx,
            'setting-battery-saver': settings.batterySaver
        };

        for (const [id, value] of Object.entries(uiMap)) {
            const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
            if (el) {
                if (el.type === 'checkbox') (el as HTMLInputElement).checked = value as boolean;
                else if (value !== undefined) el.value = (value as any).toString();
            }
        }
        this.applyTheme(settings.theme);
        this.updateActivationUIState(settings.requireKey);
        this.leftHandMode = settings.leftHandMode;
        this.cursorSpeed = settings.cursorSpeed || 1.5;
        this.customGestures = settings.customGestures || [];
        if (this.tracker) this.tracker.updateOptions(settings.sensitivity);
    }

    private applyTheme(theme: string) {
        document.body.classList.remove('theme-minimal', 'theme-emerald');
        const colors: any = { 'cyberpunk': '#00e5ff', 'minimal': '#3b82f6', 'emerald': '#10b981' };
        const accent = colors[theme] || '#00e5ff';

        if (theme !== 'cyberpunk') document.body.classList.add(`theme-${theme}`);
        document.documentElement.style.setProperty('--accent-primary', accent);
        if (this.vfx) (this.vfx as any).baseColor = accent;
    }

    private updateActivationUIState(enabled: boolean) {
        const group = document.getElementById('group-activation-key');
        if (group) {
            group.style.opacity = enabled ? '1' : '0.5';
            group.style.pointerEvents = enabled ? 'all' : 'none';
        }
    }

    private setupEventListeners() {
        const uiIds = [
            'setting-smoothing', 'setting-autolaunch', 
            'setting-require-key', 'setting-activation-key',
            'setting-sensitivity', 'setting-theme', 'setting-hand-preference',
            'setting-cursor-speed', 'setting-vfx-extra', 'setting-battery-saver',
            'map-pinch', 'map-fist', 'map-palm', 'map-peace', 'map-swipe'
        ];
        uiIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => {
                if (id === 'setting-require-key') this.updateActivationUIState((el as HTMLInputElement).checked);
                if (id === 'setting-camera-source') {
                    this.log("System: Switching camera source...");
                    this.initCamera();
                }
                this.handleSettingChange();
            });
        });

        // Initialize Camera List
        this.updateCameraList();

        // Log Search
        const search = document.getElementById('log-search') as HTMLInputElement;
        if (search) {
            search.addEventListener('input', () => {
                const term = search.value.toLowerCase();
                const entries = this.logEl.querySelectorAll('.log-entry');
                entries.forEach((entry: any) => {
                    entry.style.display = entry.innerText.toLowerCase().includes(term) ? 'block' : 'none';
                });
            });
        }

        // Clear Log
        const clear = document.getElementById('clear-log');
        if (clear) {
            clear.addEventListener('click', () => {
                this.logEl.innerHTML = '<div class="log-entry">Board cleared.</div>';
            });
        }

        // Export / Import
        const exportBtn = document.getElementById('export-settings');
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                const settings = await window.electronAPI.getSettings();
                await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
                this.log('Expert: Config copied to clipboard.');
                alert('Configuration copied to clipboard!');
            });
        }

        const importBtn = document.getElementById('import-settings');
        if (importBtn) {
            importBtn.addEventListener('click', async () => {
                try {
                    const text = await navigator.clipboard.readText();
                    const settings = JSON.parse(text);
                    window.electronAPI.saveSettings(settings);
                    this.updateUIFromSettings(settings);
                    this.log('Expert: Config imported from clipboard.');
                    alert('Configuration imported successfully!');
                } catch (e) {
                    alert('Invalid configuration in clipboard.');
                }
            });
        }

        // Gesture Studio Event Listeners
        const btnStudio = document.getElementById('open-gesture-studio');
        const modalStudio = document.getElementById('gesture-studio-modal');
        const btnStudioCancel = document.getElementById('studio-cancel');
        const btnStudioRecord = document.getElementById('studio-record');
        const inputName = document.getElementById('studio-name') as HTMLInputElement;
        const inputScript = document.getElementById('studio-script') as HTMLInputElement;
        const statusStudio = document.getElementById('studio-status');

        if (btnStudio && modalStudio) {
            btnStudio.addEventListener('click', () => {
                modalStudio.style.display = 'flex';
                if (statusStudio) statusStudio.innerText = '';
                if (inputName) inputName.value = '';
                if (inputScript) inputScript.value = '';
            });
        }

        if (btnStudioCancel && modalStudio) {
            btnStudioCancel.addEventListener('click', () => {
                modalStudio.style.display = 'none';
            });
        }

        if (btnStudioRecord && statusStudio && inputName && inputScript) {
            btnStudioRecord.addEventListener('click', () => {
                if (!inputName.value) { statusStudio.innerText = 'Error: Enter gesture name'; return; }
                if (!inputScript.value) { statusStudio.innerText = 'Error: Enter script command'; return; }

                statusStudio.innerText = 'Hold pose... 3';
                let count = 3;
                
                const interval = setInterval(() => {
                    count--;
                    if (count > 0) {
                        statusStudio.innerText = `Hold pose... ${count}`;
                        this.audio.playSuccess(0.5, 0.4);
                    } else {
                        clearInterval(interval);
                        if (!this.lastDetectedLandmarks) {
                            statusStudio.innerText = 'Error: Hand not seen. Try again.';
                        } else {
                            this.vfx.createBurst(this.canvas.width/2, this.canvas.height/2, 50, '#a200ff');
                            this.audio.playSuccess(0.5, 0.9);
                            statusStudio.innerText = 'GESTURE SAVED!';

                            // Save to custom gestures
                            this.customGestures.push({
                                name: inputName.value,
                                action: inputScript.value,
                                landmarks: JSON.parse(JSON.stringify(this.lastDetectedLandmarks)) // Clone
                            });

                            this.handleSettingChange(); // Push to backend
                            this.log(`Expert: Saved custom gesture [${inputName.value}]`);

                            setTimeout(() => {
                                if (modalStudio) modalStudio.style.display = 'none';
                            }, 1500);
                        }
                    }
                }, 1000);
            });
        }

        // Profile Switcher
        const profileSelect = document.getElementById('setting-profile') as HTMLSelectElement;
        if (profileSelect) {
            profileSelect.addEventListener('change', () => {
                const profile = profileSelect.value;
                const PROFILES: Record<string, any> = {
                    default: { pinch: 'PLAY_PAUSE', fist: 'MUTE_TOGGLE', palm: 'MISSION_CONTROL', peace: 'SHOW_DESKTOP', swipe: 'SPACES' },
                    media: { pinch: 'PLAY_PAUSE', fist: 'MUTE_TOGGLE', palm: 'MOUSE_MODE', peace: 'NEXT_TRACK', swipe: 'MEDIA' },
                    coding: { pinch: 'LAUNCH_VSCODE', fist: 'LAUNCH_TERMINAL', palm: 'MOUSE_MODE', peace: 'LOCK_SCREEN', swipe: 'BROWSER' }
                };
                const config = PROFILES[profile];
                if (config) {
                    const elPinch = document.getElementById('map-pinch') as HTMLSelectElement;
                    const elFist = document.getElementById('map-fist') as HTMLSelectElement;
                    const elPalm = document.getElementById('map-palm') as HTMLSelectElement;
                    const elPeace = document.getElementById('map-peace') as HTMLSelectElement;
                    const elSwipe = document.getElementById('map-swipe') as HTMLSelectElement;

                    if (elPinch && config.pinch) elPinch.value = config.pinch;
                    if (elFist && config.fist) elFist.value = config.fist;
                    if (elPalm && config.palm) elPalm.value = config.palm;
                    if (elPeace && config.peace) elPeace.value = config.peace;
                    if (elSwipe && config.swipe) elSwipe.value = config.swipe;

                    this.handleSettingChange();
                    this.log(`Profile: Switched to ${profile.toUpperCase()} preset.`);
                }
            });
        }
    }

    private handleSmartProfileSwitch(appName: string) {
        const profileSelect = document.getElementById('setting-profile') as HTMLSelectElement;
        if (!profileSelect) return;

        const app = appName.toLowerCase();
        let targetProfile = 'default';

        if (app.includes('safari') || app.includes('chrome') || app.includes('arc') || app.includes('browser')) {
             targetProfile = 'browser'; 
        } else if (app.includes('music') || app.includes('spotify') || app.includes('quicktime') || app.includes('vlc')) {
            targetProfile = 'media';
        } else if (app.includes('code') || app.includes('terminal') || app.includes('iterm') || app.includes('xcode')) {
            targetProfile = 'coding';
        }

        if (profileSelect.value !== targetProfile) {
            profileSelect.value = targetProfile;
            profileSelect.dispatchEvent(new Event('change'));
            
            const statusText = document.getElementById('system-status-text');
            if (statusText) statusText.innerText = `PROFILE: ${targetProfile.toUpperCase()}`;
            
            // Auto-update SWIPE mappings based on profile
            const swipeSelect = document.getElementById('map-swipe') as HTMLSelectElement;
            if (swipeSelect) {
                if (targetProfile === 'browser') swipeSelect.value = 'BROWSER';
                else if (targetProfile === 'media') swipeSelect.value = 'MEDIA';
                else if (targetProfile === 'coding') swipeSelect.value = 'BROWSER';
                else swipeSelect.value = 'SPACES';
                swipeSelect.dispatchEvent(new Event('change'));
            }

            this.log(`Smart Profile: Optimized for ${appName}`);
            this.vfx.createBurst(this.canvas.width / 2, this.canvas.height / 2, 50, '#ff00ff'); // Feedback burst
            this.audio.playSuccess(0.5, 0.9);
        }
    }

    private handleSettingChange() {
        const oldHand = this.leftHandMode;
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
            leftHandMode: (document.getElementById('setting-hand-preference') as HTMLInputElement).checked,
            batterySaver: (document.getElementById('setting-battery-saver') as HTMLInputElement).checked,
            extraVfx: (document.getElementById('setting-vfx-extra') as HTMLInputElement).checked,
            cursorSpeed: parseFloat((document.getElementById('setting-cursor-speed') as HTMLInputElement).value),
            deviceId: (document.getElementById('setting-camera-source') as HTMLSelectElement)?.value,
            customGestures: this.customGestures
        };
        this.lerpAmount = settings.smoothing;
        this.smoother.setFactor(settings.smoothing);
        this.leftHandMode = settings.leftHandMode;
        this.cursorSpeed = settings.cursorSpeed; // Updated
        this.applyTheme(settings.theme as string);
        this.tracker.updateOptions(settings.sensitivity);
        this.vfx.setExtraEffects(settings.extraVfx);
        (window as any).isBatterySaverEnabled = settings.batterySaver;
        window.electronAPI.saveSettings(settings);

        if (oldHand !== this.leftHandMode) {
            this.audio.playSuccess(this.leftHandMode ? 0.2 : 0.8, 0.5);
            this.log(`System: Hand preference updated to ${this.leftHandMode ? 'LEFT' : 'RIGHT'}`);
        }
    }

    private async updateCameraList() {
        const select = document.getElementById('setting-camera-source') as HTMLSelectElement;
        if (!select) return;

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            
            select.innerHTML = '';
            videoDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Camera ${select.length + 1}`;
                select.appendChild(option);
            });

            // Restore from settings if available
            const settings = await window.electronAPI.getSettings();
            if (settings.deviceId) {
                select.value = settings.deviceId;
            }
        } catch (e) {
            this.log("System: Failed to enumerate camera devices.");
        }
    }

    private async initCamera(highRes = false): Promise<boolean> {
        try {
            const select = document.getElementById('setting-camera-source') as HTMLSelectElement;
            const deviceId = select?.value;

            const constraints: any = {
                video: { 
                    width: highRes ? 640 : 320, 
                    height: highRes ? 480 : 240, 
                    facingMode: "user",
                    frameRate: { ideal: 60 }
                } 
            };

            if (deviceId && deviceId !== 'default') {
                constraints.video.deviceId = { exact: deviceId };
            }

            // Stop existing tracks if any
            if (this.video.srcObject) {
                const stream = this.video.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = stream;
            return new Promise((resolve) => {
                this.video.onloadeddata = () => { 
                    this.video.play(); 
                    this.log(`System: Camera initialized ${highRes ? '(HD)' : '(Eco)'}`);
                    resolve(true); 
                };
                this.video.onerror = () => resolve(false);
            });
        } catch (error) { 
            this.log("System: Camera access denied or device disconnected.");
            return false; 
        }
    }

    async loop() {
        if (!this.isRunning) return;

        if (Date.now() - this.lastInteractionTime > this.SUSPEND_TIMEOUT_MS) {
            if (!this.isSuspended) {
                this.isSuspended = true;
                document.body.classList.add('battery-saver');
                window.electronAPI.setTrackingStatus(false);
                this.log('System: Entering Eco-Mode. Scanning for hands at lower frequency.');
            }
        }

        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        if (this.canvas.width !== cw || this.canvas.height !== ch) {
            this.canvas.width = cw;
            this.canvas.height = ch;
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.vfx.update();

        try {
            let skipRate = this.isSuspended ? 4 : 1; // 15 FPS if suspended, 60 FPS normal
            // if (!this.isVisible) skipRate = 2; 
            
            if (this.frameCount % skipRate === 0) {
                // Brightness check
                if (this.frameCount % 90 === 0) {
                    this.estimateBrightness();
                    // If extremely dark, try to bump res once
                    if (this.currentBrightness < 25 && this.video.videoWidth < 640) {
                        this.log("Aether Vision: Boosting sensor resolution for low light...");
                        this.initCamera(true);
                    } else if (this.currentBrightness > 50 && this.video.videoWidth >= 640) {
                        // Scale back down to save power if light is OK
                        this.initCamera(false);
                    }
                }

                // Show loading pulse if tracker isn't ready
                if (!(this.tracker as any).isInitialized) {
                    if (this.frameCount % 30 === 0) {
                        this.log("Neural Core: Syncing with MediaPipe CDN...");
                    }
                    this.updateQualityUI(0, false);
                    if (this.uiElements['quality-text']) {
                        this.uiElements['quality-text'].innerText = this.frameCount % 20 < 10 ? 'CORE WARM-UP' : 'SYNCING...';
                    }
                }

                const result = this.tracker.detect(this.video, performance.now());
                if (result && result.landmarks && result.landmarks.length > 0) {
                        if (this.frameCount % 10 === 0) {
                            const lowLight = this.currentBrightness < 45;
                            const label = lowLight ? 'LOW LIGHT - BOOSTED' : 'LIGHT OK';
                            const mainConfidence = (result.handedness[0]?.[0] as any)?.score || 0;
                            this.confEl.innerText = `CONF: ${(mainConfidence * 100).toFixed(0)}% [${label}]`;
                            this.confEl.style.color = lowLight ? '#ff9800' : 'rgba(255,255,255,0.4)';
                            
                            this.video.style.filter = lowLight ? 
                                `scaleX(-1) brightness(1.8) contrast(1.5) saturate(1.2)` : 
                                `scaleX(-1) brightness(1) contrast(1) saturate(1)`;
                            
                            if (this.signalPillEl) this.signalPillEl.style.display = lowLight ? 'block' : 'none';
                            if (this.lightWarnEl) this.lightWarnEl.style.opacity = lowLight ? '1' : '0';
                        }

                    // Multi-Hand Loop: Process all detected hands
                    const states: any[] = [];
                    result.landmarks.forEach((handLandmarks, hIdx) => {
                        const handednessInfo = result.handedness[hIdx]?.[0] || result.handedness[hIdx];
                        const confidence = (handednessInfo as any)?.score || 0;
                        if (confidence < 0.35) return;

                        this.wakeUp();
                        window.electronAPI.setTrackingStatus(true);

                        const smoothed = this.smoother.smooth(handLandmarks);
                        this.vfx.drawSkeleton(smoothed, this.canvas.width, this.canvas.height, confidence);
                        
                        // Draw Technical Mesh if Diagnostic Mode is active
                        if (this.diagnosticMode) {
                            this.vfx.drawDiagnosticMesh(smoothed, this.canvas.width, this.canvas.height);
                        }

                        if (hIdx === 0) {
                            this.lastDetectedLandmarks = smoothed;
                            if (this.proxEl) this.proxEl.style.opacity = smoothed[0].z < -0.8 ? '1' : '0';
                        }

                        const state = this.gesture.process(smoothed, this.customGestures);
                        states.push(state);

                        if (hIdx === 0) {
                            this.lastWristPos = state.lastWristPos;
                            this.lastPointerPos = state.pointerPos;
                            
                            const velocity = Math.sqrt(state.velocity.x**2 + state.velocity.y**2);
                            const adaptiveFactor = Math.max(0.05, Math.min(0.9, this.lerpAmount * (1 - velocity * 10)));
                            this.smoother.setFactor(adaptiveFactor);

                            this.updateTilt(1 - state.pointerPos.x, state.pointerPos.y);
                            this.handleGestureState(state);

                            if (this.velWarnEl) this.velWarnEl.style.opacity = velocity > 0.15 ? '1' : '0';

                            if (this.isActivated) {
                                const stability = Math.max(0, 1 - velocity * 5);
                                this.drawStabilityGraph(stability);
                                this.updateGestureUI(state);
                            } else {
                                this.updateGestureUI(null);
                                this.drawStabilityGraph(0);
                            }
                            this.updateQualityUI(confidence, true);
                        }
                    });

                    // Handle Multi-Hand Effects (Zoom)
                    if (states.length >= 2) {
                        const effects = this.gesture.calculateMultiHandEffects(states);
                        if (effects.zoom > 0) {
                            if (this.lastMultiHandDist > 0) {
                                const delta = effects.zoom - this.lastMultiHandDist;
                                if (Math.abs(delta) > 0.05) {
                                    if (Math.abs(delta) > 0.1) {
                                        this.triggerAction(delta > 0 ? 'VOLUME_UP' : 'VOLUME_DOWN', true);
                                        this.lastMultiHandDist = effects.zoom;
                                    }
                                }
                            } else {
                                this.lastMultiHandDist = effects.zoom;
                            }
                        }
                    } else {
                        this.lastMultiHandDist = 0;
                    }

                    this.lastHandDetectionTime = Date.now();
                } else {
                    this.gesture.reset();
                    this.updateQualityUI(0, false);
                    
                    // Engine Heartbeat: If total silence for 5 seconds, reload tracker
                    if (this.lastHandDetectionTime !== 0 && Date.now() - this.lastHandDetectionTime > 5000) {
                        this.log("System: Heartbeat lost. Resetting detection engine...");
                        this.tracker.initialize(); 
                        this.lastHandDetectionTime = Date.now(); // reset timer
                    }

                    if (Date.now() - this.lastHandDetectionTime > 2000 && this.lastHandDetectionTime !== 0) {
                        window.electronAPI.setTrackingStatus(false);
                        this.updateGestureUI(null);
                    }
                }
            }
        } catch (e: any) { 
            this.log(`Critical Error: ${e && e.message ? e.message : 'Unknown JS crash'}`); 
            console.error(e); 
        }

        if (this.isVisible) this.vfx.draw();

        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.lastFrameTime = now;
        
        // Thermal / Performance Guard
        if (this.frameCount > 30 && delta > 100) { // Only check after warmup
            if (this.frameCount % 5 === 0) {
               (window as any).isBatterySaverEnabled = true;
               this.log('System: Thermal / Performance limit hit. Auto-scaling initiated.');
            }
        }
        
        if (this.frameCount % 30 === 0) {
            const currentFps = Math.round(1000 / delta);
            if (currentFps !== this.lastFps) {
                this.fpsEl.innerText = `FPS: ${currentFps}`;
                this.lastFps = currentFps;
            }
        }
        this.frameCount++;
        // Background Persistence: Always loop, but slow down if hidden to save CPU
        if (this.isVisible) {
            requestAnimationFrame(() => this.loop());
        } else {
            // Even if "hidden", we MUST keep tracking for gestures to work globally.
            // 20-30 FPS is enough for background gestures.
            setTimeout(() => this.loop(), 33); 
        }
    }

    private updateGestureUI(state: any) {
        const feedbackEl = this.uiElements['gesture-feedback'];
        const gestureSpan = this.uiElements['last-gesture'];
        if (!feedbackEl || !gestureSpan) return;

        if (!state) {
            feedbackEl.style.opacity = '0';
            this.clearStatusHighlights();
            return;
        }

        let name = 'NONE';
        let statusId = '';
        if (state.isPinching) { name = 'PINCH 🤏'; statusId = 'status-pinch'; }
        else if (state.isFist) { name = 'FIST ✊'; statusId = 'status-fist'; }
        else if (state.isOpenPalm) { name = 'PALM ✋'; statusId = 'status-palm'; }
        else if (state.isPeace) { name = 'PEACE ✌️'; statusId = 'status-peace'; }
        else if (state.swipeDirection) { name = `SWIPE ${state.swipeDirection.toUpperCase()}`; statusId = 'status-swipe'; }

        this.highlightStatus(statusId);

        if (name !== 'NONE') {
            document.body.classList.add('gesture-active');
            gestureSpan.innerText = name;
            feedbackEl.style.opacity = '1';
            if (this.gestureTimeout) clearTimeout(this.gestureTimeout);
            this.gestureTimeout = setTimeout(() => {
                document.body.classList.remove('gesture-active');
                feedbackEl.style.opacity = '0';
                this.gestureTimeout = null;
            }, 1000);
        }
    }

    private highlightStatus(id: string) {
        if (!id) return;
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('active');
            // Force reflow to restart animation
            el.style.animation = 'none';
            void (el as any).offsetWidth; 
            el.style.animation = 'pill-pulse 0.4s cubic-bezier(0.1, 0.9, 0.2, 1)';
            
            // Auto-clear after a delay if it's a one-shot highlight
            // Mouse/Scroll highlights are cleared by handleGestureState clearing logic or next frame
        }
    }

    private cameraStatus: string = 'checking...';
    private cursorSpeed: number = 1.5; // Added

    private clearStatusHighlights() {
        this.statusPills.forEach(p => p.classList.remove('active'));
    }

    private handleGestureState(state: any) {
        if (!state.isPinching && !state.isFist) this.pinchAnchorY = null;
        let action: string | null = null;
        
        // Virtual Trackpad Logic
        const palmAction = this.mapElements['map-palm'].value;
        
        const isLaserTracking = this.isLaserModeActive; // Track wrist position even without palm if Laser is active
        const isMouseTracking = palmAction === 'MOUSE_MODE' && state.isOpenPalm && !this.isLaserModeActive;
        
        if (isMouseTracking || isLaserTracking) {
            this.isMouseModeActive = isMouseTracking;
            if (isMouseTracking) this.highlightStatus('status-palm'); 

            const now = performance.now();
            if (now - this.lastMouseUpdate > 16) { // 60Hz update rate to save resources
                // Calculate Depth-Based Speed Multiplier (Z is negative closer to camera)
                // -0.8 to -0.2 range approximately
                const zNorm = Math.min(-0.2, Math.max(-1.0, state.pointerPos.z));
                const depthScale = 1.0 + (Math.abs(zNorm) - 0.2) * 1.5; // Closer hand = Faster speed
                
                let normX = 1 - state.pointerPos.x;
                let normY = state.pointerPos.y;

                // Apply Sensitivity with Depth Scaling
                normX = 0.5 + (normX - 0.5) * this.cursorSpeed * depthScale;
                normY = 0.5 + (normY - 0.5) * this.cursorSpeed * depthScale;
                
                // Update depth UI indicator
                const depthPill = document.getElementById('status-depth');
                if (depthPill) {
                    depthPill.style.opacity = Math.abs(zNorm) > 0.6 ? '1' : '0.4';
                    depthPill.innerText = `DEPTH: ${(Math.abs(zNorm)*100).toFixed(0)}%`;
                }

                // Clamp bounds
                normX = Math.max(0, Math.min(1, normX));
                normY = Math.max(0, Math.min(1, normY));
                const targetX = normX * this.screenWidth;
                const targetY = normY * this.screenHeight;

                // Neural Deadzone: Filter out micro-jitters (< 2px)
                if (Math.abs(targetX - this.lastX) > 2 || Math.abs(targetY - this.lastY) > 2) {
                    if (isLaserTracking) {
                        const isDrawing = state.isPinching;
                        const isClearing = state.isFist;
                        
                        if (isClearing) {
                            if (!this.isFistHeld) {
                                (window.electronAPI as any).drawLaserPoint(targetX, targetY, false, true);
                                this.isFistHeld = true;
                                this.log("Laser: Canvas Cleared");
                            }
                        } else {
                            this.isFistHeld = false;
                            (window.electronAPI as any).drawLaserPoint(targetX, targetY, isDrawing, false);
                        }
                    } else {
                        (window.electronAPI as any).mouseMove(targetX, targetY);
                    }
                    this.lastX = targetX;
                    this.lastY = targetY;
                }
                
                this.lastMouseUpdate = now;
            }
        } else {
            if (this.isLaserModeActive) { // Fallback to track wrist even without open palm
                const now = performance.now();
                if (now - this.lastMouseUpdate > 16) {
                    let normX = 1 - state.pointerPos.x;
                    let normY = state.pointerPos.y;
                    normX = 0.5 + (normX - 0.5) * this.cursorSpeed;
                    normY = 0.5 + (normY - 0.5) * this.cursorSpeed;
                    normX = Math.max(0, Math.min(1, normX));
                    normY = Math.max(0, Math.min(1, normY));
                    const targetX = normX * this.screenWidth;
                    const targetY = normY * this.screenHeight;
                    
                    if (Math.abs(targetX - this.lastX) > 2 || Math.abs(targetY - this.lastY) > 2) {
                        const isDrawing = state.isPinching;
                        const isClearing = state.isFist;
                        
                        if (isClearing) {
                            if (!this.isFistHeld) {
                                (window.electronAPI as any).drawLaserPoint(targetX, targetY, false, true);
                                this.isFistHeld = true;
                            }
                        } else {
                            this.isFistHeld = false;
                            (window.electronAPI as any).drawLaserPoint(targetX, targetY, isDrawing, false);
                        }
                        this.lastX = targetX;
                        this.lastY = targetY;
                    }
                    this.lastMouseUpdate = now;
                }
            }
            this.isMouseModeActive = false;
        }

        // Suppress OS Swipes if Laser Mode is active
        if (state.swipeDirection && !this.isMouseModeActive && !this.isPinchHeld && !this.isLaserModeActive) {
            const swipeBase = this.mapElements['map-swipe'].value;
            if (swipeBase === 'SPACES') {
                if (state.swipeDirection === 'left') action = 'SPACE_LEFT';
                else if (state.swipeDirection === 'right') action = 'SPACE_RIGHT';
                else if (state.swipeDirection === 'up') action = 'MISSION_CONTROL';
                else if (state.swipeDirection === 'down') action = 'SHOW_DESKTOP';
            } else if (swipeBase === 'MEDIA') {
                if (state.swipeDirection === 'left') action = 'PREV_TRACK';
                else if (state.swipeDirection === 'right') action = 'NEXT_TRACK';
                else if (state.swipeDirection === 'up') action = 'VOLUME_UP';
                else if (state.swipeDirection === 'down') action = 'VOLUME_DOWN';
            } else if (swipeBase === 'BROWSER') {
                if (state.swipeDirection === 'left') action = 'BROWSER_BACK';
                else if (state.swipeDirection === 'right') action = 'BROWSER_FORWARD';
                else if (state.swipeDirection === 'up') action = 'BROWSER_TAB_NEXT';
                else if (state.swipeDirection === 'down') action = 'BROWSER_TAB_PREV';
            }
        }
        else if (state.isPinching) {
            action = this.mapElements['map-pinch'].value;
            // Intercept mouse actions if laser mode is ON
            if (this.isLaserModeActive) {
                this.isPinchHeld = true; // Mark as held to prevent jitter
            }
            else if (action === 'MOUSE_MODE' || this.isMouseModeActive) {
                this.highlightStatus('status-pinch');
                const now = performance.now();
                
                if (!this.isPinchHeld) {
                    (window.electronAPI as any).mouseDown();
                    this.isPinchHeld = true;
                    this.pinchStartTime = now;
                    this.log("Mouse: Click/Drag Initialized");
                } else {
                    // Clicking Stability: Wait 200ms before allowing cursor to MOVE (Drag)
                    // This ensures the OS treats it as a CLICK unless the user holds & moves
                    if (now - this.pinchStartTime > 200) {
                        if (now - this.lastMouseUpdate > 16) {
                            const zNorm = Math.min(-0.2, Math.max(-1.0, state.pointerPos.z));
                            const depthScale = 1.0 + (Math.abs(zNorm) - 0.2) * 1.5;
                            
                            let normX = 1 - state.pointerPos.x;
                            let normY = state.pointerPos.y;
                            normX = 0.5 + (normX - 0.5) * this.cursorSpeed * depthScale;
                            normY = 0.5 + (normY - 0.5) * this.cursorSpeed * depthScale;
                            normX = Math.max(0, Math.min(1, normX));
                            normY = Math.max(0, Math.min(1, normY));

                            const targetX = normX * this.screenWidth;
                            const targetY = normY * this.screenHeight;

                            // Neural Deadzone (8px during pinch to prevent clicking slippage)
                            if (Math.abs(targetX - this.lastX) > 8 || Math.abs(targetY - this.lastY) > 8) {
                                (window.electronAPI as any).mouseDrag(targetX, targetY);
                                this.lastX = targetX;
                                this.lastY = targetY;
                            }
                            this.lastMouseUpdate = now;
                        }
                    }
                }
                return;
            }
            if (state.pinchStartPos && (action === 'VOLUME_UP' || action === 'VOLUME_DOWN' || action === 'BRIGHTNESS_UP' || action === 'BRIGHTNESS_DOWN')) {
                if (this.pinchAnchorY === null) this.pinchAnchorY = state.pinchStartPos.y;
                else {
                    const deltaY = state.pinchStartPos.y - this.pinchAnchorY;
                    if (Math.abs(deltaY) > this.CONTINUOUS_THRESH) {
                        const finalAction = deltaY < 0 ? 
                            (action.includes('VOLUME') ? 'VOLUME_UP' : 'BRIGHTNESS_UP') : 
                            (action.includes('VOLUME') ? 'VOLUME_DOWN' : 'BRIGHTNESS_DOWN');
                        this.triggerAction(finalAction, true);
                        this.pinchAnchorY = state.pinchStartPos.y;
                    }
                }
                return;
            }
        } 
        else if (state.isFist) {
            action = this.mapElements['map-fist'].value;
            if (action === 'MOUSE_SCROLL') {
                this.highlightStatus('status-fist');
                if (this.pinchAnchorY === null) this.pinchAnchorY = state.lastWristPos.y;
                else {
                    const deltaY = state.lastWristPos.y - this.pinchAnchorY;
                    if (Math.abs(deltaY) > 0.02) {
                        // Neural Physics: Apply momentum to scroll speed
                        const scrollMultiplier = 50 + (Math.abs(state.velocity.y) * 200);
                        const scrollAmount = Math.round(-deltaY * scrollMultiplier);
                        if (scrollAmount !== 0) {
                            (window.electronAPI as any).mouseScroll(scrollAmount);
                            this.pinchAnchorY = state.lastWristPos.y;
                            this.log(`Mouse: Scroll ${scrollAmount > 0 ? 'Up' : 'Down'}`);
                        }
                    }
                }
                return;
            }
        }
        else if (state.isOpenPalm) action = this.mapElements['map-palm'].value;
        else if (state.isPeace) action = this.mapElements['map-peace'].value;

        if (!state.isPinching && this.isPinchHeld) {
            this.isPinchHeld = false;
            (window.electronAPI as any).mouseUp();
            this.log("Mouse: Drag End (Up)");
        }

        // Custom Gesture Override
        if (state.matchedCustomGesture) {
            const custom = this.customGestures.find(g => g.name === state.matchedCustomGesture);
            if (custom) action = custom.action;
        }

        if (action && action !== 'NONE' && action !== 'MOUSE_MODE' && action !== 'MOUSE_SCROLL') this.triggerAction(action);
    }

    private triggerAction(action: string, continuous = false) {
        if (this.gestureLocked && !continuous) return;
        if (!this.isActivated) return; // Completely enforce Arm/Disarm lock for Shortcuts

        const now = Date.now();
        const lastTime = this.lastActionTimes.get(action) || 0;
        const debounce = continuous ? 150 : this.DEBOUNCE_MS;
        if (!continuous && now - this.lastGlobalActionTime < this.GLOBAL_DEBOUNCE_MS) return;
        
        if (now - lastTime > debounce) {
            if (action === 'LASER_POINTER') {
                this.isLaserModeActive = !this.isLaserModeActive;
                (window.electronAPI as any).toggleLaserMode(this.isLaserModeActive);
                this.log(`Laser: ${this.isLaserModeActive ? 'ENABLED (Pinch to Draw, Fist to Clear)' : 'DISABLED'}`);
                this.audio.playSuccess(0.5, this.isLaserModeActive ? 0.3 : 0.7);
                return;
            }

            if (!continuous) {
                this.gestureLocked = true;
                setTimeout(() => { this.gestureLocked = false; }, 500);
            }

            // Spatial VFX Explosion at Pointer Position
            const wx = (1 - this.lastPointerPos.x) * this.canvas.width;
            const wy = this.lastPointerPos.y * this.canvas.height;
            this.vfx.createBurst(wx, wy, 40);
            
            // Spatial Feedback
            this.audio.playSuccess(this.lastWristPos.x, this.lastWristPos.y);
            
            window.electronAPI.triggerGestureAction(action);
            this.lastActionTimes.set(action, now);
            this.lastGlobalActionTime = now;
            this.log(`Command: ${action}`);
        }
    }

    private log(msg: string) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = `>> ${msg}`;
        if (this.logEl) {
            this.logEl.prepend(entry);
            while (this.logEl.children.length > 15) this.logEl.removeChild(this.logEl.lastChild!);
        }
        window.electronAPI.log('info', msg);
    }
}

window.addEventListener('DOMContentLoaded', () => { new AetherCommandRenderer(); });
