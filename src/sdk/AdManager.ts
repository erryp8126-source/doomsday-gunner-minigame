import { AD_RULES, MOCK_ECPM_CNY, type RewardedScene } from '../config/adConfig';
import type { GameState } from '../game/types';
import type { PlatformSDK } from './PlatformSDK';

export interface AdStats {
  rewardedRequested: number;
  rewardedCompleted: number;
  rewardedAbandoned: number;
  rewardedFailed: number;
  interstitialShown: number;
  interstitialBlocked: number;
  bannerImpressions: number;
}

export interface AdDebugSnapshot {
  runtime: 'wechat' | 'douyin' | 'web';
  effectivePlatform: 'wechat' | 'douyin';
  simulatedPlatform: 'wechat' | 'douyin';
  forceFail: boolean;
  bannerVisible: boolean;
  totalRunsPlayed: number;
  beginnerProtectionLeft: number;
  interstitialCooldownLeftSec: number;
  postRewardCooldownLeftSec: number;
  lastBlockReason: string;
  stats: AdStats;
  estimatedRevenueCny: number;
  blendedEcpmCny: number;
}

export interface AdCallbacks {
  onPauseChanged: (paused: boolean) => void;
  onToast: (text: string, color?: string) => void;
  onRewardCompleted?: () => void;
}

/**
 * IAA 商业化调度单例：
 * 1. 激励视频防连点锁 + 严格完播校验 + 自动暂停恢复 + 失败兜底提示
 * 2. 安全区 Banner 显隐联动（仅主菜单与结算页展示）
 * 3. 硬性插屏频控（新手前2局免弹、60秒间隔、激励后30秒免打扰）
 */
export class AdManager {
  private static instance: AdManager | null = null;

  public static getInstance(sdk: PlatformSDK): AdManager {
    if (!AdManager.instance) {
      AdManager.instance = new AdManager(sdk);
    }
    return AdManager.instance;
  }

  private readonly sdk: PlatformSDK;
  private callbacks: AdCallbacks = {
    onPauseChanged: () => {},
    onToast: () => {},
  };

  private rewardedBusy = false;
  private interstitialBusy = false;
  private bannerVisible = false;
  private lastInterstitialAtMs = 0;
  private lastRewardedAtMs = 0;
  private lastBlockReason = '暂无拦截';
  private totalRunsSnapshot = 0;

  private simulatedPlatform: 'wechat' | 'douyin' = 'wechat';
  private forceFail = false;

  private stats: AdStats = {
    rewardedRequested: 0,
    rewardedCompleted: 0,
    rewardedAbandoned: 0,
    rewardedFailed: 0,
    interstitialShown: 0,
    interstitialBlocked: 0,
    bannerImpressions: 0,
  };

  private readonly listeners = new Set<() => void>();

  private constructor(sdk: PlatformSDK) {
    this.sdk = sdk;
  }

  public bindCallbacks(callbacks: AdCallbacks): void {
    this.callbacks = callbacks;
  }

  public syncTotalRuns(totalRuns: number): void {
    this.totalRunsSnapshot = totalRuns;
    this.notify();
  }

  public setSimulatedPlatform(platform: 'wechat' | 'douyin'): void {
    this.simulatedPlatform = platform;
    this.notify();
  }

  public getSimulatedPlatform(): 'wechat' | 'douyin' {
    return this.simulatedPlatform;
  }

  public setForceFail(force: boolean): void {
    this.forceFail = force;
    this.notify();
  }

