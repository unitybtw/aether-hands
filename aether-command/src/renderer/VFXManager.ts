export class VFXManager {
    private ctx: CanvasRenderingContext2D;
    private particles: any[] = [];
    private MAX_PARTICLES = 60;
    public baseColor: string = "#00e5ff";
    private scanlineOffset = 0;
    private trails: Map<number, { x: number, y: number }[]> = new Map();

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
    }

    public update() {
        this.scanlineOffset = (this.scanlineOffset + 1) % 100;
        if (this.particles.length === 0) return;
        
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.03;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    public draw() {
        if (this.particles.length > 0) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = "lighter";
            this.particles.forEach(p => {
                const alpha = Math.max(0, p.life);
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                this.ctx.fillStyle = this.hexToRgba(this.baseColor, alpha);
                this.ctx.fill();
            });
            this.ctx.restore();
        }
    }

    public createBurst(x: number, y: number, count: number = 20) {
        if (this.particles.length >= this.MAX_PARTICLES) return;
        const actualCount = Math.min(count, this.MAX_PARTICLES - this.particles.length);
        for (let i = 0; i < actualCount; i++) {
            this.particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 10,
                vy: (Math.random() - 0.5) * 10,
                size: Math.random() * 6 + 2,
                life: 1.0
            });
        }
    }

    public drawSkeleton(landmarks: any[], width: number, height: number, confidence: number = 1.0) {
        this.ctx.save();
        
        const mainColor = confidence < 0.7 ? '#ff4b2b' : this.baseColor;
        const connections = [
            [0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12],
            [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17, 5]
        ];

        const wrist = landmarks[0];
        const wx = (1 - wrist.x) * width;
        const wy = wrist.y * height;

        // Scanning Glow
        const gradient = this.ctx.createRadialGradient(wx, wy, 20, wx, wy, 150);
        gradient.addColorStop(0, this.hexToRgba(mainColor, 0.1));
        gradient.addColorStop(1, 'transparent');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, width, height);

        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = mainColor;
        this.ctx.strokeStyle = this.hexToRgba(mainColor, 0.6);
        this.ctx.lineWidth = 2.5;

        connections.forEach(path => {
            this.ctx.beginPath();
            path.forEach((idx, i) => {
                const pt = landmarks[idx];
                const x = (1 - pt.x) * width;
                const y = pt.y * height;
                if (i === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            });
            this.ctx.stroke();
        });

        landmarks.forEach((pt, idx) => {
            const x = (1 - pt.x) * width;
            const y = pt.y * height;
            
            // Draw Ghost Trail for Fingertips
            if ([8, 12, 16, 20].includes(idx)) {
                let trail = this.trails.get(idx);
                if (!trail) { trail = []; this.trails.set(idx, trail); }
                trail.push({ x, y });
                if (trail.length > 10) trail.shift();

                this.ctx.beginPath();
                this.ctx.moveTo(trail[0].x, trail[0].y);
                trail.forEach((t, i) => {
                    this.ctx.lineTo(t.x, t.y);
                });
                this.ctx.strokeStyle = this.hexToRgba(mainColor, 0.3);
                this.ctx.lineWidth = 1.5;
                this.ctx.stroke();
            }

            this.ctx.beginPath();
            this.ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            this.ctx.fillStyle = "#fff";
            this.ctx.fill();

            if ([4, 8, 12, 16, 20].includes(idx)) {
                this.ctx.strokeStyle = this.hexToRgba(mainColor, 0.8);
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.arc(x, y, 8, 0, Math.PI * 2);
                this.ctx.stroke();
                
                this.ctx.beginPath();
                this.ctx.moveTo(x - 12, y); this.ctx.lineTo(x - 6, y);
                this.ctx.moveTo(x + 6, y); this.ctx.lineTo(x + 12, y);
                this.ctx.moveTo(x, y - 12); this.ctx.lineTo(x, y - 6);
                this.ctx.moveTo(x, y + 6); this.ctx.lineTo(x, y + 12);
                this.ctx.stroke();
            }
        });

        // Depth Meter
        const dScale = Math.min(1, Math.max(0, (wrist.z + 0.5) * 2));
        this.ctx.fillStyle = "rgba(255,255,255,0.1)";
        this.ctx.fillRect(10, height / 2 - 50, 4, 100);
        this.ctx.fillStyle = mainColor;
        this.ctx.fillRect(10, height / 2 + 50, 4, -dScale * 100);
        this.ctx.font = "8px 'Outfit'";
        this.ctx.fillText("Z-DEPTH", 8, height / 2 - 55);

        this.ctx.restore();
    }

    private hexToRgba(hex: string, alpha: number): string {
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
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }
}
