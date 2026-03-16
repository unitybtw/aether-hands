/**
 * GestureEngine.ts
 * Interprets hand landmark data into semantic gestures.
 */

export interface GestureState {
    isPinching: boolean;
    pinchStrength: number; // 0 to 1
    velocity: { x: number, y: number };
    activeGesture: string | null;
}

export class GestureEngine {
    private lastWristPos: { x: number, y: number } | null = null;
    private velocity = { x: 0, y: 0 };

    public process(landmarks: any[]): GestureState {
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const wrist = landmarks[0];

        // 1. Pinch Detection (Thumb + Index distance)
        const dist = this.calculateDistance(thumbTip, indexTip);
        const isPinching = dist < 0.05; // Adjustable threshold
        const pinchStrength = Math.max(0, 1 - (dist / 0.1));

        // 2. Velocity / Swipe Tracking (Based on wrist movement)
        if (this.lastWristPos) {
            this.velocity = {
                x: wrist.x - this.lastWristPos.x,
                y: wrist.y - this.lastWristPos.y
            };
        }
        this.lastWristPos = { x: wrist.x, y: wrist.y };

        // 3. Simple Gesture Classification
        let activeGesture = null;
        if (isPinching) activeGesture = "PINCH";
        else if (Math.abs(this.velocity.x) > 0.03) activeGesture = "SWIPE";

        return {
            isPinching,
            pinchStrength,
            velocity: this.velocity,
            activeGesture
        };
    }

    private calculateDistance(p1: any, p2: any): number {
        return Math.sqrt(
            Math.pow(p1.x - p2.x, 2) + 
            Math.pow(p1.y - p2.y, 2) + 
            Math.pow(p1.z - p2.z, 2)
        );
    }
}
