import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

function createEngineHarness(prepopulateSave) {
  const typesMod = loadTs('src/game/types.ts');
  const adConfigMod = loadTs('src/config/adConfig.ts');
  const levelsMod = loadTs('src/config/levels.ts', { mocks: { types: typesMod } });
  const weaponsMod = loadTs('src/config/weapons.ts', {
    mocks: { types: typesMod, adConfig: adConfigMod },
  });
  const { SaveManager } = loadTs('src/game/SaveManager.ts', {
    mocks: { types: typesMod, levels: levelsMod },
  });

  let capturedSnap = null;
  const noop = () => {};
  const mockCtx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    setTransform: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    measureText: (t) => ({ width: String(t).length * 14 }),
    fillRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    fillText: noop,
  };

  const store = new Map();
  const fakeSdk = {
    getCanvas: () => ({ width: 720, height: 1280, getContext: () => mockCtx }),
    getViewport: () => ({
      width: 390,
      height: 844,
      pixelRatio: 1.5,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      safeTopLogical: 22,
    }),
    getLogicalSafeInsets: () => ({ top: 22, bottom: 0 }),
    getEffectiveAdPlatform: () => 'wechat',
    getSidebarStatus: () => ({ supported: false, fromSidebar: false }),
    getRecorderSnapshot: () => ({ hasVideo: false, durationSec: 0 }),
    startBattleRecording: noop,
    stopBattleRecording: noop,
    setMuted: noop,
    setVibrateEnabled: noop,
    vibrate: noop,
    playSound: noop,
    suspendAudio: noop,
    resumeAudio: noop,
    bindInput: () => noop,
    onResize: () => noop,
    onVisibilityChange: () => noop,
    getStorage: (k) => store.get(k) ?? null,
    setStorage: (k, v) => store.set(k, v),
    removeStorage: (k) => store.delete(k),
  };

  const saveManager = new SaveManager(fakeSdk);
  prepopulateSave?.(saveManager);

  const { GameEngine } = loadTs('src/game/GameEngine.ts', {
    mocks: {
      AssetLoader: {
        AssetLoader: class {
          isReady = true;
          loadedCount = 11;
          totalCount = 11;
          sprites = {};
          whiteSprites = {};
          cachedRoad = null;
          shadowOval = null;
          loadAll() {}
        },
      },
      Renderer: {
        Renderer: class {
          hitBoxes = { handleTap: () => false, clear: noop };
          render(snap) {
            capturedSnap = snap;
          }
        },
      },
      SaveManager: { SaveManager },
    },
  });

  const engine = new GameEngine(fakeSdk, saveManager);
  return {
    engine,
    saveManager,
    adConfigMod,
    levelsMod,
    weaponsMod,
    typesMod,
    getCapturedSnap: () => capturedSnap,
  };
}

