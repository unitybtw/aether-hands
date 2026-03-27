/**
 * HUDManager.ts
 * Manages the Aether Command telemetry overlay, status pills, and stability graphs.
 */

export class HUDManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private stabilityData: number[] = [];
    private maxDataPoints = 60;
    private statusPills: Map<string, HTMLElement> = new Map();
    private warnings: Map<string, HTMLElement> = new Map();
    private logEl: HTMLElement | null = null;
    private accentColor: string = "#00e5ff";
    private colorCache: Map<string, string> = new Map();

    /**
     * @param stabilityCanvas The canvas element used for drawing telemetry graphs
     * @param logElement The container for real-time system logs
     */
    constructor(stabilityCanvas: HTMLCanvasElement, logElement: HTMLElement) {
        this.canvas = stabilityCanvas;
        this.ctx = this.canvas.getContext('2d')!;
        this.logEl = logElement;
        
        // Cache UI elements
        const pills = ['status-pinch', 'status-fist', 'status-palm', 'status-peace', 'status-swipe', 'status-depth'];
        pills.forEach(id => {
            const el = document.getElementById(id);
            if (el) this.statusPills.set(id, el);
        });

        const warns = ['proximity-warning', 'light-warning', 'velocity-warning'];
        warns.forEach(id => {
            const el = document.getElementById(id);
            if (el) this.warnings.set(id, el);
        });
    }

    public setAccentColor(color: string) {
        this.accentColor = color;
    }

    public updateStability(value: number) {
        this.stabilityData.push(value);
        if (this.stabilityData.length > this.maxDataPoints) {
            this.stabilityData.shift();
        }
        this.drawStability();
    }

    private drawStability() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.clearRect(0, 0, w, h);

        if (this.stabilityData.length < 2) return;

        this.ctx.beginPath();
        this.ctx.strokeStyle = this.accentColor;
        this.ctx.lineWidth = 2;
        this.ctx.lineJoin = "round";

        const step = w / (this.maxDataPoints - 1);
        this.stabilityData.forEach((val, i) => {
            const x = i * step;
            const y = h - (val * h);
            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        });
        this.ctx.stroke();

        // Gradient under the curve
        this.ctx.lineTo(this.stabilityData.length * step, h);
        this.ctx.lineTo(0, h);
        const grad = this.ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, this.hexToRgba(this.accentColor, 0.2));
        grad.addColorStop(1, 'transparent');
        this.ctx.fillStyle = grad;
        this.ctx.fill();
    }

    public highlightStatus(id: string) {
        const el = this.statusPills.get(id);
        if (el) {
            el.classList.add('active');
            el.style.animation = 'none';
            void (el as any).offsetWidth; 
            el.style.animation = 'pill-pulse 0.4s cubic-bezier(0.1, 0.9, 0.2, 1)';
        }
    }

    public clearStatusHighlights() {
        this.statusPills.forEach(el => el.classList.remove('active'));
    }

    public setWarning(id: string, visible: boolean) {
        const el = this.warnings.get(id);
        if (el) {
            el.style.opacity = visible ? '1' : '0';
        }
    }

    public updateLog(msg: string) {
        if (!this.logEl) return;
        const entry = document.createElement('div');
        entry.style.marginBottom = '4px';
        entry.style.borderLeft = `2px solid ${this.accentColor}`;
        entry.style.paddingLeft = '8px';
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        this.logEl.prepend(entry);
        
        while (this.logEl.childNodes.length > 50) {
            this.logEl.removeChild(this.logEl.lastChild!);
        }
    }

    private hexToRgba(hex: string, alpha: number): string {
        const cacheKey = `${hex}_${alpha}`;
        if (this.colorCache.has(cacheKey)) return this.colorCache.get(cacheKey)!;

        let r = 0, g = 0, b = 0;
        if (hex.length === 4) {
            r = parseInt(hex[1] + hex[1], 16);
            g = parseInt(hex[2] + hex[2], 16);
            b = parseInt(hex[3] + hex[3], 16);
        } else if (hex.length === 7) {
            r = parseInt(hex.substring(1, 3), 16);
            g = parseInt(hex.substring(3, 5), 16);
            b = parseInt(hex.substring(5, 7), 16);
        }
        const rgba = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        this.colorCache.set(cacheKey, rgba);
        return rgba;
    }
}
