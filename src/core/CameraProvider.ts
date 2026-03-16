/**
 * CameraProvider.ts
 * Manages webcam access and provides video stream for tracking.
 */

export class CameraProvider {
    private videoElement: HTMLVideoElement;
    private stream: MediaStream | null = null;

    constructor() {
        this.videoElement = document.createElement('video');
        this.videoElement.autoplay = true;
        this.videoElement.playsInline = true;
        // Mirror the camera for natural interaction
        this.videoElement.style.transform = 'scaleX(-1)';
    }

    public async initialize(): Promise<HTMLVideoElement> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                },
                audio: false
            });
            this.videoElement.srcObject = this.stream;
            
            return new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play();
                    resolve(this.videoElement);
                };
            });
        } catch (error) {
            console.error("[Aether Camera] Failed to initialize webcam:", error);
            throw error;
        }
    }

    public stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
    }

    public get video(): HTMLVideoElement {
        return this.videoElement;
    }
}