test('首局分段引导：按木桶/增益门/尸王依次非打断展示，满 1.2 秒才持久化并复用结构体', () => {
  const { engine, saveManager } = createEngineHarness();
  engine.startGame('campaign', false);
  const bannerRef = engine.guideBanner;

  // 1. 首次生成木桶：触发高亮框 + 3秒指引横幅，绝不暂停战斗，此时尚未写入已看过
  engine.spawnSingleBarrel(360, -75, 0);
  const barrels = engine.barrelPool.getRawItems().filter((b) => b.active);
  assert.equal(barrels.length, 1);
  assert.equal(barrels[0].highlightGuide, true, '首个木桶高亮提示');
  assert.equal(engine.state, 'PLAYING', '触发指引绝不可暂停战斗');
  assert.equal(engine.guideBanner, bannerRef, '复用同一 guideBanner 结构体');
  assert.equal(engine.guideBanner.active, true);
  assert.equal(engine.guideBanner.stage, 'barrel');
  assert.equal(engine.guideBanner.text, '打爆数字木桶，立即换强力武器或加队友！');
  assert.equal(saveManager.hasSeenGuide('barrel'), false, '刚生成时不得立刻写入持久化已看过');

  // 展示未满 1.2 秒前仍未持久化；同阶段再刷第二个木桶也不重触发高亮
  for (let i = 0; i < 16; i++) {
    engine.update(0.05); // 0.8s < 1.2s
  }
  assert.equal(saveManager.hasSeenGuide('barrel'), false, '展示 0.8 秒小于 1.2 秒不应持久化');
  engine.spawnSingleBarrel(360, -75, 1);
  const secondBarrel = engine.barrelPool.getRawItems().filter((b) => b.active)[1];
  assert.equal(secondBarrel.highlightGuide, false);

  // 继续累计到满 1.2 秒 -> 正式持久化；后续再生成木桶不再激活引导
  for (let i = 0; i < 9; i++) {
    engine.update(0.05); // 0.8 + 0.45 = 1.25s >= 1.2s
  }
  assert.equal(saveManager.hasSeenGuide('barrel'), true, '战斗画面累计展示满 1.2 秒后持久化已看过');
  engine.guideBanner.active = false;
  engine.spawnSingleBarrel(360, -75, 2);
  assert.equal(engine.guideBanner.active, false);

  // 2. 首次出现增益门：非打断顶部引导，同样满 1.2 秒后再持久化
  engine.spawnGatePair();
  assert.equal(engine.state, 'PLAYING');
  assert.equal(engine.guideBanner.active, true);
  assert.equal(engine.guideBanner.stage, 'gate');
  assert.equal(engine.guideBanner.text, '射击红色大门可将其打蓝，穿过获得队友或射速加成！');
  assert.equal(saveManager.hasSeenGuide('gate'), false);
  for (let i = 0; i < 25; i++) {
    engine.update(0.05); // 1.25s >= 1.2s
  }
  assert.equal(saveManager.hasSeenGuide('gate'), true);

  // 3. 首次出现熔岩尸王：非打断顶部引导 + 满 1.2 秒持久化 + 3秒后淡出结束
  engine.spawnBoss();
  assert.equal(engine.state, 'PLAYING');
  assert.equal(engine.guideBanner.active, true);
  assert.equal(engine.guideBanner.stage, 'boss');
  assert.equal(engine.guideBanner.text, '注意躲避地面红圈和冲锋红道，破盾后全力输出！');
  assert.equal(saveManager.hasSeenGuide('boss'), false);

  for (let i = 0; i < 25; i++) {
    engine.update(0.05); // 1.25s
  }
  assert.equal(saveManager.hasSeenGuide('boss'), true);
  assert.equal(engine.guideBanner.active, true);

  for (let i = 0; i < 40; i++) {
    engine.update(0.05); // 总计 3.25s >= 3.0s
  }
  assert.equal(engine.guideBanner.active, false, '3秒后分段引导自然淡出关闭');
});

test('分段引导未满 1.2 秒切后台暂停或提前退出时不持久化，重进可再次触发', () => {
  const { engine, saveManager } = createEngineHarness();
  engine.startGame('campaign', false);

  engine.spawnSingleBarrel(360, -75, 0);
  for (let i = 0; i < 12; i++) {
    engine.update(0.05); // 0.6s < 1.2s
  }
  assert.equal(saveManager.hasSeenGuide('barrel'), false);

  // 切后台暂停：停留 2 秒也不累计 PLAYING 可见时长
  engine.pauseBattle();
  assert.equal(engine.state, 'PAUSED');
  for (let i = 0; i < 40; i++) {
    engine.update(0.05);
  }
  assert.equal(saveManager.hasSeenGuide('barrel'), false, '暂停状态不可累计引导可见时长或提前持久化');

  // 模拟退出后重新开局：因之前未展示满 1.2 秒，重进仍可完整再次触发引导
  engine.startGame('campaign', false);
  assert.equal(saveManager.hasSeenGuide('barrel'), false);
  engine.spawnSingleBarrel(360, -75, 0);
  const retriggeredBarrel = engine.barrelPool.getRawItems().filter((b) => b.active)[0];
  assert.equal(retriggeredBarrel.highlightGuide, true);
  assert.equal(engine.guideBanner.active, true);
  assert.equal(engine.guideBanner.stage, 'barrel');

  for (let i = 0; i < 25; i++) {
    engine.update(0.05); // 1.25s >= 1.2s
  }
  assert.equal(saveManager.hasSeenGuide('barrel'), true, '重进后展示满 1.2 秒才持久化');
});

