/**
 * VFXManager.ts
 * Handles WebGL/Canvas visual effects based on gestures.
 */

export class VFXManager {
    private ctx: CanvasRenderingContext2D;
    private particles: any[] = [];

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
    }

    public update() {
        this.particles = this.particles.filter(p => p.life > 0);
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
            this.ctx.fillStyle = `rgba(0, 229, 255, ${p.life})`;
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = "#00e5ff";
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
                life: 1.0
            });
        }
    }

    public drawTrail(x: number, y: number, strength: number) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, 10 + strength * 20, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(0, 229, 255, ${0.2 + strength * 0.5})`;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }

    public drawGlassOverlay(landmarks: any[], width: number, height: number) {
        this.ctx.save();
        this.ctx.beginPath();
        
        // Define points for a "hand-shaped" polygon (simplified)
        // Landmarks: 0 (wrist), 5 (index base), 17 (pinky base)
        const pts = [0, 5, 9, 13, 17].map(i => ({
            x: (1 - landmarks[i].x) * width,
            y: landmarks[i].y * height
        }));

        this.ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => this.ctx.lineTo(p.x, p.y));
        this.ctx.closePath();

        // Glow effect
        this.ctx.shadowBlur = 30;
        this.ctx.shadowColor = "rgba(0, 229, 255, 0.4)";
        this.ctx.fillStyle = "rgba(0, 229, 255, 0.05)";
        this.ctx.fill();

        // Border
        this.ctx.strokeStyle = "rgba(0, 229, 255, 0.2)";
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        this.ctx.restore();
    }
}
