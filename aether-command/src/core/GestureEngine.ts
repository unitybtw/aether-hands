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
    pinchStartPos: { x: number, y: number } | null;
    lastWristPos: { x: number, y: number };
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

        // Normalization Factor
        const handScale = this.calculateDistance(wrist, landmarks[9]);
        const norm = (dist: number) => dist / handScale;

        // 1. Pose Classification
        const isIndexFolded = this.calculateDistance(indexTip, wrist) < this.calculateDistance(indexPip, wrist);
        const isMiddleFolded = this.calculateDistance(middleTip, wrist) < this.calculateDistance(middlePip, wrist);
        const isRingFolded = this.calculateDistance(ringTip, wrist) < this.calculateDistance(ringPip, wrist);
        const isPinkyFolded = this.calculateDistance(pinkyTip, wrist) < this.calculateDistance(pinkyPip, wrist);

        const isFist = isIndexFolded && isMiddleFolded && isRingFolded && isPinkyFolded;
        const isPeace = !isIndexFolded && !isMiddleFolded && isRingFolded && isPinkyFolded && !isFist;

        // 2. Pinch Detection
        const rawPinchDist = this.calculateDistance(thumbTip, indexTip);
        const normPinchDist = norm(rawPinchDist);
        const isPinching = (normPinchDist < 0.45) && !isFist && !isPeace;
        const pinchStrength = Math.max(0, 1 - (normPinchDist / 0.8));

        const isOpenPalm = !isIndexFolded && !isMiddleFolded && !isRingFolded && !isPinkyFolded && !isPinching && !isFist && !isPeace;

        let pinchStartPos = null;
        if (isPinching) {
            pinchStartPos = { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 };
        }

        // 3. Velocity & Directional Swipe
        let swipeDirection: 'left' | 'right' | 'up' | 'down' | null = null;
        if (this.lastWristPos) {
            this.velocity.x = wrist.x - this.lastWristPos.x;
            this.velocity.y = wrist.y - this.lastWristPos.y;
            
            const thresh = 0.4 * handScale; 
            if (this.velocity.x > thresh) swipeDirection = 'left';
            else if (this.velocity.x < -thresh) swipeDirection = 'right';
            else if (this.velocity.y < -thresh) swipeDirection = 'up';
            else if (this.velocity.y > thresh) swipeDirection = 'down';
            
            this.lastWristPos.x = wrist.x;
            this.lastWristPos.y = wrist.y;
        } else {
            this.lastWristPos = { x: wrist.x, y: wrist.y };
        }

        return {
            isPinching,
            pinchStrength,
            velocity: this.velocity,
            swipeDirection,
            isFist,
            isOpenPalm,
            isPeace,
            pinchStartPos,
            lastWristPos: { x: wrist.x, y: wrist.y }
        };
    }

    private calculateDistance(p1: any, p2: any): number {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = p1.z - p2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}
