export class VFXManager {
    private ctx: CanvasRenderingContext2D;
    private particles: any[] = [];
    private MAX_PARTICLES = 60; // Reduced for performance
    public baseColor: string = "#00e5ff";

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
    }

    public update() {
        if (this.particles.length === 0) return;
        
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.03; // Faster fade for less overlapping
            
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    public draw() {
        if (this.particles.length === 0) return;

        this.ctx.save();
        this.ctx.globalCompositeOperation = "lighter";
        
        const count = this.particles.length;
        for (let i = 0; i < count; i++) {
            const p = this.particles[i];
            const alpha = p.life <= 0 ? 0 : p.life;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
            this.ctx.fillStyle = this.hexToRgba(this.baseColor, alpha);
            this.ctx.fill();
        }
        this.ctx.restore();
    }

    public createBurst(x: number, y: number, count: number = 15) {
        // Strict particle capping
        if (this.particles.length >= this.MAX_PARTICLES) return;
        const actualCount = Math.min(count, this.MAX_PARTICLES - this.particles.length);

        for (let i = 0; i < actualCount; i++) {
            this.particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8,
                size: Math.random() * 5 + 2,
                life: 1.0
            });
        }
    }

    public drawSkeleton(landmarks: any[], width: number, height: number) {
        this.ctx.save();
        
        const connections = [
            [0, 1, 2, 3, 4], // Thumb
            [0, 5, 6, 7, 8], // Index
            [9, 10, 11, 12], // Middle
            [13, 14, 15, 16], // Ring
            [0, 17, 18, 19, 20], // Pinky
            [5, 9, 13, 17, 5] // Palm
        ];

        // Draw Glow (Reduced blur for performance)
        this.ctx.shadowBlur = 8;
        this.ctx.shadowColor = this.baseColor;
        this.ctx.strokeStyle = this.hexToRgba(this.baseColor, 0.5);
        this.ctx.lineWidth = 2.5;
        this.ctx.lineJoin = "round";
        this.ctx.lineCap = "round";

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

        // Draw Joints
        this.ctx.fillStyle = "#fff";
        this.ctx.shadowBlur = 4;
        landmarks.forEach(pt => {
            const x = (1 - pt.x) * width;
            const y = pt.y * height;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });

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
        // Round alpha for string performance
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }
}
