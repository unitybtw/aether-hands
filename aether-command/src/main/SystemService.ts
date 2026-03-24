import { exec, spawn, ChildProcess } from 'child_process';

export class SystemService {
    private isWindows = process.platform === 'win32';
    private mouseDaemon: ChildProcess | null = null;
    private daemonSpawnLock: number = 0;
    private lastFrontmostApp: string = '';

    public execute(action: string) {
        console.log(`[SystemService] Executing action: ${action}`);
        if (this.isWindows) {
            this.executeWindows(action);
        } else {
            this.executeMac(action);
        }
    }

    private executeWindows(action: string) {
        switch (action) {
            case 'PLAY_PAUSE': this.runCommand('powershell -c "(New-Object -ComObject Shell.Application).KeyPress(179)"'); break;
            case 'VOLUME_UP': this.runCommand('powershell -c "(New-Object -ComObject Shell.Application).KeyPress(175)"'); break;
            case 'VOLUME_DOWN': this.runCommand('powershell -c "(New-Object -ComObject Shell.Application).KeyPress(174)"'); break;
            case 'MUTE_TOGGLE': this.runCommand('powershell -c "(New-Object -ComObject Shell.Application).KeyPress(173)"'); break;
            case 'NEXT_TRACK': this.runCommand('powershell -c "(New-Object -ComObject Shell.Application).KeyPress(176)"'); break;
            case 'PREV_TRACK': this.runCommand('powershell -c "(New-Object -ComObject Shell.Application).KeyPress(177)"'); break;
            case 'SHOW_DESKTOP': this.runCommand('powershell -c "(New-Object -ComObject Shell.Application).MinimizeAll()"'); break;
            case 'LOCK_SCREEN': this.runCommand('rundll32.exe user32.dll,LockWorkStation'); break;
            case 'LAUNCH_CHROME': this.runCommand('start chrome'); break;
            case 'LAUNCH_SPOTIFY': this.runCommand('start spotify'); break;
            case 'LAUNCH_VSCODE': this.runCommand('code .'); break;
            case 'LAUNCH_TERMINAL': this.runCommand('start wt'); break;
            default:
                if (action.startsWith('SCRIPT:')) {
                    this.runCommand(`powershell -c "${action.substring(7)}"`);
                }
        }
    }

    private executeMac(action: string) {
        switch (action) {
            case 'PLAY_PAUSE':
                this.runAppleScript('if application "Spotify" is running then\ntell application "Spotify" to playpause\nelse if application "Music" is running then\ntell application "Music" to playpause\nend if');
                break;
            case 'MUTE_TOGGLE':
                this.runAppleScript('set volume output muted not (output muted of (get volume settings))');
                break;
            case 'MISSION_CONTROL':
                this.runAppleScript('tell application "System Events" to key code 160');
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
                this.runAppleScript('tell application "System Events" to key code 103');
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
            case 'BROWSER_BACK':
                this.runAppleScript('tell application "System Events" to key code 123 using command down');
                break;
            case 'BROWSER_FORWARD':
                this.runAppleScript('tell application "System Events" to key code 124 using command down');
                break;
            case 'BROWSER_TAB_NEXT':
                this.runAppleScript('tell application "System Events" to key code 48 using control down');
                break;
            case 'BROWSER_TAB_PREV':
                this.runAppleScript('tell application "System Events" to key code 48 using {control down, shift down}');
                break;
            case 'SPACE_NEXT':
                this.runAppleScript('tell application "System Events" to key code 124 using control down');
                break;
            case 'SPACE_PREV':
                this.runAppleScript('tell application "System Events" to key code 123 using control down');
                break;
            case 'TAB_NEXT':
                this.runAppleScript('tell application "System Events" to key code 48 using control down');
                break;
            case 'TAB_PREV':
                this.runAppleScript('tell application "System Events" to key code 48 using {control down, shift down}');
                break;
            default:
                if (action.startsWith('SCRIPT:')) {
                    this.runAppleScript(action.substring(7));
                }
        }
    }

    private getMouseDaemon(): ChildProcess | null {
        if (!this.mouseDaemon) {
            const now = Date.now();
            if (now - this.daemonSpawnLock < 5000) return null;
            this.daemonSpawnLock = now;

            const binName = this.isWindows ? 'mouse_ctrl.exe' : 'mouse_ctrl';
            const binPath = require('path').join(__dirname, binName);
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

    private runAppleScript(script: string, silent = false): Promise<string> {
        return new Promise((resolve) => {
            exec(`osascript -e '${script}'`, (err, stdout) => {
                if (err && !silent) {
                    console.error(`[SystemService] AppleScript Error:`, err.message);
                    resolve('');
                } else {
                    resolve(stdout ? stdout.trim() : '');
                }
            });
        });
    }

    public async getMediaInfo(): Promise<string | null> {
        if (this.isWindows) return null; // Windows placeholder
        const script = `
            try
                if application "Spotify" is running then
                    tell application "Spotify"
                        if player state is playing then return (name of current track) & " - " & (artist of current track)
                    end tell
                else if application "Music" is running then
                    tell application "Music"
                        if player state is playing then return (name of current track) & " - " & (artist of current track)
                    end tell
                end if
            end try
            return ""
        `;
        const info = await this.runAppleScript(script, true);
        return info && info.length > 0 ? info : null;
    }

    public async getVolumeInfo(): Promise<string | null> {
        if (this.isWindows) return null; // Windows placeholder
        const script = `
            try
                set vol to output volume of (get volume settings)
                set isMuted to output muted of (get volume settings)
                if isMuted then return "Muted"
                return (vol as string) & "%"
            end try
            return ""
        `;
        const info = await this.runAppleScript(script, true);
        return info && info.length > 0 ? `Volume: ${info}` : null;
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
            }
        });
    }

    public startAppMonitor(onAppChange: (appName: string) => void) {
        setInterval(() => {
            if (this.isWindows) {
                exec('powershell -c "(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object -Property LastAccessTime -Descending | Select-Object -First 1).Name"', (error, stdout) => {
                    if (!error && stdout) {
                        const appName = stdout.trim();
                        if (appName && appName !== this.lastFrontmostApp) {
                            this.lastFrontmostApp = appName;
                            onAppChange(appName);
                        }
                    }
                });
            } else {
                exec(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`, (error, stdout) => {
                    if (!error && stdout) {
                        const appName = stdout.trim();
                        if (appName && appName !== this.lastFrontmostApp) {
                            this.lastFrontmostApp = appName;
                            onAppChange(appName);
                        }
                    }
                });
            }
        }, 1500);
    }
}
