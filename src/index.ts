/**
 * index.ts
 * Main entry point for Aether-Hands.
 */

import { CameraProvider } from './core/CameraProvider.js';
import { HandTracker } from './core/HandTracker.js';
import { GestureEngine } from './core/GestureEngine.js';
import { VFXManager } from './vfx/VFXManager.js';

export class AetherEngine {
    private camera: CameraProvider;
    private tracker: HandTracker;
    private gesture: GestureEngine;
    private vfx: VFXManager;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private wasPinching: boolean = false;
    private listeners: Map<string, Function[]> = new Map();

    constructor() {
        this.camera = new CameraProvider();
        this.tracker = new HandTracker();
        this.gesture = new GestureEngine();
        
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'aether-vfx-canvas';
        // ... (styles kept elsewhere)
        
        document.body.appendChild(this.canvas);
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Canvas context failed");
        this.ctx = context;
        this.vfx = new VFXManager(this.ctx);

        this.init();
    }

    private async init() {
        console.log("[Aether] Booting engine...");
        await this.camera.initialize();
        await this.tracker.initialize();
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        this.loop();
    }

    private resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    private lastResults: any = null;

    private loop() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        try {
            const results = this.tracker.detect(this.camera.video, performance.now());
            
            // If current frame detection skipped/failed, use last valid results for rendering
            const activeResults = results || this.lastResults;

            if (results) this.lastResults = results;

            if (activeResults && activeResults.landmarks && activeResults.landmarks.length > 0) {
                activeResults.landmarks.forEach((landmarks: any) => {
                const state = this.gesture.process(landmarks);
                
                // VFX: Glass Overlay
                this.vfx.drawGlassOverlay(landmarks, this.canvas.width, this.canvas.height);

                // VFX: Trail on index finger
                const indexTip = landmarks[8];
                const vx = (1 - indexTip.x) * this.canvas.width; // Mirror logic applied here
                const vy = indexTip.y * this.canvas.height;
                
                // VFX: Update dynamic color based on position
                const hue = Math.floor((vx / this.canvas.width) * 360);
                this.vfx.setBaseColor(`rgb(${this.hslToRgb(hue, 1, 0.5)})`);

                this.vfx.drawTrail(vx, vy, state.pinchStrength);

                // VFX: Burst on pinch start
                if (state.isPinching && !this.wasPinching) {
                    this.vfx.createBurst(vx, vy, 30);
                    this.emit('PINCH_START', { x: vx, y: vy });
                    
                    // Haptic feedback
                    if ("vibrate" in navigator) {
                        navigator.vibrate(20);
                    }
                } else if (!state.isPinching && this.wasPinching) {
                    this.emit('PINCH_END', { x: vx, y: vy });
                }
                this.wasPinching = state.isPinching;
            });

            this.drawSkeleton(activeResults.landmarks);
        }

        } catch (error) {
            console.error("[Aether Loop Error]", error);
        }

        this.vfx.update();
        this.vfx.draw();

        requestAnimationFrame(() => this.loop());
    }

    private emit(event: string, data: any) {
        this.listeners.get(event)?.forEach(cb => cb(data));
    }

    private hslToRgb(h: number, s: number, l: number) {
        h /= 360;
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;
    }

    private drawSkeleton(hands: any[][]) {
        this.ctx.save();
        this.ctx.translate(this.canvas.width, 0);
        this.ctx.scale(-1, 1);

        const connections = [
            [0, 1, 2, 3, 4], // Thumb
            [0, 5, 6, 7, 8], // Index
            [9, 10, 11, 12], // Middle
            [13, 14, 15, 16], // Ring
            [0, 17, 18, 19, 20], // Pinky
            [5, 9, 13, 17] // Palm base
        ];

        hands.forEach(landmarks => {
            // Draw points (glitter effect)
            landmarks.forEach((pt, i) => {
                const x = pt.x * this.canvas.width;
                const y = pt.y * this.canvas.height;
                this.ctx.fillStyle = i % 4 === 0 ? "#fff" : "#00e5ff";
                this.ctx.beginPath();
                this.ctx.arc(x, y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            });

            // Draw connections
            this.ctx.strokeStyle = "rgba(0, 229, 255, 0.3)";
            this.ctx.lineWidth = 1.5;
            connections.forEach(path => {
                this.ctx.beginPath();
                path.forEach((idx, i) => {
                    const pt = landmarks[idx];
                    if (!pt) return;
                    const x = pt.x * this.canvas.width;
                    const y = pt.y * this.canvas.height;
                    if (i === 0) this.ctx.moveTo(x, y);
                    else this.ctx.lineTo(x, y);
                });
                this.ctx.stroke();
            });
        });
        this.ctx.restore();
    }
}

