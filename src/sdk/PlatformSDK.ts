import {
  AD_UNITS,
  DOUYIN_MULTITON_CONFIG,
  isPlaceholderAdUnit,
  type RewardedScene,
  type TargetPlatform,
} from '../config/adConfig';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../game/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const wx: any;
declare const tt: any;

export type SoundEffectName =
  | 'pistol'
  | 'shotgun'
  | 'gatling'
  | 'rocket'
  | 'break_barrel'
  | 'explosion'
  | 'hit'
  | 'gate_pos'
  | 'gate_neg'
  | 'crit'
  | 'boss_alert'
  | 'victory'
  | 'defeat'
  | 'click';

export interface ViewportInfo {
  width: number;
  height: number;
  pixelRatio: number;
  safeAreaTop: number;
  safeAreaBottom: number;
}

export interface InputHandlers {
  onTap: (logicalX: number, logicalY: number) => void;
  onDragStart: (logicalX: number, logicalY: number) => void;
  onDragMove: (logicalX: number, logicalY: number, deltaX: number) => void;
  onDragEnd: () => void;
  onKeyAxis: (axis: number) => void;
}

export interface RewardedAdResult {
  rewarded: boolean;
  reason: 'completed' | 'abandoned' | 'load_failed' | 'unsupported';
  scene: RewardedScene;
  message: string;
}

export interface InterstitialAdResult {
  shown: boolean;
  reason: 'shown' | 'load_failed' | 'unsupported';
}

export interface WebSimulatorBridge {
  getSimulatedPlatform: () => 'wechat' | 'douyin';
  shouldForceFail: () => boolean;
  showRewardedVideo: (scene: RewardedScene, rewardLabel: string) => Promise<RewardedAdResult>;
  showBanner: () => void;
  hideBanner: () => void;
  showInterstitial: (sceneLabel: string) => Promise<InterstitialAdResult>;
}

export type AudioBucketKey = 'shot' | 'shotgun' | 'break' | 'explosion' | 'crit' | 'gate';

interface AudioBucketState {
  instances: any[];
  cursor: number;
  lastPlayedMs: number;
}

const SOUND_TO_BUCKET: Record<SoundEffectName, { key: AudioBucketKey; src: string; volume: number }> = {
  pistol: { key: 'shot', src: 'assets/audio/shot.wav', volume: 0.45 },
  gatling: { key: 'shot', src: 'assets/audio/shot.wav', volume: 0.36 },
  shotgun: { key: 'shotgun', src: 'assets/audio/shotgun.wav', volume: 0.62 },
  rocket: { key: 'shotgun', src: 'assets/audio/shotgun.wav', volume: 0.65 },
  break_barrel: { key: 'break', src: 'assets/audio/break.wav', volume: 0.65 },
  explosion: { key: 'explosion', src: 'assets/audio/explosion.wav', volume: 0.78 },
  boss_alert: { key: 'explosion', src: 'assets/audio/explosion.wav', volume: 0.7 },
  defeat: { key: 'explosion', src: 'assets/audio/explosion.wav', volume: 0.65 },
  crit: { key: 'crit', src: 'assets/audio/crit.wav', volume: 0.58 },
  victory: { key: 'crit', src: 'assets/audio/crit.wav', volume: 0.72 },
  click: { key: 'crit', src: 'assets/audio/crit.wav', volume: 0.42 },
  gate_pos: { key: 'gate', src: 'assets/audio/gate.wav', volume: 0.62 },
  gate_neg: { key: 'gate', src: 'assets/audio/gate.wav', volume: 0.52 },
  hit: { key: 'gate', src: 'assets/audio/gate.wav', volume: 0.55 },
};

const AUDIO_POOL_SIZE_PER_BUCKET = 3;
const AUDIO_THROTTLE_MS = 50;

export type SoundPlayerFn = (name: SoundEffectName, pitchOffset?: number) => void;
export type AudioStateFn = (suspended: boolean) => void;

/**
 * 跨端平台适配中心：统一屏蔽 微信小游戏(wx) / 抖音小游戏(tt) / 浏览器(web) 差异
 * 所有原生广告、存储、震动、触控、安全区和音频调用均通过此类中转。
 */
