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
    depth: number;
    matchedCustomGesture: string | null;
    pointerPos: { x: number, y: number, z: number };
}

export class GestureEngine {
    private lastWristPos: { x: number, y: number } | null = null;
    private velocity = { x: 0, y: 0 };
    private stateBuffer: Record<string, number> = { pinch: 0, fist: 0, palm: 0, peace: 0 };
    private lastSwipeTime: number = 0;
    private readonly BUFFER_THRESHOLD = 3; // Stable for 3 frames to trigger state change
    private readonly SWIPE_COOLDOWN = 500; // ms

    public process(landmarks: any[], customGestures: any[] = []): GestureState {
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

        const foldedCount = (isIndexFolded ? 1 : 0) + (isMiddleFolded ? 1 : 0) + (isRingFolded ? 1 : 0) + (isPinkyFolded ? 1 : 0);
        
        // Lenient Fist: If 3 or more fingers are folded, it's a fist
        const isFist = foldedCount >= 3;
        
        // Refined Peace: Index & Middle up, others down
        const isPeace = !isIndexFolded && !isMiddleFolded && isRingFolded && isPinkyFolded && !isFist;

        // 2. Pinch Detection (Depth Compensated)
        const rawPinchDist = this.calculateDistance(thumbTip, indexTip);
        const normPinchDist = norm(rawPinchDist);
        // Z is negative, so closer is smaller (e.g. -0.8), far is larger (e.g. -0.2)
        // Adjust threshold slightly: closer hands need slightly more gap to "pinch" to avoid false positives
        const pinchThreshold = 0.42 + Math.abs(wrist.z) * 0.1; 
        
        const isPinchingRaw = (normPinchDist < pinchThreshold) && !isFist && !isPeace;
        const pinchStrength = Math.max(0, 1 - (normPinchDist / 0.8));

        const isOpenPalmRaw = !isIndexFolded && !isMiddleFolded && !isRingFolded && !isPinkyFolded && !isPinchingRaw && !isFist && !isPeace;

        // 3. Buffer State for Neural Stability
        const updateState = (key: string, raw: boolean) => {
            if (raw) this.stateBuffer[key] = Math.min(this.BUFFER_THRESHOLD, this.stateBuffer[key] + 1);
            else this.stateBuffer[key] = Math.max(0, this.stateBuffer[key] - 1);
            return this.stateBuffer[key] === this.BUFFER_THRESHOLD;
        };

        const isPinching = updateState('pinch', isPinchingRaw);
        const isFistDebounced = updateState('fist', isFist);
        const isPeaceDebounced = updateState('peace', isPeace);
        const isOpenPalm = updateState('palm', isOpenPalmRaw);

        let pinchStartPos = null;
        if (isPinching) {
            pinchStartPos = { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 };
        }

        // Swipe System with Temporal Cooldown
        let swipeDirection: 'left' | 'right' | 'up' | 'down' | null = null;
        const now = Date.now();
        if (this.lastWristPos && now - this.lastSwipeTime > this.SWIPE_COOLDOWN) {
            this.velocity.x = wrist.x - this.lastWristPos.x;
            this.velocity.y = wrist.y - this.lastWristPos.y;
            
            const thresh = 0.22 * handScale; 
            if (this.velocity.x > thresh) { swipeDirection = 'left'; this.lastSwipeTime = now; }
            else if (this.velocity.x < -thresh) { swipeDirection = 'right'; this.lastSwipeTime = now; }
            else if (this.velocity.y < -thresh) { swipeDirection = 'up'; this.lastSwipeTime = now; }
            else if (this.velocity.y > thresh) { swipeDirection = 'down'; this.lastSwipeTime = now; }
            
            this.lastWristPos.x = wrist.x;
            this.lastWristPos.y = wrist.y;
        } else if (!this.lastWristPos) {
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
            lastWristPos: { x: wrist.x, y: wrist.y },
            pointerPos: { 
                x: landmarks[5].x, 
                y: landmarks[5].y - 0.25, 
                z: landmarks[5].z 
            }, // Using Index MCP (Knuckle) for rock-solid stability during clicks
            depth: (wrist.z + 0.5) * 2, // Normalized 0-1 depth
            matchedCustomGesture: this.matchCustomGesture(landmarks, customGestures, handScale)
        };
    }

    private matchCustomGesture(liveLandmarks: any[], storedGestures: any[], scale: number): string | null {
        if (!storedGestures || storedGestures.length === 0) return null;
        
        // Normalize live landmarks relative to wrist and scale
        const wrist = liveLandmarks[0];
        const normalizedLive = liveLandmarks.map(pt => ({
            x: (pt.x - wrist.x) / scale,
            y: (pt.y - wrist.y) / scale,
            z: (pt.z - wrist.z) / scale
        }));

        for (const gesture of storedGestures) {
            let totalError = 0;
            for (let i = 1; i < 21; i++) {
                const live = normalizedLive[i];
                const stored = gesture.landmarks[i];
                if (!stored) continue;
                
                const dx = live.x - stored.x;
                const dy = live.y - stored.y;
                const dz = live.z - stored.z;
                totalError += Math.sqrt(dx*dx + dy*dy + dz*dz);
            }
            // Average error per landmark. < 0.15 is considered a match
            if ((totalError / 20) < 0.15) {
                return gesture.name;
            }
        }
        return null;
    }

    private calculateDistance(p1: any, p2: any): number {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = p1.z - p2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    public calculateMultiHandEffects(hands: GestureState[]): { zoom: number } {
        if (hands.length < 2) return { zoom: 0 };
        
        const h1 = hands[0];
        const h2 = hands[1];

        // If both hands are pinching, calculate distance change for ZOOM
        if (h1.isPinching && h2.isPinching) {
            // Calculate 2D distance between the wrists for zoom
            const dist = Math.sqrt(Math.pow(h1.lastWristPos.x - h2.lastWristPos.x, 2) + Math.pow(h1.lastWristPos.y - h2.lastWristPos.y, 2));
            // We need previous distance to calculate delta. 
            // For now, let's just return the absolute distance and let the renderer handle delta.
            return { zoom: dist };
        }

        return { zoom: 0 };
    }
    
    public reset() {
        this.lastWristPos = null;
        this.velocity = { x: 0, y: 0 };
        this.stateBuffer = { pinch: 0, fist: 0, palm: 0, peace: 0 };
        this.lastSwipeTime = 0;
    }
}