test('局内超级空投：开启 8 秒非强制呼吸窗口，绝不强行弹窗，超时自然消失', () => {
  const { engine, adConfigMod } = createEngineHarness();
  engine.startGame('campaign', false);

  // 推进至空投触发窗口（duration - 10s）
  engine.elapsed = engine.currentLevel.duration - adConfigMod.AD_RULES.airdropLeadSec + 0.05;
  engine.updatePlaying(0.016);

  assert.equal(engine.airdrop.active, true, '空投呼吸按钮应开启');
  assert.equal(engine.airdrop.duration, 8.0);
  assert.ok(engine.airdrop.timer > 7.9 && engine.airdrop.timer <= 8.0);
  assert.equal(engine.state, 'PLAYING', '开启空投窗口绝不强行暂停或弹窗');

  // 模拟玩家一直躲避不点击按钮：4 秒后仍在 PLAYING 且未弹窗
  for (let i = 0; i < 80; i++) {
    engine.squadCount = 10;
    engine.updatePlaying(0.05);
  }
  assert.equal(engine.state, 'PLAYING');
  assert.equal(engine.airdrop.active, true);

  // 再经过 4.2 秒后超时自动关闭
  for (let i = 0; i < 84; i++) {
    engine.squadCount = 10;
    engine.updatePlaying(0.05);
  }
  assert.equal(engine.state, 'PLAYING');
  assert.equal(engine.airdrop.active, false, '8秒倒计时结束自动消失');

  // 第二次主动点击触发：重新激活空投并在点击后弹出选择窗
  engine.startGame('campaign', false);
  engine.elapsed = engine.currentLevel.duration - adConfigMod.AD_RULES.airdropLeadSec + 0.05;
  engine.updatePlaying(0.016);
  assert.equal(engine.airdrop.active, true);
  engine.renderActions.onTriggerAirdrop();
  assert.equal(engine.state, 'AIRDROP_MODAL', '仅玩家主动点击后才弹出空投选择遮罩');
});

test('复活恢复 6 名队友且首次通关第 1 关标记 justUnlockedEndless', () => {
  const { engine, saveManager, getCapturedSnap } = createEngineHarness();
  engine.startGame('campaign', false);
  engine.runCoins = 95;
  engine.squadCount = 0;
  engine.handleSquadZero();
  assert.equal(engine.state, 'REVIVE_MODAL');
  engine.render();
  assert.equal(getCapturedSnap().revivesRemaining, 1);

  engine.performRevive();
  assert.equal(engine.squadCount, 6, '复活应恢复 6 名队友');
  assert.equal(engine.state, 'PLAYING');
  engine.render();
  assert.equal(getCapturedSnap().revivesRemaining, 0);

  // 通关第 1 关 -> 标记首次解锁无尽狂潮
  engine.triggerGameOver(true);
  assert.equal(engine.state, 'RESULT');
  assert.equal(saveManager.isEndlessUnlocked(), true);
  engine.render();
  assert.equal(getCapturedSnap().justUnlockedEndless, true);
});