export class PlatformSDK {
  public readonly runtime: TargetPlatform;
  private readonly canvas: HTMLCanvasElement;
  private viewport: ViewportInfo;

  private muted = false;
  private audioSuspended = false;
  private webBridge: WebSimulatorBridge | null = null;
  private webSoundPlayer: SoundPlayerFn | null = null;
  private webAudioStateFn: AudioStateFn | null = null;

  private wxRewardedAd: any = null;
  private ttRewardedAd: any = null;
  private pendingRewardResolve: ((res: RewardedAdResult) => void) | null = null;
  private activeRewardScene: RewardedScene | null = null;

  private bannerAd: any = null;
  private interstitialAd: any = null;

  /** 小游戏端 InnerAudioContext 实例池（按音效桶各复用 3 个实例并做 50ms 节流） */
  private readonly minigameAudioPool: any[] = [];
  private readonly minigameAudioBuckets = new Map<AudioBucketKey, AudioBucketState>();
  private readonly memoryStorage = new Map<string, string>();

  constructor() {
    this.runtime = this.detectRuntime();
    this.canvas = this.resolveCanvas();
    this.viewport = this.queryViewport();
    this.initPlatformHooks();
  }

  private detectRuntime(): TargetPlatform {
    if (import.meta.env.VITE_TARGET === 'web') {
      return 'web';
    }
    if (typeof tt !== 'undefined' && typeof tt.createCanvas === 'function') {
      return 'douyin';
    }
    if (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') {
      return 'wechat';
    }
    return 'web';
  }

  private resolveCanvas(): HTMLCanvasElement {
    if (this.runtime === 'douyin') {
      return tt.createCanvas();
    }
    if (this.runtime === 'wechat') {
      return wx.createCanvas();
    }
    if (import.meta.env.VITE_TARGET === 'web') {
      const el = document.getElementById('game-canvas') as HTMLCanvasElement | null;
      if (!el) {
        throw new Error('未找到画布节点');
      }
      return el;
    }
    throw new Error('未知运行环境');
  }

