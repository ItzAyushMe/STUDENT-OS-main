// ============================================================
// StudentOS — sound service
// Ambient loops (rain/ocean/lofi/white noise) + sound effects.
// Native: expo-audio. Web: HTMLAudioElement. Never throws —
// audio failures are always silent (app must not crash).
// ============================================================
import { Platform } from 'react-native';

let expoAudio = null;
if (Platform.OS !== 'web') {
  try {
    expoAudio = require('expo-audio');
  } catch (e) {
    expoAudio = null;
  }
}

export const AMBIENT_SOUNDS = [
  { id: 'rain', label: 'Rain', icon: '🌧️' },
  { id: 'ocean', label: 'Ocean', icon: '🌊' },
  { id: 'lofi', label: 'Lofi', icon: '🎧' },
  { id: 'white', label: 'White Noise', icon: '🌫️' },
];

const SOURCES = {
  rain: require('../../assets/sounds/rain.wav'),
  ocean: require('../../assets/sounds/ocean.wav'),
  lofi: require('../../assets/sounds/lofi.wav'),
  white: require('../../assets/sounds/whitenoise.wav'),
};

const SFX_SOURCES = {
  complete: require('../../assets/sounds/complete.wav'),
  levelup: require('../../assets/sounds/levelup.wav'),
};

let modeConfigured = false;
async function ensureAudioMode() {
  if (modeConfigured || !expoAudio) return;
  modeConfigured = true;
  try {
    await expoAudio.setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
  } catch (e) {
    /* ignore */
  }
}

// ---------------- ambient ----------------
const nativePlayers = {}; // id -> player
const webPlayers = {}; // id -> HTMLAudioElement
let currentAmbient = null;

export const ambient = {
  current: () => currentAmbient,

  async play(id, volume = 0.6) {
    if (!SOURCES[id]) return;
    try {
      await ensureAudioMode();
      if (currentAmbient && currentAmbient !== id) ambient.stop();
      currentAmbient = id;
      if (Platform.OS === 'web') {
        let el = webPlayers[id];
        if (!el) {
          el = new Audio(SOURCES[id]);
          el.loop = true;
          webPlayers[id] = el;
        }
        el.volume = Math.max(0, Math.min(1, volume));
        el.currentTime = 0;
        await el.play();
      } else if (expoAudio) {
        let p = nativePlayers[id];
        if (!p) {
          p = expoAudio.createAudioPlayer(SOURCES[id]);
          nativePlayers[id] = p;
        }
        p.loop = true;
        p.volume = Math.max(0, Math.min(1, volume));
        p.play();
      }
    } catch (e) {
      /* audio issues never crash the app */
    }
  },

  setVolume(volume) {
    try {
      const v = Math.max(0, Math.min(1, volume));
      if (Platform.OS === 'web') {
        if (currentAmbient && webPlayers[currentAmbient]) webPlayers[currentAmbient].volume = v;
      } else if (currentAmbient && nativePlayers[currentAmbient]) {
        nativePlayers[currentAmbient].volume = v;
      }
    } catch (e) {
      /* ignore */
    }
  },

  stop() {
    try {
      if (Platform.OS === 'web') {
        Object.values(webPlayers).forEach((el) => {
          el.pause();
        });
      } else {
        Object.values(nativePlayers).forEach((p) => {
          try {
            p.pause();
          } catch (e) {
            /* ignore */
          }
        });
      }
    } catch (e) {
      /* ignore */
    }
    currentAmbient = null;
  },
};

// ---------------- SFX ----------------
const sfxNativePlayers = {};

export function playSfx(name) {
  try {
    const src = SFX_SOURCES[name];
    if (!src) return;
    ensureAudioMode();
    if (Platform.OS === 'web') {
      const el = new Audio(src);
      el.volume = 0.7;
      el.play().catch(() => {});
    } else if (expoAudio) {
      let p = sfxNativePlayers[name];
      if (!p) {
        p = expoAudio.createAudioPlayer(src);
        sfxNativePlayers[name] = p;
      }
      p.volume = 0.9;
      p.seekTo(0).catch?.(() => {});
      setTimeout(() => {
        try {
          p.play();
        } catch (e) {
          /* ignore */
        }
      }, 30);
    }
  } catch (e) {
    /* ignore */
  }
}
