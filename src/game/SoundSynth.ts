import type { SoundEffectName } from '../sdk/PlatformSDK';

/**
 * 零资源 Web Audio API 程序化合成音效（对齐 prototype_reference.html 打击手感）
 * 仅在 Web 预览构建中打包，小游戏构建时自动通过 VITE_TARGET 剔除
 */
export class SoundSynth {
  private ctx: AudioContext | null = null;
  private suspended = false;
  private lastShotTime = 0;

  private ensureContext(): AudioContext | null {
    if (this.suspended) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (!this.ctx) return;
    if (suspended) {
      this.ctx.suspend().catch(() => {});
    } else {
      this.ctx.resume().catch(() => {});
    }
  }

  public play(name: SoundEffectName, _pitchOffset = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (name === 'pistol' || name === 'shotgun' || name === 'gatling' || name === 'rocket') {
      if (now - this.lastShotTime < 0.045) return;
      this.lastShotTime = now;
    }

    switch (name) {
      case 'gatling':
        this.tone(ctx, 'sawtooth', 540, 145, 0.055, 0.075, now);
        break;
      case 'shotgun':
        this.tone(ctx, 'triangle', 235, 50, 0.12, 0.16, now);
        break;
      case 'rocket':
        this.tone(ctx, 'sawtooth', 185, 42, 0.18, 0.15, now);
        break;
      case 'pistol':
        this.tone(ctx, 'square', 640, 175, 0.06, 0.07, now);
        break;
      case 'break_barrel':
        this.tone(ctx, 'triangle', 320, 840, 0.13, 0.15, now);
        break;
      case 'explosion':
        this.tone(ctx, 'sawtooth', 135, 26, 0.28, 0.21, now);
        break;
      case 'hit':
        this.tone(ctx, 'sine', 165, 65, 0.08, 0.12, now);
        break;
      case 'gate_pos':
        this.tone(ctx, 'sine', 540, 1020, 0.14, 0.13, now);
        break;
      case 'gate_neg':
        this.tone(ctx, 'sine', 230, 115, 0.14, 0.13, now);
        break;
      case 'crit':
        this.tone(ctx, 'triangle', 880, 1480, 0.08, 0.12, now);
        break;
      case 'boss_alert':
        this.tone(ctx, 'sawtooth', 420, 260, 0.22, 0.13, now);
        this.tone(ctx, 'sawtooth', 420, 260, 0.22, 0.13, now + 0.26);
        break;
      case 'victory':
        this.tone(ctx, 'triangle', 523.25, 523.25, 0.12, 0.11, now);
        this.tone(ctx, 'triangle', 659.25, 659.25, 0.12, 0.11, now + 0.11);
        this.tone(ctx, 'triangle', 783.99, 1046.5, 0.26, 0.14, now + 0.22);
        break;
      case 'defeat':
        this.tone(ctx, 'sawtooth', 260, 95, 0.32, 0.12, now);
        break;
      case 'click':
        this.tone(ctx, 'sine', 640, 820, 0.05, 0.07, now);
        break;
    }
  }

  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    volume: number,
    startTime: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);

    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }
}
