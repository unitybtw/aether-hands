/**
 * HandTracker.ts
 * Integrates MediaPipe Hand Landmarker for real-time tracking.
 */

import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export interface HandResults {
    landmarks: any[][];
    worldLandmarks: any[][];
    handedness: any[][];
}

export class HandTracker {
    private handLandmarker: HandLandmarker | null = null;
    private isInitialized: boolean = false;

    public async initialize() {
        if (this.isInitialized) return;
        console.log("[HandTracker] Starting initialization...");

        try {
            console.log("[HandTracker] Resolving fileset from CDN...");
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
            );
            console.log("[HandTracker] Fileset resolved.");

            console.log("[HandTracker] Creating HandLandmarker...");
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1, 
                minHandDetectionConfidence: 0.8,
                minHandPresenceConfidence: 0.8,
                minTrackingConfidence: 0.8
            });
            console.log("[HandTracker] HandLandmarker created successfully.");

            this.isInitialized = true;
        } catch (error) {
            console.error("[HandTracker] Initialization error:", error);
            throw error;
        }
    }

    public updateOptions(confidence: number) {
        if (!this.handLandmarker) return;
        this.handLandmarker.setOptions({
            minHandDetectionConfidence: confidence,
            minHandPresenceConfidence: confidence,
            minTrackingConfidence: confidence
        });
        console.log(`[HandTracker] Confidence updated to: ${confidence}`);
    }

    private frameCount: number = 0;
    private lastHandCount: number = 0;

    public detect(video: HTMLVideoElement, timestamp: number): HandResults | null {
        if (!this.handLandmarker || !this.isInitialized) return null;

        /** 
         * AGGRESSIVE OPTIMIZATION:
         * 1. If no hands, check every frame.
         * 2. If hands found, skip 3 frames.
         */
        this.frameCount++;
        if (this.lastHandCount > 0 && this.frameCount % 3 !== 0) {
            return null; 
        }

        const results = this.handLandmarker.detectForVideo(video, timestamp);
        this.lastHandCount = results.landmarks ? results.landmarks.length : 0;
        
        return {
            landmarks: results.landmarks || [],
            worldLandmarks: results.worldLandmarks || [],
            handedness: results.handedness || []
        };
    }
}
