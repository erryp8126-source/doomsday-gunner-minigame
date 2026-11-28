import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

const realAdConfig = loadTs('src/config/adConfig.ts');
const adConfig = {
  ...realAdConfig,
  AD_UNITS: {
    wechat: { rewardedVideo: 'wx-rew', banner: 'wx-ban', interstitial: 'wx-int' },
    douyin: { rewardedVideo: 'tt-rew', banner: 'tt-ban', interstitial: 'tt-int' },
  },
};

/** 让已排队的 Promise 回调全部执行完（不依赖被 mock 的 setTimeout） */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** 可编排 show()/load() 结果的假广告实例 */
function fakeAd({ show = [], load = [] } = {}) {
  const ad = {
    showCalls: 0,
    loadCalls: 0,
    handlers: {},
    show() {
      const step = show[ad.showCalls++] ?? (() => Promise.resolve());
      return step(ad);
    },
    load() {
      const step = load[ad.loadCalls++] ?? (() => Promise.resolve());
      return step(ad);
    },
    onClose: (cb) => (ad.handlers.close = cb),
    onError: (cb) => (ad.handlers.error = cb),
  };
  return ad;
}

const failWithError = (ad) => {
  ad.handlers.error({ errCode: 1004 });
  return Promise.reject(new Error('no fill'));
};
const never = () => new Promise(() => {});

function createSdk(runtime, options = {}) {
  const {
    width = 390,
    height = 844,
    safeBottom = height,
    menuBottom = 0,
    rewarded = fakeAd(),
    interstitial = fakeAd(),
    extra = {},
  } = options;
  const touch = {};
  const api = {
    createCanvas: () => ({ width, height, getContext: () => ({}) }),
    createImage: () => ({}),
    getSystemInfoSync: () => ({
      windowWidth: width,
      windowHeight: height,
      pixelRatio: 3,
      statusBarHeight: 47,
      safeArea: { top: 47, bottom: safeBottom },
    }),
    getMenuButtonBoundingClientRect: () => ({ bottom: menuBottom }),
    onTouchStart: (fn) => (touch.start = fn),
    onTouchMove: (fn) => (touch.move = fn),
    onTouchEnd: (fn) => (touch.end = fn),
    onTouchCancel: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    createInnerAudioContext: () => ({ play: () => {} }),
    createRewardedVideoAd: () => rewarded,
    createInterstitialAd: () => interstitial,
    ...extra,
  };
  globalThis.wx = runtime === 'wechat' ? api : undefined;
  globalThis.tt = runtime === 'douyin' ? api : undefined;
  const { PlatformSDK } = loadTs('src/sdk/PlatformSDK.ts', {
    viteTarget: 'minigame',
    mocks: { adConfig },
  });
  return { sdk: new PlatformSDK(), rewarded, interstitial, touch };
}

test.afterEach(() => {
  globalThis.wx = undefined;
  globalThis.tt = undefined;
});

// ---------- 画面适配 ----------

test('舞台布局在长屏与平板上保持等比并居中', () => {
  const { computeStageLayout } = loadTs('src/game/stageLayout.ts');
  for (const [w, h] of [[390, 844], [768, 1024], [720, 1280]]) {
    const s = computeStageLayout(w, h);
    assert.ok(Math.abs(s.offsetX * 2 + 720 * s.scale - w) < 1e-9);
    assert.ok(Math.abs(s.offsetY * 2 + 1280 * s.scale - h) < 1e-9);
    assert.ok(s.offsetX >= -1e-9 && s.offsetY >= -1e-9);
  }
  assert.equal(computeStageLayout(768, 1024).offsetX, 96);
});

test('小游戏画布保持清晰度：舞台缓冲上限 1080×1920，且不超过设备物理像素', () => {
  const { computeScreenLayout } = loadTs('src/game/stageLayout.ts');
  for (const [w, h, dpr] of [[390, 844, 3], [768, 1024, 2], [360, 640, 4]]) {
    const s = computeScreenLayout(w, h, dpr);
    assert.ok(Math.abs(s.scale - 1.5) < 0.005, `${w}x${h}@${dpr}: ${s.scale}`);
    assert.ok(Number.isInteger(s.offsetX) && Number.isInteger(s.offsetY));
    // 缓冲区与屏幕同比例，铺满屏幕时不拉伸
    assert.ok(Math.abs(s.canvasWidth / s.canvasHeight - w / h) < 0.002);
  }
  // SDK 需上报设备原始像素比，否则缓冲区会被二次限幅而变糊
  assert.equal(createSdk('wechat').sdk.getViewport().pixelRatio, 3);
  assert.equal(createSdk('douyin').sdk.getViewport().pixelRatio, 3);
  const lowEnd = computeScreenLayout(360, 640, 1);
  assert.deepEqual([lowEnd.canvasWidth, lowEnd.canvasHeight], [360, 640]);
});

test('小游戏触摸坐标与安全区按居中舞台换算', () => {
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    const { sdk, touch } = createSdk('wechat', { width, height });
    const taps = [];
    sdk.bindInput({
      onTap: (x, y) => taps.push([x, y]),
      onDragStart: () => {},
      onDragMove: () => {},
      onDragEnd: () => {},
      onKeyAxis: () => {},
    });
    const scale = Math.min(width / 720, height / 1280);
    const ox = (width - 720 * scale) / 2;
    const oy = (height - 1280 * scale) / 2;
    for (const [lx, ly] of [[0, 0], [360, 640], [600, 1100]]) {
      const point = { clientX: ox + lx * scale, clientY: oy + ly * scale };
      touch.start({ changedTouches: [point] });
      touch.end({ changedTouches: [point] });
      const [x, y] = taps.at(-1);
      assert.ok(Math.abs(x - lx) < 1e-6 && Math.abs(y - ly) < 1e-6, `${width}x${height}: ${x},${y}`);
    }
  }

  const tall = createSdk('wechat', { safeBottom: 810, menuBottom: 91 }).sdk;
  assert.deepEqual({ ...tall.getLogicalSafeInsets() }, { top: 44, bottom: 0 });
});

