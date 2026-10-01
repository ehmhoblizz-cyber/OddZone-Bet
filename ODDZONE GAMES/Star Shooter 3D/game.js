/**
 * Star Shooter 3D - Epic Space Combat Game
 * Advanced Three.js WebGL Engine, Procedural Synthwave Web Audio,
 * Object-Pooled Visual FX, Power-Up System, Enemy Variety, Boss Battles & Mobile Touch Controls.
 */

// ==========================================
// 1. PROCEDURAL SOUND & SYNTHWAVE MUSIC ENGINE
// ==========================================
class SoundFX {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.6;
    this.sfxMuted = false;
    this.musicMuted = false;

    // Music Nodes & State
    this.musicGain = null;
    this.sfxGain = null;
    this.musicInterval = null;
    this.musicStep = 0;
    this.isPlayingMusic = false;

    // Chord Progression for Synthwave: Dm -> Bb -> F -> C
    this.chords = [
      [146.83, 174.61, 220.00], // D3, F3, A3 (Dm)
      [116.54, 146.83, 174.61], // Bb2, D3, F3 (Bb)
      [130.81, 164.81, 196.00], // F3, A3, C4 (F)
      [130.81, 164.81, 196.00]  // C3, E3, G3 (C)
    ];
    this.bassNotes = [73.42, 58.27, 87.31, 65.41]; // D2, Bb1, F2, C2
  }

  init(settings = {}) {
    if (settings.sfxVolume !== undefined) this.sfxVolume = settings.sfxVolume;
    if (settings.musicVolume !== undefined) this.musicVolume = settings.musicVolume;
    if (settings.sfxMuted !== undefined) this.sfxMuted = settings.sfxMuted;
    if (settings.musicMuted !== undefined) this.musicMuted = settings.musicMuted;

    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();

        // Master SFX Gain
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.setValueAtTime(this.sfxMuted ? 0 : this.sfxVolume, this.ctx.currentTime);
        this.sfxGain.connect(this.ctx.destination);

        // Master Music Gain
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.setValueAtTime(this.musicMuted ? 0 : this.musicVolume * 0.45, this.ctx.currentTime);
        this.musicGain.connect(this.ctx.destination);
      }
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setSFXVolume(val) {
    this.sfxVolume = THREE.MathUtils.clamp(val, 0, 1);
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxMuted ? 0 : this.sfxVolume, this.ctx.currentTime);
    }
  }

  setMusicVolume(val) {
    this.musicVolume = THREE.MathUtils.clamp(val, 0, 1);
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setValueAtTime(this.musicMuted ? 0 : this.musicVolume * 0.45, this.ctx.currentTime);
    }
  }

  toggleMute() {
    const allMuted = !this.sfxMuted;
    this.sfxMuted = allMuted;
    this.musicMuted = allMuted;
    if (this.ctx) {
      if (this.sfxGain) this.sfxGain.gain.setValueAtTime(this.sfxMuted ? 0 : this.sfxVolume, this.ctx.currentTime);
      if (this.musicGain) this.musicGain.gain.setValueAtTime(this.musicMuted ? 0 : this.musicVolume * 0.45, this.ctx.currentTime);
    }
    return this.sfxMuted;
  }

  startMusic() {
    if (!this.ctx || this.isPlayingMusic) return;
    this.isPlayingMusic = true;
    this.musicStep = 0;

    const stepDuration = (60 / 120) / 4; // 16th note at 120 BPM = 0.125s

    this.musicInterval = setInterval(() => {
      if (!this.isPlayingMusic || !this.ctx || this.ctx.state !== 'running') return;
      this.playMusicStep(this.musicStep);
      this.musicStep = (this.musicStep + 1) % 32;
    }, stepDuration * 1000);
  }

  stopMusic() {
    this.isPlayingMusic = false;
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }

  playMusicStep(step) {
    if (!this.ctx || this.musicMuted || this.musicVolume <= 0) return;
    const now = this.ctx.currentTime;
    const chordIndex = Math.floor(step / 8) % 4;
    const chord = this.chords[chordIndex];
    const bassNote = this.bassNotes[chordIndex];

    // 1. Driving Synth Bassline
    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    const bassFilter = this.ctx.createBiquadFilter();

    bassOsc.type = 'sawtooth';
    const pitch = (step % 4 === 3) ? bassNote * 2 : bassNote;
    bassOsc.frequency.setValueAtTime(pitch, now);

    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(450, now);
    bassFilter.frequency.exponentialRampToValueAtTime(100, now + 0.11);

    bassGain.gain.setValueAtTime(0.35, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(this.musicGain);

    bassOsc.start(now);
    bassOsc.stop(now + 0.12);

    // 2. Sci-Fi Mid Arpeggio
    if (step % 2 === 0) {
      const noteIndex = (step / 2) % 3;
      const arpNote = chord[noteIndex] * 2;

      const arpOsc = this.ctx.createOscillator();
      const arpGain = this.ctx.createGain();
      const arpFilter = this.ctx.createBiquadFilter();

      arpOsc.type = 'square';
      arpOsc.frequency.setValueAtTime(arpNote, now);

      arpFilter.type = 'bandpass';
      arpFilter.frequency.setValueAtTime(1400, now);
      arpFilter.Q.value = 2.0;

      arpGain.gain.setValueAtTime(0.18, now);
      arpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      arpOsc.connect(arpFilter);
      arpFilter.connect(arpGain);
      arpGain.connect(this.musicGain);

      arpOsc.start(now);
      arpOsc.stop(now + 0.22);
    }

    // 3. Hi-Hat Shaker on Off-beats
    if (step % 4 === 2) {
      const bufferSize = this.ctx.sampleRate * 0.04;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const hatNoise = this.ctx.createBufferSource();
      hatNoise.buffer = buffer;

      const hatFilter = this.ctx.createBiquadFilter();
      hatFilter.type = 'highpass';
      hatFilter.frequency.setValueAtTime(7000, now);

      const hatGain = this.ctx.createGain();
      hatGain.gain.setValueAtTime(0.15, now);
      hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      hatNoise.connect(hatFilter);
      hatFilter.connect(hatGain);
      hatGain.connect(this.musicGain);

      hatNoise.start(now);
      hatNoise.stop(now + 0.045);
    }
  }

  // --- SOUND EFFECTS ---
  playShoot(isRapid = false) {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = isRapid ? 'triangle' : 'sawtooth';
      const startFreq = isRapid ? 1100 : 880;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);

      gain.gain.setValueAtTime(isRapid ? 0.22 : 0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3600, now);
      filter.frequency.exponentialRampToValueAtTime(400, now + 0.12);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch (e) {}
  }

  playEnemyShoot() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.16);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.17);
    } catch (e) {}
  }

  playExplosion(isLarge = false) {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const duration = isLarge ? 0.9 : 0.55;

      const bufferSize = this.ctx.sampleRate * duration;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(isLarge ? 1400 : 1000, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(45, now + duration);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(isLarge ? 0.55 : 0.38, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      whiteNoise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.sfxGain);

      whiteNoise.start(now);
      whiteNoise.stop(now + duration);

      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(isLarge ? 140 : 110, now);
      subOsc.frequency.exponentialRampToValueAtTime(20, now + (isLarge ? 0.65 : 0.38));

      subGain.gain.setValueAtTime(isLarge ? 0.7 : 0.45, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + (isLarge ? 0.65 : 0.38));

      subOsc.connect(subGain);
      subGain.connect(this.sfxGain);

      subOsc.start(now);
      subOsc.stop(now + (isLarge ? 0.7 : 0.4));
    } catch (e) {}
  }

  playPowerUp() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
      notes.forEach((freq, idx) => {
        const now = this.ctx.currentTime + idx * 0.05;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        osc.start(now);
        osc.stop(now + 0.23);
      });
    } catch (e) {}
  }

  playBossWarning() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      for (let i = 0; i < 3; i++) {
        const now = this.ctx.currentTime + i * 0.25;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(440, now + 0.12);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        osc.start(now);
        osc.stop(now + 0.21);
      }
    } catch (e) {}
  }

  playBossDefeat() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [220, 277.18, 329.63, 440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        const t = now + idx * 0.08;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        osc.start(t);
        osc.stop(t + 0.52);
      });
      this.playExplosion(true);
    } catch (e) {}
  }

  playHit() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(540, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {}
  }

  playPlayerDamage() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);

      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 0.35);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.36);
    } catch (e) {}
  }

  playWaveStart() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        const now = this.ctx.currentTime + idx * 0.09;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        osc.start(now);
        osc.stop(now + 0.26);
      });
    } catch (e) {}
  }

  playGameOver() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const notes = [440, 392, 349.23, 293.66, 220];
      notes.forEach((freq, idx) => {
        const now = this.ctx.currentTime + idx * 0.16;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(200, now + 0.35);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);

        osc.start(now);
        osc.stop(now + 0.36);
      });
    } catch (e) {}
  }

  playUI() {
    if (!this.ctx || this.sfxMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.04);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }
}

// ==========================================
// 2. EXPANDED SAVE SYSTEM
// ==========================================
class SaveSystem {
  static STORAGE_KEY = 'STAR_SHOOTER_3D_SAVE';

  static load() {
    const defaults = {
      highScore: 0,
      maxWave: 1,
      totalKills: 0,
      totalScore: 0,
      bossesDefeated: 0,
      gamesPlayed: 0,
      settings: {
        sfxVolume: 0.8,
        musicVolume: 0.6,
        sfxMuted: false,
        musicMuted: false
      }
    };

    try {
      const raw = localStorage.getItem(SaveSystem.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign(defaults, parsed, {
          settings: Object.assign(defaults.settings, parsed.settings || {})
        });
      }
    } catch (e) {}
    return defaults;
  }

