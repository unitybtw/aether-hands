# 🧤 Aether-Hands

> A premium, high-performance gestural interaction engine for the web.

**[Live Demo 🚀](https://unitybtw.github.io/aether-hands/)**

**Aether-Hands** uses Computer Vision (MediaPipe) to track hand movements and transform them into immersive visual effects and game actions. It's designed for developers who want to add "spell-casting" mechanics or futuristic tactile interfaces to their web projects.

## ✨ Features
- **Real-time Tracking:** 21-point hand skeleton detection with sub-30ms latency.
- **Gesture Engine:** Semantic recognition for Pinches, Swipes, and hand states.
- **Reactive VFX:** 
  - **Neon Trails:** Light trails that follow your fingertips.
  - **Particle Bursts:** Explosion effects triggered by physical pinches.
  - **Glassmorphic Overlay:** A soft, glowing "digital aura" around your tracked hands.
- **Zero-Config Webcam:** Automatic stream management and mirroring.

## 🚀 Quick Start

```javascript
import { AetherEngine } from './aether-hands/src/index.js';

// The engine automatically attaches a VFX canvas to the body
const engine = new AetherEngine();

// Hook into gestures
engine.on('PINCH_START', (pos) => {
    console.log("Cast spell at:", pos);
});
```

## 🛠️ Tech Stack
- **Vision:** MediaPipe Hand Landmarker
- **Rendering:** HTML5 Canvas (2D Optimized)
- **Language:** TypeScript 5.x
- **Build:** ESBuild (ESM Output)

## 📄 License
MIT
