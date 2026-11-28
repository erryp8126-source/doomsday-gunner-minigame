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

test('PlatformSDK 真机插屏必须等待 onClose 才解除暂停并允许下一局，且抖音关闭 multiton 与支持重入锁', async () => {
  const realAdConfig = loadTs('src/config/adConfig.ts');
  assert.equal(realAdConfig.DOUYIN_MULTITON_CONFIG.multiton, false, '第一版应关闭抖音 multiton');

  const testAdConfig = {
    ...realAdConfig,
    AD_UNITS: {
      wechat: {
        rewardedVideo: 'adunit-wx-rew-test',
        banner: 'adunit-wx-ban-test',
        interstitial: 'adunit-wx-int-test',
      },
      douyin: {
        rewardedVideo: 'adunit-tt-rew-test',
        banner: 'adunit-tt-ban-test',
        interstitial: 'adunit-tt-int-test',
      },
    },
  };

  const origWx = globalThis.wx;
  const origTt = globalThis.tt;
  try {
    // 1. 微信插屏：show() resolve 后仍处于阻塞状态，直到 onClose() 触发
    let wxIntClose = null;
    let wxIntError = null;
    let wxRewClose = null;
    let touchHandlers = {};
    globalThis.tt = undefined;
    globalThis.wx = {
      createCanvas: () => ({ width: 720, height: 1280, getContext: () => ({}) }),
      createImage: () => ({}),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1.5 }),
      onTouchStart: (fn) => (touchHandlers.start = fn),
      onTouchMove: (fn) => (touchHandlers.move = fn),
      onTouchEnd: (fn) => (touchHandlers.end = fn),
      onTouchCancel: (fn) => (touchHandlers.cancel = fn),
      getStorageSync: () => '',
      setStorageSync: () => {},
      createInnerAudioContext: () => ({ src: '', volume: 1, obeyMuteSwitch: true, play: () => {} }),
      createRewardedVideoAd: () => ({
        load: async () => {},
        show: async () => {},
        onClose: (cb) => (wxRewClose = cb),
        onError: () => {},
      }),
      createInterstitialAd: () => ({
        load: async () => {},
        show: async () => {},
        onClose: (cb) => (wxIntClose = cb),
        onError: (cb) => (wxIntError = cb),
      }),
    };

    const { PlatformSDK } = loadTs('src/sdk/PlatformSDK.ts', {
      viteTarget: 'minigame',
      mocks: { adConfig: testAdConfig },
    });
    const { AdManager } = loadTs('src/sdk/AdManager.ts', {
      mocks: { adConfig: testAdConfig },
    });
    const sdkWx = new PlatformSDK();
    const adMgr = AdManager.getInstance(sdkWx);
    adMgr.resetTracking();
    const pauseEvents = [];
    adMgr.bindCallbacks({
      onPauseChanged: (p) => pauseEvents.push(p),
      onToast: () => {},
    });

    let settled = false;
    const intPromise = adMgr.tryShowInterstitial('局后重开', 5, Date.now() + 100_000).then((ok) => {
      settled = true;
      return ok;
    });
    // 等待 show() 微任务完成
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false, 'ad.show() 展示后尚未 onClose 时不得提前返回');
    assert.deepEqual(pauseEvents, [true], '插屏未关闭前必须保持 pausedByAd = true');

    wxIntClose();
    const shownOk = await intPromise;
    assert.equal(shownOk, true);
    assert.deepEqual(pauseEvents, [true, false]);

    // 微信插屏 onError 应安全解锁返回 false
    const errPromise = sdkWx.showInterstitialRaw('异常测试');
    await new Promise((r) => setTimeout(r, 10));
    wxIntError(new Error('fail'));
    const errRes = await errPromise;
    assert.equal(errRes.shown, false);
    assert.equal(errRes.reason, 'load_failed');

    // M5: PlatformSDK.showRewardedVideoRaw 并发重入不覆盖首个 pending Promise
    const r1 = sdkWx.showRewardedVideoRaw('revive_clear', '复活');
    const r2 = await sdkWx.showRewardedVideoRaw('revive_clear', '复活');
    assert.equal(r2.rewarded, false);
    assert.equal(r2.reason, 'load_failed');
    wxRewClose({ isEnded: true });
    assert.equal((await r1).rewarded, true);

    // L4: bindInput 轻微纵向抖动不误屏蔽 tap
    let tapCount = 0;
    const unbind = sdkWx.bindInput({
      onTap: () => (tapCount += 1),
      onDragStart: () => {},
      onDragMove: () => {},
      onDragEnd: () => {},
      onKeyAxis: () => {},
    });
    touchHandlers.start({ changedTouches: [{ clientX: 100, clientY: 200 }] });
    for (let i = 0; i < 6; i++) {
      touchHandlers.move({ changedTouches: [{ clientX: 100, clientY: 200 + (i % 2 === 0 ? 2 : 0) }] });
    }
    touchHandlers.end({ changedTouches: [{ clientX: 101, clientY: 201 }] });
    assert.equal(tapCount, 1, '轻触抖动仍应准确触发 onTap');
    unbind();

    // 2. 抖音端：关闭 multiton 传参，插屏同样等待 onClose
    let ttRewardCreateOpts = null;
    let ttIntClose = null;
    globalThis.wx = undefined;
    globalThis.tt = {
      createCanvas: () => ({ width: 720, height: 1280, getContext: () => ({}) }),
      createImage: () => ({}),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1.5 }),
      onTouchStart: () => {},
      onTouchMove: () => {},
      onTouchEnd: () => {},
      onTouchCancel: () => {},
      getStorageSync: () => '',
      setStorageSync: () => {},
      createInnerAudioContext: () => ({ src: '', volume: 1, obeyMuteSwitch: true, play: () => {} }),
      createRewardedVideoAd: (opts) => {
        ttRewardCreateOpts = opts;
        return { load: async () => {}, show: async () => {}, onClose: () => {}, onError: () => {} };
      },
      createInterstitialAd: () => ({
        load: async () => {},
        show: async () => {},
        onClose: (cb) => (ttIntClose = cb),
        onError: () => {},
      }),
    };

    const { PlatformSDK: TtPlatformSDK } = loadTs('src/sdk/PlatformSDK.ts', {
      viteTarget: 'minigame',
      mocks: { adConfig: testAdConfig },
    });
    const sdkTt = new TtPlatformSDK();
    assert.equal('multiton' in ttRewardCreateOpts, false, '抖音激励广告不应透传 multiton: true');

    let ttSettled = false;
    const ttIntPromise = sdkTt.showInterstitialRaw('抖音重开').then((res) => {
      ttSettled = true;
      return res;
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ttSettled, false, '抖音插屏在 onClose 前不得提前 resolve');
    ttIntClose();
    assert.equal((await ttIntPromise).shown, true);
  } finally {
    globalThis.wx = origWx;
    globalThis.tt = origTt;
  }
});