  static save(data) {
    try {
      localStorage.setItem(SaveSystem.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }
}

// ==========================================
// 3. MAIN GAME ENGINE
// ==========================================
class StarShooterGame {
  constructor() {
    // Game States
    this.STATE_MENU = 'MENU';
    this.STATE_PLAYING = 'PLAYING';
    this.STATE_PAUSED = 'PAUSED';
    this.STATE_GAMEOVER = 'GAMEOVER';
    this.state = this.STATE_MENU;

    // Save Data & Audio Engine
    this.saveData = SaveSystem.load();
    this.sound = new SoundFX();

    // DOM Elements
    this.canvas = document.getElementById('gameCanvas');
    this.hudOverlay = document.getElementById('hudOverlay');
    this.startScreen = document.getElementById('startScreen');
    this.pauseScreen = document.getElementById('pauseScreen');
    this.gameOverScreen = document.getElementById('gameOverScreen');
    this.damageOverlay = document.getElementById('damageOverlay');
    this.waveBanner = document.getElementById('waveBanner');
    this.waveBannerSub = document.getElementById('waveBannerSub');
    this.waveBannerText = document.getElementById('waveBannerText');
    this.reticle = document.getElementById('reticle');

    // Boss HUD Elements
    this.bossHealthContainer = document.getElementById('bossHealthContainer');
    this.bossName = document.getElementById('bossName');
    this.bossHealthText = document.getElementById('bossHealthText');
    this.bossHealthBarFill = document.getElementById('bossHealthBarFill');

    // HUD Text Elements
    this.hudScore = document.getElementById('hudScore');
    this.hudHighScore = document.getElementById('hudHighScore');
    this.hudWave = document.getElementById('hudWave');
    this.hudKills = document.getElementById('hudKills');
    this.hudNextWave = document.getElementById('hudNextWave');
    this.hudKillsContainer = document.getElementById('hudKillsContainer');
    this.healthMeter = document.getElementById('healthMeter');
    this.healthText = document.getElementById('healthText');
    this.healthSegments = Array.from(document.querySelectorAll('.health-bar-segment'));
    this.audioIcon = document.getElementById('audioIcon');

    // Active Power-Ups Badges Elements
    this.powerUpShieldBadge = document.getElementById('powerUpShield');
    this.powerUpShieldTimer = document.getElementById('powerUpShieldTimer');
    this.powerUpShieldBar = document.getElementById('powerUpShieldBar');

    this.powerUpRapidBadge = document.getElementById('powerUpRapid');
    this.powerUpRapidTimer = document.getElementById('powerUpRapidTimer');
    this.powerUpRapidBar = document.getElementById('powerUpRapidBar');

    this.powerUpMultiplierBadge = document.getElementById('powerUpMultiplier');
    this.powerUpMultiplierTimer = document.getElementById('powerUpMultiplierTimer');
    this.powerUpMultiplierBar = document.getElementById('powerUpMultiplierBar');

    this.powerUpToast = document.getElementById('powerUpToast');
    this.toastIcon = document.getElementById('toastIcon');
    this.toastText = document.getElementById('toastText');

    // Menu Stats Elements
    this.startHighScore = document.getElementById('startHighScore');
    this.startMaxWave = document.getElementById('startMaxWave');
    this.finalScore = document.getElementById('finalScore');
    this.finalHighScore = document.getElementById('finalHighScore');
    this.finalWave = document.getElementById('finalWave');
    this.finalKills = document.getElementById('finalKills');
    this.lifetimeScore = document.getElementById('lifetimeScore');
    this.lifetimeKills = document.getElementById('lifetimeKills');
    this.lifetimeBosses = document.getElementById('lifetimeBosses');
    this.lifetimeMissions = document.getElementById('lifetimeMissions');
    this.newHighScoreBadge = document.getElementById('newHighScoreBadge');
    this.pauseScore = document.getElementById('pauseScore');
    this.pauseWave = document.getElementById('pauseWave');

    // Audio Sliders
    this.musicVolSlider = document.getElementById('musicVolSlider');
    this.musicVolText = document.getElementById('musicVolText');
    this.sfxVolSlider = document.getElementById('sfxVolSlider');
    this.sfxVolText = document.getElementById('sfxVolText');

    // Mobile Touch Elements
    this.mobileTouchControls = document.getElementById('mobileTouchControls');
    this.touchSteerZone = document.getElementById('touchSteerZone');
    this.touchJoystickStick = document.getElementById('touchJoystickStick');
    this.touchFireButton = document.getElementById('touchFireButton');
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    // Gameplay Variables
    this.score = 0;
    this.lastReportedScore = -1;
    this.wave = 1;
    this.kills = 0;
    this.waveKills = 0;
    this.killsPerWave = 10;
    this.maxHealth = 5;
    this.health = 5;

    // Power-Up Effect Timers
    this.shieldTimeLeft = 0;
    this.rapidFireTimeLeft = 0;
    this.multiplierTimeLeft = 0;
    this.powerUpSpawnTimer = 0;

    // Movement & Controls
    this.mousePos = { x: 0, y: 0 };
    this.targetMousePos = { x: 0, y: 0 };
    this.isFiring = false;
    this.fireTimer = 0;
    this.laserAlternator = 0;

    // Player Flight Physics
    this.forwardSpeed = 55;
    this.shipRoll = 0;
    this.shipPitch = 0;
    this.shipYaw = 0;
    this.shipPosition = new THREE.Vector3(0, 0, 0);
    this.shipRotation = new THREE.Euler(0, 0, 0, 'YXZ');
    this.shipForward = new THREE.Vector3(0, 0, -1);
    this.shipUp = new THREE.Vector3(0, 1, 0);
    this.shipRight = new THREE.Vector3(1, 0, 0);

    // Camera follow parameters
    this.cameraOffset = new THREE.Vector3(0, 3.8, 9.5);
    this.cameraShake = 0;

    // Entity Collections & Pools
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.enemies = [];
    this.powerUps = [];
    this.particles = [];
    this.shockwaves = [];
    this.scorePopups = [];
    this.scorePopupPool = [];
    this.boss = null;
    this.isBossWave = false;
    this.bossDefeatTimer = 0;

    // Spawning timers
    this.spawnTimer = 0;
    this.spawnInterval = 2.0;
    this.survivalTimer = 0;

    // Three.js Core Objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.playerShip = null;
    this.playerShieldMesh = null;
    this.playerShieldInner = null;
    this.enginePointLight = null;
    this.starfield = null;
    this.nebulaClouds = [];
    this.strobeLights = [];

    // Pre-allocated Resource Library (Shared Geometries & Materials)
    this.resources = {};

    // Clock
    this.clock = new THREE.Clock();

    // Initialize Engine
    this.initThree();
    this.initSharedResources();
    this.createPlayerShip();
    this.createStarfield();
    this.createProceduralNebula();
    this.initScorePopupPool();
    this.initEvents();
    this.initTouchControls();
    this.initAudioSettings();
    this.updateMenuStats();

    // Start Rendering Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // ==========================================
  // 3.1 THREE.JS INITIALIZATION
  // ==========================================
  initThree() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000011, 0.0035);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 1400);
    this.camera.position.set(0, 5, 12);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x223355, 1.8);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.8);
    sunLight.position.set(40, 60, 50);
    this.scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x00f0ff, 1.5);
    rimLight.position.set(-40, -20, -50);
    this.scene.add(rimLight);
  }

  // ==========================================
  // 3.2 SHARED RESOURCE LIBRARY (GEOMETRIES & MATERIALS)
  // ==========================================
  initSharedResources() {
    // 1. Shared Spaceship Geometries
    this.resources.geos = {
      // Scout ("Viper Razorwing")
      scoutFuselage: (() => {
        const g = new THREE.ConeGeometry(0.55, 3.4, 5);
        g.rotateX(-Math.PI / 2);
        return g;
      })(),
      scoutCanopy: (() => {
        const g = new THREE.SphereGeometry(0.38, 8, 8);
        g.scale(0.75, 0.55, 1.4);
        return g;
      })(),
      scoutWing: (() => {
        const g = new THREE.BoxGeometry(1.6, 0.06, 1.1);
        g.rotateY(-0.35); // Forward sweep
        return g;
      })(),
      scoutFin: (() => {
        const g = new THREE.BoxGeometry(0.06, 0.85, 0.7);
        g.rotateZ(0.2); // Cant outward
        return g;
      })(),
      scoutEngine: (() => {
        const g = new THREE.CylinderGeometry(0.2, 0.28, 0.5, 8);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      scoutPlume: (() => {
        const g = new THREE.ConeGeometry(0.24, 1.4, 8);
        g.rotateX(-Math.PI / 2);
        return g;
      })(),
      scoutHalo: new THREE.SphereGeometry(2.2, 12, 10),

      // Tank ("Goliath Heavy Destroyer")
      tankChassis: new THREE.BoxGeometry(2.6, 1.4, 3.4),
      tankProw: (() => {
        const g = new THREE.ConeGeometry(1.4, 1.6, 4);
        g.rotateX(-Math.PI / 2);
        return g;
      })(),
      tankSidePod: (() => {
        const g = new THREE.CylinderGeometry(0.65, 0.65, 3.2, 8);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      tankShieldRing: new THREE.TorusGeometry(0.88, 0.1, 6, 16),
      tankArmorPlate: new THREE.BoxGeometry(0.26, 1.2, 2.2),
      tankReactor: new THREE.SphereGeometry(0.65, 8, 8),
      tankThruster: (() => {
        const g = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 8);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      tankHalo: new THREE.SphereGeometry(3.6, 12, 10),

      // Shooter ("Specter Catamaran Gunship")
      shooterPontoon: (() => {
        const g = new THREE.CylinderGeometry(0.42, 0.42, 3.4, 8);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      shooterBridge: new THREE.BoxGeometry(1.6, 0.5, 1.3),
      shooterEye: (() => {
        const g = new THREE.SphereGeometry(0.42, 8, 8);
        g.scale(1.2, 0.8, 1.2);
        return g;
      })(),
      shooterCannon: (() => {
        const g = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      shooterCannonTip: new THREE.SphereGeometry(0.18, 8, 8),
      shooterWing: new THREE.BoxGeometry(1.2, 0.06, 0.9),
      shooterHalo: new THREE.SphereGeometry(2.6, 12, 10),

      // Basic ("Crimson Trident Interceptor")
      basicFuselage: (() => {
        const g = new THREE.OctahedronGeometry(1.3, 0);
        g.scale(1.1, 0.7, 2.4);
        return g;
      })(),
      basicVisor: (() => {
        const g = new THREE.SphereGeometry(0.45, 8, 8);
        g.scale(0.8, 0.6, 1.5);
        return g;
      })(),
      basicWings: new THREE.BoxGeometry(3.6, 0.08, 1.2),
      basicFin: new THREE.BoxGeometry(0.08, 1.1, 0.9),
      basicGun: (() => {
        const g = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 6);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      basicHalo: new THREE.SphereGeometry(2.5, 12, 10),

      // Boss ("Sector Dreadnought")
      bossTurret: (() => {
        const g = new THREE.CylinderGeometry(0.32, 0.32, 2.2, 8);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      bossEngine: (() => {
        const g = new THREE.CylinderGeometry(0.8, 1.1, 2.0, 10);
        g.rotateX(Math.PI / 2);
        return g;
      })(),

      // FX
      particle: new THREE.SphereGeometry(0.25, 6, 6),
      particleSpark: new THREE.SphereGeometry(0.15, 4, 4),
      shockwave: (() => {
        const g = new THREE.RingGeometry(0.5, 1.2, 24);
        g.rotateX(-Math.PI / 2);
        return g;
      })()
    };

    // 2. Shared Materials
    this.resources.mats = {
      // Scout (Vibrant Crimson Plating)
      scoutHull: new THREE.MeshStandardMaterial({ color: 0x240207, metalness: 0.9, roughness: 0.2 }),
      scoutGlow: new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff1122, emissiveIntensity: 2.6, roughness: 0.1 }),
      scoutPlume: new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }),
      scoutHalo: new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),

      // Tank (Blazing Orange Heavy Armor)
      tankHull: new THREE.MeshStandardMaterial({ color: 0x220c02, metalness: 0.92, roughness: 0.25 }),
      tankGlow: new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 2.4, roughness: 0.1 }),
      tankRing: new THREE.MeshStandardMaterial({ color: 0xff7700, emissive: 0xff5500, emissiveIntensity: 2.2 }),
      tankHalo: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),

      // Shooter (Electric Magenta Gunmetal)
      shooterHull: new THREE.MeshStandardMaterial({ color: 0x1f001c, metalness: 0.88, roughness: 0.2 }),
      shooterGlow: new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xcc00aa, emissiveIntensity: 2.6, roughness: 0.1 }),
      shooterHalo: new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),

      // Basic (Crimson Interceptor)
      basicHull: new THREE.MeshStandardMaterial({ color: 0x20050d, metalness: 0.85, roughness: 0.3 }),
      basicGlow: new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff2244, emissiveIntensity: 2.2 }),
      basicHalo: new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    };
  }

  // ==========================================
  // 3.3 PRE-RENDERED HIGH-RES SCORE POPUP POOL
  // ==========================================
  initScorePopupPool() {
    this.scoreTextures = {};

    const scores = ['+100', '+150', '+250', '+300', '+2000', '+2X 200', '+2X 300', '+2X 500', '+2X 600', '+2X 4000', 'SHIELD', 'RAPID', '2X SCORE', 'REPAIR'];

    scores.forEach(text => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 256;
      const ctx = c.getContext('2d');

      // Rounded pill dark translucent background
      ctx.fillStyle = 'rgba(2, 6, 20, 0.85)';
      ctx.strokeStyle = text.includes('2X') ? '#b5179e' : (text.includes('2000') ? '#ff2a5f' : '#00f0ff');
      ctx.lineWidth = 8;

      const r = 35;
      const x = 30, y = 40, w = 452, h = 176;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Large bold typography
      ctx.font = '900 86px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Thick dark outline for maximum readability
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 14;
      ctx.strokeText(text, 256, 128);

      // Neon Fill
      ctx.fillStyle = text.includes('2X') ? '#ffd700' : (text.includes('2000') ? '#ff4d6d' : '#ffffff');
      ctx.shadowColor = text.includes('2X') ? '#ffb703' : '#00f0ff';
      ctx.shadowBlur = 18;
      ctx.fillText(text, 256, 128);

      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      this.scoreTextures[text] = mat;
    });

    // Allocate 15 reusable Sprite objects
    for (let i = 0; i < 15; i++) {
      const sprite = new THREE.Sprite(this.scoreTextures['+100']);
      sprite.visible = false;
      this.scene.add(sprite);
      this.scorePopupPool.push(sprite);
    }
  }

  triggerScorePopup(pos, text) {
    const mat = this.scoreTextures[text] || this.scoreTextures['+100'];

    let sprite = this.scorePopupPool.find(s => !s.visible);
    if (!sprite) {
      sprite = new THREE.Sprite(mat);
      this.scene.add(sprite);
      this.scorePopupPool.push(sprite);
    }

    sprite.material = mat;
    sprite.material.opacity = 1.0;
    sprite.position.copy(pos);
    sprite.scale.set(6.0, 3.0, 1.0);
    sprite.visible = true;

    this.scorePopups.push({
      sprite: sprite,
      life: 1.3,
      maxLife: 1.3,
      baseScale: 6.0
    });
  }

  // ==========================================
  // 3.4 STARFIELD & PROCEDURAL NEBULA
  // ==========================================
  createStarfield() {
    const starCount = 2200;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 550;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 550;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 650;

      const tint = Math.random();
      if (tint > 0.7) {
        starColors[i * 3] = 0.0;
        starColors[i * 3 + 1] = 0.94;
        starColors[i * 3 + 2] = 1.0;
      } else if (tint > 0.4) {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 0.2;
        starColors[i * 3 + 2] = 0.45;
      } else {
        starColors[i * 3] = 0.9;
        starColors[i * 3 + 1] = 0.95;
        starColors[i * 3 + 2] = 1.0;
      }
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.85
    });

    this.starfield = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starfield);
  }

  createProceduralNebula() {
    const createNebulaTexture = (colorCenter, colorEdge) => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
      grad.addColorStop(0, colorCenter);
      grad.addColorStop(0.5, colorEdge);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    };

    const textures = [
      createNebulaTexture('rgba(0, 240, 255, 0.45)', 'rgba(0, 50, 120, 0.15)'),
      createNebulaTexture('rgba(255, 42, 95, 0.45)', 'rgba(100, 10, 50, 0.15)'),
      createNebulaTexture('rgba(181, 23, 158, 0.45)', 'rgba(60, 10, 90, 0.15)')
    ];

    const planeGeo = new THREE.PlaneGeometry(350, 350);

    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: textures[i % textures.length],
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 600,
        (Math.random() - 0.5) * 400,
        -250 - Math.random() * 300
      );
      mesh.rotation.z = Math.random() * Math.PI;

      this.scene.add(mesh);
      this.nebulaClouds.push(mesh);
    }
  }

  // ==========================================
  // 3.5 ENHANCED PLAYER STARFIGHTER MODEL
  // ==========================================
  createPlayerShip() {
    this.playerShip = new THREE.Group();

    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0x141e30,
      metalness: 0.88,
      roughness: 0.22
    });

    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c1322,
      metalness: 0.9,
      roughness: 0.28
    });

    const glowCyanMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 2.2,
      roughness: 0.08
    });

    // 1. Sleek Main Fuselage
    const noseGeo = new THREE.ConeGeometry(0.7, 3.4, 6);
    noseGeo.rotateX(Math.PI / 2);
    const noseMesh = new THREE.Mesh(noseGeo, hullMaterial);
    noseMesh.position.set(0, 0, -1.2);
    this.playerShip.add(noseMesh);

    const bodyGeo = new THREE.BoxGeometry(1.2, 0.65, 2.6);
    const bodyMesh = new THREE.Mesh(bodyGeo, hullMaterial);
    bodyMesh.position.set(0, 0, 0.5);
    this.playerShip.add(bodyMesh);

    // 2. Glowing Cockpit Canopy (Multi-layered)
    const cockpitGeo = new THREE.SphereGeometry(0.48, 16, 12);
    cockpitGeo.scale(0.8, 0.7, 2.0);
    const cockpitMesh = new THREE.Mesh(cockpitGeo, glowCyanMaterial);
    cockpitMesh.position.set(0, 0.45, -0.3);
    this.playerShip.add(cockpitMesh);

    // 3. Swept-Back Combat Wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(3.2, -1.2);
    wingShape.lineTo(3.2, -1.9);
    wingShape.lineTo(0, -0.9);
    wingShape.closePath();

    const extrudeSettings = { depth: 0.08, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.02, bevelThickness: 0.02 };
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, extrudeSettings);
    wingGeo.rotateX(-Math.PI / 2);

    const rightWing = new THREE.Mesh(wingGeo, wingMaterial);
    rightWing.position.set(0.5, 0, 0.8);
    this.playerShip.add(rightWing);

    const leftWingGeo = wingGeo.clone();
    leftWingGeo.scale(-1, 1, 1);
    const leftWing = new THREE.Mesh(leftWingGeo, wingMaterial);
    leftWing.position.set(-0.5, 0, 0.8);
    this.playerShip.add(leftWing);

    // 4. Wingtip Laser Cannons & Strobe Lights
    const cannonGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8);
    cannonGeo.rotateX(Math.PI / 2);

    const rightCannon = new THREE.Mesh(cannonGeo, glowCyanMaterial);
    rightCannon.position.set(3.4, 0.05, -0.2);
    this.playerShip.add(rightCannon);

    const leftCannon = new THREE.Mesh(cannonGeo, glowCyanMaterial);
    leftCannon.position.set(-3.4, 0.05, -0.2);
    this.playerShip.add(leftCannon);

    // Navigation Strobe Lights
    const strobeGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const portLight = new THREE.Mesh(strobeGeo, new THREE.MeshBasicMaterial({ color: 0xff0044 }));
    portLight.position.set(-3.4, 0.15, -1.0);
    this.playerShip.add(portLight);

    const starboardLight = new THREE.Mesh(strobeGeo, new THREE.MeshBasicMaterial({ color: 0x00ff66 }));
    starboardLight.position.set(3.4, 0.15, -1.0);
    this.playerShip.add(starboardLight);

    this.strobeLights = [portLight, starboardLight];

    this.cannonOffsets = [
      new THREE.Vector3(-3.4, 0.05, -1.0),
      new THREE.Vector3(3.4, 0.05, -1.0)
    ];

    // 5. Dual-Layered Engine Thruster Plumes
    const thrusterGeo = new THREE.CylinderGeometry(0.24, 0.32, 0.6, 12);
    thrusterGeo.rotateX(Math.PI / 2);

    const leftThruster = new THREE.Mesh(thrusterGeo, hullMaterial);
    leftThruster.position.set(-0.45, 0, 1.8);
    this.playerShip.add(leftThruster);

    const rightThruster = new THREE.Mesh(thrusterGeo, hullMaterial);
    rightThruster.position.set(0.45, 0, 1.8);
    this.playerShip.add(rightThruster);

    // Outer Cyan Flames
    const outerPlumeGeo = new THREE.ConeGeometry(0.28, 1.6, 8);
    outerPlumeGeo.rotateX(-Math.PI / 2);
    const outerPlumeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending });

    this.leftPlume = new THREE.Mesh(outerPlumeGeo, outerPlumeMat);
    this.leftPlume.position.set(-0.45, 0, 2.6);
    this.playerShip.add(this.leftPlume);

    this.rightPlume = new THREE.Mesh(outerPlumeGeo, outerPlumeMat);
    this.rightPlume.position.set(0.45, 0, 2.6);
    this.playerShip.add(this.rightPlume);

    // Inner Hot-White Flame Cores
    const innerPlumeGeo = new THREE.ConeGeometry(0.14, 1.1, 8);
    innerPlumeGeo.rotateX(-Math.PI / 2);
    const innerPlumeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });

    this.leftInnerPlume = new THREE.Mesh(innerPlumeGeo, innerPlumeMat);
    this.leftInnerPlume.position.set(-0.45, 0, 2.3);
    this.playerShip.add(this.leftInnerPlume);

    this.rightInnerPlume = new THREE.Mesh(innerPlumeGeo, innerPlumeMat);
    this.rightInnerPlume.position.set(0.45, 0, 2.3);
    this.playerShip.add(this.rightInnerPlume);

    // Dynamic Engine Point Light
    this.enginePointLight = new THREE.PointLight(0x00f0ff, 2.5, 18);
    this.enginePointLight.position.set(0, 0, 2.2);
    this.playerShip.add(this.enginePointLight);

    // 6. Permanent Player Silhouette Glow Halo
    const playerAuraGeo = new THREE.SphereGeometry(3.2, 12, 10);
    const playerAuraMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const playerAura = new THREE.Mesh(playerAuraGeo, playerAuraMat);
    this.playerShip.add(playerAura);

    // 7. Double-Layered Invulnerability Shield Bubble
    const shieldOuterGeo = new THREE.IcosahedronGeometry(3.8, 2);
    const shieldOuterMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    this.playerShieldMesh = new THREE.Mesh(shieldOuterGeo, shieldOuterMat);

    const shieldInnerGeo = new THREE.SphereGeometry(3.6, 16, 12);
    const shieldInnerMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.playerShieldInner = new THREE.Mesh(shieldInnerGeo, shieldInnerMat);
    this.playerShieldMesh.add(this.playerShieldInner);

    this.playerShieldMesh.visible = false;
    this.playerShip.add(this.playerShieldMesh);

    this.scene.add(this.playerShip);
  }

  // ==========================================
  // 3.6 EVENT LISTENERS & INPUT CONTROLS
  // ==========================================
  initEvents() {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || !event.data || event.data.type !== 'oddzone:end') return;
      if (this.state === this.STATE_GAMEOVER) {
        this.notifyOddZone('oddzone:game-complete');
        return;
      }
      if (this.state !== this.STATE_PLAYING && this.state !== this.STATE_PAUSED) return;
      this.isFiring = false;
      this.triggerGameOver();
      this.notifyOddZone('oddzone:game-complete');
    });

    window.addEventListener('resize', () => {
      if (!this.renderer || !this.camera) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isTouchDevice) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;

      this.targetMousePos.x = THREE.MathUtils.clamp(nx, -1, 1);
      this.targetMousePos.y = THREE.MathUtils.clamp(ny, -1, 1);

      if (this.reticle) {
        this.reticle.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 28}px)`;
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.state === this.STATE_PLAYING && !this.isTouchDevice) {
        this.isFiring = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && !this.isTouchDevice) {
        this.isFiring = false;
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        if (this.state === this.STATE_PLAYING) this.isFiring = true;
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        this.togglePause();
      } else if (e.code === 'KeyM') {
        this.toggleAudio();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.isFiring = false;
    });

    // Button Bindings
    document.getElementById('btnStartGame').addEventListener('click', () => {
      this.sound.init(this.saveData.settings);
      this.sound.playUI();
      this.startGame();
    });

    document.getElementById('btnRestartGame').addEventListener('click', () => {
      this.sound.playUI();
      this.startGame();
    });

    document.getElementById('btnMainMenu').addEventListener('click', () => {
      this.sound.playUI();
      this.showMainMenu();
    });

    document.getElementById('btnResumeGame').addEventListener('click', () => {
      this.sound.playUI();
      this.togglePause();
    });

    document.getElementById('btnRestartFromPause').addEventListener('click', () => {
      this.sound.playUI();
      this.togglePause();
      this.startGame();
    });

    document.getElementById('btnMenuFromPause').addEventListener('click', () => {
      this.sound.playUI();
      this.togglePause();
      this.showMainMenu();
    });

    document.getElementById('btnPauseGame').addEventListener('click', () => {
      this.sound.playUI();
      this.togglePause();
    });

    document.getElementById('btnAudioToggle').addEventListener('click', () => {
      this.toggleAudio();
    });

    // Intel & Threat Dossier Tab Switching
    const tabButtons = document.querySelectorAll('.intel-tab-btn');
    const tabContents = document.querySelectorAll('.intel-tab-content');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.sound.playUI();
        const targetId = btn.getAttribute('data-tab');

        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetContent = document.getElementById(targetId);
        if (targetContent) targetContent.classList.add('active');
      });
    });
  }

  initTouchControls() {
    if (!this.isTouchDevice) {
      if (this.mobileTouchControls) this.mobileTouchControls.classList.add('hidden');
      return;
    }

    if (this.reticle) this.reticle.classList.add('hidden');
    if (this.mobileTouchControls) this.mobileTouchControls.classList.remove('hidden');

    let touchStartX = 0;
    let touchStartY = 0;
    let isDragging = false;

    this.touchSteerZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      isDragging = true;
    }, { passive: false });

    this.touchSteerZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!isDragging) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      const maxRadius = 50;

      const clampedX = THREE.MathUtils.clamp(dx, -maxRadius, maxRadius);
      const clampedY = THREE.MathUtils.clamp(dy, -maxRadius, maxRadius);

      this.touchJoystickStick.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
      this.targetMousePos.x = clampedX / maxRadius;
      this.targetMousePos.y = clampedY / maxRadius;
    }, { passive: false });

    const resetJoystick = () => {
      isDragging = false;
      this.touchJoystickStick.style.transform = 'translate(0px, 0px)';
      this.targetMousePos.x = 0;
      this.targetMousePos.y = 0;
    };

    this.touchSteerZone.addEventListener('touchend', resetJoystick);
    this.touchSteerZone.addEventListener('touchcancel', resetJoystick);

    this.touchFireButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.isFiring = true;
      this.touchFireButton.classList.add('active');
    }, { passive: false });

    const stopFiring = (e) => {
      e.preventDefault();
      this.isFiring = false;
      this.touchFireButton.classList.remove('active');
    };

    this.touchFireButton.addEventListener('touchend', stopFiring);
    this.touchFireButton.addEventListener('touchcancel', stopFiring);
  }

  initAudioSettings() {
    this.sound.init(this.saveData.settings);

    if (this.musicVolSlider) {
      this.musicVolSlider.value = this.saveData.settings.musicVolume;
      this.musicVolText.textContent = `${Math.round(this.saveData.settings.musicVolume * 100)}%`;
      this.musicVolSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.saveData.settings.musicVolume = val;
        this.musicVolText.textContent = `${Math.round(val * 100)}%`;
        this.sound.setMusicVolume(val);
        SaveSystem.save(this.saveData);
      });
    }

    if (this.sfxVolSlider) {
      this.sfxVolSlider.value = this.saveData.settings.sfxVolume;
      this.sfxVolText.textContent = `${Math.round(this.saveData.settings.sfxVolume * 100)}%`;
      this.sfxVolSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.saveData.settings.sfxVolume = val;
        this.sfxVolText.textContent = `${Math.round(val * 100)}%`;
        this.sound.setSFXVolume(val);
        SaveSystem.save(this.saveData);
      });
    }
  }

  toggleAudio() {
    this.sound.init(this.saveData.settings);
    const muted = this.sound.toggleMute();
    this.saveData.settings.sfxMuted = muted;
    this.saveData.settings.musicMuted = muted;
    this.audioIcon.textContent = muted ? '🔇' : '🔊';
    SaveSystem.save(this.saveData);
    this.sound.playUI();
  }

  togglePause() {
    if (this.state === this.STATE_PLAYING) {
      this.state = this.STATE_PAUSED;
      this.sound.stopMusic();
      this.pauseScore.textContent = this.score.toLocaleString();
      this.pauseWave.textContent = this.wave;
      this.pauseScreen.classList.remove('hidden');
      this.hudOverlay.classList.add('hidden');
    } else if (this.state === this.STATE_PAUSED) {
      this.state = this.STATE_PLAYING;
      this.sound.startMusic();
      this.pauseScreen.classList.add('hidden');
      this.hudOverlay.classList.remove('hidden');
      this.clock.getDelta();
    }
  }

  showMainMenu() {
    this.state = this.STATE_MENU;
    this.sound.stopMusic();
    this.startScreen.classList.remove('hidden');
    this.pauseScreen.classList.add('hidden');
    this.gameOverScreen.classList.add('hidden');
    this.hudOverlay.classList.add('hidden');
    this.bossHealthContainer.classList.add('hidden');
    this.updateMenuStats();
    this.clearGameEntities();
  }

  updateMenuStats() {
    const formattedScore = this.saveData.highScore.toString().padStart(6, '0');
    const formattedWave = this.saveData.maxWave.toString().padStart(2, '0');
    this.startHighScore.textContent = formattedScore;
    this.startMaxWave.textContent = formattedWave;
    this.hudHighScore.textContent = formattedScore;
  }

  // ==========================================
  // 3.7 GAME START & WAVE MANAGEMENT
  // ==========================================
  startGame() {
    this.state = this.STATE_PLAYING;
    this.score = 0;
    this.lastReportedScore = -1;
    this.wave = 1;
    this.kills = 0;
    this.waveKills = 0;
    this.health = this.maxHealth;
    this.spawnTimer = 0;
    this.spawnInterval = 2.0;
    this.survivalTimer = 0;
    this.cameraShake = 0;
    this.bossDefeatTimer = 0;
    this.powerUpSpawnTimer = 0;

    // Reset Power-Ups
    this.shieldTimeLeft = 0;
    this.rapidFireTimeLeft = 0;
    this.multiplierTimeLeft = 0;

    this.saveData.gamesPlayed++;
    SaveSystem.save(this.saveData);

    this.shipPosition.set(0, 0, 0);
    this.shipYaw = 0;
    this.shipPitch = 0;
    this.shipRoll = 0;
    this.playerShip.position.copy(this.shipPosition);
    this.playerShip.rotation.set(0, 0, 0);
    if (this.playerShieldMesh) this.playerShieldMesh.visible = false;

    this.mousePos.x = 0;
    this.mousePos.y = 0;
    this.targetMousePos.x = 0;
    this.targetMousePos.y = 0;

    this.clearGameEntities();

    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.gameOverScreen.classList.add('hidden');
    this.hudOverlay.classList.remove('hidden');
    this.bossHealthContainer.classList.add('hidden');
    this.updateHUD();

    this.sound.startMusic();
    this.sound.playWaveStart();
    this.showWaveAnnouncement(1, 'COMMENCE PATROL');

    this.clock.start();
    this.notifyOddZone('oddzone:game-start');
  }

  notifyOddZone(type) {
    if (window.parent === window) return;
    const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin;
    window.parent.postMessage({ type, score: this.score }, targetOrigin);
  }

  clearGameEntities() {
    this.projectiles.forEach(p => this.scene.remove(p.mesh));
    this.projectiles = [];

    this.enemyProjectiles.forEach(ep => this.scene.remove(ep.mesh));
    this.enemyProjectiles = [];

    this.enemies.forEach(e => this.scene.remove(e.mesh));
    this.enemies = [];

    this.powerUps.forEach(pu => this.scene.remove(pu.mesh));
    this.powerUps = [];

    this.particles.forEach(p => this.scene.remove(p.mesh));
    this.particles = [];

    this.shockwaves.forEach(sw => this.scene.remove(sw.mesh));
    this.shockwaves = [];

    this.scorePopups.forEach(sp => { sp.sprite.visible = false; });
    this.scorePopups = [];

    if (this.boss) {
      this.scene.remove(this.boss.mesh);
      this.boss = null;
    }
    this.isBossWave = false;
  }

  showWaveAnnouncement(waveNum, title, isBoss = false) {
    this.waveBannerSub.textContent = isBoss ? 'CRITICAL THREAT DETECTED' : 'WARNING: ENEMY TRANSMISSION DETECTED';
    this.waveBannerText.textContent = `WAVE ${waveNum}: ${title}`;
    this.waveBanner.classList.remove('hidden');
    setTimeout(() => {
      this.waveBanner.classList.add('hidden');
    }, 2500);
  }

  showPowerUpToast(icon, title) {
    this.toastIcon.textContent = icon;
    this.toastText.textContent = `${title} ACTIVATED!`;
    this.powerUpToast.classList.remove('hidden');
    setTimeout(() => {
      this.powerUpToast.classList.add('hidden');
    }, 1800);
  }

  // ==========================================
  // 3.8 POWER-UP SYSTEM
  // ==========================================
  spawnPowerUp(position, specificType = null) {
    const types = ['SHIELD', 'RAPID_FIRE', 'MULTIPLIER', 'REPAIR'];
    const type = specificType || types[Math.floor(Math.random() * types.length)];

    let geo, color;
    if (type === 'SHIELD') {
      geo = new THREE.IcosahedronGeometry(0.9, 0);
      color = 0x00f0ff;
    } else if (type === 'RAPID_FIRE') {
      geo = new THREE.ConeGeometry(0.8, 1.4, 4);
      color = 0xffb703;
    } else if (type === 'MULTIPLIER') {
      geo = new THREE.OctahedronGeometry(0.9, 0);
      color = 0xb5179e;
    } else {
      geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
      color = 0x00ffa3;
    }

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.8,
      metalness: 0.8,
      roughness: 0.2
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);

    const ringGeo = new THREE.TorusGeometry(1.2, 0.05, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: color, wireframe: true, transparent: true, opacity: 0.7 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.add(ringMesh);

    this.scene.add(mesh);

    this.powerUps.push({
      mesh: mesh,
      ring: ringMesh,
      type: type,
      life: 10.0,
      radius: 2.2
    });
  }

  collectPowerUp(powerUp) {
    this.sound.playPowerUp();

    if (powerUp.type === 'SHIELD') {
      this.shieldTimeLeft = 5.0;
      if (this.playerShieldMesh) this.playerShieldMesh.visible = true;
      this.showPowerUpToast('🛡️', 'SHIELD');
      this.triggerScorePopup(this.shipPosition, 'SHIELD');
    } else if (powerUp.type === 'RAPID_FIRE') {
      this.rapidFireTimeLeft = 8.0;
      this.showPowerUpToast('⚡', 'RAPID FIRE');
      this.triggerScorePopup(this.shipPosition, 'RAPID');
    } else if (powerUp.type === 'MULTIPLIER') {
      this.multiplierTimeLeft = 10.0;
      this.showPowerUpToast('💎', '2X SCORE MULTIPLIER');
      this.triggerScorePopup(this.shipPosition, '2X SCORE');
    } else if (powerUp.type === 'REPAIR') {
      this.health = Math.min(this.maxHealth, this.health + 1);
      this.showPowerUpToast('💚', 'HULL REPAIRED +1');
      this.triggerScorePopup(this.shipPosition, 'REPAIR');
      this.updateHUD();
    }

    this.spawnExplosion(powerUp.mesh.position, 14, 0x00f0ff);
  }

  // ==========================================
  // 3.9 WEAPONS & PROJECTILES
  // ==========================================
  fireLaser() {
    const isRapid = this.rapidFireTimeLeft > 0;
    const cannonIndex = this.laserAlternator % 2;
    this.laserAlternator++;

    const offset = this.cannonOffsets[cannonIndex].clone();
    offset.applyQuaternion(this.playerShip.quaternion);
    const spawnPos = this.shipPosition.clone().add(offset);

    const laserLength = isRapid ? 3.2 : 2.6;
    const laserColor = isRapid ? 0xffb703 : 0x00f0ff;

    const laserGeo = new THREE.CylinderGeometry(0.14, 0.14, laserLength, 8);
    laserGeo.rotateX(Math.PI / 2);
    const laserMat = new THREE.MeshStandardMaterial({
      color: laserColor,
      emissive: laserColor,
      emissiveIntensity: isRapid ? 3.0 : 2.2,
      roughness: 0.1
    });

    const laserMesh = new THREE.Mesh(laserGeo, laserMat);
    laserMesh.position.copy(spawnPos);
    laserMesh.quaternion.copy(this.playerShip.quaternion);

    // Trailing Glow Ribbon
    const trailGeo = new THREE.CylinderGeometry(0.05, 0.15, 4.5, 6);
    trailGeo.rotateX(Math.PI / 2);
    const trailMat = new THREE.MeshBasicMaterial({
      color: laserColor,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    const trailMesh = new THREE.Mesh(trailGeo, trailMat);
    trailMesh.position.set(0, 0, 2.2);
    laserMesh.add(trailMesh);

    this.scene.add(laserMesh);

    const speed = isRapid ? 215 : 185;
    const velocity = this.shipForward.clone().multiplyScalar(speed);

    this.projectiles.push({
      mesh: laserMesh,
      velocity: velocity,
      life: 2.2,
      radius: 0.7
    });

    this.sound.playShoot(isRapid);
    this.spawnMuzzleFlash(spawnPos, laserColor);
  }

  spawnMuzzleFlash(pos, color = 0x00f0ff) {
    const flashGeo = new THREE.SphereGeometry(0.4, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    this.scene.add(flash);

    this.particles.push({
      mesh: flash,
      velocity: new THREE.Vector3(),
      life: 0.08,
      maxLife: 0.08,
      scaleSpeed: 2.0,
      fade: true
    });
  }

  fireEnemyLaser(fromPos, targetPos) {
    const dir = targetPos.clone().sub(fromPos).normalize();

    const laserGeo = new THREE.SphereGeometry(0.42, 8, 8);
    const laserMat = new THREE.MeshStandardMaterial({
      color: 0xff0044,
      emissive: 0xff0044,
      emissiveIntensity: 2.8
    });

    const laserMesh = new THREE.Mesh(laserGeo, laserMat);
    laserMesh.position.copy(fromPos);
    this.scene.add(laserMesh);

    this.enemyProjectiles.push({
      mesh: laserMesh,
      velocity: dir.multiplyScalar(32),
      life: 5.0,
      radius: 0.9
    });

    this.sound.playEnemyShoot();
  }

  // ==========================================
  // 3.10 HIGH-VISIBILITY ENEMY VARIETY & SPAWN
  // ==========================================
  spawnEnemy() {
    if (this.isBossWave) return;

    const spawnDist = 130 + Math.random() * 80;
    const spreadX = (Math.random() - 0.5) * 65;
    const spreadY = (Math.random() - 0.5) * 45;

    const spawnPos = this.shipPosition.clone()
      .add(this.shipForward.clone().multiplyScalar(spawnDist))
      .add(this.shipRight.clone().multiplyScalar(spreadX))
      .add(this.shipUp.clone().multiplyScalar(spreadY));

    let type = 'BASIC';
    const rand = Math.random();

    if (this.wave <= 2) {
      type = rand < 0.7 ? 'SCOUT' : 'BASIC';
    } else if (this.wave <= 4) {
      if (rand < 0.35) type = 'SCOUT';
      else if (rand < 0.6) type = 'BASIC';
      else if (rand < 0.8) type = 'TANK';
      else type = 'SHOOTER';
    } else {
      if (rand < 0.25) type = 'SCOUT';
      else if (rand < 0.45) type = 'BASIC';
      else if (rand < 0.75) type = 'TANK';
      else type = 'SHOOTER';
    }

    const enemyGroup = new THREE.Group();
    let health = 1;
    let speed = 22;
    let points = 100;
    let radius = 2.0;
    let collisionDamage = 1;
    let haloMesh = null;
    let extraAnim = {};

    if (type === 'SCOUT') {
      // Scout ("Viper Razorwing" - Ultra-fast needle fighter)
      const fuselage = new THREE.Mesh(this.resources.geos.scoutFuselage, this.resources.mats.scoutHull);
      enemyGroup.add(fuselage);

      const canopy = new THREE.Mesh(this.resources.geos.scoutCanopy, this.resources.mats.scoutGlow);
      canopy.position.set(0, 0.25, -0.4);
      enemyGroup.add(canopy);

      const leftWing = new THREE.Mesh(this.resources.geos.scoutWing, this.resources.mats.scoutHull);
      leftWing.position.set(-1.1, 0, 0.2);
      enemyGroup.add(leftWing);

      const rightWing = new THREE.Mesh(this.resources.geos.scoutWing, this.resources.mats.scoutHull);
      rightWing.position.set(1.1, 0, 0.2);
      rightWing.scale.set(-1, 1, 1);
      enemyGroup.add(rightWing);

      const leftBlade = new THREE.Mesh(this.resources.geos.scoutFin, this.resources.mats.scoutGlow);
      leftBlade.position.set(-1.8, 0.2, -0.2);
      enemyGroup.add(leftBlade);

      const rightBlade = new THREE.Mesh(this.resources.geos.scoutFin, this.resources.mats.scoutGlow);
      rightBlade.position.set(1.8, 0.2, -0.2);
      rightBlade.scale.set(-1, 1, 1);
      enemyGroup.add(rightBlade);

      const engine = new THREE.Mesh(this.resources.geos.scoutEngine, this.resources.mats.scoutHull);
      engine.position.set(0, 0, 1.4);
      enemyGroup.add(engine);

      const plume = new THREE.Mesh(this.resources.geos.scoutPlume, this.resources.mats.scoutPlume);
      plume.position.set(0, 0, 2.1);
      enemyGroup.add(plume);

      haloMesh = new THREE.Mesh(this.resources.geos.scoutHalo, this.resources.mats.scoutHalo);
      enemyGroup.add(haloMesh);

      speed = 40 + (this.wave - 1) * 2;
      health = 1;
      points = 150;
      radius = 1.9;
      extraAnim = { plume: plume, canopy: canopy };
    } else if (type === 'TANK') {
      // Tank ("Goliath Heavy Destroyer" - Multi-deck industrial juggernaut)
      const chassis = new THREE.Mesh(this.resources.geos.tankChassis, this.resources.mats.tankHull);
      enemyGroup.add(chassis);

      const prow = new THREE.Mesh(this.resources.geos.tankProw, this.resources.mats.tankGlow);
      prow.position.set(0, 0, -1.8);
      enemyGroup.add(prow);

      const leftPod = new THREE.Mesh(this.resources.geos.tankSidePod, this.resources.mats.tankHull);
      leftPod.position.set(-1.7, 0, 0);
      enemyGroup.add(leftPod);

      const rightPod = new THREE.Mesh(this.resources.geos.tankSidePod, this.resources.mats.tankHull);
      rightPod.position.set(1.7, 0, 0);
      enemyGroup.add(rightPod);

      const leftRing = new THREE.Mesh(this.resources.geos.tankShieldRing, this.resources.mats.tankRing);
      leftRing.position.set(-1.7, 0, 0);
      enemyGroup.add(leftRing);

      const rightRing = new THREE.Mesh(this.resources.geos.tankShieldRing, this.resources.mats.tankRing);
      rightRing.position.set(1.7, 0, 0);
      enemyGroup.add(rightRing);

      const leftArmor = new THREE.Mesh(this.resources.geos.tankArmorPlate, this.resources.mats.tankGlow);
      leftArmor.position.set(-2.0, 0, 0);
      enemyGroup.add(leftArmor);

      const rightArmor = new THREE.Mesh(this.resources.geos.tankArmorPlate, this.resources.mats.tankGlow);
      rightArmor.position.set(2.0, 0, 0);
      enemyGroup.add(rightArmor);

      const reactor = new THREE.Mesh(this.resources.geos.tankReactor, this.resources.mats.tankGlow);
      reactor.position.set(0, 0.8, 0);
      enemyGroup.add(reactor);

      [-0.7, 0.7].forEach(x => {
        [-0.35, 0.35].forEach(y => {
          const thruster = new THREE.Mesh(this.resources.geos.tankThruster, this.resources.mats.tankGlow);
          thruster.position.set(x, y, 1.8);
          enemyGroup.add(thruster);
        });
      });

      haloMesh = new THREE.Mesh(this.resources.geos.tankHalo, this.resources.mats.tankHalo);
      enemyGroup.add(haloMesh);

      speed = 14 + (this.wave - 1) * 1.2;
      health = 3;
      points = 300;
      radius = 2.9;
      collisionDamage = 2;
      extraAnim = { leftRing: leftRing, rightRing: rightRing, reactor: reactor };
    } else if (type === 'SHOOTER') {
      // Shooter ("Specter Catamaran Gunship" - Twin-hull plasma assault craft)
      const leftPontoon = new THREE.Mesh(this.resources.geos.shooterPontoon, this.resources.mats.shooterHull);
      leftPontoon.position.set(-1.1, 0, 0);
      enemyGroup.add(leftPontoon);

      const rightPontoon = new THREE.Mesh(this.resources.geos.shooterPontoon, this.resources.mats.shooterHull);
      rightPontoon.position.set(1.1, 0, 0);
      enemyGroup.add(rightPontoon);

      const bridge = new THREE.Mesh(this.resources.geos.shooterBridge, this.resources.mats.shooterHull);
      enemyGroup.add(bridge);

      const eye = new THREE.Mesh(this.resources.geos.shooterEye, this.resources.mats.shooterGlow);
      eye.position.set(0, 0.25, -0.4);
      enemyGroup.add(eye);

      const leftCannon = new THREE.Mesh(this.resources.geos.shooterCannon, this.resources.mats.shooterHull);
      leftCannon.position.set(-1.1, 0, -1.8);
      enemyGroup.add(leftCannon);

      const rightCannon = new THREE.Mesh(this.resources.geos.shooterCannon, this.resources.mats.shooterHull);
      rightCannon.position.set(1.1, 0, -1.8);
      enemyGroup.add(rightCannon);

      const leftTip = new THREE.Mesh(this.resources.geos.shooterCannonTip, this.resources.mats.shooterGlow);
      leftTip.position.set(-1.1, 0, -2.9);
      enemyGroup.add(leftTip);

      const rightTip = new THREE.Mesh(this.resources.geos.shooterCannonTip, this.resources.mats.shooterGlow);
      rightTip.position.set(1.1, 0, -2.9);
      enemyGroup.add(rightTip);

      const leftWinglet = new THREE.Mesh(this.resources.geos.shooterWing, this.resources.mats.shooterGlow);
      leftWinglet.position.set(-1.8, 0, 0.5);
      enemyGroup.add(leftWinglet);

      const rightWinglet = new THREE.Mesh(this.resources.geos.shooterWing, this.resources.mats.shooterGlow);
      rightWinglet.position.set(1.8, 0, 0.5);
      enemyGroup.add(rightWinglet);

      haloMesh = new THREE.Mesh(this.resources.geos.shooterHalo, this.resources.mats.shooterHalo);
      enemyGroup.add(haloMesh);

      speed = 22 + (this.wave - 1) * 2;
      health = 2;
      points = 250;
      radius = 2.4;
      extraAnim = { eye: eye, leftTip: leftTip, rightTip: rightTip };
    } else { // BASIC
      // Basic ("Crimson Trident Interceptor" - Standard stealth fighter)
      const fuselage = new THREE.Mesh(this.resources.geos.basicFuselage, this.resources.mats.basicHull);
      enemyGroup.add(fuselage);

      const visor = new THREE.Mesh(this.resources.geos.basicVisor, this.resources.mats.basicGlow);
      visor.position.set(0, 0.25, -0.6);
      enemyGroup.add(visor);

      const wings = new THREE.Mesh(this.resources.geos.basicWings, this.resources.mats.basicHull);
      wings.position.set(0, 0, 0.3);
      enemyGroup.add(wings);

      const fin = new THREE.Mesh(this.resources.geos.basicFin, this.resources.mats.basicGlow);
      fin.position.set(0, 0.7, 0.5);
      enemyGroup.add(fin);

      const leftGun = new THREE.Mesh(this.resources.geos.basicGun, this.resources.mats.basicGlow);
      leftGun.position.set(-1.2, -0.1, -0.8);
      enemyGroup.add(leftGun);

      const rightGun = new THREE.Mesh(this.resources.geos.basicGun, this.resources.mats.basicGlow);
      rightGun.position.set(1.2, -0.1, -0.8);
      enemyGroup.add(rightGun);

      haloMesh = new THREE.Mesh(this.resources.geos.basicHalo, this.resources.mats.basicHalo);
      enemyGroup.add(haloMesh);

      speed = 22 + (this.wave - 1) * 2.5;
      health = 1;
      points = 100;
      radius = 2.2;
      extraAnim = { visor: visor, fin: fin };
    }

    enemyGroup.position.copy(spawnPos);
    this.scene.add(enemyGroup);

    this.enemies.push({
      mesh: enemyGroup,
      halo: haloMesh,
      extra: extraAnim,
      type: type,
      speed: speed,
      radius: radius,
      health: health,
      maxHealth: health,
      points: points,
      collisionDamage: collisionDamage,
      shootTimer: Math.random() * 1.5,
      pulsePhase: Math.random() * Math.PI * 2
    });
  }

  // ==========================================
  // 3.11 BOSS ENCOUNTER WITH ADVANCED FLAGSHIP MODEL
  // ==========================================
  startBossWave() {
    this.isBossWave = true;
    this.sound.playBossWarning();
    this.showWaveAnnouncement(this.wave, `DREADNOUGHT VEX-${this.wave}`, true);

    this.bossHealthContainer.classList.remove('hidden');
    this.bossName.textContent = `DREADNOUGHT VEX-${this.wave}`;
    this.bossHealthText.textContent = '100%';
    this.bossHealthBarFill.style.width = '100%';
    this.hudKillsContainer.innerHTML = '<span class="neon-pink">ELIMINATE SECTOR BOSS</span>';

    const spawnDist = 180;
    const spawnPos = this.shipPosition.clone().add(this.shipForward.clone().multiplyScalar(spawnDist));

    const bossGroup = new THREE.Group();

    // 1. Colossal Hexagonal Dreadnought Citadel
    const mainHullGeo = new THREE.CylinderGeometry(5.2, 6.8, 3.4, 6);
    mainHullGeo.rotateX(Math.PI / 2);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x180208, metalness: 0.92, roughness: 0.25 });
    const mainHull = new THREE.Mesh(mainHullGeo, hullMat);
    bossGroup.add(mainHull);

    // 2. Glowing White-Hot Reactor Core & Corona
    const coreGeo = new THREE.SphereGeometry(2.4, 16, 16);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00f0ff, emissiveIntensity: 3.8 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    bossGroup.add(core);

    // 3. Heavy Outrigger Armor Wings
    const wingGeo = new THREE.BoxGeometry(19.0, 1.1, 4.6);
    const wings = new THREE.Mesh(wingGeo, hullMat);
    bossGroup.add(wings);

    // 4. 5 Heavy Laser Battery Turrets (Where 5-Spread Lasers Fire)
    const turretGeo = this.resources.geos.bossTurret;
    const turretGlowMat = new THREE.MeshStandardMaterial({ color: 0xff2a5f, emissive: 0xff0044, emissiveIntensity: 3.0 });
    const turrets = [];

    [-7.5, -3.8, 0, 3.8, 7.5].forEach(tx => {
      const turret = new THREE.Mesh(turretGeo, turretGlowMat);
      turret.position.set(tx, 0.4, -2.4);
      bossGroup.add(turret);
      turrets.push(turret);
    });

    // 5. Dual Heavy Sub-Light Engine Bays
    const engineGeo = this.resources.geos.bossEngine;
    const engineGlowMat = new THREE.MeshBasicMaterial({ color: 0xff0044, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });

    [-3.0, 3.0].forEach(ex => {
      const eng = new THREE.Mesh(engineGeo, hullMat);
      eng.position.set(ex, 0, 2.2);
      bossGroup.add(eng);

      const flare = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 8), engineGlowMat);
      flare.rotateX(-Math.PI / 2);
      flare.position.set(ex, 0, 3.4);
      bossGroup.add(flare);
    });

    // 6. Rotating Armored Ion Sail Ring
    const ringGeo = new THREE.TorusGeometry(8.8, 0.45, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xff2a5f, emissive: 0xff2a5f, emissiveIntensity: 2.0 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    bossGroup.add(ring);

    // 7. Warning Strobe Beacons on Wingtips
    const strobeGeo = new THREE.SphereGeometry(0.45, 8, 8);
    const leftStrobe = new THREE.Mesh(strobeGeo, new THREE.MeshBasicMaterial({ color: 0xff0044 }));
    leftStrobe.position.set(-9.2, 0.6, 0);
    bossGroup.add(leftStrobe);

    const rightStrobe = new THREE.Mesh(strobeGeo, new THREE.MeshBasicMaterial({ color: 0xff0044 }));
    rightStrobe.position.set(9.2, 0.6, 0);
    bossGroup.add(rightStrobe);

    // 8. Red Boss Illumination Light
    const bossLight = new THREE.PointLight(0xff0044, 4.0, 45);
    bossLight.position.set(0, 3, 0);
    bossGroup.add(bossLight);

    bossGroup.position.copy(spawnPos);
    this.scene.add(bossGroup);

    const bossHP = 20 + Math.floor((this.wave - 5) / 5) * 10;

    this.boss = {
      mesh: bossGroup,
      ring: ring,
      core: core,
      turrets: turrets,
      leftStrobe: leftStrobe,
      rightStrobe: rightStrobe,
      health: bossHP,
      maxHealth: bossHP,
      speed: 16,
      radius: 7.2,
      spreadAttackTimer: 0,
      chargeTimer: 0,
      isCharging: false,
      chargeDuration: 0,
      strafeAngle: 0
    };
  }

  updateBoss(dt) {
    if (!this.boss) return;

    this.boss.ring.rotation.z += dt * 1.5;
    const pulse = 3.0 + Math.sin(Date.now() * 0.01) * 0.9;
    this.boss.core.material.emissiveIntensity = pulse;

    // Strobe blinking
    const blink = Math.sin(Date.now() * 0.02) > 0;
    this.boss.leftStrobe.visible = blink;
    this.boss.rightStrobe.visible = !blink;

    this.boss.strafeAngle += dt * 0.8;
    const toPlayer = this.shipPosition.clone().sub(this.boss.mesh.position).normalize();
    let currentSpeed = this.boss.speed;

    this.boss.chargeTimer += dt;
    if (this.boss.chargeTimer >= 6.0) {
      this.boss.chargeTimer = 0;
      this.boss.isCharging = true;
      this.boss.chargeDuration = 1.0;
      this.cameraShake = 0.4;
    }

    if (this.boss.isCharging) {
      currentSpeed = 55;
      this.boss.chargeDuration -= dt;
      if (this.boss.chargeDuration <= 0) {
        this.boss.isCharging = false;
      }
    }

    const moveStep = toPlayer.multiplyScalar(currentSpeed * dt);
    moveStep.add(this.shipRight.clone().multiplyScalar(Math.cos(this.boss.strafeAngle) * 12 * dt));
    this.boss.mesh.position.add(moveStep);

    // Smoothly orient boss to track starfighter
    this.boss.mesh.lookAt(this.shipPosition);

    this.boss.spreadAttackTimer += dt;
    if (this.boss.spreadAttackTimer >= 2.0) {
      this.boss.spreadAttackTimer = 0;

      for (let angle = -0.3; angle <= 0.3; angle += 0.15) {
        const spreadTarget = this.shipPosition.clone().add(
          this.shipRight.clone().multiplyScalar(angle * 40)
        );
        this.fireEnemyLaser(this.boss.mesh.position, spreadTarget);
      }
    }

    const distToPlayer = this.boss.mesh.position.distanceTo(this.shipPosition);
    if (distToPlayer < (this.boss.radius + 2.0)) {
      this.takeDamage(2);
      this.cameraShake = 0.7;
    }
  }

  // ==========================================
  // 3.12 SHOCKWAVES & POOLED PARTICLES
  // ==========================================
  spawnShockwave(pos, color = 0xff2a5f, maxRadius = 22) {
    const mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Mesh(this.resources.geos.shockwave, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    this.shockwaves.push({
      mesh: mesh,
      radius: 1.0,
      maxRadius: maxRadius,
      life: 0.6,
      maxLife: 0.6
    });
  }

  spawnExplosion(pos, count = 20, color = 0xff2a5f) {
    const particleCount = this.isTouchDevice ? Math.floor(count * 0.75) : count;

    for (let i = 0; i < particleCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.4 ? color : 0x00f0ff,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending
      });

      const pMesh = new THREE.Mesh(this.resources.geos.particle, mat);
      pMesh.position.copy(pos);
      this.scene.add(pMesh);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 28,
        (Math.random() - 0.5) * 28,
        (Math.random() - 0.5) * 28
      );

      const life = 0.45 + Math.random() * 0.45;

      this.particles.push({
        mesh: pMesh,
        velocity: velocity,
        life: life,
        maxLife: life,
        scaleSpeed: 0.97,
        fade: true
      });
    }
  }

  spawnEngineTrail() {
    if (Math.random() > 0.35) return;

    const isRapid = this.rapidFireTimeLeft > 0;
    const trailColor = isRapid ? 0xffb703 : 0x00f0ff;

    const leftPos = this.playerShip.localToWorld(new THREE.Vector3(-0.45, 0, 2.3));
    const rightPos = this.playerShip.localToWorld(new THREE.Vector3(0.45, 0, 2.3));

    // Outer Cyan/Amber Trail
    [leftPos, rightPos].forEach(pos => {
      const mat = new THREE.MeshBasicMaterial({ color: trailColor, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
      const p = new THREE.Mesh(this.resources.geos.particle, mat);
      p.position.copy(pos);
      this.scene.add(p);

      this.particles.push({
        mesh: p,
        velocity: this.shipForward.clone().multiplyScalar(-14),
        life: 0.28,
        maxLife: 0.28,
        scaleSpeed: 0.88,
        fade: true
      });
    });

    // Inner White Core Sparks
    const leftInnerPos = this.playerShip.localToWorld(new THREE.Vector3(-0.45, 0, 2.1));
    const rightInnerPos = this.playerShip.localToWorld(new THREE.Vector3(0.45, 0, 2.1));

    [leftInnerPos, rightInnerPos].forEach(pos => {
      const pWhite = new THREE.Mesh(this.resources.geos.particleSpark, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
      pWhite.position.copy(pos);
      this.scene.add(pWhite);

      this.particles.push({
        mesh: pWhite,
        velocity: this.shipForward.clone().multiplyScalar(-18),
        life: 0.16,
        maxLife: 0.16,
        scaleSpeed: 0.8,
        fade: true
      });
    });
  }

  // ==========================================
  // 3.13 DAMAGE & CAREER GAME OVER
  // ==========================================
  takeDamage(amount = 1) {
    if (this.shieldTimeLeft > 0) return;

    this.health = Math.max(0, this.health - amount);
    this.sound.playPlayerDamage();

    this.damageOverlay.classList.remove('active');
    void this.damageOverlay.offsetWidth;
    this.damageOverlay.classList.add('active');

    this.cameraShake = amount > 1 ? 0.65 : 0.45;
    this.spawnExplosion(this.shipPosition, 16, 0xff2a5f);

    this.updateHUD();

    if (this.health <= 0) {
      this.triggerGameOver();
    }
  }

  triggerGameOver() {
    this.state = this.STATE_GAMEOVER;
    this.sound.stopMusic();
    this.sound.playGameOver();
    this.notifyOddZone('oddzone:game-complete');

    this.spawnExplosion(this.shipPosition, 45, 0x00f0ff);
    this.spawnExplosion(this.shipPosition, 45, 0xff2a5f);
    this.spawnShockwave(this.shipPosition, 0x00f0ff, 30);

    const isNewHigh = this.score > this.saveData.highScore;
    if (isNewHigh) this.saveData.highScore = this.score;
    if (this.wave > this.saveData.maxWave) this.saveData.maxWave = this.wave;
    this.saveData.totalKills += this.kills;
    this.saveData.totalScore += this.score;
    SaveSystem.save(this.saveData);

    this.finalScore.textContent = this.score.toString().padStart(6, '0');
    this.finalHighScore.textContent = this.saveData.highScore.toString().padStart(6, '0');
    this.finalWave.textContent = `WAVE ${this.wave}`;
    this.finalKills.textContent = this.kills;

    this.lifetimeScore.textContent = this.saveData.totalScore.toLocaleString();
    this.lifetimeKills.textContent = this.saveData.totalKills.toLocaleString();
    this.lifetimeBosses.textContent = this.saveData.bossesDefeated;
    this.lifetimeMissions.textContent = this.saveData.gamesPlayed;

    if (isNewHigh && this.score > 0) {
      this.newHighScoreBadge.classList.remove('hidden');
    } else {
      this.newHighScoreBadge.classList.add('hidden');
    }

    setTimeout(() => {
      this.gameOverScreen.classList.remove('hidden');
      this.hudOverlay.classList.add('hidden');
      this.bossHealthContainer.classList.add('hidden');
    }, 850);
  }

  updateHUD() {
    this.hudScore.textContent = this.score.toString().padStart(6, '0');
    if (this.score !== this.lastReportedScore) {
      this.lastReportedScore = this.score;
      this.notifyOddZone('oddzone:score');
    }
    this.hudHighScore.textContent = this.saveData.highScore.toString().padStart(6, '0');
    this.hudWave.textContent = this.wave.toString().padStart(2, '0');

    if (!this.isBossWave) {
      this.hudKills.textContent = this.waveKills;
      this.hudNextWave.textContent = this.killsPerWave;
    }

    const pct = (this.health / this.maxHealth) * 100;
    this.healthText.textContent = `${Math.round(pct)}%`;

    this.healthSegments.forEach((segment, idx) => {
      const active = idx < this.health;
      segment.className = 'health-bar-segment';
      if (active) {
        if (this.health <= 1) segment.classList.add('active', 'danger');
        else if (this.health <= 2) segment.classList.add('active', 'warning');
        else segment.classList.add('active');
      }
    });

    if (this.shieldTimeLeft > 0) {
      this.powerUpShieldBadge.classList.remove('hidden');
      this.powerUpShieldTimer.textContent = `${this.shieldTimeLeft.toFixed(1)}s`;
      this.powerUpShieldBar.style.width = `${(this.shieldTimeLeft / 5.0) * 100}%`;
    } else {
      this.powerUpShieldBadge.classList.add('hidden');
      if (this.playerShieldMesh) this.playerShieldMesh.visible = false;
    }

    if (this.rapidFireTimeLeft > 0) {
      this.powerUpRapidBadge.classList.remove('hidden');
      this.powerUpRapidTimer.textContent = `${this.rapidFireTimeLeft.toFixed(1)}s`;
      this.powerUpRapidBar.style.width = `${(this.rapidFireTimeLeft / 8.0) * 100}%`;
    } else {
      this.powerUpRapidBadge.classList.add('hidden');
    }

    if (this.multiplierTimeLeft > 0) {
      this.powerUpMultiplierBadge.classList.remove('hidden');
      this.powerUpMultiplierTimer.textContent = `${this.multiplierTimeLeft.toFixed(1)}s`;
      this.powerUpMultiplierBar.style.width = `${(this.multiplierTimeLeft / 10.0) * 100}%`;
    } else {
      this.powerUpMultiplierBadge.classList.add('hidden');
    }
  }

  // ==========================================
  // 3.14 FRAME UPDATE & PHYSICS LOOP
  // ==========================================
  update(dt) {
    dt = Math.min(dt, 0.05);

    // 1. Passive Survival Score
    this.survivalTimer += dt;
    if (this.survivalTimer >= 1.0) {
      this.survivalTimer = 0;
      this.score += this.multiplierTimeLeft > 0 ? 20 : 10;
      this.updateHUD();
    }

    // 2. Power-Up Timers Update
    if (this.shieldTimeLeft > 0) {
      this.shieldTimeLeft = Math.max(0, this.shieldTimeLeft - dt);
      if (this.playerShieldMesh) {
        this.playerShieldMesh.visible = true;
        this.playerShieldMesh.rotation.y += dt * 2.0;
        this.playerShieldMesh.rotation.x += dt * 1.0;
      }
    }
    if (this.rapidFireTimeLeft > 0) {
      this.rapidFireTimeLeft = Math.max(0, this.rapidFireTimeLeft - dt);
    }
    if (this.multiplierTimeLeft > 0) {
      this.multiplierTimeLeft = Math.max(0, this.multiplierTimeLeft - dt);
    }

    // Wingtip Strobe Flash
    const strobeBlink = Math.sin(Date.now() * 0.015) > 0;
    this.strobeLights.forEach((l, idx) => {
      l.visible = idx === 0 ? strobeBlink : !strobeBlink;
    });

    // Periodic Power-up Spawner
    this.powerUpSpawnTimer += dt;
    if (this.powerUpSpawnTimer >= 12.0) {
      this.powerUpSpawnTimer = 0;
      if (this.powerUps.length === 0) {
        const spawnPos = this.shipPosition.clone()
          .add(this.shipForward.clone().multiplyScalar(90))
          .add(this.shipRight.clone().multiplyScalar((Math.random() - 0.5) * 40));
        this.spawnPowerUp(spawnPos);
      }
    }

    // 3. Smooth Flight Steering
    const steerSpeed = 4.8;
    this.mousePos.x += (this.targetMousePos.x - this.mousePos.x) * steerSpeed * dt;
    this.mousePos.y += (this.targetMousePos.y - this.mousePos.y) * steerSpeed * dt;

    this.shipYaw += -this.mousePos.x * 1.45 * dt;
    this.shipPitch = -this.mousePos.y * 0.75;
    this.shipRoll = -this.mousePos.x * 0.85;

    this.shipRotation.set(this.shipPitch, this.shipYaw, this.shipRoll, 'YXZ');
    this.playerShip.quaternion.setFromEuler(this.shipRotation);

    this.shipForward.set(0, 0, -1).applyQuaternion(this.playerShip.quaternion).normalize();
    this.shipUp.set(0, 1, 0).applyQuaternion(this.playerShip.quaternion).normalize();
    this.shipRight.set(1, 0, 0).applyQuaternion(this.playerShip.quaternion).normalize();

    const currentSpeed = this.forwardSpeed + (this.wave - 1) * 2.0;
    this.shipPosition.add(this.shipForward.clone().multiplyScalar(currentSpeed * dt));
    this.playerShip.position.copy(this.shipPosition);

    // Dual Engine Flame Pulsing
    const plumeScale = 0.95 + Math.sin(Date.now() * 0.025) * 0.25;
    if (this.leftPlume && this.rightPlume) {
      this.leftPlume.scale.set(1, 1, plumeScale);
      this.rightPlume.scale.set(1, 1, plumeScale);
      this.leftInnerPlume.scale.set(1, 1, plumeScale * 0.9);
      this.rightInnerPlume.scale.set(1, 1, plumeScale * 0.9);
    }
    if (this.enginePointLight) {
      const baseIntensity = this.rapidFireTimeLeft > 0 ? 4.5 : 2.5;
      this.enginePointLight.intensity = baseIntensity + Math.sin(Date.now() * 0.03) * 0.8;
      this.enginePointLight.color.setHex(this.rapidFireTimeLeft > 0 ? 0xffb703 : 0x00f0ff);
    }
    this.spawnEngineTrail();

    // 4. Camera Follow
    const targetCamPos = this.shipPosition.clone().add(
      this.cameraOffset.clone().applyQuaternion(this.playerShip.quaternion)
    );

    if (this.cameraShake > 0) {
      targetCamPos.x += (Math.random() - 0.5) * this.cameraShake * 3.0;
      targetCamPos.y += (Math.random() - 0.5) * this.cameraShake * 3.0;
      targetCamPos.z += (Math.random() - 0.5) * this.cameraShake * 3.0;
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.2);
    }

    this.camera.position.lerp(targetCamPos, 0.12);
    const lookTarget = this.shipPosition.clone().add(this.shipForward.clone().multiplyScalar(35));
    this.camera.lookAt(lookTarget);

    if (this.starfield) this.starfield.position.copy(this.shipPosition);
    this.nebulaClouds.forEach(nc => nc.position.z = this.shipPosition.z - 300);

    // 5. Laser Firing
    const currentFireRate = this.rapidFireTimeLeft > 0 ? 0.08 : 0.18;
    if (this.isFiring) {
      this.fireTimer += dt;
      if (this.fireTimer >= currentFireRate) {
        this.fireTimer = 0;
        this.fireLaser();
      }
    } else {
      this.fireTimer = currentFireRate;
    }

    // 6. Update Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
      p.life -= dt;

      if (p.life <= 0 || p.mesh.position.distanceTo(this.shipPosition) > 360) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // 7. Update Enemy Projectiles
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const ep = this.enemyProjectiles[i];
      ep.mesh.position.add(ep.velocity.clone().multiplyScalar(dt));
      ep.life -= dt;

      const distToPlayer = ep.mesh.position.distanceTo(this.shipPosition);
      if (distToPlayer < (ep.radius + 1.8)) {
        this.scene.remove(ep.mesh);
        this.enemyProjectiles.splice(i, 1);
        this.takeDamage(1);
        continue;
      }

      if (ep.life <= 0 || distToPlayer > 360) {
        this.scene.remove(ep.mesh);
        this.enemyProjectiles.splice(i, 1);
      }
    }

    // 8. Update Power-Ups
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      const pu = this.powerUps[i];
      pu.mesh.rotation.y += dt * 2.5;
      pu.mesh.rotation.x += dt * 1.5;
      pu.ring.rotation.z += dt * 3.0;
      pu.life -= dt;

      const distToPlayer = pu.mesh.position.distanceTo(this.shipPosition);
      if (distToPlayer < pu.radius) {
        this.collectPowerUp(pu);
        this.scene.remove(pu.mesh);
        this.powerUps.splice(i, 1);
        continue;
      }

      if (pu.life <= 0) {
        this.scene.remove(pu.mesh);
        this.powerUps.splice(i, 1);
      }
    }

    // 9. Boss Wave Management
    if (this.wave % 5 === 0 && !this.isBossWave && !this.boss && this.bossDefeatTimer <= 0) {
      this.startBossWave();
    }

    if (this.isBossWave && this.boss) {
      this.updateBoss(dt);

      for (let j = this.projectiles.length - 1; j >= 0; j--) {
        const p = this.projectiles[j];
        const dist = this.boss.mesh.position.distanceTo(p.mesh.position);

        if (dist < (this.boss.radius + p.radius)) {
          this.scene.remove(p.mesh);
          this.projectiles.splice(j, 1);

          this.boss.health -= 1;
          this.sound.playHit();
          this.spawnExplosion(p.mesh.position, 6, 0x00f0ff);

          const bossPct = THREE.MathUtils.clamp((this.boss.health / this.boss.maxHealth) * 100, 0, 100);
          this.bossHealthBarFill.style.width = `${bossPct}%`;
          this.bossHealthText.textContent = `${Math.round(bossPct)}%`;

          if (this.boss.health <= 0) {
            this.scene.remove(this.boss.mesh);
            this.boss = null;
            this.isBossWave = false;

            const isDouble = this.multiplierTimeLeft > 0;
            const bossPoints = 2000 * (isDouble ? 2 : 1);
            this.score += bossPoints;
            this.saveData.bossesDefeated++;
            SaveSystem.save(this.saveData);

            this.sound.playBossDefeat();
            this.spawnExplosion(this.shipPosition.clone().add(this.shipForward.clone().multiplyScalar(40)), 65, 0xff2a5f);
            this.spawnShockwave(this.shipPosition.clone().add(this.shipForward.clone().multiplyScalar(40)), 0xff2a5f, 40);

            // Large Floating Score Popup for Boss Defeat
            this.triggerScorePopup(this.shipPosition.clone().add(this.shipForward.clone().multiplyScalar(35)), isDouble ? '+2X 4000' : '+2000');

            this.spawnPowerUp(this.shipPosition.clone().add(this.shipForward.clone().multiplyScalar(25)), 'SHIELD');

            this.bossHealthContainer.classList.add('hidden');
            this.showWaveAnnouncement(this.wave, 'BOSS DESTROYED! SECTOR SECURED');

            this.bossDefeatTimer = 3.0;
            break;
          }
        }
      }
    }

    if (this.bossDefeatTimer > 0) {
      this.bossDefeatTimer -= dt;
      if (this.bossDefeatTimer <= 0) {
        this.wave += 1;
        this.waveKills = 0;
        this.spawnInterval = Math.max(0.45, 2.0 - (this.wave - 1) * 0.2);
        this.sound.playWaveStart();
        this.showWaveAnnouncement(this.wave, 'ADVANCING TO NEXT SECTOR');
        this.hudKillsContainer.innerHTML = 'KILLS: <span id="hudKills">0</span> / <span id="hudNextWave">10</span>';
        this.hudKills = document.getElementById('hudKills');
        this.hudNextWave = document.getElementById('hudNextWave');
      }
    }

    // 10. Normal Enemies Spawning & Animation Pulse
    if (!this.isBossWave && this.bossDefeatTimer <= 0) {
      this.spawnTimer += dt;
      if (this.spawnTimer >= this.spawnInterval) {
        this.spawnTimer = 0;
        this.spawnEnemy();
      }
    }

    const playerRadius = 2.0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];

      // Enemy Movement towards player
      const toPlayer = this.shipPosition.clone().sub(enemy.mesh.position).normalize();
      enemy.mesh.position.add(toPlayer.multiplyScalar(enemy.speed * dt));

      // Spaceship Flight Orientation & Banking
      enemy.mesh.lookAt(this.shipPosition);
      enemy.mesh.rotation.z += Math.sin(enemy.pulsePhase * 0.8) * 0.15;

      // Animated Sub-Components & Thruster Coils
      enemy.pulsePhase += dt * 6.0;
      const haloScale = 1.0 + Math.sin(enemy.pulsePhase) * 0.18;
      if (enemy.halo) {
        enemy.halo.scale.set(haloScale, haloScale, haloScale);
      }

      if (enemy.type === 'TANK' && enemy.extra) {
        if (enemy.extra.leftRing) enemy.extra.leftRing.rotation.z += dt * 3.5;
        if (enemy.extra.rightRing) enemy.extra.rightRing.rotation.z -= dt * 3.5;
        if (enemy.extra.reactor) {
          const rScale = 0.9 + Math.sin(enemy.pulsePhase * 1.5) * 0.15;
          enemy.extra.reactor.scale.set(rScale, rScale, rScale);
        }
      } else if (enemy.type === 'SCOUT' && enemy.extra) {
        if (enemy.extra.plume) {
          const pScale = 0.85 + Math.sin(enemy.pulsePhase * 2.0) * 0.35;
          enemy.extra.plume.scale.set(1, 1, pScale);
        }
      } else if (enemy.type === 'SHOOTER' && enemy.extra) {
        if (enemy.extra.leftTip && enemy.extra.rightTip) {
          const tipScale = 1.0 + Math.sin(enemy.pulsePhase * 2.5) * 0.25;
          enemy.extra.leftTip.scale.set(tipScale, tipScale, tipScale);
          enemy.extra.rightTip.scale.set(tipScale, tipScale, tipScale);
        }
      }

      if (enemy.type === 'SHOOTER') {
        enemy.shootTimer += dt;
        if (enemy.shootTimer >= 1.8) {
          enemy.shootTimer = 0;
          this.fireEnemyLaser(enemy.mesh.position, this.shipPosition);
        }
      }

      const distToPlayer = enemy.mesh.position.distanceTo(this.shipPosition);

      if (distToPlayer < (enemy.radius + playerRadius)) {
        this.scene.remove(enemy.mesh);
        this.enemies.splice(i, 1);
        this.takeDamage(enemy.collisionDamage || 1);
        continue;
      }

      // Collision with Player Lasers
      let enemyDestroyed = false;
      for (let j = this.projectiles.length - 1; j >= 0; j--) {
        const p = this.projectiles[j];
        const distToLaser = enemy.mesh.position.distanceTo(p.mesh.position);

        if (distToLaser < (enemy.radius + p.radius)) {
          this.scene.remove(p.mesh);
          this.projectiles.splice(j, 1);

          enemy.health -= 1;
          this.sound.playHit();

          if (enemy.health <= 0) {
            this.scene.remove(enemy.mesh);
            this.enemies.splice(i, 1);
            enemyDestroyed = true;

            const isDouble = this.multiplierTimeLeft > 0;
            const awardedPoints = enemy.points * (isDouble ? 2 : 1);
            this.score += awardedPoints;
            this.kills += 1;
            this.waveKills += 1;

            // Trigger High-Visibility 3D Floating Score Popup
            let scoreText = `+${enemy.points}`;
            if (isDouble) {
              scoreText = `+2X ${enemy.points * 2}`;
            }
            this.triggerScorePopup(enemy.mesh.position, scoreText);

            const isLarge = enemy.type === 'TANK';
            this.sound.playExplosion(isLarge);
            this.spawnExplosion(enemy.mesh.position, isLarge ? 32 : 20, isLarge ? 0xff5500 : 0xff2a5f);
            this.spawnShockwave(enemy.mesh.position, isLarge ? 0xff5500 : 0x00f0ff, isLarge ? 26 : 16);

            // 15% Power-up drop chance
            if (Math.random() < 0.15) {
              this.spawnPowerUp(enemy.mesh.position);
            }

            if (this.waveKills >= this.killsPerWave) {
              this.waveKills = 0;
              this.wave += 1;
              this.spawnInterval = Math.max(0.45, 2.0 - (this.wave - 1) * 0.2);
              this.sound.playWaveStart();
              this.showWaveAnnouncement(this.wave, 'ENEMY SWARM ESCALATING');
            }

            this.updateHUD();
            break;
          } else {
            this.spawnExplosion(enemy.mesh.position, 6, 0x00f0ff);
          }
        }
      }

      if (!enemyDestroyed) {
        const relativeZ = this.shipForward.dot(enemy.mesh.position.clone().sub(this.shipPosition));
        if (relativeZ < -95) {
          this.scene.remove(enemy.mesh);
          this.enemies.splice(i, 1);
        }
      }
    }

    // 11. Update Floating Score Popups
    for (let i = this.scorePopups.length - 1; i >= 0; i--) {
      const sp = this.scorePopups[i];
      sp.life -= dt;
      const progress = 1.0 - (sp.life / sp.maxLife);

      // Float upward along shipUp vector
      sp.sprite.position.add(this.shipUp.clone().multiplyScalar(14 * dt));

      // Bouncy scale ease
      const scaleEase = Math.sin(Math.min(1.0, progress * 4.0) * Math.PI / 2);
      const currentScale = sp.baseScale * (0.6 + scaleEase * 0.5);
      sp.sprite.scale.set(currentScale, currentScale * 0.5, 1.0);

      // Fade out in last 40% of lifetime
      if (progress > 0.6) {
        sp.sprite.material.opacity = Math.max(0, (sp.life / (sp.maxLife * 0.4)));
      }

      if (sp.life <= 0) {
        sp.sprite.visible = false;
        this.scorePopups.splice(i, 1);
      }
    }

    // 12. Update Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      const progress = 1.0 - (sw.life / sw.maxLife);
      const currentRadius = 1.0 + progress * sw.maxRadius;
      sw.mesh.scale.set(currentRadius, currentRadius, currentRadius);
      sw.mesh.material.opacity = Math.max(0, sw.life / sw.maxLife);

      if (sw.life <= 0) {
        this.scene.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
      }
    }

    // 13. Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
      p.life -= dt;

      if (p.scaleSpeed) p.mesh.scale.multiplyScalar(p.scaleSpeed);
      if (p.fade && p.mesh.material) {
        p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      }

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    this.updateHUD();
  }

  // ==========================================
  // 3.15 ANIMATION LOOP
  // ==========================================
  animate() {
    requestAnimationFrame(this.animate);

    const dt = this.clock.getDelta();

    if (this.state === this.STATE_PLAYING) {
      this.update(dt);
    } else if (this.state === this.STATE_MENU || this.state === this.STATE_GAMEOVER) {
      if (this.playerShip) this.playerShip.rotation.y += dt * 0.4;
      if (this.starfield) this.starfield.rotation.y += dt * 0.05;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

function bindOddZoneAdapters(game) {
  window.__oddzoneReadScore = () => Number(game?.score || 0);
  window.__oddzoneStart = () => {
    if (!game) return;
    // The arena's tap-to-start fires this. startGame() resets the score to 0,
    // so only re-enter if we are sitting on the menu or a finished run.
    if (game.state === game.STATE_MENU || game.state === game.STATE_GAMEOVER) {
      game.startGame();
    }
  };
  // The host polls this every 100ms to notice a death. Without it the run
  // never ends on death and the player has to sit out the full 2 minutes.
  window.__oddzoneIsOver = () => !!game && game.state === game.STATE_GAMEOVER;
  window.__oddzoneEnd = () => {
    if (!game) return;
    if (game.state === game.STATE_GAMEOVER) return;
    if (game.state === game.STATE_PLAYING || game.state === game.STATE_PAUSED) {
      game.isFiring = false;
      game.triggerGameOver();
    }
  };
}

// Bootstrap Game Instance
window.addEventListener('DOMContentLoaded', () => {
  window.starShooterGame = new StarShooterGame();
  bindOddZoneAdapters(window.starShooterGame);
});