  private initPlatformHooks(): void {
    if (this.runtime === 'wechat') {
      if (typeof wx.showShareMenu === 'function') {
        wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
      }
      this.initWeChatRewardedAd();
    } else if (this.runtime === 'douyin') {
      if (typeof tt.showShareMenu === 'function') {
        tt.showShareMenu({ withShareTicket: false });
      }
      this.initDouyinRewardedAd();
    }
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** 创建跨端图片对象（屏蔽 wx.createImage / tt.createImage / Web Image 差异） */
  public createImage(): HTMLImageElement {
    if (this.runtime === 'douyin') {
      return tt.createImage();
    }
    if (this.runtime === 'wechat') {
      return wx.createImage();
    }
    if (import.meta.env.VITE_TARGET === 'web') {
      return new window.Image();
    }
    throw new Error('未知运行环境');
  }

  /** 创建跨端离屏画布（用于离屏白剪影生成） */
  public createOffscreenCanvas(width: number, height: number): HTMLCanvasElement {
    let off: HTMLCanvasElement;
    if (this.runtime === 'douyin') {
      off = tt.createCanvas();
    } else if (this.runtime === 'wechat') {
      off = wx.createCanvas();
    } else if (import.meta.env.VITE_TARGET === 'web') {
      off = document.createElement('canvas');
    } else {
      throw new Error('未知运行环境');
    }
    off.width = Math.max(1, width);
    off.height = Math.max(1, height);
    return off;
  }

  public getViewport(): ViewportInfo {
    this.viewport = this.queryViewport();
    return this.viewport;
  }

  /** 获取当前逻辑视口顶部/底部安全区内边距（映射至 720×1280 坐标系） */
  public getLogicalSafeInsets(): { top: number; bottom: number } {
    const vp = this.viewport;
    const scaleY = LOGICAL_HEIGHT / Math.max(1, vp.height);
    return {
      top: Math.round(vp.safeAreaTop * scaleY),
      bottom: Math.round(vp.safeAreaBottom * scaleY),
    };
  }

  private queryViewport(): ViewportInfo {
    if (this.runtime === 'wechat') {
      const info =
        typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const safe = info.safeArea || { top: 0, bottom: info.windowHeight };
      return {
        width: info.windowWidth,
        height: info.windowHeight,
        pixelRatio: Math.min(info.pixelRatio || 2, 3),
        safeAreaTop: Math.max(0, safe.top || 0),
        safeAreaBottom: Math.max(0, info.windowHeight - (safe.bottom || info.windowHeight)),
      };
    }

    if (this.runtime === 'douyin') {
      const info = tt.getSystemInfoSync();
      const safe = info.safeArea || { top: 0, bottom: info.windowHeight };
      return {
        width: info.windowWidth,
        height: info.windowHeight,
        pixelRatio: Math.min(info.pixelRatio || 2, 3),
        safeAreaTop: Math.max(0, safe.top || 0),
        safeAreaBottom: Math.max(0, info.windowHeight - (safe.bottom || info.windowHeight)),
      };
    }

    if (import.meta.env.VITE_TARGET === 'web') {
      const parent = this.canvas.parentElement;
      const rect = parent ? parent.getBoundingClientRect() : { width: 390, height: 844 };
      return {
        width: Math.max(300, Math.round(rect.width)),
        height: Math.max(500, Math.round(rect.height)),
        pixelRatio: Math.min(window.devicePixelRatio || 2, 3),
        safeAreaTop: 18,
        safeAreaBottom: 14,
      };
    }

    return {
      width: 390,
      height: 844,
      pixelRatio: 2,
      safeAreaTop: 0,
      safeAreaBottom: 0,
    };
  }

  public getEffectiveAdPlatform(): 'wechat' | 'douyin' {
    if (this.runtime === 'douyin') return 'douyin';
    if (this.runtime === 'wechat') return 'wechat';
    return this.webBridge?.getSimulatedPlatform() ?? 'wechat';
  }

  public registerWebBridge(bridge: WebSimulatorBridge): void {
    if (import.meta.env.VITE_TARGET === 'web') {
      this.webBridge = bridge;
    }
  }

  public registerWebAudio(player: SoundPlayerFn, stateFn: AudioStateFn): void {
    if (import.meta.env.VITE_TARGET === 'web') {
      this.webSoundPlayer = player;
      this.webAudioStateFn = stateFn;
    }
  }

  /** 将屏幕坐标映射为 720×1280 逻辑画布坐标 */
  private toLogical(clientX: number, clientY: number): { x: number; y: number } {
    if (this.runtime === 'web' && import.meta.env.VITE_TARGET === 'web') {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / Math.max(1, rect.width)) * LOGICAL_WIDTH;
      const y = ((clientY - rect.top) / Math.max(1, rect.height)) * LOGICAL_HEIGHT;
      return { x, y };
    }
    const vp = this.viewport;
    return {
      x: (clientX / Math.max(1, vp.width)) * LOGICAL_WIDTH,
      y: (clientY / Math.max(1, vp.height)) * LOGICAL_HEIGHT,
    };
  }