test('Renderer 主菜单首局减压、复活透明信息与结算页成长差额提示', () => {
  const { engine, typesMod, levelsMod, weaponsMod } = createEngineHarness();
  const canvasUiMod = loadTs('src/game/CanvasUI.ts', { mocks: { types: typesMod } });
  const { Renderer } = loadTs('src/game/Renderer.ts', {
    mocks: {
      GameEngine: {
        createTrooperBuffer: () => [],
        fillTrooperPositions: () => 0,
      },
      CanvasUI: canvasUiMod,
      types: typesMod,
      weapons: weaponsMod,
    },
  });

  const drawnTexts = [];
  const noop = () => {};
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    setTransform: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    measureText: (t) => ({ width: String(t).length * 14 }),
    fillRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    fillText: (text) => drawnTexts.push(String(text)),
  };
  const fakeAssets = {
    isReady: true,
    loadedCount: 11,
    totalCount: 11,
    sprites: { boss: {} },
    whiteSprites: {},
    cachedRoad: null,
    shadowOval: null,
  };
  const renderer = new Renderer(ctx, fakeAssets);
  const emptyPool = { getRawItems: () => [], forEachActive: noop };
  const dummyActions = new Proxy({}, { get: () => noop });

  const makeSnap = (totalRunsPlayed, overrides = {}) => ({
    renderScale: 1.5,
    mode: 'campaign',
    endlessWave: 1,
    totalSurviveSec: 0,
    isNewEndlessRecord: false,
    state: 'MENU',
    clock: 0,
    roadScroll: 0,
    shakeX: 0,
    shakeY: 0,
    damageVignette: 0,
    recoil: 0,
    muzzleFlash: 0,
    squadX: 360,
    squadCount: 2,
    weapon: weaponsMod.WEAPONS.pistol,
    doubleFireTimer: 0,
    invincibleTimer: 0,
    resumeGraceTimer: 0,
    weaponBanner: { active: false, timer: 0, duration: 1.2, weaponName: '', iconKey: '', accentColor: '#38bdf8' },
    guideBanner: { active: false, stage: '', text: '', accentColor: '#38bdf8', timer: 0, duration: 3 },
    themeBanner: { active: false, theme: 'normal', label: '', subLabel: '', accentColor: '#38bdf8', timer: 0, duration: 2 },
    stuckAssistActive: false,
    overflowAttackBonus: 0,
    hasArmoryRedDot: false,
    skin: weaponsMod.SKINS[0],
    level: levelsMod.getLevelConfig(1),
    elapsed: 0,
    bossSpawned: false,
    bossRef: null,
    bossState: engine.bossState,
    effectivePlatform: 'wechat',
    endlessUnlocked: false,
    tutorialAlpha: 0,
    sidebar: { supported: false, fromSidebar: false },
    recorder: { hasVideo: false, durationSec: 0 },
    canClaimSidebarReward: false,
    canClaimVideoReward: false,
    kills: 0,
    runCoins: 0,
    combo: 0,
    comboTimer: 0,
    comboPulse: 1,
    isVictory: false,
    justUnlockedEndless: false,
    milestoneCongrats: null,
    showStuckAssist: false,
    hasEliteTitle: false,
    hasPermanentCoinBonus: false,
    hasFinalHonorBadge: false,
    nextMilestone: levelsMod.getNextMilestone(1, []),
    reviveProgressPct: 0,
    revivesRemaining: 1,
    resultClaimed: false,
    airdrop: engine.airdrop,
    save: {
      coins: 0,
      bestKills: 0,
      unlockedLevel: 1,
      selectedLevel: 1,
      attackLevel: 1,
      fireRateLevel: 1,
      squadLevel: 2,
      equippedSkin: 'standard',
      skinAdProgress: { standard: 0, crimson: 0, pulse: 0, dragon: 0 },
      totalRunsPlayed,
      totalRewardedAds: 0,
      muted: false,
      vibrateEnabled: true,
      tutorialDone: false,
      guideSeen: { barrel: false, gate: false, boss: false },
      lastVideoShareRewardDate: '',
      lastSidebarRewardDate: '',
      endlessBestWave: 0,
      endlessBestKills: 0,
      endlessBestTimeSec: 0,
      claimedMilestones: [],
      stuckLevelId: 1,
      consecutiveFailures: 0,
      stuckAssistPending: false,
    },
    toast: null,
    safeTop: 22,
    upgradeCosts: { attack: 60, firerate: 60, squad: 120 },
    canAfford: { attack: false, firerate: false, squad: false },
    upgradeGap: { minCost: 60, canUpgradeNow: false, gap: 60, allMaxed: false },
    bullets: emptyPool,
    zombies: emptyPool,
    barrels: emptyPool,
    gates: emptyPool,
    particles: emptyPool,
    texts: emptyPool,
    bossFireballs: emptyPool,
    ...overrides,
  });

  // 1. 首局 (totalRunsPlayed = 0)：不推销满配广告按钮，突出「开始突围」，无尽锁定文案清晰
  drawnTexts.length = 0;
  renderer.render(makeSnap(0), dummyActions);
  const firstRunBoxes = renderer.hitBoxes.boxes.slice(0, renderer.hitBoxes.activeCount).map((b) => b.id);
  assert.equal(firstRunBoxes.includes('menu_super_start'), false, '首局菜单隐藏满配广告按钮');
  assert.equal(firstRunBoxes.includes('menu_start'), true);
  assert.ok(drawnTexts.includes('开始突围'));
  assert.ok(drawnTexts.includes('完成第 1 关解锁（奖励丰厚金币）'));

  // 2. 非首局 (totalRunsPlayed >= 1)：出现次级「看广告满配开局」按钮
  drawnTexts.length = 0;
  renderer.render(makeSnap(1), dummyActions);
  const secondRunBoxes = renderer.hitBoxes.boxes.slice(0, renderer.hitBoxes.activeCount).map((b) => b.id);
  assert.equal(secondRunBoxes.includes('menu_super_start'), true, '完成第 1 局后出现次级满配开局入口');
  assert.ok(drawnTexts.includes('看广告满配开局'));

  // 3. 战败复活弹窗透明收益说明
  drawnTexts.length = 0;
  renderer.render(
    makeSnap(1, { state: 'REVIVE_MODAL', runCoins: 88, revivesRemaining: 1 }),
    dummyActions,
  );
  assert.ok(drawnTexts.includes('本局已累计获得 88 金币'));
  assert.ok(drawnTexts.includes('复活立即恢复 6 名队友并清空周围尸潮'));
  assert.ok(drawnTexts.some((t) => t.includes('本局剩余 1 次')));

  // 4. 结算页：首次解锁无尽 + 升级差额精准引导 + 金币充足提示
  drawnTexts.length = 0;
  renderer.render(
    makeSnap(1, {
      state: 'RESULT',
      isVictory: true,
      justUnlockedEndless: true,
      runCoins: 40,
      upgradeGap: { minCost: 60, canUpgradeNow: false, gap: 20, allMaxed: false },
    }),
    dummyActions,
  );
  assert.ok(drawnTexts.includes('已解锁新模式：无尽狂潮！'));
  assert.ok(drawnTexts.includes('距离下次升级仅差 20 金币（看广告翻倍即可升级）'));

  drawnTexts.length = 0;
  renderer.render(
    makeSnap(2, {
      state: 'RESULT',
      mode: 'endless',
      endlessWave: 4,
      isNewEndlessRecord: true,
      runCoins: 100,
      upgradeGap: { minCost: 60, canUpgradeNow: true, gap: 0, allMaxed: false },
    }),
    dummyActions,
  );
  assert.ok(drawnTexts.includes('新纪录！最高波次突破至第 4 波！'));
  assert.ok(drawnTexts.includes('金币已充足，可回主界面升级战力！'));
});

