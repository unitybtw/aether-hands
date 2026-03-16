import { exec } from 'child_process';

export class SystemService {
    public execute(action: string) {
        switch (action) {
            case 'PLAY_PAUSE':
                this.runAppleScript('tell application "System Events" to key code 103'); // Media Play/Pause
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
            default:
                console.log(`[SystemService] Unknown action: ${action}`);
        }
    }

    private runAppleScript(script: string) {
        exec(`osascript -e '${script}'`, (err) => {
            if (err) console.error(`[SystemService] AppleScript Error:`, err);
        });
    }

    private runCommand(cmd: string) {
        exec(cmd, (err) => {
            if (err) console.error(`[SystemService] Command Error:`, err);
        });
    }
}