  public bindInput(handlers: InputHandlers): () => void {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let totalMove = 0;

    const handleDown = (cx: number, cy: number) => {
      const pt = this.toLogical(cx, cy);
      dragging = true;
      startX = pt.x;
      startY = pt.y;
      lastX = pt.x;
      totalMove = 0;
      handlers.onDragStart(pt.x, pt.y);
    };

    const handleMove = (cx: number, cy: number) => {
      if (!dragging) return;
      const pt = this.toLogical(cx, cy);
      const dx = pt.x - lastX;
      totalMove += Math.abs(dx) + Math.abs(pt.y - startY) * 0.1;
      lastX = pt.x;
      handlers.onDragMove(pt.x, pt.y, dx);
    };

    const handleUp = (cx: number, cy: number) => {
      if (!dragging) return;
      dragging = false;
      const pt = this.toLogical(cx, cy);
      const dist = Math.hypot(pt.x - startX, pt.y - startY);
      if (dist < 18 && totalMove < 22) {
        handlers.onTap(pt.x, pt.y);
      }
      handlers.onDragEnd();
    };

    if (this.runtime === 'wechat' || this.runtime === 'douyin') {
      const api = this.runtime === 'douyin' ? tt : wx;
      const onTS = (e: any) => {
        const t = e.changedTouches?.[0] || e.touches?.[0];
        if (t) handleDown(t.clientX, t.clientY);
      };
      const onTM = (e: any) => {
        const t = e.changedTouches?.[0] || e.touches?.[0];
        if (t) handleMove(t.clientX, t.clientY);
      };
      const onTE = (e: any) => {
        const t = e.changedTouches?.[0];
        if (t) handleUp(t.clientX, t.clientY);
        else {
          dragging = false;
          handlers.onDragEnd();
        }
      };
      const onTC = () => {
        dragging = false;
        handlers.onDragEnd();
      };
      api.onTouchStart(onTS);
      api.onTouchMove(onTM);
      api.onTouchEnd(onTE);
      api.onTouchCancel(onTC);
      return () => {
        api.offTouchStart?.(onTS);
        api.offTouchMove?.(onTM);
        api.offTouchEnd?.(onTE);
        api.offTouchCancel?.(onTC);
      };
    }

    if (import.meta.env.VITE_TARGET === 'web') {
      const pressed = new Set<string>();
      const updateAxis = () => {
        const left = pressed.has('KeyA') || pressed.has('ArrowLeft');
        const right = pressed.has('KeyD') || pressed.has('ArrowRight');
        handlers.onKeyAxis((right ? 1 : 0) - (left ? 1 : 0));
      };

      const onPointerDown = (e: PointerEvent) => {
        this.canvas.setPointerCapture?.(e.pointerId);
        handleDown(e.clientX, e.clientY);
      };
      const onPointerMove = (e: PointerEvent) => {
        handleMove(e.clientX, e.clientY);
      };
      const onPointerUp = (e: PointerEvent) => {
        handleUp(e.clientX, e.clientY);
      };
      const onPointerCancel = () => {
        dragging = false;
        handlers.onDragEnd();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          pressed.add(e.code);
          updateAxis();
        }
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (pressed.delete(e.code)) {
          updateAxis();
        }
      };

      this.canvas.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      return () => {
        this.canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      };
    }

