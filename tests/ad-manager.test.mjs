import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

function createAdHarness(options = {}) {
  const { AdManager } = loadTs('src/sdk/AdManager.ts');
  const toasts = [];
  const pauseEvents = [];
  let rewardCompletedCount = 0;
  let rewardedRawCalls = 0;
  let interstitialRawCalls = 0;
  let resolvePendingVideo = null;

  let nextRewardResult = options.nextRewardResult ?? {
    rewarded: true,
    reason: 'completed',
    message: '奖励已发放',
  };

  const fakeSdk = {
    runtime: 'wechat',
    getEffectiveAdPlatform: () => 'wechat',
    showRewardedVideoRaw: (scene) => {
      rewardedRawCalls += 1;
      if (options.deferRewarded) {
        return new Promise((resolve) => {
          resolvePendingVideo = (overrideResult) =>
            resolve({ scene, ...(overrideResult ?? nextRewardResult) });
        });
      }
      return Promise.resolve({ scene, ...nextRewardResult });
    },
    showBannerRaw: () => {},
    hideBannerRaw: () => {},
    showInterstitialRaw: async () => {
      interstitialRawCalls += 1;
      return { shown: true, reason: 'shown' };
    },
  };

  const adManager = AdManager.getInstance(fakeSdk);
  adManager.resetTracking();
  adManager.bindCallbacks({
    onPauseChanged: (paused) => pauseEvents.push(paused),
    onToast: (text) => toasts.push(text),
    onRewardCompleted: () => {
      rewardCompletedCount += 1;
    },
  });

  return {
    adManager,
    toasts,
    pauseEvents,
    getRewardCompletedCount: () => rewardCompletedCount,
    getRewardedRawCalls: () => rewardedRawCalls,
    getInterstitialRawCalls: () => interstitialRawCalls,
    setNextRewardResult: (res) => {
      nextRewardResult = res;
    },
    resolvePendingVideo: (res) => resolvePendingVideo?.(res),
  };
}

test('AdManager 激励视频防连点互斥锁', async () => {
  const h = createAdHarness({ deferRewarded: true });

  const firstPromise = h.adManager.showRewardedVideo('revive_clear', '原地复活');
  const secondOk = await h.adManager.showRewardedVideo('revive_clear', '原地复活');

  assert.equal(secondOk, false, '并发第二次点击必须被互斥锁拦截');
  assert.equal(h.getRewardedRawCalls(), 1, '并发状态下仅向底层 SDK 发起一次广告请求');
  assert.equal(h.toasts[0], '广告加载中，请勿重复点击');

  h.resolvePendingVideo({ rewarded: true, reason: 'completed', message: '奖励已发放' });
  const firstOk = await firstPromise;
  assert.equal(firstOk, true);
  assert.equal(h.getRewardCompletedCount(), 1);
  assert.deepEqual(h.pauseEvents, [true, false]);
});

test('AdManager 激励视频中途关闭不发奖，完整观看正常发奖', async () => {
  const h = createAdHarness();

  h.setNextRewardResult({
    rewarded: false,
    reason: 'abandoned',
    message: '完整观看广告才能领取奖励',
  });
  const abandonedOk = await h.adManager.showRewardedVideo('airdrop_supply', '空投支援');
  assert.equal(abandonedOk, false);
  assert.equal(h.getRewardCompletedCount(), 0);
  assert.equal(h.adManager.getDebugSnapshot().stats.rewardedAbandoned, 1);
  assert.equal(h.toasts.at(-1), '完整观看广告才能领取奖励');

  h.setNextRewardResult({
    rewarded: true,
    reason: 'completed',
    message: '奖励已发放',
  });
  const completedOk = await h.adManager.showRewardedVideo('airdrop_supply', '空投支援');
  assert.equal(completedOk, true);
  assert.equal(h.getRewardCompletedCount(), 1);
  assert.equal(h.adManager.getDebugSnapshot().stats.rewardedCompleted, 1);
  assert.deepEqual(h.pauseEvents, [true, false, true, false]);
});

test('AdManager 三层插屏频控（前两局免弹、激励后 30 秒免打扰、全局 60 秒冷却）', async () => {
  const origDateNow = Date.now;
  let nowMs = 1_000_000;
  Date.now = () => nowMs;

  try {
    const h = createAdHarness();

    // 1. 新手前 2 局免弹保护
    assert.equal(h.adManager.canShowInterstitial(1, nowMs).allowed, false);
    assert.equal(h.adManager.canShowInterstitial(2, nowMs).allowed, false);
    assert.equal(h.adManager.canShowInterstitial(3, nowMs).allowed, true);

    // 2. 激励视频看完后 30 秒内屏蔽插屏
    const rewOk = await h.adManager.showRewardedVideo('pre_battle_boost', '加特林开局');
    assert.equal(rewOk, true);
    nowMs += 29_999;
    assert.equal(h.adManager.canShowInterstitial(3, nowMs).allowed, false);
    assert.equal(h.adManager.canShowInterstitial(3, nowMs).reason, '激励视频后三十秒免打扰');

    // 超过 30 秒后放行第一次插屏展示
    nowMs += 1;
    assert.equal(h.adManager.canShowInterstitial(3, nowMs).allowed, true);
    const firstShown = await h.adManager.tryShowInterstitial('第3局结束', 3, nowMs);
    assert.equal(firstShown, true);
    assert.equal(h.getInterstitialRawCalls(), 1);

    // 3. 插屏全局 60 秒冷却拦截
    nowMs += 59_999;
    const blockedByCooldown = await h.adManager.tryShowInterstitial('60秒内再弹', 4, nowMs);
    assert.equal(blockedByCooldown, false);
    assert.equal(h.getInterstitialRawCalls(), 1);
    assert.equal(h.adManager.getDebugSnapshot(nowMs).lastBlockReason, '插屏六十秒冷却中');

    nowMs += 1;
    const allowedAfterCooldown = await h.adManager.tryShowInterstitial('冷却结束', 4, nowMs);
    assert.equal(allowedAfterCooldown, true);
    assert.equal(h.getInterstitialRawCalls(), 2);
  } finally {
    Date.now = origDateNow;
  }
});
