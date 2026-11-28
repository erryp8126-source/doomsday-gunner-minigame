import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

function createEngineHarness(prepopulateSave, options = {}) {
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
  let stopRecordingCalls = 0;
  let startRecordingCalls = 0;
  let resumeAudioCalls = 0;
  let suspendAudioCalls = 0;
  let visibilityOnHide = null;
  let visibilityOnShow = null;
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
    startBattleRecording: () => {
      startRecordingCalls += 1;
    },
    stopBattleRecording: () => {
      stopRecordingCalls += 1;
    },
    setMuted: noop,
    setVibrateEnabled: noop,
    vibrate: noop,
    playSound: noop,
    suspendAudio: () => {
      suspendAudioCalls += 1;
    },
    resumeAudio: () => {
      resumeAudioCalls += 1;
    },
    bindInput: () => noop,
    onResize: () => noop,
    onVisibilityChange: (onHide, onShow) => {
      visibilityOnHide = onHide;
      visibilityOnShow = onShow;
      return noop;
    },
    getStorage: (k) => store.get(k) ?? null,
    setStorage: (k, v) => store.set(k, v),
    removeStorage: (k) => store.delete(k),
  };

  const saveManager = new SaveManager(fakeSdk);
  prepopulateSave?.(saveManager);

  const engineMod = loadTs('src/game/GameEngine.ts', {
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
  const { GameEngine } = engineMod;

  const engine = new GameEngine(fakeSdk, saveManager, options.adHooks);
  return {
    engine,
    engineMod,
    saveManager,
    adConfigMod,
    levelsMod,
    weaponsMod,
    typesMod,
    getCapturedSnap: () => capturedSnap,
    getStopRecordingCalls: () => stopRecordingCalls,
    getStartRecordingCalls: () => startRecordingCalls,
    getResumeAudioCalls: () => resumeAudioCalls,
    getSuspendAudioCalls: () => suspendAudioCalls,
    triggerVisibilityShow: () => visibilityOnShow?.(),
    triggerVisibilityHide: () => visibilityOnHide?.(),
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

test('H3/H4: Boss 冲锋破盾进入 STUNNED 不秒杀且平滑回撤；击杀 Boss 后同帧子弹循环立即中止', () => {
  // 1. H3: 冲锋期间破盾进入 STUNNED，不触发 loss=99 贴脸秒杀并向 chargeReturnY 撤退
  const { engine } = createEngineHarness();
  engine.startGame('campaign', false);
  engine.squadCount = 5;
  engine.spawnBoss();
  const boss = engine.bossRef;
  boss.hp = 800;
  boss.x = engine.squadX;
  boss.y = 950;
  engine.bossState.action = 'CHARGE_DASH';
  engine.bossState.chargeReturnY = 280;
  engine.bossState.shieldActive = true;
  engine.bossState.shieldHp = 10;
  engine.bossState.shieldMaxHp = 500;

  engine.applyZombieDamage(boss, 50, false, false, boss.x, boss.y);
  assert.equal(engine.bossState.action, 'STUNNED');
  assert.equal(engine.bossState.shieldActive, false);

  engine.updateZombies(0.05);
  assert.equal(engine.state, 'PLAYING', 'STUNNED 期间不得触发贴脸 loss=99 团灭');
  assert.equal(engine.squadCount, 5);
  assert.ok(boss.y < 950, '破盾眩晕后 Boss 应平滑退回安全纵坐标');

  // 2. H4: 击杀 Boss 后立即中止同帧剩余子弹判定，后续木桶不被同帧误打爆
  engine.startGame('campaign', false);
  engine.spawnBoss();
  const boss2 = engine.bossRef;
  boss2.hp = 5;
  boss2.x = 360;
  boss2.y = 320;
  engine.bossState.action = 'PATROL';

  const barrel = engine.barrelPool.acquire();
  barrel.x = 360;
  barrel.y = 180;
  barrel.hp = 5;
  barrel.maxHp = 5;
  barrel.radius = 52;

  const b1 = engine.bulletPool.acquire();
  b1.x = 360;
  b1.y = 320;
  b1.vx = 0;
  b1.vy = -1000;
  b1.damage = 50;
  b1.radius = 8;
  b1.splash = 0;

  const b2 = engine.bulletPool.acquire();
  b2.x = 360;
  b2.y = 180;
  b2.vx = 0;
  b2.vy = -1000;
  b2.damage = 50;
  b2.radius = 8;
  b2.splash = 0;

  engine.updateBulletsAndCollisions(0.001);
  assert.equal(engine.state, 'RESULT');
  assert.equal(engine.isVictory, true);
  assert.equal(barrel.active, true, '击杀 Boss 切入结算后，同帧剩余子弹不得再打爆后续木桶');
  assert.equal(barrel.hp, 5);
});

test('H5/M1/M4/M5/M6/M7: 子弹池扩容320、录屏生命周期、广告中不恢复音频、异步重置隔离、无尽溢出与高胶囊不越界', async () => {
  let resolveAd = null;
  const h = createEngineHarness(undefined, {
    adHooks: {
      requestRewarded: () =>
        new Promise((resolve) => {
          resolveAd = resolve;
        }),
    },
  });
  const { engine, engineMod } = h;

  // H5: 8人霰弹连发5轮(200发)不得被 FIFO 提前覆写
  assert.ok(engineMod.MAX_BULLET_POOL >= 320);
  engine.startGame('campaign', false);
  engine.weaponId = 'shotgun';
  engine.squadCount = 8;
  let firstShotBullet = null;
  for (let i = 0; i < 5; i++) {
    engine.fireSquad();
    if (i === 0) {
      firstShotBullet = engine.bulletPool.getRawItems().find((b) => b.active);
    }
  }
  assert.equal(engine.bulletPool.activeCount, 200);
  assert.equal(firstShotBullet.active, true);

  // M1: 暂停返回菜单 / 重开须停止抖音录屏
  const prevStops = h.getStopRecordingCalls();
  engine.pauseBattle();
  await engine.renderActions.onBackToMenu();
  assert.equal(h.getStopRecordingCalls(), prevStops + 1, '暂停返回主菜单须调用 stopBattleRecording');

  engine.startGame('campaign', false);
  engine.pauseBattle();
  await engine.renderActions.onRestartBattle();
  assert.equal(h.getStopRecordingCalls(), prevStops + 2, '暂停重开须调用 stopBattleRecording');

  // M4: pausedByAd=true 期间触发 onShow 不得恢复游戏音频
  const origRaf = globalThis.requestAnimationFrame;
  const origCancelRaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    engine.start();
    const resumeBefore = h.getResumeAudioCalls();
    engine.setAdPause(true);
    h.triggerVisibilityShow();
    assert.equal(h.getResumeAudioCalls(), resumeBefore, '广告展示期间切回前台不得提前恢复游戏音频');
    engine.setAdPause(false);
    assert.equal(h.getResumeAudioCalls(), resumeBefore + 1);
    engine.destroy();
  } finally {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancelRaf;
  }

  // M5: await 激励广告期间被重置存档后，旧广告回调不得强行开局
  engine.renderActions.onStartSuperBattle();
  engine.syncSaveAfterReset();
  assert.equal(engine.state, 'MENU');
  resolveAd(true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(engine.state, 'MENU', '状态版本号变更后旧广告回调必须放弃续接');

  // M6: 无尽模式 36 人满编过波与杀 Boss 正确走溢出转化
  engine.startGame('endless', false);
  engine.squadCount = 36;
  const bonus0 = engine.overflowAttackBonus;
  const coins0 = engine.runCoins;
  engine.advanceEndlessToNextWave();
  assert.equal(engine.squadCount, 36);
  assert.ok(engine.overflowAttackBonus > bonus0, '无尽过波满编应增加溢出攻击加成');
  assert.ok(engine.runCoins > coins0, '无尽过波满编应获得溢出金币');

  engine.spawnBoss();
  const bonus1 = engine.overflowAttackBonus;
  engine.killZombie(engine.bossRef);
  assert.equal(engine.squadCount, 36);
  assert.ok(engine.overflowAttackBonus > bonus1, '无尽击破尸王满编应增加溢出攻击加成');

  // M7: 高胶囊安全区 (safeTop=200) + 主题关时，主菜单 Boss 展示不得越界压盖战绩栏 (y=480+40=520)
  const { Renderer } = loadTs('src/game/Renderer.ts', {
    mocks: {
      GameEngine: { createTrooperBuffer: () => [], fillTrooperPositions: () => 0 },
    },
  });
  const drawnImages = [];
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
    drawImage: (_img, _x, y, _w, h) => drawnImages.push({ y, h }),
    measureText: (t) => ({ width: String(t).length * 14 }),
    fillRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    fillText: noop,
  };
  const renderer = new Renderer(ctx, {
    isReady: true,
    loadedCount: 11,
    totalCount: 11,
    sprites: { boss: {} },
    whiteSprites: {},
    cachedRoad: null,
    shadowOval: null,
  });
  engine.setState('MENU');
  engine.render();
  const menuSnap = {
    ...h.getCapturedSnap(),
    state: 'MENU',
    safeTop: 200,
    level: h.levelsMod.getLevelConfig(3),
  };
  renderer.render(menuSnap, new Proxy({}, { get: () => noop }));
  for (const imgCall of drawnImages) {
    assert.ok(imgCall.y + imgCall.h <= 520, `主菜单 Boss 高度不得越界压盖下方战绩栏 (${imgCall.y + imgCall.h})`);
  }
});

test('射速余数累加：60fps/30fps 下加特林 2 级严格快于 1 级且单帧最多补射 2 次', () => {
  const measureShots = (fireRateLevel, fps, totalSec) => {
    let shots = 0;
    const { engine } = createEngineHarness((sm) => {
      sm.getData().fireRateLevel = fireRateLevel;
    });
    engine.sdk.playSound = (name) => {
      if (name === 'gatling') shots += 1;
    };
    engine.startGame('campaign', false);
    engine.weaponId = 'gatling';
    engine.squadCount = 1;
    const steps = Math.round(totalSec * fps);
    const dt = 1 / fps;
    for (let i = 0; i < steps; i++) {
      engine.zombieTimer = 999;
      engine.barrelTimer = 999;
      engine.gateTimer = 999;
      engine.update(dt);
    }
    return shots;
  };

  const lv1Shots60 = measureShots(1, 60, 10);
  const lv2Shots60 = measureShots(2, 60, 10);
  assert.ok(
    lv2Shots60 > lv1Shots60,
    `60fps 下 2 级加特林射速应严格高于 1 级（lv1=${lv1Shots60}, lv2=${lv2Shots60}）`,
  );

  const lv1Shots30 = measureShots(1, 30, 10);
  const lv2Shots30 = measureShots(2, 30, 10);
  assert.ok(
    lv2Shots30 > lv1Shots30,
    `30fps 下 2 级加特林射速应严格高于 1 级（lv1=${lv1Shots30}, lv2=${lv2Shots30}）`,
  );

  // 单帧大 dt（0.3s）补射次数严格封顶 2 次，不会一次性倾泻超量齐射
  let spikeShots = 0;
  const { engine: spikeEngine } = createEngineHarness((sm) => {
    sm.getData().fireRateLevel = 20;
  });
  spikeEngine.sdk.playSound = (name) => {
    if (name === 'gatling') spikeShots += 1;
  };
  spikeEngine.startGame('campaign', false);
  spikeEngine.weaponId = 'gatling';
  spikeEngine.fireCd = 0.01;
  spikeEngine.update(0.3);
  assert.equal(spikeShots, 2);
});

test('满配霰弹 + 20级射速 + 2.6x加成 + 空投双倍：DPS 不归零且在飞子弹不溢出 320 子弹池', () => {
  const { engine } = createEngineHarness((sm) => {
    const d = sm.getData();
    d.attackLevel = 20;
    d.fireRateLevel = 20;
    d.equippedSkin = 'pulse';
  });
  engine.startGame('campaign', false);
  engine.weaponId = 'shotgun';
  engine.squadCount = 36;
  engine.fireRateBonus = 2.6;
  engine.doubleFireTimer = 15;
  engine.combo = 50;

  // 1) 空场最坏情况（无怪阻挡、子弹飞满整条赛道）：检验峰值在飞子弹严格低于 320
  let peakBulletsEmpty = 0;
  for (let i = 0; i < 120; i++) {
    engine.zombieTimer = 999;
    engine.barrelTimer = 999;
    engine.gateTimer = 999;
    engine.comboTimer = 2.7;
    engine.doubleFireTimer = 15;
    engine.update(1 / 60);
    if (engine.bulletPool.activeCount > peakBulletsEmpty) {
      peakBulletsEmpty = engine.bulletPool.activeCount;
    }
  }
  assert.ok(
    peakBulletsEmpty > 0 && peakBulletsEmpty < 320,
    `空场满配霰弹峰值子弹(${peakBulletsEmpty})应小于池上限 320`,
  );

  // 2) 前方放置超大血量靶子：确认折算后 DPS 稳定命中且无损输出
  const target = engine.zombiePool.acquire();
  target.x = 360;
  target.y = 360;
  target.hp = 5_000_000;
  target.maxHp = 5_000_000;
  target.speed = 0;
  target.radius = 220;
  target.kind = 'normal';
  target.isBoss = false;
  target.dying = false;

  let hpAt1s = 0;
  for (let i = 0; i < 120; i++) {
    engine.zombieTimer = 999;
    engine.barrelTimer = 999;
    engine.gateTimer = 999;
    engine.comboTimer = 2.7;
    engine.doubleFireTimer = 15;
    target.y = 360;
    engine.update(1 / 60);
    if (i === 59) hpAt1s = target.hp;
  }
  const secondWindowDamage = hpAt1s - target.hp;
  assert.ok(
    secondWindowDamage > 150_000,
    `满配霰弹稳定阶段每秒有效伤害应完整折算输出（实测=${secondWindowDamage}）`,
  );
});

test('暂停重开未结算局保留卡关助战，以及非 9:16 偏移下 Renderer 所有 setTransform 带 ox/oy', async () => {
  const { engine, getCapturedSnap } = createEngineHarness((sm) => {
    sm.markLevelCleared(1, 15);
    sm.selectLevel(2);
    sm.armStuckAssist(2);
  });

  engine.startGame('campaign', false);
  assert.equal(engine.stuckAssistActive, true);
  assert.equal(engine.weaponId, 'gatling');

  // 暂停且未结算 -> 点击「重新开始」应保留助战
  engine.pauseBattle();
  assert.equal(engine.state, 'PAUSED');
  await engine.renderActions.onRestartBattle();
  assert.equal(engine.stuckAssistActive, true, '战斗中暂停重开且未结算应保留卡关助战');
  assert.equal(engine.weaponId, 'gatling');
  assert.equal(engine.fireRateBonus, 1.35);

  // 结算后点「再次挑战」则清空单局助战
  engine.triggerGameOver(false);
  await engine.renderActions.onRestartBattle();
  assert.equal(engine.stuckAssistActive, false, '结算后重开不再保留单局卡关助战');

  // 验证 Renderer 在 renderOffsetX=64, renderOffsetY=32 与震屏叠加时，全部 setTransform 含偏移
  const { Renderer } = loadTs('src/game/Renderer.ts', {
    mocks: { GameEngine: { createTrooperBuffer: () => [{ x: 360, y: 1140 }], fillTrooperPositions: () => 1 } },
  });
  const transforms = [];
  const noop = () => {};
  const ctx = {
    canvas: { width: 1200, height: 2000 },
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
    setTransform: (...args) => transforms.push(args),
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
  const fakeAssets = { sprites: {}, whiteSprites: {}, cachedRoad: null, shadowOval: null, loadAll() {} };
  const renderer = new Renderer(ctx, fakeAssets);
  engine.startGame('campaign', false);
  const zombie = engine.zombiePool.acquire();
  zombie.x = 300;
  zombie.y = 500;
  zombie.dying = false;

  engine.render();
  const snap = {
    ...getCapturedSnap(),
    state: 'PLAYING',
    renderScale: 1.5,
    renderOffsetX: 64,
    renderOffsetY: 32,
    shakeX: 6,
    shakeY: -4,
  };
  const actions = new Proxy({}, { get: () => noop });
  renderer.render(snap, actions);

  assert.ok(transforms.length >= 6, `应捕获入口、丧尸、士兵与复位多次 setTransform（实际=${transforms.length}）`);
  assert.deepEqual(transforms[0], [1.5, 0, 0, 1.5, 64 + 1.5 * 6, 32 + 1.5 * -4]);
  assert.deepEqual(transforms.at(-1), [1.5, 0, 0, 1.5, 64, 32]);
  for (const [, , , , e, f] of transforms) {
    assert.ok(e >= 64 - 20 && f >= 32 - 20, `所有 setTransform 均应携带舞台居中偏移 (64, 32): e=${e}, f=${f}`);
  }
});