  public isForceFail(): boolean {
    return this.forceFail;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  public resetTracking(): void {
    this.lastInterstitialAtMs = 0;
    this.lastRewardedAtMs = 0;
    this.lastBlockReason = '已重置';
    this.totalRunsSnapshot = 0;
    this.stats = {
      rewardedRequested: 0,
      rewardedCompleted: 0,
      rewardedAbandoned: 0,
      rewardedFailed: 0,
      interstitialShown: 0,
      interstitialBlocked: 0,
      bannerImpressions: 0,
    };
    this.notify();
  }

  public async showRewardedVideo(scene: RewardedScene, rewardLabel: string): Promise<boolean> {
    if (this.rewardedBusy || this.interstitialBusy) {
      this.callbacks.onToast('广告加载中，请勿重复点击', '#fbbf24');
      return false;
    }

    this.rewardedBusy = true;
    this.stats.rewardedRequested += 1;
    this.notify();

    this.callbacks.onPauseChanged(true);
    try {
      const res = await this.sdk.showRewardedVideoRaw(scene, rewardLabel);
      if (res.rewarded) {
        this.stats.rewardedCompleted += 1;
        this.lastRewardedAtMs = Date.now();
        this.callbacks.onRewardCompleted?.();
        return true;
      }

      if (res.reason === 'abandoned') {
        this.stats.rewardedAbandoned += 1;
        this.callbacks.onToast('完整观看广告才能领取奖励', '#fbbf24');
      } else {
        this.stats.rewardedFailed += 1;
        this.callbacks.onToast('暂无可用广告，请稍后再试', '#f87171');
      }
      return false;
    } catch {
      this.stats.rewardedFailed += 1;
      this.callbacks.onToast('暂无可用广告，请稍后再试', '#f87171');
      return false;
    } finally {
      this.callbacks.onPauseChanged(false);
      this.rewardedBusy = false;
      this.notify();
    }
  }

  public syncBannerForState(state: GameState): void {
    const shouldShow = state === 'MENU' || state === 'RESULT';
    if (shouldShow && !this.bannerVisible) {
      this.bannerVisible = true;
      this.stats.bannerImpressions += 1;
      this.sdk.showBannerRaw();
      this.notify();
    } else if (!shouldShow && this.bannerVisible) {
      this.bannerVisible = false;
      this.sdk.hideBannerRaw();
      this.notify();
    }
  }

  public canShowInterstitial(
    totalRunsPlayed: number,
    nowMs = Date.now(),
  ): { allowed: boolean; reason: string } {
    if (totalRunsPlayed <= AD_RULES.beginnerNoInterstitialRuns) {
      return { allowed: false, reason: '新手前两局免打扰保护' };
    }
    if (
      this.lastRewardedAtMs > 0 &&
      nowMs - this.lastRewardedAtMs < AD_RULES.postRewardInterstitialCooldownMs
    ) {
      return { allowed: false, reason: '激励视频后三十秒免打扰' };
    }
    if (
      this.lastInterstitialAtMs > 0 &&
      nowMs - this.lastInterstitialAtMs < AD_RULES.interstitialCooldownMs
    ) {
      return { allowed: false, reason: '插屏六十秒冷却中' };
    }
    return { allowed: true, reason: '允许展示' };
  }

  public async tryShowInterstitial(
    sceneLabel: string,
    totalRunsPlayed: number,
    nowMs = Date.now(),
  ): Promise<boolean> {
    this.totalRunsSnapshot = totalRunsPlayed;
    if (this.rewardedBusy || this.interstitialBusy) {
      return false;
    }

    const check = this.canShowInterstitial(totalRunsPlayed, nowMs);
    if (!check.allowed) {
      this.stats.interstitialBlocked += 1;
      this.lastBlockReason = check.reason;
      this.notify();
      return false;
    }

    this.interstitialBusy = true;
    this.callbacks.onPauseChanged(true);
    try {
      const res = await this.sdk.showInterstitialRaw(sceneLabel);
      if (res.shown) {
        this.stats.interstitialShown += 1;
        this.lastInterstitialAtMs = Date.now();
        this.lastBlockReason = '正常展示完成';
        return true;
      }
      this.lastBlockReason = '插屏暂无可用填充';
      return false;
    } catch {
      this.lastBlockReason = '插屏拉取异常';
      return false;
    } finally {
      this.callbacks.onPauseChanged(false);
      this.interstitialBusy = false;
      this.notify();
    }
  }

  public getDebugSnapshot(nowMs = Date.now()): AdDebugSnapshot {
    const interstitialLeft =
      this.lastInterstitialAtMs > 0
        ? Math.max(0, Math.ceil((AD_RULES.interstitialCooldownMs - (nowMs - this.lastInterstitialAtMs)) / 1000))
        : 0;
    const postRewardLeft =
      this.lastRewardedAtMs > 0
        ? Math.max(0, Math.ceil((AD_RULES.postRewardInterstitialCooldownMs - (nowMs - this.lastRewardedAtMs)) / 1000))
        : 0;

    const totalImpressions =
      this.stats.rewardedCompleted + this.stats.interstitialShown + this.stats.bannerImpressions;
    const estimatedRevenueCny =
      (this.stats.rewardedCompleted * MOCK_ECPM_CNY.rewardedVideo +
        this.stats.interstitialShown * MOCK_ECPM_CNY.interstitial +
        this.stats.bannerImpressions * MOCK_ECPM_CNY.banner) /
      1000;
    const blendedEcpmCny = totalImpressions > 0 ? (estimatedRevenueCny / totalImpressions) * 1000 : 0;

    return {
      runtime: this.sdk.runtime,
      effectivePlatform: this.sdk.getEffectiveAdPlatform(),
      simulatedPlatform: this.simulatedPlatform,
      forceFail: this.forceFail,
      bannerVisible: this.bannerVisible,
      totalRunsPlayed: this.totalRunsSnapshot,
      beginnerProtectionLeft: Math.max(0, AD_RULES.beginnerNoInterstitialRuns - this.totalRunsSnapshot),
      interstitialCooldownLeftSec: interstitialLeft,
      postRewardCooldownLeftSec: postRewardLeft,
      lastBlockReason: this.lastBlockReason,
      stats: { ...this.stats },
      estimatedRevenueCny,
      blendedEcpmCny,
    };
  }
}
