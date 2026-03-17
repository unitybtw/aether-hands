/**
 * GestureEngine.ts
 * Interprets hand landmark data into semantic gestures.
 */

export interface GestureState {
    isPinching: boolean;
    pinchStrength: number;
    velocity: { x: number, y: number };
    swipeDirection: 'left' | 'right' | 'up' | 'down' | null;
    isFist: boolean;
    isOpenPalm: boolean;
    isPeace: boolean;
}

export class GestureEngine {
    private lastWristPos: { x: number, y: number } | null = null;
    private velocity = { x: 0, y: 0 };

    public process(landmarks: any[]): GestureState {
        const wrist = landmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const indexPip = landmarks[6];
        const middleTip = landmarks[12];
        const middlePip = landmarks[10];
        const ringTip = landmarks[16];
        const ringPip = landmarks[14];
        const pinkyTip = landmarks[20];
        const pinkyPip = landmarks[18];

        // Normalization Factor: Use distance from wrist to middle MCP (knuckle) as a proxy for hand scale
        // Landmark 9 is middle mcp
        const handScale = this.calculateDistance(wrist, landmarks[9]);
        const norm = (dist: number) => dist / handScale;

        // 1. Pose Classification (Fist vs Open Palm)
        // Check if tips are closer to wrist than their respective PIP joints
        const isIndexFolded = this.calculateDistance(indexTip, wrist) < this.calculateDistance(indexPip, wrist);
        const isMiddleFolded = this.calculateDistance(middleTip, wrist) < this.calculateDistance(middlePip, wrist);
        const isRingFolded = this.calculateDistance(ringTip, wrist) < this.calculateDistance(ringPip, wrist);
        const isPinkyFolded = this.calculateDistance(pinkyTip, wrist) < this.calculateDistance(pinkyPip, wrist);

        const isFist = isIndexFolded && isMiddleFolded && isRingFolded && isPinkyFolded;
        const isOpenPalm = !isIndexFolded && !isMiddleFolded && !isRingFolded && !isPinkyFolded;
        const isPeace = !isIndexFolded && !isMiddleFolded && isRingFolded && isPinkyFolded;

        // 2. Pinch Detection (Normalized)
        const rawPinchDist = this.calculateDistance(thumbTip, indexTip);
        const normPinchDist = norm(rawPinchDist);
        const isPinching = (normPinchDist < 0.4) && !isFist; // Exclude fist from being a pinch
        const pinchStrength = Math.max(0, 1 - (normPinchDist / 0.8));

        // 3. Velocity & Directional Swipe
        let swipeDirection: 'left' | 'right' | 'up' | 'down' | null = null;
        if (this.lastWristPos) {
            this.velocity = {
                x: wrist.x - this.lastWristPos.x,
                y: wrist.y - this.lastWristPos.y
            };
            
            // Normalize velocity threshold by hand scale too
            const thresh = 0.4 * handScale; 
            if (this.velocity.x > thresh) swipeDirection = 'left';
            else if (this.velocity.x < -thresh) swipeDirection = 'right';
            else if (this.velocity.y < -thresh) swipeDirection = 'up';
            else if (this.velocity.y > thresh) swipeDirection = 'down';
        }
        this.lastWristPos = { x: wrist.x, y: wrist.y };

        return {
            isPinching,
            pinchStrength,
            velocity: this.velocity,
            swipeDirection,
            isFist,
            isOpenPalm,
            isPeace
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
