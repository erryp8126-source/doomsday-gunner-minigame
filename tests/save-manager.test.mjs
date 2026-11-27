import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

function createStorageSdk() {
  const store = new Map();
  return {
    store,
    getStorage: (key) => store.get(key) ?? null,
    setStorage: (key, val) => store.set(key, val),
    removeStorage: (key) => store.delete(key),
  };
}

test('SaveManager 默认存档字段与初始未解锁状态正确', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const sdk = createStorageSdk();
  const sm = new SaveManager(sdk);
  const data = sm.getData();

  assert.equal(data.coins, 0);
  assert.equal(data.unlockedLevel, 1);
  assert.equal(data.selectedLevel, 1);
  assert.equal(data.attackLevel, 1);
  assert.equal(data.fireRateLevel, 1);
  assert.equal(data.squadLevel, 2);
  assert.equal(data.equippedSkin, 'standard');
  assert.equal(data.vibrateEnabled, true);
  assert.equal(data.tutorialDone, false);
  assert.deepEqual(data.guideSeen, { barrel: false, gate: false, boss: false });
  assert.equal(sm.isEndlessUnlocked(), false);
});

test('SaveManager 通关第 1 关后解锁第 2 关与无尽模式并持久化', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const sdk = createStorageSdk();
  const sm = new SaveManager(sdk);

  assert.equal(sm.isEndlessUnlocked(), false);
  sm.markLevelCleared(1, 5);
  assert.equal(sm.getData().unlockedLevel, 2);
  assert.equal(sm.getData().selectedLevel, 2);
  assert.equal(sm.isEndlessUnlocked(), true);

  // 重新实例化验证持久化读写
  const reloaded = new SaveManager(sdk);
  assert.equal(reloaded.isEndlessUnlocked(), true);
  assert.equal(reloaded.getData().unlockedLevel, 2);
});

test('SaveManager 每日视频分享与侧边栏复访奖励同一天防重复领取', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const sdk = createStorageSdk();
  const sm = new SaveManager(sdk);

  assert.equal(sm.canClaimDailyVideoReward(), true);
  assert.equal(sm.claimDailyVideoReward(150), true);
  assert.equal(sm.getData().coins, 150);
  assert.equal(sm.canClaimDailyVideoReward(), false);
  assert.equal(sm.claimDailyVideoReward(150), false, '同一天不可重复领取每日视频奖励');
  assert.equal(sm.getData().coins, 150);

  assert.equal(sm.canClaimDailySidebarReward(), true);
  assert.equal(sm.claimDailySidebarReward(200), true);
  assert.equal(sm.getData().coins, 350);
  assert.equal(sm.canClaimDailySidebarReward(), false);
  assert.equal(sm.claimDailySidebarReward(200), false, '同一天不可重复领取每日侧边栏复访奖励');
  assert.equal(sm.getData().coins, 350);
});

test('SaveManager 分段引导标记持久化与旧存档兼容', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const sdk = createStorageSdk();
  // 模拟无 guideSeen 字段的旧版存档
  sdk.setStorage('doomsday_gunner_save_v2', JSON.stringify({ coins: 45, unlockedLevel: 1 }));

  const sm = new SaveManager(sdk);
  assert.equal(sm.hasSeenGuide('barrel'), false);
  assert.equal(sm.hasSeenGuide('gate'), false);
  assert.equal(sm.hasSeenGuide('boss'), false);

  sm.markGuideSeen('barrel');
  sm.markGuideSeen('gate');

  const reloaded = new SaveManager(sdk);
  assert.equal(reloaded.hasSeenGuide('barrel'), true);
  assert.equal(reloaded.hasSeenGuide('gate'), true);
  assert.equal(reloaded.hasSeenGuide('boss'), false);
});

test('SaveManager getCheapestUpgradeGap 准确计算升级差额、复用对象及满级状态', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const sdk = createStorageSdk();
  const sm = new SaveManager(sdk);

  // 初始最便宜升级为 60 金币（基础攻击 / 初始射速 1级）
  const out = { minCost: 0, canUpgradeNow: false, gap: 0, allMaxed: false };
  const res1 = sm.getCheapestUpgradeGap(25, out);
  assert.equal(res1, out, '传入 out 时应原地复用同一结构体避免 GC');
  assert.equal(out.minCost, 60);
  assert.equal(out.gap, 35);
  assert.equal(out.canUpgradeNow, false);
  assert.equal(out.allMaxed, false);

  sm.addCoins(40);
  sm.getCheapestUpgradeGap(20, out);
  assert.equal(out.gap, 0);
  assert.equal(out.canUpgradeNow, true);

  // 模拟全部升至满级
  const data = sm.getData();
  data.attackLevel = 20;
  data.fireRateLevel = 20;
  data.squadLevel = 6;
  sm.getCheapestUpgradeGap(100, out);
  assert.equal(out.allMaxed, true);
  assert.equal(out.canUpgradeNow, false);
  assert.equal(out.minCost, 0);
});
