export class VFXManager {
    private ctx: CanvasRenderingContext2D;
    private particles: any[] = [];
    private MAX_PARTICLES = 50;
    private baseColor: string = "#00e5ff";

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
    }

    public setBaseColor(color: string) {
        this.baseColor = color;
    }

    public update() {
        // Efficiency: Update in place and limit growth
        this.particles = this.particles.filter(p => p.life > 0).slice(0, this.MAX_PARTICLES);
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
        });
    }

    public draw() {
        this.particles.forEach(p => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            this.ctx.fillStyle = (p.color || this.baseColor).replace(")", `, ${p.life})`).replace("rgb", "rgba");
            if (this.baseColor.startsWith("#")) {
                this.ctx.fillStyle = `rgba(0, 229, 255, ${p.life})`; // Fallback for HEX
            }
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = this.baseColor;
            this.ctx.fill();
        });
    }

    public createBurst(x: number, y: number, count: number = 20) {
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 10,
                vy: (Math.random() - 0.5) * 10,
                size: Math.random() * 5 + 2,
                life: 1.0,
                color: this.baseColor
            });
        }
    }

    public drawTrail(x: number, y: number, strength: number) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, 10 + strength * 20, 0, Math.PI * 2);
        this.ctx.strokeStyle = this.baseColor;
        this.ctx.globalAlpha = 0.2 + strength * 0.5;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;
    }

    public drawSearchPulse(width: number, height: number) {
        const time = performance.now() * 0.002;
        const radius = 20 + Math.sin(time) * 10;
        this.ctx.beginPath();
        this.ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        this.ctx.strokeStyle = "rgba(0, 229, 255, 0.2)";
        this.ctx.setLineDash([5, 5]);
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    public drawGlassOverlay(landmarks: any[], width: number, height: number) {
        this.ctx.save();
        this.ctx.beginPath();
        
        // Define points for a "hand-shaped" polygon (simplified)
        // Landmarks: 0 (wrist), 5 (index base), 17 (pinky base)
        const pts = [0, 5, 9, 13, 17].map(i => {
            const p = landmarks[i];
            if (!p) return { x: 0, y: 0 };
            return {
                x: (1 - p.x) * width,
                y: p.y * height
            };
        });

        this.ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => this.ctx.lineTo(p.x, p.y));
        this.ctx.closePath();

        // Use a simple fill instead of shadows
        this.ctx.fillStyle = "rgba(0, 229, 255, 0.15)";
        this.ctx.fill();

        // Border
        this.ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        this.ctx.restore();
    }
}