test('36人满编溢出转化：木桶/蓝门溢出转攻击+4%(封顶+80%)与金币+20，触发主题关横幅与永久+15%金币', () => {
  const { applySquadOverflowBonus, MAX_OVERFLOW_ATTACK_BONUS } = loadTs('src/game/types.ts');

  const underCap = applySquadOverflowBonus(33, 2, 0);
  assert.deepEqual(underCap, {
    nextSquad: 35,
    overflowCount: 0,
    nextAttackBonus: 0,
    coinGain: 0,
  });

  const crossingCap = applySquadOverflowBonus(35, 3, 0);
  assert.deepEqual(crossingCap, {
    nextSquad: 36,
    overflowCount: 2,
    nextAttackBonus: 0.08,
    coinGain: 40,
  });

  const capped = applySquadOverflowBonus(36, 4, 0.72);
  assert.equal(capped.nextSquad, 36);
  assert.equal(capped.overflowCount, 4);
  assert.equal(capped.nextAttackBonus, MAX_OVERFLOW_ATTACK_BONUS);
  assert.equal(capped.coinGain, 80);

  // 引擎实测第 3 关（黄金木桶爽刷关）+ 第 10 关永久金币加成
  const { engine, saveManager } = createEngineHarness((sm) => {
    for (let id = 1; id <= 10; id++) sm.markLevelCleared(id, 15);
    sm.selectLevel(3);
  });
  engine.startGame('campaign', false);
  assert.equal(engine.themeBanner.active, true);
  assert.equal(engine.themeBanner.label, '黄金木桶爽刷关');
  engine.update(2.1);
  assert.equal(engine.themeBanner.active, false, '主题开场横幅 2 秒后自动淡出关闭');

  // 黄金木桶关每次双门皆为正收益蓝门
  engine.spawnGatePair();
  const spawnedGates = engine.gatePool.getRawItems().filter((g) => g.active);
  assert.equal(spawnedGates.length, 2);
  assert.ok(spawnedGates.every((g) => g.value > 0), '黄金木桶爽刷关应生成双正收益蓝门');

  // 36人满编后触发木桶/蓝门加人
  engine.squadCount = 36;
  const coinsBefore = engine.runCoins;
  engine.addSquadWithOverflow(2, 360, 600);
  assert.equal(engine.squadCount, 36);
  assert.equal(engine.overflowAttackBonus, 0.08);
  // 2 * 20 = 40 基础金币 * 1.15 永久加成 = 46 金币
  assert.equal(engine.runCoins - coinsBefore, 46);
  const floatTexts = engine.floatTextPool.getRawItems().filter((t) => t.active).map((t) => t.text);
  assert.ok(floatTexts.includes('满编强化：攻击提升！'));
});

