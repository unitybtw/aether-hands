import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface AppSettings {
    mappings: {
        pinch: string;
        fist: string;
        palm: string;
        swipe: string;
    };
    smoothing: number;
    sensitivity: number;
    openAtLogin: boolean;
    requireKey: boolean;
    leftHandMode: boolean;
    theme: 'cyberpunk' | 'minimal' | 'emerald';
    activationKey: 'Command' | 'Option' | 'Control';
}

const DEFAULT_SETTINGS: AppSettings = {
    mappings: {
        pinch: 'PLAY_PAUSE',
        fist: 'MUTE_TOGGLE',
        palm: 'MISSION_CONTROL',
        swipe: 'SPACES'
    },
    smoothing: 0.5,
    sensitivity: 0.8,
    openAtLogin: false,
    requireKey: false,
    leftHandMode: false,
    theme: 'cyberpunk',
    activationKey: 'Command'
};

export class SettingsManager {
    private settingsPath: string;
    private settings: AppSettings;

    constructor() {
        const userDataPath = app.getPath('userData');
        this.settingsPath = path.join(userDataPath, 'settings.json');
        this.settings = this.loadSettings();
    }

    private loadSettings(): AppSettings {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf-8');
                return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
            }
        } catch (error) {
            console.error('[SettingsManager] Error loading settings:', error);
        }
        return { ...DEFAULT_SETTINGS };
    }

    public getSettings(): AppSettings {
        return this.settings;
    }

    public updateSettings(partialSettings: Partial<AppSettings>) {
        this.settings = { ...this.settings, ...partialSettings };
        this.saveSettings();
    }

    private saveSettings() {
        try {
            fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
            console.log('[SettingsManager] Settings saved to:', this.settingsPath);
        } catch (error) {
            console.error('[SettingsManager] Error saving settings:', error);
        }
    }
}