// ---------- 广告 ----------

for (const runtime of ['wechat', 'douyin']) {
  test(`${runtime} 激励视频首次展示失败、重试成功后仍发放奖励`, async () => {
    const rewarded = fakeAd({ show: [failWithError] });
    const { sdk } = createSdk(runtime, { rewarded });
    let result = null;
    const pending = sdk.showRewardedVideoRaw('revive_clear', '复活').then((r) => (result = r));
    await flush();
    assert.equal(result, null, '重试链进行中不得提前返回失败');
    assert.equal(rewarded.showCalls, 2);
    rewarded.handlers.close({ isEnded: true });
    assert.equal((await pending).rewarded, true);
  });

  test(`${runtime} 插屏重试期间的 onError 不提前解除等待`, async () => {
    const interstitial =
      runtime === 'wechat' ? fakeAd({ show: [failWithError] }) : fakeAd();
    if (runtime === 'douyin') {
      interstitial.load = () => {
        interstitial.handlers.error({});
        return Promise.resolve();
      };
    }
    const { sdk } = createSdk(runtime, { interstitial });
    let result = null;
    const pending = sdk.showInterstitialRaw('重开').then((r) => (result = r));
    await flush();
    assert.equal(result, null);
    interstitial.handlers.close();
    assert.equal((await pending).shown, true);
  });
}

test('激励视频重试仍失败时返回 load_failed，且可再次发起', async () => {
  const rewarded = fakeAd({ show: [failWithError, failWithError] });
  const { sdk } = createSdk('wechat', { rewarded });
  const first = await sdk.showRewardedVideoRaw('revive_clear', '复活');
  assert.equal(first.rewarded, false);
  assert.equal(first.reason, 'load_failed');
  const next = sdk.showRewardedVideoRaw('revive_clear', '复活');
  await flush();
  rewarded.handlers.close({ isEnded: false });
  assert.equal((await next).reason, 'abandoned');
});

test('广告打开后触发 onError 会结束等待', async () => {
  const { sdk, rewarded } = createSdk('douyin');
  const pending = sdk.showRewardedVideoRaw('revive_clear', '复活');
  await flush();
  rewarded.handlers.error({});
  assert.equal((await pending).reason, 'load_failed');
});

test('show() 一直无响应时超时返回，之后不再补弹广告', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishLoad;
  const rewarded = fakeAd({
    show: [failWithError],
    load: [() => new Promise((resolve) => (finishLoad = resolve))],
  });
  const { sdk } = createSdk('wechat', { rewarded });
  const pending = sdk.showRewardedVideoRaw('revive_clear', '复活');
  await flush();
  t.mock.timers.tick(15_000);
  assert.equal((await pending).reason, 'load_failed');
  finishLoad();
  await flush();
  assert.equal(rewarded.showCalls, 1, '超时后不得再调用 show()');
});

test('onClose 丢失时超时解除暂停', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sdk } = createSdk('wechat', { interstitial: fakeAd(), rewarded: fakeAd() });
  const reward = sdk.showRewardedVideoRaw('revive_clear', '复活');
  const inter = sdk.showInterstitialRaw('重开');
  await flush();
  t.mock.timers.tick(180_000);
  assert.equal((await reward).rewarded, false);
  assert.equal((await inter).shown, true);
});

test('插屏 show() 无响应时超时返回失败', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sdk } = createSdk('wechat', { interstitial: fakeAd({ show: [never] }) });
  const pending = sdk.showInterstitialRaw('重开');
  await flush();
  t.mock.timers.tick(15_000);
  assert.equal((await pending).shown, false);
});

// ---------- 抖音侧边栏 ----------

function createSidebarSdk(launch, checkResult = { isExist: true }) {
  let onShow;
  const { sdk } = createSdk('douyin', {
    extra: {
      checkScene: ({ success }) => success(checkResult),
      getLaunchOptionsSync: () => launch,
      onShow: (fn) => (onShow = fn),
    },
  });
  return { sdk, show: (opts) => onShow(opts) };
}

const SIDEBAR = { scene: '021036', launch_from: 'homepage', location: 'sidebar_card' };

test('只有 launch_from 与 location 同时匹配才算侧边栏进入', () => {
  for (const launch of [
    { launch_from: 'homepage', location: 'recent' },
    { launch_from: 'homepage' },
    { location: 'sidebar_card' },
    {},
  ]) {
    assert.equal(createSidebarSdk(launch).sdk.getSidebarStatus().fromSidebar, false, JSON.stringify(launch));
  }
  assert.equal(createSidebarSdk(SIDEBAR).sdk.getSidebarStatus().fromSidebar, true);
});

test('侧边栏状态以最近一次 onShow 为准', () => {
  const h = createSidebarSdk({ launch_from: 'search' });
  h.show(SIDEBAR);
  assert.equal(h.sdk.getSidebarStatus().fromSidebar, true);
  h.show({ launch_from: 'search', location: 'search_card' });
  assert.equal(h.sdk.getSidebarStatus().fromSidebar, false);
});

test('checkScene 未明确返回 isExist 时不展示侧边栏入口', () => {
  assert.equal(createSidebarSdk({}, {}).sdk.getSidebarStatus().supported, false);
  assert.equal(createSidebarSdk({}).sdk.getSidebarStatus().supported, true);
});
