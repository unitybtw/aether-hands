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
    
    private lastActionTimes: Map<string, number> = new Map();
    private lastGlobalActionTime: number = 0;
    private lastFrameTime = 0;
    private fpsEl: HTMLElement;
    private confEl: HTMLElement;
    private stabilityCanvas: HTMLCanvasElement;
    private stabilityCtx: CanvasRenderingContext2D;
    private stabilityData: number[] = new Array(50).fill(0);
    private gestureLocked: boolean = false;
    private readonly GLOBAL_DEBOUNCE_MS = 800;
    private readonly DEBOUNCE_MS = 1500;
    
    private pinchAnchorY: number | null = null;
    private readonly CONTINUOUS_THRESH = 0.05;
    
    private lastInteractionTime: number = Date.now();
    private isSuspended: boolean = false;
    private isVisible: boolean = true;
    private readonly SUSPEND_TIMEOUT_MS = 300000;
    private currentBrightness: number = 0;

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
        
        this.lastFrameTime = performance.now();
        this.fpsEl = document.getElementById('debug-fps')!;
        this.confEl = document.getElementById('debug-conf')!;

        this.initialize();
        this.setupInactivityListeners();
        this.setupTiltEffect();

        window.electronAPI.onVisibilityChanged((visible) => {
            this.isVisible = visible;
            this.log(`System: ${visible ? 'Dashboard Visible' : 'Dashboard Hidden'}.`);
        });
    }

    private setupInactivityListeners() {
        window.addEventListener('mousemove', (e) => {
            this.wakeUp();
        });
        window.addEventListener('keydown', () => this.wakeUp());
        window.addEventListener('click', () => this.wakeUp());
    }

    private setupTiltEffect() {
        let lastX = 0;
        let lastY = 0;
        const panels = document.querySelectorAll('.panel'); // Cache panels
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isVisible) return;
            const targetX = (e.clientX / window.innerWidth - 0.5) * 8;
            const targetY = (e.clientY / window.innerHeight - 0.5) * 8;

            // Only update if movement is significant (> 0.2 deg change)
            if (Math.abs(targetX - lastX) > 0.2 || Math.abs(targetY - lastY) > 0.2) {
                lastX = targetX;
                lastY = targetY;
                const transform = `perspective(1000px) rotateX(${-targetY}deg) rotateY(${targetX}deg)`;
                panels.forEach((panel: any) => {
                    panel.style.transform = transform;
                });
            }
        });
    }

    private estimateBrightness() {
        if (!this.video.videoWidth) return;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 20;
        tempCanvas.height = 15;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;
        
        tempCtx.drawImage(this.video, 0, 0, 20, 15);
        const data = tempCtx.getImageData(0, 0, 20, 15).data;
        let brightness = 0;
        for (let i = 0; i < data.length; i += 4) {
            brightness += (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
        }
        this.currentBrightness = brightness / (20 * 15);
    }

    private drawStabilityGraph(stability: number) {
        if (!this.isVisible) return;
        this.stabilityData.push(stability);
        if (this.stabilityData.length > 50) this.stabilityData.shift();

        const w = this.stabilityCanvas.width = this.stabilityCanvas.clientWidth;
        const h = this.stabilityCanvas.height = this.stabilityCanvas.clientHeight;
        const ctx = this.stabilityCtx;

        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        ctx.strokeStyle = this.vfx.baseColor;
        ctx.lineWidth = 1.5;
        
        this.stabilityData.forEach((val, i) => {
            const x = (i / (this.stabilityData.length - 1)) * w;
            const y = h - (val * (h * 0.8));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
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

            const hasCamera = await this.initCamera();
            if (!hasCamera) return;

            await this.tracker.initialize();
            this.isRunning = true;
            this.loop();
        } catch (err: any) {
            this.log(`Critical Error: ${err.message}`);
        }
    }

    private updateActivationStatusUI(active: boolean) {
        const dot = document.getElementById('activation-dot');
        const text = document.getElementById('activation-text');
        if (dot && text) {
            dot.style.background = active ? '#00e5ff' : '#64748b';
            dot.style.boxShadow = active ? '0 0 10px #00e5ff' : 'none';
            text.innerText = active ? 'SYSTEM ARMED' : 'SYSTEM STANDBY (HOLD KEY)';
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
                else if (value !== undefined) el.value = (value as any).toString();
            }
        }
        this.applyTheme(settings.theme);
        this.updateActivationUIState(settings.requireKey);
        this.leftHandMode = settings.leftHandMode;
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
        const uiElements = [
            'setting-smoothing', 'setting-autolaunch', 
            'setting-require-key', 'setting-activation-key',
            'setting-sensitivity', 'setting-theme', 'setting-hand-preference',
            'map-pinch', 'map-fist', 'map-palm', 'map-peace', 'map-swipe'
        ];
        uiElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => {
                if (id === 'setting-require-key') this.updateActivationUIState((el as HTMLInputElement).checked);
                this.handleSettingChange();
            });
        });

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

        // Profile Switcher
        const profileSelect = document.getElementById('setting-profile') as HTMLSelectElement;
        if (profileSelect) {
            profileSelect.addEventListener('change', () => {
                const profile = profileSelect.value;
                // @ts-ignore
                const config = (window as any).PROFILES[profile];
                if (config) {
                    (document.getElementById('map-pinch') as HTMLSelectElement).value = config.pinch;
                    (document.getElementById('map-fist') as HTMLSelectElement).value = config.fist;
                    (document.getElementById('map-palm') as HTMLSelectElement).value = config.palm;
                    (document.getElementById('map-peace') as HTMLSelectElement).value = config.peace;
                    (document.getElementById('map-swipe') as HTMLSelectElement).value = config.swipe;
                    this.handleSettingChange();
                    this.log(`Profile: Switching to ${profile.toUpperCase()} mode.`);
                }
            });
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
            extraVfx: (document.getElementById('setting-vfx-extra') as HTMLInputElement).checked
        };
        this.lerpAmount = settings.smoothing;
        this.smoother.setFactor(settings.smoothing);
        this.leftHandMode = settings.leftHandMode;
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

    private async initCamera(): Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480, facingMode: "user" } 
            });
            this.video.srcObject = stream;
            return new Promise((resolve) => {
                this.video.onloadeddata = () => { this.video.play(); resolve(true); };
                this.video.onerror = () => resolve(false);
            });
        } catch (error) { return false; }
    }

    async loop() {
        if (!this.isRunning) return;

        if (Date.now() - this.lastInteractionTime > this.SUSPEND_TIMEOUT_MS) {
            if (!this.isSuspended) {
                this.isSuspended = true;
                document.body.classList.add('battery-saver');
                window.electronAPI.setTrackingStatus(false);
            }
            requestAnimationFrame(() => this.loop());
            return;
        }

        if (!this.isVisible) await new Promise(resolve => setTimeout(resolve, 66));
        
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        if (this.canvas.width !== cw || this.canvas.height !== ch) {
            this.canvas.width = cw;
            this.canvas.height = ch;
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.vfx.update();

        try {
            let skipRate = this.isVisible ? 1 : 12;
            // @ts-ignore
            if (this.isVisible && (window as any).isBatterySaverEnabled) skipRate = 2; // 30FPS base
            
            if (this.frameCount % skipRate === 0) {
                // Adaptive Light Normalization - Occurs every 2 seconds roughly
                if (this.frameCount % 120 === 0) {
                    this.estimateBrightness();
                }

                const result = this.tracker.detect(this.video, performance.now());
                if (result && result.landmarks && result.landmarks.length > 0) {
                    const handednessInfo = result.handedness?.[0]?.[0] || result.handedness?.[0];
                    const handedness = (handednessInfo as any)?.categoryName || 'Unknown';
                    const confidence = (handednessInfo as any)?.score || 0;

                    if (this.frameCount % 10 === 0) {
                        const lowLight = this.currentBrightness < 50;
                        const label = lowLight ? 'LOW LIGHT' : 'OK';
                        this.confEl.innerText = `CONF: ${(confidence * 100).toFixed(0)}% [${label}]`;
                        this.confEl.style.color = lowLight ? '#ff9800' : 'rgba(255,255,255,0.4)';
                    }

                    // Lower confidence requirement in low light to avoid "hand lost" stutter
                    const minConf = this.currentBrightness < 50 ? 0.5 : 0.7;
                    const isRequestedHand = (handedness === 'Unknown' || confidence > minConf) && 
                                           (this.leftHandMode ? (handedness === 'Left') : (handedness === 'Right'));
                    
                    if (isRequestedHand) {
                        window.electronAPI.setTrackingStatus(true);
                        
                        // Predictive Smoothing
                        const smoothed = this.smoother.smooth(result.landmarks[0]);
                        this.vfx.drawSkeleton(smoothed, this.canvas.width, this.canvas.height, confidence);

                        // Proximity Warning
                        const proxEl = document.getElementById('proximity-warning');
                        if (proxEl) {
                            proxEl.style.opacity = smoothed[0].z < -0.8 ? '1' : '0';
                        }

                        if (this.isActivated) {
                            const state = this.gesture.process(smoothed);
                            
                            // Update Stability (Inversely proportional to velocity)
                            const vel = Math.sqrt(state.velocity.x ** 2 + state.velocity.y ** 2);
                            const stability = Math.max(0, 1 - vel * 5);
                            this.drawStabilityGraph(stability);

                            this.handleGestureState(state);
                            this.updateGestureUI(state);
                        } else {
                            this.updateGestureUI(null);
                            this.drawStabilityGraph(0);
                        }
                    } else {
                        this.updateGestureUI(null);
                    }
                    this.lastHandDetectionTime = Date.now();
                } else {
                    if (Date.now() - this.lastHandDetectionTime > 2000 && this.lastHandDetectionTime !== 0) {
                        window.electronAPI.setTrackingStatus(false);
                        this.lastHandDetectionTime = 0;
                        this.updateGestureUI(null);
                    }
                }
            }
        } catch (e) { console.error(e); }

        if (this.isVisible) this.vfx.draw();

        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.lastFrameTime = now;
        if (this.frameCount % 30 === 0) this.fpsEl.innerText = `FPS: ${Math.round(1000 / delta)}`;
        this.frameCount++;
        requestAnimationFrame(() => this.loop());
    }

    private updateGestureUI(state: any) {
        const feedbackEl = document.getElementById('gesture-feedback');
        const gestureSpan = document.getElementById('last-gesture');
        const overlay = document.getElementById('gesture-status-overlay');
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
        this.clearStatusHighlights();
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    private clearStatusHighlights() {
        document.querySelectorAll('.status-pill').forEach(p => p.classList.remove('active'));
    }

    private handleGestureState(state: any) {
        if (!state.isPinching) this.pinchAnchorY = null;
        let action: string | null = null;
        if (state.isPinching) {
            action = (document.getElementById('map-pinch') as HTMLSelectElement).value;
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
        else if (state.isFist) action = (document.getElementById('map-fist') as HTMLSelectElement).value;
        else if (state.isOpenPalm) action = (document.getElementById('map-palm') as HTMLSelectElement).value;
        else if (state.isPeace) action = (document.getElementById('map-peace') as HTMLSelectElement).value;
        else if (state.swipeDirection) {
            const swipeBase = (document.getElementById('map-swipe') as HTMLSelectElement).value;
            action = swipeBase === 'SPACES' ? (state.swipeDirection === 'left' ? 'SPACE_LEFT' : 'SPACE_RIGHT') : swipeBase;
        }
        if (action && action !== 'NONE') this.triggerAction(action);
    }

    private triggerAction(action: string, continuous = false) {
        if (this.gestureLocked && !continuous) return;

        const now = Date.now();
        const lastTime = this.lastActionTimes.get(action) || 0;
        const debounce = continuous ? 150 : this.DEBOUNCE_MS;
        if (!continuous && now - this.lastGlobalActionTime < this.GLOBAL_DEBOUNCE_MS) return;
        
        if (now - lastTime > debounce) {
            if (!continuous) {
                this.gestureLocked = true;
                setTimeout(() => { this.gestureLocked = false; }, 500);
            }

            this.vfx.createBurst(this.canvas.width / 2, this.canvas.height / 2, 30);
            
            // Spatial Feedback
            const hx = this.gesture['lastWristPos']?.x || 0.5;
            const hy = this.gesture['lastWristPos']?.y || 0.5;
            this.audio.playSuccess(hx, hy);
            
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
