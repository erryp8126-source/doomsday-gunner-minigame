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

test('SaveManager 里程碑一次性发放金币/称号/永久+15%金币加成与终极徽章', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const sdk = createStorageSdk();
  const sm = new SaveManager(sdk);

  assert.equal(sm.hasEliteTitle(), false);
  assert.equal(sm.hasPermanentCoinBonus(), false);
  assert.equal(sm.getPermanentCoinMultiplier(), 1);
  assert.equal(sm.hasFinalHonorBadge(), false);

  const m1 = sm.markLevelCleared(1, 15);
  assert.equal(m1.newlyClaimedMilestone?.clearLevel, 1);
  assert.equal(sm.getData().coins, 0);

  // 通关第 5 关：奖励 500 金币并解锁「精英战区」称号，重复通关不重复发币
  const m5 = sm.markLevelCleared(5, 15);
  assert.equal(m5.newlyClaimedMilestone?.clearLevel, 5);
  assert.equal(sm.getData().coins, 500);
  assert.equal(sm.hasEliteTitle(), true);
  const m5Repeat = sm.markLevelCleared(5, 15);
  assert.equal(m5Repeat.newlyClaimedMilestone, null);
  assert.equal(sm.getData().coins, 500);

  // 通关第 10 关：奖励 1000 金币并激活永久金币 +15%
  const m10 = sm.markLevelCleared(10, 15);
  assert.equal(m10.newlyClaimedMilestone?.clearLevel, 10);
  assert.equal(sm.getData().coins, 1500);
  assert.equal(sm.hasPermanentCoinBonus(), true);
  assert.equal(sm.getPermanentCoinMultiplier(), 1.15);

  // 通关第 15 关：解锁终极荣誉徽章并持久化
  const m15 = sm.markLevelCleared(15, 15);
  assert.equal(m15.newlyClaimedMilestone?.clearLevel, 15);
  assert.equal(sm.hasFinalHonorBadge(), true);
  const reloaded = new SaveManager(sdk);
  assert.equal(reloaded.hasEliteTitle(), true);
  assert.equal(reloaded.getPermanentCoinMultiplier(), 1.15);
  assert.equal(reloaded.hasFinalHonorBadge(), true);
});

test('SaveManager 连败次数统计、切换关卡重置与卡关助战单局消费', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const sdk = createStorageSdk();
  const sm = new SaveManager(sdk);

  // 解锁至第 4 关
  sm.markLevelCleared(1, 15);
  sm.markLevelCleared(2, 15);
  sm.markLevelCleared(3, 15);
  assert.equal(sm.getData().selectedLevel, 4);

  assert.equal(sm.recordLevelFailure(4), 1);
  assert.equal(sm.recordLevelFailure(4), 2);
  assert.equal(sm.getConsecutiveFailures(4), 2);

  sm.armStuckAssist(4);
  // 切换关卡会清空当前连败和待激活助战
  sm.selectLevel(2);
  assert.equal(sm.getConsecutiveFailures(4), 0);
  assert.equal(sm.consumeStuckAssist(4), false);

  sm.selectLevel(4);
  sm.recordLevelFailure(4);
  sm.recordLevelFailure(4);
  sm.armStuckAssist(4);
  assert.equal(sm.consumeStuckAssist(4), true, '单局消费卡关助战应返回 true');
  assert.equal(sm.consumeStuckAssist(4), false, '助战仅单局有效，不可二次消费');
  assert.equal(sm.getConsecutiveFailures(4), 0);
});

test('SaveManager 损坏或越界存档自动清洗并安全恢复', () => {
  const { SaveManager } = loadTs('src/game/SaveManager.ts');
  const { LEVELS } = loadTs('src/config/levels.ts');
  const sdk = createStorageSdk();

  for (const badRaw of ['null', '[]', '"corrupt"', '{bad json']) {
    sdk.setStorage('doomsday_gunner_save_v2', badRaw);
    const smBad = new SaveManager(sdk);
    assert.equal(smBad.getData().unlockedLevel, 1);
    assert.equal(smBad.getData().selectedLevel, 1);
    assert.equal(smBad.getData().coins, 0);
  }

  sdk.setStorage(
    'doomsday_gunner_save_v2',
    JSON.stringify({
      coins: -999,
      bestKills: 'bad',
      unlockedLevel: 999,
      selectedLevel: 500,
      attackLevel: 0,
      fireRateLevel: null,
      squadLevel: 99,
      equippedSkin: 'invalid_skin',
      skinAdProgress: { crimson: -3, pulse: 'x', dragon: 2.8 },
      claimedMilestones: [1, 1, 5, 999, 'bad', null],
      stuckLevelId: -2,
      consecutiveFailures: -7,
      vibrateEnabled: 'yes',
    }),
  );

  const sm = new SaveManager(sdk);
  const d = sm.getData();
  assert.equal(d.coins, 0);
  assert.equal(d.bestKills, 0);
  assert.equal(d.unlockedLevel, LEVELS.length);
  assert.equal(d.selectedLevel, LEVELS.length);
  assert.equal(d.attackLevel, 1);

  sdk.setStorage(
    'doomsday_gunner_save_v2',
    JSON.stringify({ unlockedLevel: 3, selectedLevel: 'bad' }),
  );
  const smInvalidSel = new SaveManager(sdk);
  assert.equal(smInvalidSel.getData().selectedLevel, 1);
  assert.equal(d.fireRateLevel, 1);
  assert.equal(d.squadLevel, 6);
  assert.equal(d.equippedSkin, 'standard');
  assert.equal(d.skinAdProgress.crimson, 0);
  assert.equal(d.skinAdProgress.pulse, 0);
  assert.equal(d.skinAdProgress.dragon, 2);
  assert.deepEqual(d.claimedMilestones, [1, 5]);
  assert.equal(d.stuckLevelId, 1);
  assert.equal(d.consecutiveFailures, 0);
  assert.equal(d.vibrateEnabled, true);

  sm.addCoins(Number.NaN);
  sm.addCoins(-10);
  assert.equal(sm.getData().coins, 0);
});