test('连败2次结算页显示卡关助战按钮，且卡关助战仅单局生效', async () => {
  const { engine, saveManager, getCapturedSnap } = createEngineHarness((sm) => {
    sm.markLevelCleared(1, 15);
    sm.markLevelCleared(2, 15);
    sm.markLevelCleared(3, 15);
    sm.selectLevel(4);
    sm.recordLevelFailure(4);
    sm.recordLevelFailure(4);
  });

  engine.startGame('campaign', false);
  engine.triggerGameOver(false);
  engine.render();
  const snap = getCapturedSnap();
  assert.equal(snap.showStuckAssist, true, '第4关连败2次后结算页应激活卡关助战提示');

  // 使用无头 Canvas 校验 Renderer 真能渲染卡关助战按钮与主菜单里程碑预告
  const { Renderer } = loadTs('src/game/Renderer.ts', { mocks: { GameEngine: { createTrooperBuffer: () => [], fillTrooperPositions: () => 0 } } });
  const drawnTexts = [];
  const noop = () => {};
  const ctx = {
    canvas: { width: 720, height: 1280 },
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    setTransform: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    measureText: (t) => ({ width: String(t).length * 14 }),
    fillRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    fillText: (text) => drawnTexts.push(String(text)),
  };
  const fakeAssets = {
    sprites: {},
    whiteSprites: {},
    cachedRoad: null,
    shadowOval: null,
    loadAll() {},
  };
  const renderer = new Renderer(ctx, fakeAssets);
  const actions = new Proxy({}, { get: () => noop });
  renderer.render(snap, actions);
  const assistIds = renderer.hitBoxes.boxes.slice(0, renderer.hitBoxes.activeCount).map((b) => b.id);
  assert.ok(assistIds.includes('res_stuck_assist'));
  assert.ok(drawnTexts.includes('卡关助战：看广告借用满级传说武器 1 局'));

  // 看广告借用后进入助战局，随后重开普通局助战应失效
  saveManager.armStuckAssist(4);
  engine.startGame('campaign', false);
  assert.equal(engine.stuckAssistActive, true);
  assert.equal(engine.weaponId, 'gatling');
  assert.equal(engine.squadCount >= 5, true);

  engine.startGame('campaign', false);
  assert.equal(engine.stuckAssistActive, false, '卡关助战为单局临时强化，下一正常局自动失效');
});