    return () => {};
  }

  public onResize(callback: () => void): () => void {
    if (this.runtime === 'wechat') {
      if (typeof wx.onWindowResize !== 'function') return () => {};
      wx.onWindowResize(callback);
      return () => wx.offWindowResize?.(callback);
    }
    if (this.runtime === 'douyin') {
      if (typeof tt.onWindowResize !== 'function') return () => {};
      tt.onWindowResize(callback);
      return () => tt.offWindowResize?.(callback);
    }
    if (import.meta.env.VITE_TARGET === 'web') {
      window.addEventListener('resize', callback);
      return () => window.removeEventListener('resize', callback);
    }
    return () => {};
  }

  public onVisibilityChange(onHide: () => void, onShow: () => void): () => void {
    if (this.runtime === 'wechat') {
      wx.onHide?.(onHide);
      wx.onShow?.(onShow);
      return () => {
        wx.offHide?.(onHide);
        wx.offShow?.(onShow);
      };
    }
    if (this.runtime === 'douyin') {
      tt.onHide?.(onHide);
      tt.onShow?.(onShow);
      return () => {
        tt.offHide?.(onHide);
        tt.offShow?.(onShow);
      };
    }
    if (import.meta.env.VITE_TARGET === 'web') {
      const onVis = () => {
        if (document.hidden) onHide();
        else onShow();
      };
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }
    return () => {};
  }

  public getStorage(key: string): string | null {
    try {
      if (this.runtime === 'wechat') {
        const val = wx.getStorageSync(key);
        return val === '' || val === undefined || val === null ? null : String(val);
      }
      if (this.runtime === 'douyin') {
        const val = tt.getStorageSync(key);
        return val === '' || val === undefined || val === null ? null : String(val);
      }
      if (import.meta.env.VITE_TARGET === 'web') {
        return window.localStorage.getItem(key);
      }
    } catch {
      return this.memoryStorage.get(key) ?? null;
    }
    return this.memoryStorage.get(key) ?? null;
  }

  public setStorage(key: string, value: string): void {
    this.memoryStorage.set(key, value);
    try {
      if (this.runtime === 'wechat') {
        wx.setStorageSync(key, value);
      } else if (this.runtime === 'douyin') {
        tt.setStorageSync(key, value);
      } else if (import.meta.env.VITE_TARGET === 'web') {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // 忽略存储配额错误
    }
  }

  public removeStorage(key: string): void {
    this.memoryStorage.delete(key);
    try {
      if (this.runtime === 'wechat') {
        wx.removeStorageSync?.(key);
      } else if (this.runtime === 'douyin') {
        tt.removeStorageSync?.(key);
      } else if (import.meta.env.VITE_TARGET === 'web') {
        window.localStorage.removeItem(key);
      }
    } catch {
      // 忽略清理异常
    }
  }

  public vibrate(style: 'light' | 'medium' | 'heavy'): void {
    try {
      if (this.runtime === 'wechat' && typeof wx.vibrateShort === 'function') {
        wx.vibrateShort({ type: style });
      } else if (this.runtime === 'douyin' && typeof tt.vibrateShort === 'function') {
        tt.vibrateShort({ type: style });
      }
    } catch {
      // 忽略震动兼容差异
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.runtime !== 'web') {
      for (const ctx of this.minigameAudioPool) {
        try {
          ctx.stop?.();
        } catch {
          // 忽略
        }
      }
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public suspendAudio(): void {
    this.audioSuspended = true;
    if (import.meta.env.VITE_TARGET === 'web') {
      this.webAudioStateFn?.(true);
    }
    for (const ctx of this.minigameAudioPool) {
      try {
        ctx.pause?.();
      } catch {
        // 忽略
      }
    }
  }

  public resumeAudio(): void {
    this.audioSuspended = false;
    if (import.meta.env.VITE_TARGET === 'web') {
      this.webAudioStateFn?.(false);
    }
  }

  public playSound(name: SoundEffectName, pitchOffset = 0): void {
    if (this.muted || this.audioSuspended) return;
    if (import.meta.env.VITE_TARGET === 'web') {
      this.webSoundPlayer?.(name, pitchOffset);
      return;
    }
    this.playMinigameInnerAudio(name);
  }

  private playMinigameInnerAudio(name: SoundEffectName): void {
    const api = this.runtime === 'douyin' ? tt : this.runtime === 'wechat' ? wx : null;
    if (!api || typeof api.createInnerAudioContext !== 'function') return;

    const spec = SOUND_TO_BUCKET[name];
    if (!spec) return;

    let bucket = this.minigameAudioBuckets.get(spec.key);
    if (!bucket) {
      bucket = { instances: [], cursor: 0, lastPlayedMs: 0 };
      this.minigameAudioBuckets.set(spec.key, bucket);
    }

    const nowMs = Date.now();
    if (nowMs - bucket.lastPlayedMs < AUDIO_THROTTLE_MS) {
      return;
    }
    bucket.lastPlayedMs = nowMs;

    let ctx: any;
    if (bucket.instances.length < AUDIO_POOL_SIZE_PER_BUCKET) {
      ctx = api.createInnerAudioContext();
      ctx.src = spec.src;
      ctx.obeyMuteSwitch = true;
      ctx.onError?.(() => {});
      bucket.instances.push(ctx);
      this.minigameAudioPool.push(ctx);
    } else {
      ctx = bucket.instances[bucket.cursor % bucket.instances.length];
      bucket.cursor = (bucket.cursor + 1) % bucket.instances.length;
    }

    try {
      ctx.volume = spec.volume;
      if (typeof ctx.stop === 'function') {
        ctx.stop();
      }
      if (typeof ctx.seek === 'function') {
        ctx.seek(0);
      }
      ctx.play();
    } catch {
      // 忽略真机音频异常
    }
  }

  private initWeChatRewardedAd(): void {
    const adUnitId = AD_UNITS.wechat.rewardedVideo;
    if (isPlaceholderAdUnit(adUnitId) || typeof wx.createRewardedVideoAd !== 'function') {
      return;
    }
    this.wxRewardedAd = wx.createRewardedVideoAd({ adUnitId });
    this.wxRewardedAd.onClose((res: { isEnded?: boolean } | undefined) => {
      const resolver = this.pendingRewardResolve;
      const scene = this.activeRewardScene || 'revive_clear';
      this.pendingRewardResolve = null;
      this.activeRewardScene = null;
      if (!resolver) return;

      // 微信基础库：res 存在时严格要求 res.isEnded === true，部分旧版本无 res 传参视为已完播
      const completed = res ? res.isEnded === true : true;
      resolver({
        rewarded: completed,
        reason: completed ? 'completed' : 'abandoned',
        scene,
        message: completed ? '奖励已发放' : '完整观看广告才能领取奖励',
      });
    });

    this.wxRewardedAd.onError(() => {
      const resolver = this.pendingRewardResolve;
      const scene = this.activeRewardScene || 'revive_clear';
      this.pendingRewardResolve = null;
      this.activeRewardScene = null;
      if (resolver) {
        resolver({
          rewarded: false,
          reason: 'load_failed',
          scene,
          message: '暂无可用广告，请稍后再试',
        });
      }
    });
  }

  private initDouyinRewardedAd(): void {
    const adUnitId = AD_UNITS.douyin.rewardedVideo;
    if (isPlaceholderAdUnit(adUnitId) || typeof tt.createRewardedVideoAd !== 'function') {
      return;
    }
    this.ttRewardedAd = tt.createRewardedVideoAd({
      adUnitId,
      multiton: DOUYIN_MULTITON_CONFIG.multiton,
      multitonRewardMsg: DOUYIN_MULTITON_CONFIG.multitonRewardMsg,
      multitonRewardTimes: DOUYIN_MULTITON_CONFIG.multitonRewardTimes,
      progressTip: DOUYIN_MULTITON_CONFIG.progressTip,
    });
    this.ttRewardedAd.onClose((res: { isEnded?: boolean; count?: number } | undefined) => {
      const resolver = this.pendingRewardResolve;
      const scene = this.activeRewardScene || 'revive_clear';
      this.pendingRewardResolve = null;
      this.activeRewardScene = null;
      if (!resolver) return;

      const completed = Boolean(res?.isEnded);
      resolver({
        rewarded: completed,
        reason: completed ? 'completed' : 'abandoned',
        scene,
        message: completed ? '奖励已发放' : '完整观看广告才能领取奖励',
      });
    });

    this.ttRewardedAd.onError(() => {
      const resolver = this.pendingRewardResolve;
      const scene = this.activeRewardScene || 'revive_clear';
      this.pendingRewardResolve = null;
      this.activeRewardScene = null;
      if (resolver) {
        resolver({
          rewarded: false,
          reason: 'load_failed',
          scene,
          message: '暂无可用广告，请稍后再试',
        });
      }
    });
  }

  public showRewardedVideoRaw(scene: RewardedScene, rewardLabel: string): Promise<RewardedAdResult> {
    if (import.meta.env.VITE_TARGET === 'web' && this.webBridge) {
      return this.webBridge.showRewardedVideo(scene, rewardLabel);
    }

    const rewardedAd = this.runtime === 'douyin' ? this.ttRewardedAd : this.wxRewardedAd;
    if (!rewardedAd) {
      return Promise.resolve({
        rewarded: false,
        reason: 'unsupported',
        scene,
        message: '暂无可用广告，请稍后再试',
      });
    }

    return new Promise((resolve) => {
      this.pendingRewardResolve = resolve;
      this.activeRewardScene = scene;

      rewardedAd
        .show()
        .catch(() => rewardedAd.load().then(() => rewardedAd.show()))
        .catch(() => {
          if (this.pendingRewardResolve) {
            const cb = this.pendingRewardResolve;
            this.pendingRewardResolve = null;
            this.activeRewardScene = null;
            cb({
              rewarded: false,
              reason: 'load_failed',
              scene,
              message: '暂无可用广告，请稍后再试',
            });
          }
        });
    });
  }

  public showBannerRaw(): void {
    if (import.meta.env.VITE_TARGET === 'web' && this.webBridge) {
      this.webBridge.showBanner();
      return;
    }

    if (this.runtime === 'wechat') {
      const adUnitId = AD_UNITS.wechat.banner;
      if (isPlaceholderAdUnit(adUnitId) || typeof wx.createBannerAd !== 'function') return;
      const vp = this.getViewport();
      const targetWidth = Math.min(320, Math.max(300, vp.width - 24));
      if (!this.bannerAd) {
        this.bannerAd = wx.createBannerAd({
          adUnitId,
          adIntervals: 30,
          style: {
            left: (vp.width - targetWidth) / 2,
            top: vp.height - vp.safeAreaBottom - 60,
            width: targetWidth,
          },
        });
        this.bannerAd.onResize((size: { width: number; height: number }) => {
          this.bannerAd.style.left = (vp.width - size.width) / 2;
          this.bannerAd.style.top = vp.height - vp.safeAreaBottom - size.height;
        });
        this.bannerAd.onError(() => {});
      }
      this.bannerAd.show?.().catch(() => {});
      return;
    }

    if (this.runtime === 'douyin') {
      const adUnitId = AD_UNITS.douyin.banner;
      if (isPlaceholderAdUnit(adUnitId) || typeof tt.createBannerAd !== 'function') return;
      const vp = this.getViewport();
      const targetWidth = Math.min(300, vp.width - 24);
      if (!this.bannerAd) {
        this.bannerAd = tt.createBannerAd({
          adUnitId,
          adIntervals: 30,
          style: {
            width: targetWidth,
            left: (vp.width - targetWidth) / 2,
            top: vp.height - vp.safeAreaBottom - 60,
          },
        });
        this.bannerAd.onResize((size: { width: number; height: number }) => {
          this.bannerAd.style.left = (vp.width - size.width) / 2;
          this.bannerAd.style.top = vp.height - vp.safeAreaBottom - size.height;
        });
        this.bannerAd.onError(() => {});
      }
      this.bannerAd.show?.().catch(() => {});
    }
  }

  public hideBannerRaw(): void {
    if (import.meta.env.VITE_TARGET === 'web' && this.webBridge) {
      this.webBridge.hideBanner();
      return;
    }
    this.bannerAd?.hide?.();
  }

  public showInterstitialRaw(sceneLabel: string): Promise<InterstitialAdResult> {
    if (import.meta.env.VITE_TARGET === 'web' && this.webBridge) {
      return this.webBridge.showInterstitial(sceneLabel);
    }

    if (this.runtime === 'wechat') {
      const adUnitId = AD_UNITS.wechat.interstitial;
      if (isPlaceholderAdUnit(adUnitId) || typeof wx.createInterstitialAd !== 'function') {
        return Promise.resolve({ shown: false, reason: 'unsupported' });
      }
      if (!this.interstitialAd) {
        this.interstitialAd = wx.createInterstitialAd({ adUnitId });
        this.interstitialAd.onError(() => {});
      }
      return this.interstitialAd
        .show()
        .catch(() => this.interstitialAd.load().then(() => this.interstitialAd.show()))
        .then(() => ({ shown: true, reason: 'shown' as const }))
        .catch(() => ({ shown: false, reason: 'load_failed' as const }));
    }

    if (this.runtime === 'douyin') {
      const adUnitId = AD_UNITS.douyin.interstitial;
      if (isPlaceholderAdUnit(adUnitId) || typeof tt.createInterstitialAd !== 'function') {
        return Promise.resolve({ shown: false, reason: 'unsupported' });
      }
      if (!this.interstitialAd) {
        this.interstitialAd = tt.createInterstitialAd({ adUnitId });
        this.interstitialAd.onError(() => {});
      }
      return this.interstitialAd
        .load()
        .then(() => this.interstitialAd.show())
        .then(() => ({ shown: true, reason: 'shown' as const }))
        .catch(() => ({ shown: false, reason: 'load_failed' as const }));
    }

    return Promise.resolve({ shown: false, reason: 'unsupported' });
  }
}
