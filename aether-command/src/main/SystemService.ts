import { exec, spawn, ChildProcess } from 'child_process';

export class SystemService {
    public execute(action: string) {
        console.log(`[SystemService] Executing action: ${action}`);
        switch (action) {
            case 'PLAY_PAUSE':
                this.runAppleScript('if application "Spotify" is running then\ntell application "Spotify" to playpause\nelse if application "Music" is running then\ntell application "Music" to playpause\nend if');
                break;
            case 'MUTE_TOGGLE':
                this.runAppleScript('set volume output muted not (output muted of (get volume settings))');
                break;
            case 'MISSION_CONTROL':
                this.runAppleScript('tell application "System Events" to key code 160'); // Mission Control
                break;
            case 'SPACE_LEFT':
                this.runAppleScript('tell application "System Events" to key code 123 using control down');
                break;
            case 'SPACE_RIGHT':
                this.runAppleScript('tell application "System Events" to key code 124 using control down');
                break;
            case 'BRIGHTNESS_UP':
                this.runAppleScript('tell application "System Events" to key code 144');
                break;
            case 'BRIGHTNESS_DOWN':
                this.runAppleScript('tell application "System Events" to key code 145');
                break;
            case 'LOCK_SCREEN':
                this.runAppleScript('tell application "System Events" to keystroke "q" using {command down, control down}');
                break;
            case 'MIC_MUTE':
                this.runAppleScript('set volume input volume (if input volume is 0 then 100 else 0)');
                break;
            case 'LAUNCH_SAFARI':
                this.runCommand('open -a Safari');
                break;
            case 'LAUNCH_SPOTIFY':
                this.runCommand('open -a Spotify');
                break;
            case 'VOLUME_UP':
                this.runAppleScript('set volume output volume (output volume of (get volume settings) + 10)');
                break;
            case 'VOLUME_DOWN':
                this.runAppleScript('set volume output volume (output volume of (get volume settings) - 10)');
                break;
            case 'NEXT_TRACK':
                this.runAppleScript('if application "Spotify" is running then\ntell application "Spotify" to next track\nelse if application "Music" is running then\ntell application "Music" to next track\nend if');
                break;
            case 'PREV_TRACK':
                this.runAppleScript('if application "Spotify" is running then\ntell application "Spotify" to previous track\nelse if application "Music" is running then\ntell application "Music" to previous track\nend if');
                break;
            case 'LAUNCHPAD':
                this.runCommand('open -a Launchpad');
                break;
            case 'SHOW_DESKTOP':
                this.runAppleScript('tell application "System Events" to key code 103'); // F11 Show Desktop
                break;
            case 'LAUNCH_CHROME':
                this.runCommand('open -a "Google Chrome"');
                break;
            case 'LAUNCH_VSCODE':
                this.runCommand('open -a "Visual Studio Code"');
                break;
            case 'LAUNCH_TERMINAL':
                this.runCommand('open -a Terminal');
                break;
            default:
                if (action.startsWith('SCRIPT:')) {
                    this.runAppleScript(action.substring(7));
                } else {
                    console.warn(`[SystemService] Unknown or unmapped action: ${action}`);
                }
        }
    }

    private mouseDaemon: ChildProcess | null = null;
    private daemonSpawnLock: number = 0;

    private getMouseDaemon(): ChildProcess | null {
        if (!this.mouseDaemon) {
            const now = Date.now();
            if (now - this.daemonSpawnLock < 5000) return null; // Prevent spawn loops (5 sec cooldown)
            this.daemonSpawnLock = now;

            const binPath = require('path').join(__dirname, 'mouse_ctrl');
            try {
                this.mouseDaemon = spawn(binPath);
                this.mouseDaemon.on('exit', () => { this.mouseDaemon = null; });
                this.mouseDaemon.on('error', (err) => {
                    console.error('[SystemService] Mouse daemon error:', err);
                    this.mouseDaemon = null;
                });
            } catch (e) {
                console.error('[SystemService] Failed to spawn mouse daemon:', e);
                this.mouseDaemon = null;
            }
        }
        return this.mouseDaemon;
    }

    public updateMousePosition(x: number, y: number) {
        // High performance native C module for zero-latency cursor movement via stdin daemon
        const daemon = this.getMouseDaemon();
        if (daemon && daemon.stdin) daemon.stdin.write(`${Math.round(x)} ${Math.round(y)}\n`);
    }

    public clickMouse(button: 'left' | 'right' = 'left') {
        const daemon = this.getMouseDaemon();
        if (daemon && daemon.stdin) daemon.stdin.write(`click\n`);
    }

    public mouseScroll(deltaY: number) {
        const daemon = this.getMouseDaemon();
        if (daemon && daemon.stdin) daemon.stdin.write(`scroll ${Math.round(deltaY)}\n`);
    }

    public mouseDrag(x: number, y: number) {
        const daemon = this.getMouseDaemon();
        if (daemon && daemon.stdin) daemon.stdin.write(`drag ${Math.round(x)} ${Math.round(y)}\n`);
    }

    public mouseDown() {
        const daemon = this.getMouseDaemon();
        if (daemon && daemon.stdin) daemon.stdin.write(`down\n`);
    }

    public mouseUp() {
        const daemon = this.getMouseDaemon();
        if (daemon && daemon.stdin) daemon.stdin.write(`up\n`);
    }

    private runAppleScript(script: string, silent = false) {
        exec(`osascript -e '${script}'`, (err, stdout, stderr) => {
            if (err && !silent) {
                console.error(`[SystemService] AppleScript Error:`, err.message);
            }
        });
    }

    public cleanup() {
        if (this.mouseDaemon) {
            this.mouseDaemon.kill();
            this.mouseDaemon = null;
        }
    }

    private runCommand(cmd: string) {
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.error(`[SystemService] Command Error [${cmd}]:`, err.message);
            } else {
                console.log(`[SystemService] Command Success: ${cmd}`);
            }
        });
    }
}
