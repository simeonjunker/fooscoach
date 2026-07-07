'use strict';

/**
 * Wraps the vendor-prefixed Fullscreen API.
 * Source: https://www.w3schools.com/jsref/met_element_requestfullscreen.asp
 */
class FullscreenManager {
  static open() {
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (request) request.call(el);
  }

  static close() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) exit.call(document);
  }
}

/**
 * Keeps the screen awake while the tab is visible.
 * Source: https://www.slingacademy.com/article/prevent-screen-sleep-with-the-screen-wake-lock-api-in-javascript/
 */
class WakeLockManager {
  constructor() {
    this.supported = 'wakeLock' in navigator;
    this.wakeLock = null;

    if (this.supported) {
      document.addEventListener('visibilitychange', () => this._handleVisibilityChange());
    }
  }

  async request() {
    if (!this.supported) return;

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake lock is active.');
      this.wakeLock.addEventListener('release', () => console.log('Wake lock was released.'));
    } catch (err) {
      console.error(`Could not obtain wake lock: ${err.name}, ${err.message}`);
    }
  }

  async _handleVisibilityChange() {
    if (this.wakeLock && document.hidden) {
      await this.wakeLock.release();
    } else if (!document.hidden) {
      await this.request();
    }
  }
}

// Vivid, mutually distinguishable defaults (one per position, left to right).
// Picked from a colorblind-friendly qualitative palette so neighboring
// positions never look alike, even at a glance.
const DEFAULT_POSITION_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4'];

const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;

/**
 * Parses and validates the URL query parameters that configure a session.
 */
class Config {
  constructor(paramsString) {
    const params = new URLSearchParams(paramsString);

    this.availablePositions = [0, 1, 2, 3, 4].filter((i) => this._bool(params, `pos${i}`));

    this.prepareTime = this._millis(params, 'prepareTime');
    this.readyTime = this._millis(params, 'readyTime');
    this.minWait = this._millis(params, 'minWaitTime');
    this.maxWait = this._millis(params, 'maxWaitTime');
    this.highlightTime = this._millis(params, 'highlightTime');
    this.refreshTime = this._millis(params, 'refreshTime');

    this.doClick = this._bool(params, 'doClick');
    this.doBeep = this._bool(params, 'doBeep');
    this.doAnnounce = this._bool(params, 'doAnnounce');

    this.useCustomColors = this._bool(params, 'useCustomColors');
    this.positionColors = [0, 1, 2, 3, 4].map((i) => this._color(params, `color${i}`, DEFAULT_POSITION_COLORS[i]));
  }

  _bool(params, key) {
    try {
      return Boolean(JSON.parse(params.get(key)));
    } catch {
      return false;
    }
  }

  _millis(params, key) {
    const seconds = parseInt(params.get(key), 10);
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }

  _color(params, key, fallback) {
    const raw = params.get(key);
    if (!raw || !HEX_COLOR_PATTERN.test(raw)) return fallback;
    return raw.startsWith('#') ? raw : `#${raw}`;
  }
}

/**
 * Plays the audio cues used throughout a session, gated by the current config.
 */
class AudioPlayer {
  constructor(config, playbackRate = 1) {
    this.config = config;
    this.beepSound = new Audio('assets/sound/beep.ogg');
    this.tickSound = new Audio('assets/sound/tick.ogg');

    // announcements[0..4] correspond to left, half-left, middle, half-right, right
    this.announcements = Array.from(
      { length: 5 },
      (_, i) => new Audio(`assets/sound/announce/ger/${i}.mp3`)
    );
    this.announcements.forEach((audio) => {
      audio.playbackRate = playbackRate;
    });
  }

  playTick() {
    if (this.config.doClick) this.tickSound.play();
  }

  playBeep() {
    if (this.config.doBeep) this.beepSound.play();
  }

  playPosition(index) {
    if (this.config.doAnnounce) this.announcements[index].play();
  }
}

/**
 * Drives the highlight/pause/resume game loop.
 */
class ReactionGame {
  constructor(config, audioPlayer) {
    this.config = config;
    this.audio = audioPlayer;
    this.container = document.querySelector('.container');
    this.sections = document.querySelectorAll('.section');
    this.overlay = document.getElementById('overlay');

    this.isRunning = true;
    this.timeoutId = null;
    this.tickIntervalId = null;

    if (this.config.useCustomColors) {
      this.container.classList.add('no-dividers');
    }

    document.documentElement.addEventListener('click', () => this.togglePause());
  }

  start() {
    FullscreenManager.open();
    this._restartLoop();
  }

  _clearTimers() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.tickIntervalId) clearInterval(this.tickIntervalId);
  }

  _showOverlay(text, backgroundColor) {
    this.overlay.textContent = text;
    this.overlay.style.backgroundColor = backgroundColor;
    this.overlay.classList.add('visible');
  }

  _showUniformColor(color) {
    this.sections.forEach((section) => {
      section.style.backgroundColor = color;
    });
  }

  _resetSections() {
    this.sections.forEach((section) => {
      section.style.backgroundColor = 'black';
    });
  }

  _restartLoop(text = 'Ball auf die Drei') {
    this._showOverlay(text, 'white');
    this.timeoutId = setTimeout(() => this._getReady(), this.config.prepareTime);
  }

  _getReady(text = 'Mach dich bereit!') {
    this._showOverlay(text, 'white');
    this.timeoutId = setTimeout(() => {
      this.overlay.classList.remove('visible');
      this._highlightRandomSection();
    }, this.config.readyTime);
  }

  _randomDuration(min = this.config.minWait, max = this.config.maxWait) {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  _pickRandomSection() {
    const positions = this.config.availablePositions;
    const index = positions[Math.floor(Math.random() * positions.length)];
    return { index, element: this.sections[index] };
  }

  _highlightRandomSection() {
    const waitDuration = this._randomDuration();
    const { index, element } = this._pickRandomSection();

    this.tickIntervalId = setInterval(() => this.audio.playTick(), 1000);

    this.timeoutId = setTimeout(() => {
      clearInterval(this.tickIntervalId);
      this.audio.playPosition(index);
      this.audio.playBeep();

      if (this.config.useCustomColors) {
        this._showUniformColor(this.config.positionColors[index]);
      } else {
        element.style.backgroundColor = 'green';
      }

      this.timeoutId = setTimeout(() => {
        this._resetSections();
        this.timeoutId = setTimeout(() => this._restartLoop(), this.config.refreshTime);
      }, this.config.highlightTime);
    }, waitDuration);
  }

  togglePause() {
    if (this.isRunning) {
      this._pause();
    } else {
      this._resume();
    }
  }

  _pause() {
    this._clearTimers();
    this._showOverlay('Pause!', 'white');
    this._resetSections();
    FullscreenManager.close();
    this.isRunning = false;
  }

  _resume() {
    FullscreenManager.open();
    this.overlay.textContent = 'Weiter!';
    setTimeout(() => {
      this.overlay.classList.remove('visible');
      this._restartLoop();
      this.isRunning = true;
    }, 1000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const config = new Config(window.location.search);
  const audioPlayer = new AudioPlayer(config);
  const wakeLock = new WakeLockManager();
  wakeLock.request();

  const game = new ReactionGame(config, audioPlayer);
  game.start();
});