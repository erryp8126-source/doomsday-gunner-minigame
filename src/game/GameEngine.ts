import { AD_RULES } from '../config/adConfig';
import {
  LEVELS,
  getEndlessWaveConfig,
  getLevelConfig,
  getLevelThemeMeta,
  getNextMilestone,
} from '../config/levels';
import { SKINS, WEAPONS, getSkinDef } from '../config/weapons';
import type { PlatformSDK } from '../sdk/PlatformSDK';
import { AssetLoader } from './AssetLoader';
import { ObjectPool } from './ObjectPool';
import { Renderer, type RenderActions, type RenderSnapshot } from './Renderer';
import { SaveManager } from './SaveManager';
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MAX_SQUAD_CAP,
  PLAYER_Y,
  ROAD_LEFT,
  ROAD_RIGHT,
  ROAD_W,
  applySquadOverflowBonus,
  clamp,
  type AirdropCrate,
  type Barrel,
  type BarrelRewardType,
  type BossCombatState,
  type BossFireball,
  type Bullet,
  type DamageText,
  type GameMode,
  type GameState,
  type Gate,
  type GuideBannerState,
  type GuideStageKey,
  type LevelTheme,
  type MilestoneDef,
  type Particle,
  type SkinDef,
  type ThemeBannerState,
  type ToastMessage,
  type UpgradeGapInfo,
  type WeaponBannerState,
  type WeaponId,
  type Zombie,
  type ZombieKind,
} from './types';

export interface AdHooks {
  onStateChanged?: (state: GameState) => void;
  requestRewarded?: (
    scene:
      | 'pre_battle_boost'
      | 'airdrop_supply'
      | 'revive_clear'
      | 'result_double'
      | 'result_triple'
      | 'armory_unlock'
      | 'stuck_assist',
    label: string,
  ) => Promise<boolean>;
  tryInterstitial?: (sceneLabel: string) => Promise<void>;
}

export interface TrooperPoint {
  x: number;
  y: number;
}

export interface PerfMetrics {
  fps: number;
  avgFrameMs: number;
  maxFrameMs: number;
  avgWorkMs: number;
  maxWorkMs: number;
  bullets: number;
  zombies: number;
  barrels: number;
  gates: number;
  particles: number;
  texts: number;
  squadCount: number;
  weaponId: WeaponId;
  dpr: number;
}

export const MAX_VISIBLE_TROOPERS = 16;

export function createTrooperBuffer(): TrooperPoint[] {
  const buf: TrooperPoint[] = [];
  for (let i = 0; i < MAX_VISIBLE_TROOPERS; i++) {
    buf.push({ x: 0, y: 0 });
  }
  return buf;
}

/**
 * 小队同心环站位计算：就地写入预分配缓冲并返回有效人数（零每帧数组/对象分配）
 */
export function fillTrooperPositions(
  count: number,
  cx: number,
  cy: number,
  out: TrooperPoint[],
): number {
  const vis = Math.min(Math.max(1, count), Math.min(MAX_VISIBLE_TROOPERS, out.length));
  for (let i = 0; i < vis; i++) {
    const pt = out[i];
    if (i === 0) {
      pt.x = cx;
      pt.y = cy;
    } else {
      const ring = i <= 6 ? 1 : 2;
      const idx = ring === 1 ? i - 1 : i - 7;
      const cap = ring === 1 ? 6 : 9;
      const ang = (idx / cap) * Math.PI * 2 + ring * 0.45;
      const r = ring * 34;
      pt.x = clamp(cx + Math.cos(ang) * r, ROAD_LEFT + 22, ROAD_RIGHT - 22);
      pt.y = cy + Math.sin(ang) * (r * 0.68);
    }
  }
  return vis;
}

const SHARED_TROOPER_QUERY_BUF = createTrooperBuffer();
const SHARED_TROOPER_QUERY_VIEWS = createTrooperBuffer();

/**
 * 小队同心环站位兼容读取接口（复用模块级静态缓冲）
 */
export function getTrooperPositions(
  count: number,
  cx: number,
  cy: number,
): readonly TrooperPoint[] {
  const vis = fillTrooperPositions(count, cx, cy, SHARED_TROOPER_QUERY_BUF);
  SHARED_TROOPER_QUERY_VIEWS.length = vis;
  for (let i = 0; i < vis; i++) {
    SHARED_TROOPER_QUERY_VIEWS[i] = SHARED_TROOPER_QUERY_BUF[i];
  }
  return SHARED_TROOPER_QUERY_VIEWS;
}

const BARREL_PICKS: ReadonlyArray<{
  type: BarrelRewardType;
  weapon: WeaponId;
  val: number;
  label: string;
  iconKey: Barrel['iconKey'];
  hpScale: number;
}> = [
  { type: 'weapon', weapon: 'shotgun', val: 1, label: '连发霰弹', iconKey: 'weapon_shotgun', hpScale: 1.52 },
  { type: 'weapon', weapon: 'gatling', val: 1, label: '重型加特林', iconKey: 'weapon_gatling', hpScale: 1.70 },
  { type: 'weapon', weapon: 'rocket', val: 1, label: '高爆火箭筒', iconKey: 'weapon_rocket', hpScale: 1.72 },
  { type: 'squad', weapon: 'pistol', val: 2, label: '队友 +2', iconKey: '', hpScale: 1.40 },
  { type: 'squad', weapon: 'pistol', val: 3, label: '队友 +3', iconKey: '', hpScale: 1.56 },
  { type: 'rate', weapon: 'pistol', val: 0.2, label: '射速 +20%', iconKey: '', hpScale: 1.42 },
];

const BARREL_LANE_XS: readonly [number, number, number] = [
  ROAD_LEFT + ROAD_W * 0.24,
  LOGICAL_WIDTH / 2,
  ROAD_LEFT + ROAD_W * 0.76,
];

const GUIDE_PERSIST_VISIBLE_SEC = 1.2;

/**
 * 《末日枪手突围》2D 精绘核心引擎（对齐原型手感 + 全对象池 + 5 大 IAA 商业化闭环）
 */
export class GameEngine {
  private readonly sdk: PlatformSDK;
  private readonly saveManager: SaveManager;
  private readonly assetLoader: AssetLoader;
  private readonly renderer: Renderer;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly adHooks: AdHooks;

  private state: GameState = 'MENU';
  private mode: GameMode = 'campaign';
  private pausedByAd = false;
  private stateBeforePause: GameState = 'PLAYING';
  private rafId = 0;
  private lastTimestamp = 0;
  private clock = 0;
  private roadScroll = 0;
  private gatePairSeq = 1;

  private squadX = LOGICAL_WIDTH / 2;
  private targetX = LOGICAL_WIDTH / 2;
  private keyAxis = 0;
  private squadCount = 2;
  private weaponId: WeaponId = 'pistol';
  private fireRateBonus = 1;
  private doubleFireTimer = 0;
  private invincibleTimer = 0;
  private resumeGraceTimer = 0;
  private readonly weaponBanner: WeaponBannerState = {
    active: false,
    timer: 0,
    duration: 1.2,
    weaponName: '',
    iconKey: '',
    accentColor: '#38bdf8',
  };
  private readonly guideBanner: GuideBannerState = {
    active: false,
    stage: '',
    text: '',
    accentColor: '#38bdf8',
    timer: 0,
    duration: 3.0,
  };
  private readonly themeBanner: ThemeBannerState = {
    active: false,
    theme: 'normal',
    label: '',
    subLabel: '',
    accentColor: '#38bdf8',
    timer: 0,
    duration: 2.0,
  };
  private pendingGuideStage: GuideStageKey | '' = '';
  private pendingGuideVisibleSec = 0;
  private readonly upgradeGapCache: UpgradeGapInfo = {
    minCost: 60,
    canUpgradeNow: false,
    gap: 60,
    allMaxed: false,
  };
  private justUnlockedEndless = false;
  private milestoneCongrats: MilestoneDef | null = null;
  private overflowAttackBonus = 0;
  private stuckAssistActive = false;

  private fireCd = 0;
  private recoil = 0;
  private muzzleFlash = 0;
  private shakeTimer = 0;
  private shakePower = 0;
  private damageVignette = 0;

  private currentLevel = getLevelConfig(1);
  private endlessWave = 1;
  private totalSurviveSec = 0;
  private isNewEndlessRecord = false;
  private elapsed = 0;
  private zombieTimer = 0.55;
  private barrelTimer = 1.5;
  private gateTimer = 6.5;
  private bossSpawned = false;
  private bossRef: Zombie | null = null;

  private kills = 0;
  private runCoins = 0;
  private runCoinsExact = 0;
  private combo = 0;
  private maxCombo = 0;
  private comboTimer = 0;
  private comboPulse = 1;
  private isVictory = false;
  private revivesUsedThisRun = 0;
  private airdropTriggeredThisRun = false;
  private resultClaimed = false;
  private hazardHurtCd = 0;
  private tutorialActive = false;
  private tutorialTimer = 0;
  private tutorialDragAccum = 0;
  private tutorialFade = 0;
  private toast: ToastMessage | null = null;
  private unbindFns: Array<() => void> = [];
  private currentDpr = 1.5;
  private canvasScale = 1.5;
  private readonly fireTrooperBuf = createTrooperBuffer();
  private perfWindowStartMs = 0;
  private perfFrameCount = 0;
  private perfFrameMsSum = 0;
  private perfFrameMsMax = 0;
  private perfWorkMsSum = 0;
  private perfWorkMsMax = 0;
  private readonly perfMetrics: PerfMetrics = {
    fps: 60,
    avgFrameMs: 16.7,
    maxFrameMs: 16.7,
    avgWorkMs: 0,
    maxWorkMs: 0,
    bullets: 0,
    zombies: 0,
    barrels: 0,
    gates: 0,
    particles: 0,
    texts: 0,
    squadCount: 2,
    weaponId: 'pistol',
    dpr: 1.5,
  };
  private readonly renderActions: RenderActions;
  private readonly renderSnapshot: RenderSnapshot;

  private readonly bossState: BossCombatState = {
    alertPending: false,
    alertTimer: 0,
    alertDuration: 1.5,
    action: 'ENTERING',
    patrolDir: 1,
    patrolSpeed: 105,
    baseY: 280,
    advanceTimer: 12,
    fireballCd: 2.5,
    chargeCd: 4.2,
    chargeTargetX: LOGICAL_WIDTH / 2,
    chargeHalfWidth: 56,
    chargeTimer: 0,
    chargeDuration: 1.2,
    chargeHitApplied: false,
    chargeReturnY: 280,
    shieldTriggered: false,
    shieldActive: false,
    shieldHp: 0,
    shieldMaxHp: 0,
    shieldTimer: 0,
    shieldDuration: 6,
    stunTimer: 0,
    shockwaveFlash: 0,
  };

  private readonly bossFireballPool = new ObjectPool<BossFireball>(
    () => ({
      active: false,
      startX: 0,
      startY: 0,
      targetX: 0,
      targetY: 0,
      radius: 48,
      timer: 0,
      duration: 1.1,
      explodeFlash: 0,
      exploded: false,
    }),
    12,
    12,
  );

  private readonly airdrop: AirdropCrate = {
    active: false,
    x: LOGICAL_WIDTH / 2,
    y: -60,
    speed: 145,
    claimed: false,
    timer: 0,
    duration: 8.0,
  };

  private readonly bulletPool = new ObjectPool<Bullet>(
    () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      damage: 10,
      radius: 6,
      color: '#ffe066',
      splash: 0,
    }),
    120,
    120,
  );

  private readonly zombiePool = new ObjectPool<Zombie>(
    () => ({
      active: false,
      x: 0,
      y: 0,
      hp: 20,
      maxHp: 20,
      speed: 120,
      radius: 28,
      scale: 1,
      kind: 'normal',
      hitFlash: 0,
      phase: 0,
      isBoss: false,
      dying: false,
      vx: 0,
      vy: 0,
      rot: 0,
      vrot: 0,
      dieLife: 0,
      rageStage: 0,
      rageTimer: 0,
    }),
    160,
  );

  private readonly barrelPool = new ObjectPool<Barrel>(
    () => ({
      active: false,
      x: 0,
      y: 0,
      hp: 20,
      maxHp: 20,
      speed: 150,
      radius: 52,
      rewardType: 'squad',
      rewardWeapon: 'shotgun',
      rewardVal: 2,
      rewardLabel: '队友 +2',
      iconKey: '',
      hitScale: 1,
      hitFlash: 0,
      highlightGuide: false,
    }),
    24,
  );

  private readonly gatePool = new ObjectPool<Gate>(
    () => ({
      active: false,
      x: 0,
      y: 0,
      w: 158,
      h: 78,
      speed: 168,
      kind: 'squad',
      value: 2,
      pairId: 0,
      used: false,
      hitFlash: 0,
      hitAccum: 0,
    }),
    16,
  );

  private readonly particlePool = new ObjectPool<Particle>(
    () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.4,
      size: 7,
      color: '#ffffff',
    }),
    80,
    80,
  );

  private readonly floatTextPool = new ObjectPool<DamageText>(
    () => ({
      active: false,
      x: 0,
      y: 0,
      vy: -95,
      text: '',
      color: '#ffffff',
      life: 0,
      maxLife: 0.75,
      size: 28,
    }),
    18,
    18,
  );

  constructor(sdk: PlatformSDK, saveManager: SaveManager, adHooks: AdHooks = {}) {
    this.sdk = sdk;
    this.saveManager = saveManager;
    this.adHooks = adHooks;
    this.assetLoader = new AssetLoader(sdk);

    const canvas = this.sdk.getCanvas();
    const ctx =
      (canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | null) ||
      canvas.getContext('2d');
    if (!ctx) {
      throw new Error('画布上下文初始化失败');
    }
    this.ctx = ctx;
    this.renderer = new Renderer(ctx, this.assetLoader);
    this.syncCanvasResolution();

    const initSave = this.saveManager.getData();
    const initLevel = getLevelConfig(initSave.selectedLevel);
    this.currentLevel = initLevel;

    this.renderSnapshot = {
      renderScale: this.canvasScale,
      mode: this.mode,
      endlessWave: this.endlessWave,
      totalSurviveSec: this.totalSurviveSec,
      isNewEndlessRecord: this.isNewEndlessRecord,
      state: this.state,
      clock: this.clock,
      roadScroll: this.roadScroll,
      shakeX: 0,
      shakeY: 0,
      damageVignette: this.damageVignette,
      recoil: this.recoil,
      muzzleFlash: this.muzzleFlash,
      squadX: this.squadX,
      squadCount: this.squadCount,
      weapon: WEAPONS[this.weaponId],
      doubleFireTimer: this.doubleFireTimer,
      invincibleTimer: this.invincibleTimer,
      resumeGraceTimer: this.resumeGraceTimer,
      weaponBanner: this.weaponBanner,
      guideBanner: this.guideBanner,
      themeBanner: this.themeBanner,
      stuckAssistActive: false,
      overflowAttackBonus: 0,
      hasArmoryRedDot: false,
      skin: getSkinDef(initSave.equippedSkin),
      level: initLevel,
      elapsed: this.elapsed,
      bossSpawned: this.bossSpawned,
      bossRef: this.bossRef,
      bossState: this.bossState,
      effectivePlatform: this.sdk.getEffectiveAdPlatform(),
      endlessUnlocked: this.saveManager.isEndlessUnlocked(),
      tutorialAlpha: 0,
      sidebar: this.sdk.getSidebarStatus(),
      recorder: this.sdk.getRecorderSnapshot(),
      canClaimSidebarReward: this.saveManager.canClaimDailySidebarReward(),
      canClaimVideoReward: this.saveManager.canClaimDailyVideoReward(),
      kills: this.kills,
      runCoins: this.runCoins,
      combo: this.combo,
      comboTimer: this.comboTimer,
      comboPulse: this.comboPulse,
      isVictory: this.isVictory,
      justUnlockedEndless: this.justUnlockedEndless,
      milestoneCongrats: null,
      showStuckAssist: false,
      hasEliteTitle: this.saveManager.hasEliteTitle(),
      hasPermanentCoinBonus: this.saveManager.hasPermanentCoinBonus(),
      hasFinalHonorBadge: this.saveManager.hasFinalHonorBadge(),
      nextMilestone: getNextMilestone(initSave.unlockedLevel, initSave.claimedMilestones),
      reviveProgressPct: 0,
      revivesRemaining: AD_RULES.maxRevivesPerRun,
      resultClaimed: this.resultClaimed,
      airdrop: this.airdrop,
      save: initSave,
      toast: this.toast,
      safeTop: 0,
      upgradeCosts: { attack: 0, firerate: 0, squad: 0 },
      canAfford: { attack: false, firerate: false, squad: false },
      upgradeGap: this.upgradeGapCache,
      bullets: this.bulletPool,
      zombies: this.zombiePool,
      barrels: this.barrelPool,
      gates: this.gatePool,
      particles: this.particlePool,
      texts: this.floatTextPool,
      bossFireballs: this.bossFireballPool,
    };

    this.renderActions = {
      onStartSuperBattle: async () => {
        const ok = await this.requestRewardedAction('pre_battle_boost', '重型加特林与五人满配开局');
        if (ok) {
          this.startGame('campaign', true);
        }
      },
      onStartBattle: () => this.startGame('campaign', false),
      onStartEndless: () => {
        if (!this.saveManager.isEndlessUnlocked()) {
          this.showToast('完成第 1 关解锁无尽狂潮（奖励丰厚金币）', '#fbbf24');
          return;
        }
        this.startGame('endless', false);
      },
      onPrevLevel: () => {
        const curSave = this.saveManager.getData();
        this.saveManager.selectLevel(curSave.selectedLevel - 1);
        this.currentLevel = getLevelConfig(this.saveManager.getData().selectedLevel);
      },
      onNextLevel: () => {
        const curSave = this.saveManager.getData();
        this.saveManager.selectLevel(curSave.selectedLevel + 1);
        this.currentLevel = getLevelConfig(this.saveManager.getData().selectedLevel);
      },
      onUpgradeAttack: () => {
        if (this.saveManager.upgrade('attack')) {
          const cur = this.saveManager.getData().attackLevel;
          this.sdk.playSound('gate_pos');
          this.sdk.vibrate('light');
          this.showToast(`基础攻击 +12%（当前 ${cur} 级）`, '#4ade80');
        }
      },
      onUpgradeFireRate: () => {
        if (this.saveManager.upgrade('firerate')) {
          const cur = this.saveManager.getData().fireRateLevel;
          this.sdk.playSound('gate_pos');
          this.sdk.vibrate('light');
          this.showToast(`初始射速 +8%（当前 ${cur} 级）`, '#4ade80');
        }
      },
      onUpgradeSquad: () => {
        if (this.saveManager.upgrade('squad')) {
          const cur = this.saveManager.getData().squadLevel;
          this.sdk.playSound('gate_pos');
          this.sdk.vibrate('light');
          this.showToast(`初始人数 +1（当前 ${cur} 人）`, '#4ade80');
        }
      },
      onOpenArmory: () => this.setState('ARMORY'),
      onCloseArmory: () => this.setState('MENU'),
      onArmorySkinAction: (sk) => {
        void this.handleSkinAction(sk);
      },
      onTriggerAirdrop: () => this.openAirdropModal(),
      onAirdropChooseRocket: async () => {
        const ok = await this.requestRewardedAction('airdrop_supply', '空投高爆火箭筒');
        if (ok) {
          this.airdrop.active = false;
          this.airdrop.claimed = true;
          this.weaponId = 'rocket';
          this.triggerWeaponBanner('rocket');
          this.showToast('已装备高爆火箭筒', '#fb923c');
          this.setState('PLAYING');
        }
      },
      onAirdropChooseDouble: async () => {
        const ok = await this.requestRewardedAction('airdrop_supply', '全队火力翻倍十五秒');
        if (ok) {
          this.airdrop.active = false;
          this.airdrop.claimed = true;
          this.doubleFireTimer = AD_RULES.doubleFireDurationSec;
          this.showToast('全队火力翻倍十五秒已启动', '#fbbf24');
          this.setState('PLAYING');
        }
      },
      onAirdropDismiss: () => {
        this.airdrop.active = false;
        this.airdrop.claimed = true;
        this.setState('PLAYING');
      },
      onReviveWatchAd: async () => {
        const ok = await this.requestRewardedAction('revive_clear', '原地复活并清屏');
        if (ok) {
          this.performRevive();
        }
      },
      onReviveGiveUp: () => this.triggerGameOver(false),
      onResultClaimNormal: () => this.claimResultCoins(1),
      onResultClaimAd: async () => {
        const isTriple =
          this.isVictory ||
          (this.mode === 'endless' && (this.endlessWave >= 3 || this.isNewEndlessRecord));
        const scene = isTriple ? 'result_triple' : 'result_double';
        const mult = isTriple ? 3 : 2;
        const ok = await this.requestRewardedAction(scene, `${mult}倍金币奖励`);
        if (ok) {
          this.claimResultCoins(mult);
        }
      },
      onRestartBattle: async () => {
        if (this.state === 'PAUSED') {
          this.sdk.resumeAudio();
        }
        if (this.state === 'RESULT' && !this.resultClaimed) {
          this.claimResultCoins(1);
        }
        if (this.state === 'RESULT' && this.adHooks.tryInterstitial) {
          await this.adHooks.tryInterstitial('局后重开插屏');
        }
        this.startGame(this.mode, false);
      },
      onBackToMenu: async () => {
        if (this.state === 'PAUSED') {
          this.sdk.resumeAudio();
        }
        if (this.state === 'RESULT' && !this.resultClaimed) {
          this.claimResultCoins(1);
        }
        if (this.state === 'RESULT' && this.adHooks.tryInterstitial) {
          await this.adHooks.tryInterstitial('返回主菜单插屏');
        }
        this.currentLevel = getLevelConfig(this.saveManager.getData().selectedLevel);
        this.setState('MENU');
      },
      onTogglePause: () => {
        if (this.state === 'PLAYING') {
          this.pauseBattle();
        } else if (this.state === 'PAUSED') {
          this.resumeBattle();
        }
      },
      onToggleMute: () => {
        const next = !this.saveManager.getData().muted;
        this.saveManager.setMuted(next);
        this.sdk.setMuted(next);
        this.showToast(next ? '已开启静音' : '已开启音效');
      },
      onOpenAgeModal: () => this.setState('AGE_MODAL'),
      onCloseAgeModal: () => this.setState('MENU'),
      onToggleVibrate: () => {
        const next = !this.saveManager.getData().vibrateEnabled;
        this.saveManager.setVibrateEnabled(next);
        this.sdk.setVibrateEnabled(next);
        if (next) {
          this.sdk.vibrate('light');
        }
        this.showToast(next ? '已开启震动反馈' : '已关闭震动反馈');
      },
      onClickSidebarGift: () => {
        if (!this.saveManager.canClaimDailySidebarReward()) {
          this.showToast('今日侧边栏复访礼已领取', '#94a3b8');
          return;
        }
        if (this.sdk.getSidebarStatus().fromSidebar) {
          if (this.saveManager.claimDailySidebarReward(200)) {
            this.sdk.playSound('victory');
            this.sdk.vibrate('medium');
            this.showToast('侧边栏复访礼到账！获得 200 金币', '#4ade80');
          }
          return;
        }
        this.sdk.navigateToSidebar();
        this.showToast('请从侧边栏重新进入游戏领取 200 金币', '#fde047', 2.4);
      },
      onShareScore: () => {
        const shareMsg =
          this.mode === 'endless'
            ? `我在末日枪手突围无尽狂潮守到第${this.endlessWave}波，消灭${this.kills}名丧尸！`
            : `我在末日枪手突围第${this.currentLevel.id}关消灭了${this.kills}名丧尸，等你来战！`;
        void this.sdk.shareScore(shareMsg).then((res) => {
          this.showToast(res.message, res.shared ? '#4ade80' : '#fbbf24');
        });
      },
      onShareHighlightVideo: () => {
        const videoTitle =
          this.mode === 'endless'
            ? `末日狂潮第${this.endlessWave}波斩杀${this.kills}只丧尸高能集锦`
            : `末日突围第${this.currentLevel.id}关击退熔岩尸王高能时刻`;
        void this.sdk.shareRecordedVideo(videoTitle).then((res) => {
          if (!res.shared) {
            this.showToast(res.message, '#fbbf24');
            return;
          }
          if (this.saveManager.claimDailyVideoReward(150)) {
            this.sdk.playSound('victory');
            this.sdk.vibrate('medium');
            this.showToast('视频发布成功！首发布奖励 150 金币', '#fde047', 2.6);
          } else {
            this.showToast(res.message, '#4ade80');
          }
        });
      },
      onStartStuckAssist: async () => {
        if (this.mode !== 'campaign' || this.isVictory) return;
        const ok = await this.requestRewardedAction(
          'stuck_assist',
          '卡关助战：借用满级传说武器 1 局',
        );
        if (!ok) return;
        if (!this.resultClaimed) {
          this.claimResultCoins(1);
        }
        this.saveManager.armStuckAssist(this.currentLevel.id);
        this.startGame('campaign', false);
      },
    };
  }

  public start(): void {
    const data = this.saveManager.getData();
    this.sdk.setMuted(data.muted);
    this.sdk.setVibrateEnabled(data.vibrateEnabled);
    this.currentLevel = getLevelConfig(data.selectedLevel);
    this.assetLoader.loadAll();

    this.unbindFns.push(
      this.sdk.bindInput({
        onTap: (lx, ly) => {
          if (this.pausedByAd) return;
          const hit = this.renderer.hitBoxes.handleTap(lx, ly);
          if (hit) {
            this.sdk.playSound('click');
          }
        },
        onDragStart: () => {},
        onDragMove: (_lx, _ly, deltaX) => {
          if (this.state === 'PLAYING' && !this.pausedByAd) {
            if (this.tutorialActive) {
              this.tutorialDragAccum += Math.abs(deltaX);
            }
            this.targetX = clamp(
              this.targetX + deltaX * 1.15,
              ROAD_LEFT + 30,
              ROAD_RIGHT - 30,
            );
          }
        },
        onDragEnd: () => {},
        onKeyAxis: (axis) => {
          this.keyAxis = axis;
        },
      }),
    );

    this.unbindFns.push(this.sdk.onResize(() => this.syncCanvasResolution()));
    this.unbindFns.push(
      this.sdk.onVisibilityChange(
        () => {
          if (this.state === 'PLAYING') {
            this.pauseBattle();
          } else {
            this.sdk.suspendAudio();
          }
        },
        () => {
          if (this.state !== 'PAUSED') {
            this.sdk.resumeAudio();
          }
        },
      ),
    );

    this.setState('MENU');

    this.lastTimestamp = performance.now();
    this.perfWindowStartMs = this.lastTimestamp;
    const tick = (now: number) => {
      const workStart = performance.now();
      const rawDtMs = Math.max(0.1, now - this.lastTimestamp);
      const dt = Math.min(0.05, Math.max(0.001, rawDtMs / 1000));
      this.lastTimestamp = now;

      this.update(dt);
      this.render();
      const workMs = performance.now() - workStart;

      this.perfFrameCount += 1;
      this.perfFrameMsSum += rawDtMs;
      if (rawDtMs > this.perfFrameMsMax) {
        this.perfFrameMsMax = rawDtMs;
      }
      this.perfWorkMsSum += workMs;
      if (workMs > this.perfWorkMsMax) {
        this.perfWorkMsMax = workMs;
      }
      const windowSpan = now - this.perfWindowStartMs;
      if (windowSpan >= 500) {
        this.perfMetrics.fps = Math.round((this.perfFrameCount * 1000) / windowSpan);
        this.perfMetrics.avgFrameMs = Number((this.perfFrameMsSum / this.perfFrameCount).toFixed(1));
        this.perfMetrics.maxFrameMs = Number(this.perfFrameMsMax.toFixed(1));
        this.perfMetrics.avgWorkMs = Number((this.perfWorkMsSum / this.perfFrameCount).toFixed(2));
        this.perfMetrics.maxWorkMs = Number(this.perfWorkMsMax.toFixed(2));
        this.perfWindowStartMs = now;
        this.perfFrameCount = 0;
        this.perfFrameMsSum = 0;
        this.perfFrameMsMax = 0;
        this.perfWorkMsSum = 0;
        this.perfWorkMsMax = 0;
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    for (const fn of this.unbindFns) fn();
    this.unbindFns = [];
  }

  public setAdPause(paused: boolean): void {
    this.pausedByAd = paused;
    if (paused) {
      this.sdk.suspendAudio();
    } else {
      this.sdk.resumeAudio();
      this.lastTimestamp = performance.now();
      this.perfWindowStartMs = this.lastTimestamp;
      this.perfFrameCount = 0;
      this.perfFrameMsSum = 0;
      this.perfFrameMsMax = 0;
      this.perfWorkMsSum = 0;
      this.perfWorkMsMax = 0;
    }
  }

  public getPerfMetrics(): PerfMetrics {
    this.perfMetrics.bullets = this.bulletPool.activeCount;
    this.perfMetrics.zombies = this.zombiePool.activeCount;
    this.perfMetrics.barrels = this.barrelPool.activeCount;
    this.perfMetrics.gates = this.gatePool.activeCount;
    this.perfMetrics.particles = this.particlePool.activeCount;
    this.perfMetrics.texts = this.floatTextPool.activeCount;
    this.perfMetrics.squadCount = this.squadCount;
    this.perfMetrics.weaponId = this.weaponId;
    this.perfMetrics.dpr = this.currentDpr;
    return this.perfMetrics;
  }

  /** 仅限浏览器调试台调用：一键进入重型加特林+10人小队+狂暴尸王极限压测场景 */
  public startStressTest(): void {
    this.startGame('campaign', true);
    this.weaponId = 'gatling';
    this.squadCount = 10;
    this.fireRateBonus = 1.4;
    this.elapsed = Math.max(this.elapsed, this.currentLevel.duration);
    this.spawnBoss();
    if (this.bossRef) {
      this.bossRef.y = 280;
      this.bossRef.maxHp = 18000;
      this.bossRef.hp = Math.floor(this.bossRef.maxHp * 0.64);
      this.bossState.action = 'PATROL';
      this.bossState.fireballCd = 0.8;
      this.bossState.chargeCd = 3.2;
      this.checkBossRage(this.bossRef);
    }
    this.spawnZombieWave(ROAD_LEFT + ROAD_W * 0.3, 12, 170);
    this.spawnZombieWave(ROAD_LEFT + ROAD_W * 0.7, 12, 210);
    this.perfWindowStartMs = performance.now();
    this.perfFrameCount = 0;
    this.perfFrameMsSum = 0;
    this.perfFrameMsMax = 0;
    this.perfWorkMsSum = 0;
    this.perfWorkMsMax = 0;
    this.showToast('已启动极限压测：重型加特林十人小队迎战狂暴尸王', '#fde047', 2.6);
  }

  /** 仅限浏览器调试台调用：一键解锁全关卡与无尽狂潮模式 */
  public unlockAllForDebug(): void {
    this.saveManager.unlockAllForDebug(LEVELS.length);
    this.showToast('已解锁全部关卡与无尽狂潮模式', '#4ade80');
  }

  public syncSaveAfterReset(): void {
    const data = this.saveManager.getData();
    this.currentLevel = getLevelConfig(data.selectedLevel);
    this.sdk.setMuted(data.muted);
    this.sdk.setVibrateEnabled(data.vibrateEnabled);
    this.setState('MENU');
    this.showToast('本地存档已重置', '#38bdf8');
  }

  private setState(next: GameState): void {
    this.state = next;
    this.adHooks.onStateChanged?.(next);
  }

  private syncCanvasResolution(): void {
    const vp = this.sdk.getViewport();
    const canvas = this.sdk.getCanvas();
    const clampedDpr = Math.min(vp.pixelRatio || 1, 1.5);
    this.currentDpr = clampedDpr;
    canvas.width = Math.round(LOGICAL_WIDTH * clampedDpr);
    canvas.height = Math.round(LOGICAL_HEIGHT * clampedDpr);
    const scale = canvas.width / LOGICAL_WIDTH;
    this.canvasScale = scale;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  public showToast(text: string, color = '#fbbf24', duration = 2.1): void {
    this.toast = { text, color, timer: duration, duration };
  }

  private addShake(power: number, duration: number): void {
    this.shakePower = Math.max(this.shakePower, power);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  private resetBossState(): void {
    const bs = this.bossState;
    bs.alertPending = false;
    bs.alertTimer = 0;
    bs.alertDuration = 1.5;
    bs.action = 'ENTERING';
    bs.patrolDir = 1;
    bs.patrolSpeed = this.currentLevel.bossPatrolSpeed;
    bs.baseY = 280;
    bs.advanceTimer = 12;
    bs.fireballCd = 2.5;
    bs.chargeCd = 4.2;
    bs.chargeTargetX = LOGICAL_WIDTH / 2;
    bs.chargeHalfWidth = 56;
    bs.chargeTimer = 0;
    bs.chargeDuration = 1.2;
    bs.chargeHitApplied = false;
    bs.chargeReturnY = 280;
    bs.shieldTriggered = false;
    bs.shieldActive = false;
    bs.shieldHp = 0;
    bs.shieldMaxHp = 0;
    bs.shieldTimer = 0;
    bs.shieldDuration = 6;
    bs.stunTimer = 0;
    bs.shockwaveFlash = 0;
    this.hazardHurtCd = 0;
    this.bossFireballPool.releaseAll();
  }

  private startGame(mode: GameMode, withSuperStart: boolean): void {
    this.mode = mode;
    this.endlessWave = 1;
    this.totalSurviveSec = 0;
    this.isNewEndlessRecord = false;
    this.currentLevel =
      mode === 'endless'
        ? getEndlessWaveConfig(1)
        : getLevelConfig(this.saveManager.getData().selectedLevel);

    this.bulletPool.releaseAll();
    this.zombiePool.releaseAll();
    this.barrelPool.releaseAll();
    this.gatePool.releaseAll();
    this.particlePool.releaseAll();
    this.floatTextPool.releaseAll();
    this.resetBossState();

    const skin = getSkinDef(this.saveManager.getData().equippedSkin);
    const baseSquad = this.saveManager.getInitialSquadSize() + skin.startSquadBonus;
    const assistActive =
      mode === 'campaign' && this.saveManager.consumeStuckAssist(this.currentLevel.id);
    this.stuckAssistActive = assistActive;
    const assistSquad = assistActive ? 3 : 0;

    this.squadX = LOGICAL_WIDTH / 2;
    this.targetX = LOGICAL_WIDTH / 2;
    this.squadCount = Math.min(
      MAX_SQUAD_CAP,
      (withSuperStart ? Math.max(5, baseSquad + 3) : baseSquad) + assistSquad,
    );
    this.weaponId = assistActive || withSuperStart ? 'gatling' : 'pistol';
    this.fireRateBonus = assistActive ? 1.35 : 1;
    this.overflowAttackBonus = 0;
    this.doubleFireTimer = 0;
    this.invincibleTimer = 0;
    this.resumeGraceTimer = 0;
    this.weaponBanner.active = false;
    this.weaponBanner.timer = 0;
    this.guideBanner.active = false;
    this.guideBanner.stage = '';
    this.guideBanner.timer = 0;
    this.pendingGuideStage = '';
    this.pendingGuideVisibleSec = 0;
    this.justUnlockedEndless = false;
    this.milestoneCongrats = null;

    if (this.currentLevel.theme !== 'normal') {
      this.triggerThemeBanner(this.currentLevel.theme);
    } else {
      this.themeBanner.active = false;
      this.themeBanner.theme = 'normal';
      this.themeBanner.timer = 0;
    }

    this.fireCd = 0;
    this.recoil = 0;
    this.muzzleFlash = 0;
    this.shakeTimer = 0;
    this.damageVignette = 0;

    this.elapsed = 0;
    this.zombieTimer = 0.55;
    this.barrelTimer = this.currentLevel.theme === 'gold' ? 0.8 : 1.5;
    this.gateTimer = this.currentLevel.theme === 'gold' ? 3.5 : 6.5;
    this.bossSpawned = false;
    this.bossRef = null;

    this.kills = 0;
    this.runCoins = 0;
    this.runCoinsExact = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.comboPulse = 1;
    this.isVictory = false;
    this.revivesUsedThisRun = 0;
    this.airdropTriggeredThisRun = false;
    this.resultClaimed = false;
    this.airdrop.active = false;
    this.airdrop.claimed = false;
    this.airdrop.timer = 0;
    this.airdrop.duration = 8.0;

    this.saveManager.incrementRunCount();
    if (!this.saveManager.getData().tutorialDone) {
      this.tutorialActive = true;
      this.tutorialTimer = 0;
      this.tutorialDragAccum = 0;
      this.tutorialFade = 1;
    } else {
      this.tutorialActive = false;
      this.tutorialTimer = 0;
      this.tutorialDragAccum = 0;
      this.tutorialFade = 0;
    }
    this.sdk.startBattleRecording();
    this.setState('PLAYING');

    if (assistActive) {
      this.showToast(`卡关助战已激活！满级传说火力与 ${this.squadCount} 名队友出击`, '#fbbf24', 2.6);
    } else if (withSuperStart) {
      this.showToast(`满配开局！重型加特林与 ${this.squadCount} 名队友出击`, '#4ade80');
    } else if (mode === 'endless') {
      this.showToast('无尽狂潮第1波 · 准备迎战', '#c084fc');
    } else {
      this.showToast(`第${this.currentLevel.id}关·${this.currentLevel.name} · 准备迎战`);
    }
  }

  private async requestRewardedAction(
    scene:
      | 'pre_battle_boost'
      | 'airdrop_supply'
      | 'revive_clear'
      | 'result_double'
      | 'result_triple'
      | 'armory_unlock'
      | 'stuck_assist',
    label: string,
  ): Promise<boolean> {
    if (this.adHooks.requestRewarded) {
      return this.adHooks.requestRewarded(scene, label);
    }
    const res = await this.sdk.showRewardedVideoRaw(scene, label);
    if (!res.rewarded) {
      this.showToast(res.message, '#f87171');
    }
    return res.rewarded;
  }

  private triggerGameOver(victory: boolean): void {
    this.isVictory = victory;
    this.justUnlockedEndless = false;
    this.milestoneCongrats = null;
    this.sdk.stopBattleRecording();
    this.resetBossState();
    this.saveManager.recordBestKills(this.kills);

    if (this.mode === 'endless') {
      const rec = this.saveManager.recordEndlessResult(
        this.endlessWave,
        this.kills,
        Math.floor(this.totalSurviveSec),
      );
      this.isNewEndlessRecord = rec.isNewRecord;
      this.runCoins = Math.max(30, this.runCoins);
      this.runCoinsExact = this.runCoins;
      this.sdk.playSound('defeat');
      this.sdk.vibrate('medium');
    } else if (victory) {
      const wasUnlocked = this.saveManager.isEndlessUnlocked();
      this.addRunCoins(this.currentLevel.clearCoins, false);
      const { newlyClaimedMilestone } = this.saveManager.markLevelCleared(
        this.currentLevel.id,
        LEVELS.length,
      );
      this.milestoneCongrats = newlyClaimedMilestone;
      this.justUnlockedEndless = !wasUnlocked && this.saveManager.isEndlessUnlocked();
      this.sdk.playSound('victory');
      this.sdk.vibrate('heavy');
    } else {
      this.saveManager.recordLevelFailure(this.currentLevel.id);
      this.runCoins = Math.max(20, this.runCoins);
      this.runCoinsExact = this.runCoins;
      this.sdk.playSound('defeat');
      this.sdk.vibrate('medium');
    }
    this.setState('RESULT');
  }

  private claimResultCoins(multiplier: number): void {
    if (this.resultClaimed) return;
    this.resultClaimed = true;
    const reward = this.runCoins * multiplier;
    this.saveManager.addCoins(reward);
    this.showToast(`已领取 ${reward} 金币`, '#4ade80');
  }

  private update(dt: number): void {
    this.clock += dt;
    if (this.toast) {
      this.toast.timer -= dt;
      if (this.toast.timer <= 0) this.toast = null;
    }
    if (this.damageVignette > 0) {
      this.damageVignette = Math.max(0, this.damageVignette - dt * 1.5);
    }
    if (this.pausedByAd) return;

    if (this.state === 'PLAYING') {
      this.updatePlaying(dt);
    } else if (this.state === 'MENU' || this.state === 'ARMORY') {
      this.roadScroll = (this.roadScroll + dt * 110) % (LOGICAL_HEIGHT * 2);
    }
    this.updateEffects(dt);
  }

  private updatePlaying(dt: number): void {
    this.elapsed += dt;
    this.totalSurviveSec += dt;
    this.roadScroll = (this.roadScroll + dt * 360) % (LOGICAL_HEIGHT * 2);

    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
    if (this.shakeTimer > 0) this.shakeTimer -= dt;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 55);
    if (this.doubleFireTimer > 0) this.doubleFireTimer = Math.max(0, this.doubleFireTimer - dt);
    if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    if (this.resumeGraceTimer > 0) this.resumeGraceTimer = Math.max(0, this.resumeGraceTimer - dt);
    if (this.weaponBanner.active) {
      this.weaponBanner.timer = Math.max(0, this.weaponBanner.timer - dt);
      if (this.weaponBanner.timer <= 0) {
        this.weaponBanner.active = false;
      }
    }
    if (this.guideBanner.active) {
      if (this.pendingGuideStage && this.state === 'PLAYING') {
        this.pendingGuideVisibleSec += dt;
        if (this.pendingGuideVisibleSec >= GUIDE_PERSIST_VISIBLE_SEC) {
          this.saveManager.markGuideSeen(this.pendingGuideStage);
          this.pendingGuideStage = '';
          this.pendingGuideVisibleSec = 0;
        }
      }
      this.guideBanner.timer = Math.max(0, this.guideBanner.timer - dt);
      if (this.guideBanner.timer <= 0) {
        this.guideBanner.active = false;
        this.guideBanner.stage = '';
        this.pendingGuideStage = '';
        this.pendingGuideVisibleSec = 0;
      }
    }
    if (this.themeBanner.active) {
      this.themeBanner.timer = Math.max(0, this.themeBanner.timer - dt);
      if (this.themeBanner.timer <= 0) {
        this.themeBanner.active = false;
      }
    }
    if (this.hazardHurtCd > 0) this.hazardHurtCd = Math.max(0, this.hazardHurtCd - dt);
    if (this.bossState.shockwaveFlash > 0) {
      this.bossState.shockwaveFlash = Math.max(0, this.bossState.shockwaveFlash - dt);
    }

    if (this.keyAxis !== 0) {
      const keyMove = this.keyAxis * 500 * dt;
      this.targetX += keyMove;
      if (this.tutorialActive) {
        this.tutorialDragAccum += Math.abs(keyMove);
      }
    }
    this.targetX = clamp(this.targetX, ROAD_LEFT + 30, ROAD_RIGHT - 30);
    this.squadX += (this.targetX - this.squadX) * Math.min(1, dt * 18);

    if (this.tutorialActive) {
      this.tutorialTimer += dt;
      if (this.tutorialDragAccum >= 95 || this.tutorialTimer >= 5.0) {
        this.tutorialActive = false;
        this.saveManager.markTutorialDone();
      }
    } else if (this.tutorialFade > 0) {
      this.tutorialFade = Math.max(0, this.tutorialFade - dt * 2.5);
    }

    const lv = this.currentLevel;
    const skin = getSkinDef(this.saveManager.getData().equippedSkin);
    const comboRateMult = this.combo >= 50 ? 1.25 : this.combo >= 25 ? 1.15 : 1.0;
    const totalRateMult =
      this.fireRateBonus *
      this.saveManager.getFireRateMultiplier() *
      (1 + skin.fireRateBonus) *
      comboRateMult *
      (this.doubleFireTimer > 0 ? 1.65 : 1);

    const w = WEAPONS[this.weaponId];
    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.fireSquad();
      this.fireCd = 1 / (w.fireRate * totalRateMult);
    }

    // 局内超级空投（尸王登场前 10 秒出现 8 秒非强制右侧呼吸入口，绝不强行弹窗打断）
    if (
      !this.airdropTriggeredThisRun &&
      !this.bossSpawned &&
      this.elapsed >= Math.max(8, lv.duration - AD_RULES.airdropLeadSec)
    ) {
      this.airdropTriggeredThisRun = true;
      this.airdrop.active = true;
      this.airdrop.claimed = false;
      this.airdrop.duration = 8.0;
      this.airdrop.timer = 8.0;
    }

    if (this.airdrop.active && !this.airdrop.claimed) {
      this.airdrop.timer = Math.max(0, this.airdrop.timer - dt);
      if (this.airdrop.timer <= 0) {
        this.airdrop.active = false;
      }
    }

    const isBossWave = this.mode === 'campaign' || this.endlessWave % 2 === 0;

    // 尸王登场 1.5 秒红色警戒演出与正式入场（无尽模式每逢偶数波登场强化尸王，奇数波满 40 秒直接推进波次）
    if (!this.bossSpawned && !this.bossState.alertPending && this.elapsed >= lv.duration) {
      if (isBossWave) {
        this.triggerBossAlert();
      } else {
        this.advanceEndlessToNextWave();
      }
    } else if (this.bossState.alertPending) {
      this.bossState.alertTimer -= dt;
      this.addShake(4, 0.12);
      if (this.bossState.alertTimer <= 0) {
        this.bossState.alertPending = false;
        this.bossState.alertTimer = 0;
        this.spawnBoss();
      }
    }

    this.zombieTimer -= dt;
    if (this.zombieTimer <= 0) {
      this.spawnZombieWave();
      const isSpeedTheme = lv.theme === 'speed';
      const warmupSec = isSpeedTheme ? 5 : 12;
      if (this.bossSpawned || this.bossState.alertPending) {
        this.zombieTimer = isSpeedTheme ? 2.2 : 2.8;
      } else if (this.elapsed < warmupSec) {
        this.zombieTimer = isSpeedTheme
          ? Math.max(1.25, 1.55 - (this.elapsed / warmupSec) * 0.25)
          : Math.max(1.75, 2.05 - (this.elapsed / 12) * 0.25);
      } else {
        const p = Math.min(1, this.elapsed / lv.duration);
        const ramp = Math.min(
          1,
          (this.elapsed - warmupSec) / Math.max(10, lv.duration - warmupSec),
        );
        const baseInterval = Math.max(0.85, 2.05 - p * 0.95 - (Math.min(5, lv.id) - 1) * 0.08);
        const rawInterval = baseInterval * (1 - 0.25 * ramp);
        this.zombieTimer = isSpeedTheme
          ? Math.max(0.48, rawInterval * 0.76)
          : Math.max(0.62, rawInterval);
      }
    }

    this.barrelTimer -= dt;
    if (this.barrelTimer <= 0) {
      this.spawnBarrel();
      const baseBarrelInterval = 4.6 + Math.random() * 1.5;
      this.barrelTimer = lv.theme === 'gold' ? baseBarrelInterval * 0.5 : baseBarrelInterval;
    }

    this.gateTimer -= dt;
    if (this.gateTimer <= 0 && !this.bossSpawned && !this.bossState.alertPending) {
      this.spawnGatePair();
      this.gateTimer = lv.theme === 'gold' ? 5.6 : 11.2;
    }

    this.updateBulletsAndCollisions(dt);
    if (this.state !== 'PLAYING') return;

    this.updateBarrels(dt);
    if (this.state !== 'PLAYING') return;

    this.updateGates(dt);
    if (this.state !== 'PLAYING') return;

    this.updateZombies(dt);
    if (this.state !== 'PLAYING') return;

    this.updateBossFireballs(dt);
  }

  private fireSquad(): void {
    const w = WEAPONS[this.weaponId];
    const skin = getSkinDef(this.saveManager.getData().equippedSkin);
    const shooters = Math.min(this.squadCount, 8);
    const overflowMult = this.squadCount > 8 ? 1 + (this.squadCount - 8) * 0.08 : 1;
    const totalDmgMult =
      overflowMult *
      (1 + this.overflowAttackBonus) *
      (this.stuckAssistActive ? 1.6 : 1) *
      this.saveManager.getAttackMultiplier() *
      (1 + skin.damageBonus) *
      (this.doubleFireTimer > 0 ? 2 : 1);

    const vis = fillTrooperPositions(shooters, this.squadX, PLAYER_Y, this.fireTrooperBuf);
    for (let i = 0; i < vis; i++) {
      const p = this.fireTrooperBuf[i];
      for (let k = 0; k < w.pellets; k++) {
        const b = this.bulletPool.acquire();
        const ang =
          (Math.random() - 0.5) * w.spread +
          (w.pellets > 1 ? (k / (w.pellets - 1) - 0.5) * w.spread : 0);
        b.x = p.x + 12;
        b.y = p.y - 44;
        b.vx = Math.sin(ang) * w.bulletSpeed;
        b.vy = -Math.cos(ang) * w.bulletSpeed;
        b.damage = w.damage * totalDmgMult;
        b.radius = w.radius;
        b.color = skin.id === 'standard' ? w.color : skin.bulletTint;
        b.splash = w.splash;
      }
    }

    this.muzzleFlash = 0.06;
    this.recoil = 7;
    this.sdk.playSound(w.id);
  }

  private spawnZombieWave(
    overrideLaneX?: number,
    overrideCount?: number,
    overrideBaseY?: number,
  ): void {
    if (this.zombiePool.activeCount >= 125) return;
    const lv = this.currentLevel;
    const prog = Math.min(1, this.elapsed / lv.duration);
    const ramp = this.elapsed >= 12 ? Math.min(1, (this.elapsed - 12) / Math.max(10, lv.duration - 12)) : 0;
    const extraCount = this.elapsed >= 12 ? 2 + Math.floor(ramp * 2.4) : 0;
    const count =
      overrideCount ??
      3 +
        Math.floor(prog * 5) +
        extraCount +
        Math.floor(Math.min(6, lv.id) * 0.5) +
        Math.floor(Math.random() * 2);
    const baseHp = Math.floor((20 + prog * 54) * lv.hpMult);
    const cx = overrideLaneX ?? ROAD_LEFT + 55 + Math.random() * (ROAD_W - 110);
    const spreadX = overrideLaneX !== undefined ? 75 : 145;

    for (let i = 0; i < count; i++) {
      const z = this.zombiePool.acquire();
      const r = Math.random();
      let kind: ZombieKind = 'normal';
      let hp = baseHp;
      let speed = 124 + prog * 48;
      let scale = 1.0;
      let radius = 28;

      const runnerStartProg = lv.theme === 'speed' ? 0 : 0.12;
      const tankStartProg = lv.theme === 'shield' ? 0.06 : 0.24;

      if (prog >= runnerStartProg && r < lv.runnerRate) {
        kind = 'runner';
        hp = Math.floor(baseHp * 0.78);
        speed = Math.round((205 + prog * 58) * 1.18);
        scale = 0.96;
        radius = 26;
      } else if (prog >= tankStartProg && r > 1 - lv.tankRate) {
        kind = 'tank';
        hp = Math.floor(baseHp * 2.6);
        speed = 86 + prog * 22;
        scale = 1.28;
        radius = 38;
      }

      z.kind = kind;
      z.hp = hp;
      z.maxHp = hp;
      z.speed = speed;
      z.scale = scale;
      z.radius = radius;
      z.isBoss = false;
      z.hitFlash = 0;
      z.phase = Math.random() * Math.PI * 2;
      z.dying = false;
      z.rot = 0;
      z.vx = 0;
      z.vy = 0;
      z.vrot = 0;
      z.dieLife = 0;
      z.rageStage = 0;
      z.rageTimer = 0;
      z.x = clamp(cx + (Math.random() - 0.5) * spreadX, ROAD_LEFT + 30, ROAD_RIGHT - 30);
      z.y = (overrideBaseY ?? -55) - Math.random() * 115;
    }
  }

  private spawnFlankRunner(x: number, y: number): void {
    if (this.zombiePool.activeCount >= 138) return;
    const lv = this.currentLevel;
    const prog = Math.min(1, this.elapsed / lv.duration);
    const baseHp = Math.floor((20 + prog * 54) * lv.hpMult);
    const z = this.zombiePool.acquire();
    z.kind = 'runner';
    z.hp = Math.floor(baseHp * 0.75);
    z.maxHp = z.hp;
    z.speed = Math.round((215 + prog * 58) * 1.18);
    z.scale = 0.96;
    z.radius = 26;
    z.isBoss = false;
    z.hitFlash = 0;
    z.phase = Math.random() * Math.PI * 2;
    z.dying = false;
    z.rot = 0;
    z.vx = 0;
    z.vy = 0;
    z.vrot = 0;
    z.dieLife = 0;
    z.rageStage = 0;
    z.rageTimer = 0;
    z.x = clamp(x, ROAD_LEFT + 26, ROAD_RIGHT - 26);
    z.y = y;
  }

  private advanceEndlessToNextWave(): void {
    this.addRunCoins(this.currentLevel.clearCoins, false);
    this.squadCount = Math.min(MAX_SQUAD_CAP, this.squadCount + 1);
    this.sdk.playSound('gate_pos');
    this.endlessWave += 1;
    this.currentLevel = getEndlessWaveConfig(this.endlessWave);
    this.elapsed = 0;
    this.airdropTriggeredThisRun = false;
    this.airdrop.active = false;
    this.airdrop.claimed = false;
    this.airdrop.timer = 0;
    if (this.endlessWave % 2 === 0) {
      this.showToast(`进入无尽第${this.endlessWave}波！强化尸王即将现身`, '#fde047', 2.6);
    } else {
      this.showToast(`进入无尽第${this.endlessWave}波 · 增援一名队友`, '#c084fc', 2.4);
    }
  }

  private triggerBossAlert(): void {
    const bs = this.bossState;
    bs.alertPending = true;
    bs.alertDuration = 1.5;
    bs.alertTimer = 1.5;
    this.addShake(6, 0.35);
    this.sdk.playSound('boss_alert');
    this.sdk.vibrate('medium');
  }

  private spawnBoss(): void {
    this.bossSpawned = true;
    const lv = this.currentLevel;
    const z = this.zombiePool.acquire();
    z.kind = 'boss';
    z.isBoss = true;
    z.maxHp = lv.bossHp;
    z.hp = lv.bossHp;
    z.speed = 62;
    z.scale = 1.0;
    z.radius = 86;
    z.x = LOGICAL_WIDTH / 2;
    z.y = -110;
    z.hitFlash = 0;
    z.phase = 0;
    z.dying = false;
    z.rot = 0;
    z.vx = 0;
    z.vy = 0;
    z.vrot = 0;
    z.dieLife = 0;
    z.rageStage = 0;
    z.rageTimer = 0;
    this.bossRef = z;

    const bs = this.bossState;
    bs.alertPending = false;
    bs.alertTimer = 0;
    bs.action = 'ENTERING';
    bs.patrolDir = Math.random() > 0.5 ? 1 : -1;
    bs.patrolSpeed = lv.bossPatrolSpeed;
    bs.baseY = 280;
    bs.advanceTimer = 12.0;
    bs.fireballCd = 2.5;
    bs.chargeCd = 4.2;
    bs.chargeTargetX = LOGICAL_WIDTH / 2;
    bs.chargeHalfWidth = 56;
    bs.chargeTimer = 0;
    bs.chargeDuration = 1.2;
    bs.chargeHitApplied = false;
    bs.chargeReturnY = 280;
    bs.shieldTriggered = false;
    bs.shieldActive = false;
    bs.shieldHp = 0;
    bs.shieldMaxHp = 0;
    bs.shieldTimer = 0;
    bs.shieldDuration = 6.0;
    bs.stunTimer = 0;
    bs.shockwaveFlash = 0;

    this.addShake(14, 0.38);
    this.showToast(`警告：${lv.bossName}来袭，全队集火`, '#f87171');
    this.triggerGuideBanner('boss');
  }

  private applySquadDamage(loss: number, label: string, fxX: number, fxY: number): void {
    if (this.invincibleTimer > 0 || this.state !== 'PLAYING') return;
    this.squadCount = Math.max(0, this.squadCount - loss);
    this.damageVignette = 0.55;
    this.addShake(11, 0.22);
    this.sdk.playSound('hit');
    this.sdk.vibrate('medium');
    this.spawnParticles(fxX, fxY, '#ff4757', 12, 210, 7);
    this.spawnFloatText(fxX, fxY, label, '#ff4757', 32);
    if (this.squadCount <= 0) {
      this.squadCount = 0;
      this.handleSquadZero();
    }
  }

  private castBossFireballs(boss: Zombie): void {
    const lv = this.currentLevel;
    const minCount = lv.bossFireballMin;
    const maxCount = Math.max(minCount, lv.bossFireballMax);
    const count = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));

    // 为玩家预设一条安全走廊中心，确保横移即可无伤躲过全部火球
    const minX = ROAD_LEFT + 46;
    const maxX = ROAD_RIGHT - 46;
    const safeX =
      this.squadX > LOGICAL_WIDTH / 2
        ? ROAD_LEFT + 54 + Math.random() * 44
        : ROAD_RIGHT - 54 - Math.random() * 44;

    for (let k = 0; k < count; k++) {
      let tx: number;
      if (k === 0) {
        tx = clamp(this.squadX + (Math.random() - 0.5) * 24, minX, maxX);
        if (Math.abs(tx - safeX) < 88) {
          tx = clamp(safeX + (safeX < LOGICAL_WIDTH / 2 ? 96 : -96), minX, maxX);
        }
      } else {
        const leftWidth = Math.max(0, safeX - 90 - minX);
        const rightStart = Math.min(maxX, safeX + 90);
        const rightWidth = Math.max(0, maxX - rightStart);
        if (leftWidth >= 10 && rightWidth >= 10) {
          if (Math.random() < leftWidth / (leftWidth + rightWidth)) {
            tx = minX + Math.random() * leftWidth;
          } else {
            tx = rightStart + Math.random() * rightWidth;
          }
        } else if (leftWidth >= 10) {
          tx = minX + Math.random() * leftWidth;
        } else {
          tx = rightStart + Math.random() * Math.max(10, rightWidth);
        }
        tx = clamp(tx, minX, maxX);
      }

      const ty = PLAYER_Y - 24 + (k % 3) * 18 + (Math.random() - 0.5) * 8;
      const fb = this.bossFireballPool.acquire();
      fb.startX = boss.x + (k - (count - 1) * 0.5) * 18;
      fb.startY = boss.y - 16;
      fb.targetX = tx;
      fb.targetY = ty;
      fb.radius = 48;
      fb.duration = 1.1;
      fb.timer = 1.1;
      fb.explodeFlash = 0;
      fb.exploded = false;
    }
  }

  private updateBossFireballs(dt: number): void {
    const items = this.bossFireballPool.getRawItems();
    for (let i = 0; i < items.length; i++) {
      const fb = items[i];
      if (!fb.active) continue;

      if (fb.exploded) {
        fb.explodeFlash -= dt;
        if (fb.explodeFlash <= 0) {
          this.bossFireballPool.release(fb);
        }
        continue;
      }

      fb.timer -= dt;
      if (fb.timer <= 0) {
        fb.timer = 0;
        fb.exploded = true;
        fb.explodeFlash = 0.22;
        this.addShake(8, 0.16);
        this.sdk.playSound('explosion');
        this.spawnParticles(fb.targetX, fb.targetY, '#fb923c', 12, 240, 8);
        this.spawnParticles(fb.targetX, fb.targetY, '#ef4444', 8, 190, 7);

        const dx = fb.targetX - this.squadX;
        const dy = fb.targetY - PLAYER_Y;
        const hitR = fb.radius + 26;
        if (dx * dx + dy * dy <= hitR * hitR && this.hazardHurtCd <= 0 && this.invincibleTimer <= 0) {
          this.hazardHurtCd = 0.22;
          this.applySquadDamage(2, '火球命中 -2', fb.targetX, fb.targetY - 20);
          if (this.state !== 'PLAYING') return;
        }
      }
    }
  }

  private updateBossBehavior(z: Zombie, dt: number): void {
    const bs = this.bossState;
    z.phase += dt * 7.5;
    const speedMult = z.rageTimer > 0 ? 1.3 : 1.0;
    if (z.rageTimer > 0) z.rageTimer = Math.max(0, z.rageTimer - dt);
    if (z.hitFlash > 0) z.hitFlash -= dt;

    if (bs.shieldActive && bs.action !== 'STUNNED') {
      bs.shieldTimer -= dt;
      if (bs.shieldTimer <= 0) {
        bs.shieldActive = false;
        bs.shieldHp = 0;
        bs.shieldTimer = 0;
        bs.shockwaveFlash = 0.55;
        this.addShake(15, 0.42);
        this.sdk.playSound('explosion');
        this.sdk.vibrate('heavy');
        this.spawnParticles(z.x, z.y, '#ef4444', 28, 360, 11);
        this.showToast('未能及时破盾！熔岩冲击波来袭', '#ef4444', 2.4);
        this.applySquadDamage(2, '冲击波 -2', this.squadX, PLAYER_Y - 60);
        if (this.state !== 'PLAYING') return;
      }
    }

    if (bs.action === 'ENTERING') {
      z.y += 220 * dt;
      if (z.y >= bs.baseY) {
        z.y = bs.baseY;
        bs.action = 'PATROL';
      }
      return;
    }

    if (bs.action === 'STUNNED') {
      bs.stunTimer -= dt;
      if (bs.stunTimer <= 0) {
        bs.stunTimer = 0;
        bs.action = 'PATROL';
      }
      return;
    }

    if (bs.action === 'PATROL') {
      z.x += bs.patrolDir * bs.patrolSpeed * speedMult * dt;
      if (z.x <= ROAD_LEFT + 72) {
        z.x = ROAD_LEFT + 72;
        bs.patrolDir = 1;
      } else if (z.x >= ROAD_RIGHT - 72) {
        z.x = ROAD_RIGHT - 72;
        bs.patrolDir = -1;
      }

      bs.baseY = Math.min(PLAYER_Y, bs.baseY + 10 * speedMult * dt);
      bs.advanceTimer -= dt;
      if (bs.advanceTimer <= 0) {
        bs.advanceTimer = 12.0;
        bs.baseY = Math.min(PLAYER_Y, bs.baseY + 72);
        this.addShake(6, 0.16);
        this.spawnFloatText(z.x, z.y - 96, '尸王逼近', '#fb923c', 28);
      }
      z.y += (bs.baseY - z.y) * Math.min(1, dt * 6);

      bs.fireballCd -= dt;
      if (bs.fireballCd <= 0) {
        bs.fireballCd = 5.5;
        this.castBossFireballs(z);
      }

      const hpRatio = z.hp / Math.max(1, z.maxHp);
      if (z.rageStage >= 1 || hpRatio <= 0.65) {
        bs.chargeCd -= dt;
        if (bs.chargeCd <= 0) {
          bs.action = 'CHARGE_WARN';
          bs.chargeCd = 9.5;
          bs.chargeDuration = 1.2;
          bs.chargeTimer = 1.2;
          bs.chargeTargetX = clamp(this.squadX, ROAD_LEFT + 58, ROAD_RIGHT - 58);
          bs.chargeHalfWidth = 56;
          bs.chargeHitApplied = false;
          bs.chargeReturnY = Math.min(bs.baseY, 560);
          this.sdk.playSound('boss_alert');
          this.spawnFloatText(z.x, z.y - 96, '冲锋蓄力', '#f87171', 30);
        }
      }
      return;
    }

    if (bs.action === 'CHARGE_WARN') {
      z.x += (bs.chargeTargetX - z.x) * Math.min(1, dt * 10);
      bs.chargeTimer -= dt;
      if (bs.chargeTimer <= 0) {
        bs.chargeTimer = 0;
        bs.action = 'CHARGE_DASH';
        this.addShake(8, 0.18);
        this.sdk.playSound('explosion');
      }
      return;
    }

    if (bs.action === 'CHARGE_DASH') {
      z.x = bs.chargeTargetX;
      z.y += 1080 * dt;
      if (Math.random() < 0.65) {
        this.spawnParticles(z.x, z.y + 40, '#fb923c', 1, 90, 6);
      }
      if (
        !bs.chargeHitApplied &&
        Math.abs(z.y - PLAYER_Y) < 92 &&
        Math.abs(z.x - this.squadX) < bs.chargeHalfWidth + 24
      ) {
        bs.chargeHitApplied = true;
        this.applySquadDamage(3, '冲锋践踏 -3', this.squadX, PLAYER_Y - 60);
        if (this.state !== 'PLAYING') return;
      }
      if (z.y >= PLAYER_Y - 12) {
        z.y = PLAYER_Y - 12;
        bs.action = 'CHARGE_RETURN';
        this.addShake(11, 0.24);
        this.spawnParticles(z.x, z.y + 40, '#f97316', 14, 240, 8);
      }
      return;
    }

    if (bs.action === 'CHARGE_RETURN') {
      z.y -= 520 * dt;
      if (z.y <= bs.chargeReturnY) {
        z.y = bs.chargeReturnY;
        bs.action = 'PATROL';
      }
    }
  }

  private spawnSingleBarrel(laneX: number, y: number, forcedIdx?: number): number {
    const b = this.barrelPool.acquire();
    const lv = this.currentLevel;
    const prog = Math.min(1, this.elapsed / lv.duration);

    let idx: number;
    if (forcedIdx !== undefined) {
      idx = forcedIdx % BARREL_PICKS.length;
    } else if (lv.theme === 'shield' && Math.random() < 0.45) {
      idx = 2; // 铁壁重盾关大幅提高高爆火箭筒掉率
    } else {
      idx = Math.floor(Math.random() * BARREL_PICKS.length);
    }
    const pick = BARREL_PICKS[idx];
    const earlySoft = this.elapsed < 8 ? 0.82 : 1.0;
    const hp = Math.max(
      18,
      Math.floor((22 + prog * 115) * pick.hpScale * earlySoft * (0.85 + lv.hpMult * 0.35)),
    );

    b.x = laneX;
    b.y = y;
    b.hp = hp;
    b.maxHp = hp;
    b.speed = 148 + prog * 24;
    b.radius = 52;
    b.rewardType = pick.type;
    b.rewardWeapon = pick.weapon;
    b.rewardVal = pick.val;
    b.rewardLabel = pick.label;
    b.iconKey = pick.iconKey;
    b.hitScale = 1;
    b.hitFlash = 0;
    b.highlightGuide = this.triggerGuideBanner('barrel');
    return idx;
  }

  private spawnBarrel(): void {
    if (this.elapsed >= 10 && !this.bossSpawned && Math.random() < 0.35) {
      if (Math.random() < 0.5) {
        // 左右并列双木桶，诱发路径取舍
        const firstIdx = this.spawnSingleBarrel(BARREL_LANE_XS[0], -75);
        this.spawnSingleBarrel(
          BARREL_LANE_XS[2],
          -75,
          firstIdx + 1 + Math.floor(Math.random() * 4),
        );
      } else {
        // 一侧木桶 + 对侧丧尸群组合，强迫玩家抉择打桶或清怪
        const barrelOnLeft = Math.random() < 0.5;
        this.spawnSingleBarrel(barrelOnLeft ? BARREL_LANE_XS[0] : BARREL_LANE_XS[2], -75);
        this.spawnZombieWave(
          barrelOnLeft ? BARREL_LANE_XS[2] : BARREL_LANE_XS[0],
          3 + Math.floor(Math.random() * 2),
          -85,
        );
      }
      return;
    }
    this.spawnSingleBarrel(BARREL_LANE_XS[Math.floor(Math.random() * BARREL_LANE_XS.length)], -75);
  }

  private spawnGatePair(): void {
    const pairId = this.gatePairSeq++;
    const allPositive = this.currentLevel.theme === 'gold';
    const leftPos = Math.random() > 0.5;
    this.triggerGuideBanner('gate');

    for (let i = 0; i < 2; i++) {
      const g = this.gatePool.acquire();
      const x = i === 0 ? ROAD_LEFT + ROAD_W * 0.25 : ROAD_LEFT + ROAD_W * 0.75;
      const positive = allPositive ? true : i === 0 ? leftPos : !leftPos;
      g.x = x;
      g.y = -75;
      g.w = ROAD_W * 0.48;
      g.h = 78;
      g.speed = 166;
      g.pairId = pairId;
      g.used = false;
      g.hitFlash = 0;
      g.hitAccum = 0;
      if (positive) {
        if (allPositive) {
          g.kind = i === 0 ? 'squad' : 'rate';
          g.value = g.kind === 'squad' ? 2 + Math.floor(Math.random() * 2) : 20;
        } else {
          g.kind = Math.random() > 0.35 ? 'squad' : 'rate';
          g.value = g.kind === 'squad' ? 1 + Math.floor(Math.random() * 2) : 15;
        }
      } else {
        g.kind = 'squad';
        g.value = -(4 + Math.floor(Math.random() * 4));
      }
    }
  }

  private applyZombieDamage(
    z: Zombie,
    rawDamage: number,
    isCrit: boolean,
    isSplash: boolean,
    hitX: number,
    hitY: number,
  ): number {
    let finalDmg = rawDamage;
    if (z.isBoss) {
      const bs = this.bossState;
      if (bs.shieldActive) {
        bs.shieldHp -= rawDamage;
        finalDmg = rawDamage * 0.2;
        this.spawnParticles(hitX, hitY, '#38bdf8', 2, 110, 5);
        if (bs.shieldHp <= 0) {
          bs.shieldHp = 0;
          bs.shieldActive = false;
          bs.action = 'STUNNED';
          bs.stunTimer = 3.0;
          bs.chargeTimer = 0;
          this.addShake(14, 0.35);
          this.sdk.playSound('break_barrel');
          this.sdk.vibrate('heavy');
          this.spawnParticles(z.x, z.y, '#fde047', 24, 320, 10);
          this.spawnFloatText(z.x, z.y - 96, '破盾虚弱！', '#fde047', 36);
          this.showToast('破盾虚弱！三秒眩晕且受到额外易伤', '#fde047', 2.6);
        }
      } else if (bs.action === 'STUNNED' && bs.stunTimer > 0) {
        finalDmg = rawDamage * 1.8;
      }
    } else if (!isCrit && !isSplash && z.kind === 'tank') {
      finalDmg = rawDamage * 0.7;
      this.spawnParticles(hitX, hitY, '#93c5fd', 3, 120, 5);
    }

    z.hp -= finalDmg;
    z.hitFlash = isCrit ? 0.11 : 0.08;

    if (z.hp <= 0) {
      this.killZombie(z, isCrit || isSplash || this.weaponId === 'shotgun');
    } else if (z.isBoss) {
      this.checkBossRage(z);
    }
    return finalDmg;
  }

  private checkBossRage(boss: Zombie): void {
    const ratio = boss.hp / Math.max(1, boss.maxHp);
    if (boss.rageStage < 1 && ratio <= 0.65) {
      this.triggerBossRage(boss, 1);
    }
    if (boss.rageStage < 2 && ratio <= 0.3) {
      this.triggerBossRage(boss, 2);
    }
  }

  private triggerBossRage(boss: Zombie, stage: number): void {
    boss.rageStage = stage;
    boss.rageTimer = 4.0;
    this.addShake(16, 0.45);
    this.sdk.playSound('boss_alert');
    this.sdk.vibrate('heavy');

    for (let side = 0; side < 2; side++) {
      const baseX = side === 0 ? ROAD_LEFT + 34 : ROAD_RIGHT - 34;
      const dir = side === 0 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        this.spawnFlankRunner(baseX + dir * k * 14, Math.max(40, boss.y + 15 + k * 28));
      }
    }

    if (stage === 1) {
      this.bossState.chargeCd = Math.min(this.bossState.chargeCd, 2.8);
      this.showToast('尸王狂暴！召唤尸潮！', '#ef4444', 2.4);
    } else if (stage >= 2 && !this.bossState.shieldTriggered) {
      const bs = this.bossState;
      bs.shieldTriggered = true;
      bs.shieldActive = true;
      bs.shieldMaxHp = Math.max(200, Math.round(boss.maxHp * 0.18));
      bs.shieldHp = bs.shieldMaxHp;
      bs.shieldDuration = 6.0;
      bs.shieldTimer = 6.0;
      this.spawnFloatText(boss.x, boss.y - 96, '熔岩护盾', '#38bdf8', 32);
      this.showToast('尸王开启熔岩护盾！六秒内集火破盾', '#38bdf8', 2.6);
    } else {
      this.showToast('尸王狂暴！召唤尸潮！', '#ef4444', 2.4);
    }
  }

  private killZombie(z: Zombie, bigKnockback: boolean): void {
    if (z.dying) return;
    z.dying = true;
    z.dieLife = 0.48;
    z.vx = (Math.random() - 0.5) * (bigKnockback ? 420 : 220);
    z.vy = -(bigKnockback ? 520 : 320);
    z.vrot = (Math.random() > 0.5 ? 1 : -1) * (bigKnockback ? 12 : 8);

    this.kills += 1;
    this.combo += 1;
    this.comboTimer = 2.7;
    this.comboPulse = 1.38;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    if (this.combo === 10) this.showToast('10 连击，暴击率大幅提升', '#fde047');
    else if (this.combo === 25) this.showToast('25 狂热连击，射速提升百分之十五', '#fb923c');
    else if (this.combo === 50) this.showToast('50 无双连击，全队火力全开', '#f87171');

    this.addRunCoins(z.isBoss ? 80 : z.kind === 'tank' ? 8 : 3, true);
    this.spawnParticles(
      z.x,
      z.y,
      z.isBoss ? '#ff9f43' : '#ff4757',
      z.isBoss ? 36 : 9,
      z.isBoss ? 340 : 210,
      z.isBoss ? 12 : 7,
    );

    if (z.isBoss) {
      this.sdk.playSound('explosion');
      this.addShake(16, 0.45);
      this.bossRef = null;
      this.bossState.shieldActive = false;
      this.bossState.shieldHp = 0;
      this.bossState.action = 'PATROL';
      this.bossState.stunTimer = 0;
      this.bossFireballPool.releaseAll();
      if (this.mode === 'endless') {
        this.addRunCoins(this.currentLevel.clearCoins, false);
        this.squadCount = Math.min(MAX_SQUAD_CAP, this.squadCount + 2);
        this.sdk.playSound('victory');
        this.sdk.vibrate('heavy');
        this.endlessWave += 1;
        this.currentLevel = getEndlessWaveConfig(this.endlessWave);
        this.elapsed = 0;
        this.bossSpawned = false;
        this.resetBossState();
        this.airdropTriggeredThisRun = false;
        this.airdrop.active = false;
        this.airdrop.claimed = false;
        this.airdrop.timer = 0;
        this.showToast(`击破尸王！增援两名队友，进入无尽第${this.endlessWave}波`, '#fde047', 2.8);
      } else {
        this.triggerGameOver(true);
      }
    }
  }

  private updateBulletsAndCollisions(dt: number): void {
    const bulletItems = this.bulletPool.getRawItems();
    const gateItems = this.gatePool.getRawItems();
    const barrelItems = this.barrelPool.getRawItems();
    const zombieItems = this.zombiePool.getRawItems();

    for (let bi = 0; bi < bulletItems.length; bi++) {
      const b = bulletItems[bi];
      if (!b.active) continue;

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -40 || b.x < ROAD_LEFT - 40 || b.x > ROAD_RIGHT + 40) {
        this.bulletPool.release(b);
        continue;
      }

      let hit = false;

      // 1) 红蓝能量门（加大负门转化门槛，避免白嫖）
      for (let gi = 0; gi < gateItems.length; gi++) {
        const g = gateItems[gi];
        if (!g.active || g.used) continue;
        if (Math.abs(b.x - g.x) < g.w / 2 && Math.abs(b.y - g.y) < g.h / 2) {
          g.hitFlash = 0.08;
          g.hitAccum += 1;
          const needHits = g.kind === 'rate' ? 3 : g.value < 0 ? 3 : 4;
          if (g.hitAccum >= needHits) {
            g.hitAccum = 0;
            const prev = g.value;
            g.value += g.kind === 'rate' ? 3 : 1;
            if (prev < 0 && g.value >= 0) {
              if (g.value === 0) g.value = 1;
              this.sdk.playSound('gate_pos');
              this.spawnFloatText(g.x, g.y - 44, '逆转增益', '#60a5fa', 26);
            }
          }
          this.spawnParticles(b.x, b.y, g.value >= 0 ? '#38bdf8' : '#ff6b6b', 3, 95, 5);
          hit = true;
          break;
        }
      }
      if (hit) {
        this.bulletPool.release(b);
        continue;
      }

      // 2) 数字木桶
      for (let bri = 0; bri < barrelItems.length; bri++) {
        const br = barrelItems[bri];
        if (!br.active) continue;
        const dx = b.x - br.x;
        const dy = b.y - br.y;
        const rr = br.radius + b.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          br.hp -= b.damage;
          br.hitScale = 1.15;
          br.hitFlash = 0.08;
          this.spawnParticles(b.x, b.y, '#e3a857', 3, 120, 5);
          if (br.hp <= 0) {
            this.sdk.playSound('break_barrel');
            this.sdk.vibrate('light');
            this.addShake(7, 0.16);
            this.spawnParticles(br.x, br.y, '#d99b52', 18, 270, 9);
            this.spawnParticles(br.x, br.y, '#ffe066', 10, 210, 6);
            if (br.rewardType === 'weapon') {
              this.weaponId = br.rewardWeapon;
              this.triggerWeaponBanner(br.rewardWeapon);
              this.spawnFloatText(br.x, br.y - 25, `装备 ${br.rewardLabel}`, '#38bdf8', 34);
            } else if (br.rewardType === 'squad') {
              this.addSquadWithOverflow(br.rewardVal, br.x, br.y - 25);
            } else {
              this.fireRateBonus = Math.min(2.6, this.fireRateBonus + br.rewardVal);
              this.spawnFloatText(br.x, br.y - 25, '射速提升', '#fbbf24', 34);
            }
            if (this.currentLevel.theme === 'gold') {
              const bonus = this.addRunCoins(12, true);
              this.spawnFloatText(br.x, br.y - 62, `黄金木桶 +${bonus}金币`, '#fde047', 24);
            }
            this.barrelPool.release(br);
          }
          hit = true;
          break;
        }
      }
      if (hit) {
        this.bulletPool.release(b);
        continue;
      }

      // 3) 丧尸与尸王
      for (let zi = 0; zi < zombieItems.length; zi++) {
        const z = zombieItems[zi];
        if (!z.active || z.dying) continue;
        const dx = b.x - z.x;
        const dy = b.y - z.y;
        const r = z.radius + b.radius;
        if (dx * dx + dy * dy <= r * r) {
          if (b.splash > 0) {
            this.sdk.playSound('explosion');
            this.addShake(8, 0.15);
            this.spawnParticles(b.x, b.y, '#ff7675', 16, 280, 9);
            const splashSq = b.splash * b.splash;
            for (let szi = 0; szi < zombieItems.length; szi++) {
              const sz = zombieItems[szi];
              if (!sz.active || sz.dying) continue;
              const sdx = sz.x - b.x;
              const sdy = sz.y - b.y;
              if (sdx * sdx + sdy * sdy <= splashSq) {
                this.applyZombieDamage(sz, b.damage, false, true, b.x, b.y);
              }
            }
          } else {
            const critRate = this.combo >= 25 ? 0.36 : this.combo >= 10 ? 0.28 : 0.2;
            const isCrit = Math.random() < critRate;
            const rawDmg = isCrit ? b.damage * 2.0 : b.damage;
            if (!z.isBoss) z.y -= isCrit ? 10 : 5;
            const dealt = this.applyZombieDamage(z, rawDmg, isCrit, false, b.x, b.y);
            if (isCrit) {
              this.addShake(5.5, 0.09);
              this.sdk.playSound('crit');
              this.sdk.vibrate('light');
              this.spawnParticles(b.x, b.y, '#fbbf24', 6, 175, 6);
              this.spawnFloatText(
                z.x + (Math.random() - 0.5) * 24,
                z.y - 44,
                `暴击 ${Math.round(dealt)}`,
                '#fde047',
                27,
              );
            } else if (z.kind !== 'tank') {
              this.spawnParticles(b.x, b.y, '#7bed9f', 2, 110, 5);
            }
          }
          hit = true;
          break;
        }
      }

      if (hit) {
        this.bulletPool.release(b);
      }
    }
  }

  private updateBarrels(dt: number): void {
    const barrelItems = this.barrelPool.getRawItems();
    const lerpScale = Math.min(1, dt * 15);
    for (let i = 0; i < barrelItems.length; i++) {
      const br = barrelItems[i];
      if (!br.active) continue;

      br.y += br.speed * dt;
      br.hitScale += (1 - br.hitScale) * lerpScale;
      if (br.hitFlash > 0) br.hitFlash -= dt;

      const dx = br.x - this.squadX;
      const dy = br.y - PLAYER_Y;
      const hitR = br.radius + 32;
      if (dx * dx + dy * dy < hitR * hitR) {
        this.barrelPool.release(br);
        if (this.invincibleTimer <= 0) {
          this.squadCount -= 1;
          this.damageVignette = 0.45;
          this.addShake(9, 0.2);
          this.sdk.playSound('hit');
          this.sdk.vibrate('medium');
          this.spawnParticles(br.x, br.y, '#d99b52', 14, 210, 7);
          this.spawnFloatText(this.squadX, PLAYER_Y - 55, '撞击 -1', '#ff4757', 30);
          if (this.squadCount <= 0) {
            this.squadCount = 0;
            this.handleSquadZero();
            return;
          }
        }
        continue;
      }

      if (br.y > LOGICAL_HEIGHT + 90) {
        this.barrelPool.release(br);
      }
    }
  }

  private updateGates(dt: number): void {
    const gateItems = this.gatePool.getRawItems();
    for (let i = 0; i < gateItems.length; i++) {
      const g = gateItems[i];
      if (!g.active) continue;

      g.y += g.speed * dt;
      if (g.hitFlash > 0) g.hitFlash -= dt;

      if (!g.used && Math.abs(g.y - PLAYER_Y) < 46 && Math.abs(g.x - this.squadX) < g.w / 2 + 12) {
        const pid = g.pairId;
        for (let oi = 0; oi < gateItems.length; oi++) {
          const other = gateItems[oi];
          if (other.active && other.pairId === pid) other.used = true;
        }

        this.sdk.playSound(g.value >= 0 ? 'gate_pos' : 'gate_neg');
        if (g.kind === 'squad') {
          if (g.value > 0) {
            this.addSquadWithOverflow(g.value, this.squadX, PLAYER_Y - 60);
          } else {
            this.squadCount = Math.max(0, this.squadCount + g.value);
            this.spawnFloatText(this.squadX, PLAYER_Y - 60, `队友 ${g.value}`, '#ff4757', 34);
          }
          if (this.squadCount <= 0) {
            this.squadCount = 0;
            this.handleSquadZero();
            return;
          }
        } else {
          this.fireRateBonus = Math.min(2.6, Math.max(0.5, this.fireRateBonus + g.value / 100));
          this.spawnFloatText(
            this.squadX,
            PLAYER_Y - 60,
            `射速 ${g.value >= 0 ? '+' : ''}${g.value}%`,
            '#38bdf8',
            32,
          );
        }
      }

      if (g.y > LOGICAL_HEIGHT + 90) {
        this.gatePool.release(g);
      }
    }
  }

  private updateZombies(dt: number): void {
    const zombieItems = this.zombiePool.getRawItems();
    const squadColBonus = Math.min(48, 22 + this.squadCount * 1.3);

    for (let i = 0; i < zombieItems.length; i++) {
      const z = zombieItems[i];
      if (!z.active) continue;

      if (z.dying) {
        z.dieLife -= dt;
        z.x += z.vx * dt;
        z.y += z.vy * dt;
        z.vy += 900 * dt;
        z.rot += z.vrot * dt;
        if (z.dieLife <= 0) this.zombiePool.release(z);
        continue;
      }

      if (z.isBoss) {
        this.updateBossBehavior(z, dt);
        if (this.state !== 'PLAYING') return;
        if (this.bossState.action === 'CHARGE_DASH' || this.bossState.action === 'CHARGE_RETURN') {
          continue;
        }
      } else {
        z.phase += dt * (z.kind === 'runner' ? 14.5 : 7.5);
        z.y += z.speed * dt;
        if (z.hitFlash > 0) z.hitFlash -= dt;

        if (z.kind === 'runner' && z.y > 420) {
          const diff = this.squadX - z.x;
          if (Math.abs(diff) > 4) {
            z.x = clamp(
              z.x + Math.sign(diff) * Math.min(Math.abs(diff), 128 * dt),
              ROAD_LEFT + 24,
              ROAD_RIGHT - 24,
            );
          }
        } else if (z.y > 700) {
          z.x += Math.sign(this.squadX - z.x) * 66 * dt;
        }
      }

      const dx = z.x - this.squadX;
      const dy = z.y - PLAYER_Y;
      const colR = z.radius + squadColBonus;
      if (dx * dx + dy * dy < colR * colR) {
        if (this.invincibleTimer > 0) {
          if (!z.isBoss) {
            this.spawnParticles(z.x, z.y, '#38bdf8', 10, 210, 7);
            this.zombiePool.release(z);
          }
          continue;
        }
        const loss = z.isBoss ? 99 : z.kind === 'tank' ? 2 : 1;
        this.squadCount -= loss;
        this.damageVignette = 0.55;
        this.addShake(11, 0.22);
        this.sdk.playSound('hit');
        this.sdk.vibrate('medium');
        this.spawnParticles(z.x, z.y, '#ff4757', 12, 210, 7);
        if (!z.isBoss) this.zombiePool.release(z);
        if (this.squadCount <= 0) {
          this.squadCount = 0;
          this.handleSquadZero();
          return;
        }
        continue;
      }

      if (z.y > LOGICAL_HEIGHT + 95) {
        if (z.isBoss) {
          this.squadCount = 0;
          this.handleSquadZero();
          return;
        }
        this.zombiePool.release(z);
      }
    }
  }

  private updateEffects(dt: number): void {
    if (this.state === 'PLAYING') {
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.combo = 0;
      }
      this.comboPulse += (1 - this.comboPulse) * Math.min(1, dt * 14);
    }

    const pItems = this.particlePool.getRawItems();
    for (let i = 0; i < pItems.length; i++) {
      const p = pItems[i];
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.93;
      p.vy *= 0.93;
      p.life -= dt;
      if (p.life <= 0) this.particlePool.release(p);
    }

    const ftItems = this.floatTextPool.getRawItems();
    for (let i = 0; i < ftItems.length; i++) {
      const ft = ftItems[i];
      if (!ft.active) continue;
      ft.y += ft.vy * dt;
      ft.life -= dt;
      if (ft.life <= 0) this.floatTextPool.release(ft);
    }
  }

  private handleSquadZero(): void {
    if (this.revivesUsedThisRun < AD_RULES.maxRevivesPerRun) {
      this.setState('REVIVE_MODAL');
    } else {
      this.triggerGameOver(false);
    }
  }

  private performRevive(): void {
    this.revivesUsedThisRun += 1;
    this.squadCount = 6;
    this.invincibleTimer = 2.5;
    this.hazardHurtCd = 0;
    this.bossFireballPool.releaseAll();
    this.sdk.playSound('explosion');
    this.addShake(14, 0.35);

    const zItems = this.zombiePool.getRawItems();
    for (let i = 0; i < zItems.length; i++) {
      const z = zItems[i];
      if (!z.active) continue;
      if (z.isBoss) {
        z.y = Math.min(z.y, 240);
        z.hp = Math.max(1, z.hp - z.maxHp * 0.2);
        z.hitFlash = 0.15;
        this.bossState.baseY = Math.min(this.bossState.baseY, 280);
        if (
          this.bossState.action === 'CHARGE_WARN' ||
          this.bossState.action === 'CHARGE_DASH' ||
          this.bossState.action === 'CHARGE_RETURN'
        ) {
          this.bossState.action = 'PATROL';
          this.bossState.chargeTimer = 0;
        }
      } else {
        this.spawnParticles(z.x, z.y, '#38bdf8', 8, 220, 7);
        this.zombiePool.release(z);
      }
    }
    this.showToast('满血复活！六名队友回归并清空周围尸潮', '#4ade80');
    this.setState('PLAYING');
  }

  private openAirdropModal(): void {
    if (!this.airdrop.active || this.airdrop.claimed) return;
    this.setState('AIRDROP_MODAL');
  }

  private spawnParticles(
    x: number,
    y: number,
    color: string,
    count: number,
    speedMax: number,
    sizeMax: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.particlePool.acquire();
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * speedMax;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = 0.24 + Math.random() * 0.28;
      p.life = p.maxLife;
      p.size = 4 + Math.random() * sizeMax;
      p.color = color;
    }
  }

  private spawnFloatText(
    x: number,
    y: number,
    text: string,
    color: string,
    size: number,
  ): void {
    const ft = this.floatTextPool.acquire();
    ft.x = x;
    ft.y = y;
    ft.vy = -95;
    ft.text = text;
    ft.color = color;
    ft.maxLife = 0.78;
    ft.life = ft.maxLife;
    ft.size = size;
  }

  private async handleSkinAction(skin: SkinDef): Promise<void> {
    if (this.saveManager.isSkinUnlocked(skin.id, skin.unlockAds)) {
      this.saveManager.equipSkin(skin.id, skin.unlockAds);
      this.showToast(`已装备涂装：${skin.name}`, '#4ade80');
      return;
    }
    const ok = await this.requestRewardedAction('armory_unlock', `解锁传说涂装·${skin.name}`);
    if (!ok) return;
    const res = this.saveManager.addSkinAdProgress(skin.id, skin.unlockAds);
    if (res.unlockedNow) {
      this.showToast(`恭喜解锁并装备「${skin.name}」`, '#fde047');
    } else {
      this.showToast(`解锁进度 ${res.progress}/${skin.unlockAds}`, '#38bdf8');
    }
  }

  private pauseBattle(): void {
    if (this.state !== 'PLAYING') return;
    this.stateBeforePause = 'PLAYING';
    this.sdk.suspendAudio();
    this.setState('PAUSED');
  }

  private resumeBattle(): void {
    if (this.state !== 'PAUSED') return;
    this.sdk.resumeAudio();
    this.lastTimestamp = performance.now();
    this.resumeGraceTimer = 1.0;
    this.invincibleTimer = Math.max(this.invincibleTimer, 1.0);
    this.setState(this.stateBeforePause);
  }

  private triggerWeaponBanner(weaponId: WeaponId): void {
    if (weaponId === 'pistol') return;
    const w = WEAPONS[weaponId];
    this.weaponBanner.active = true;
    this.weaponBanner.duration = 1.2;
    this.weaponBanner.timer = 1.2;
    this.weaponBanner.weaponName = w.name;
    this.weaponBanner.iconKey = w.iconKey;
    this.weaponBanner.accentColor = w.color;
  }

  private triggerGuideBanner(stage: GuideStageKey): boolean {
    if (this.saveManager.hasSeenGuide(stage)) return false;
    if (this.guideBanner.active && this.guideBanner.stage === stage) return false;
    this.pendingGuideStage = stage;
    this.pendingGuideVisibleSec = 0;
    this.guideBanner.active = true;
    this.guideBanner.stage = stage;
    this.guideBanner.duration = 3.0;
    this.guideBanner.timer = 3.0;
    if (stage === 'barrel') {
      this.guideBanner.text = '打爆数字木桶，立即换强力武器或加队友！';
      this.guideBanner.accentColor = '#fbbf24';
    } else if (stage === 'gate') {
      this.guideBanner.text = '射击红色大门可将其打蓝，穿过获得队友或射速加成！';
      this.guideBanner.accentColor = '#38bdf8';
    } else {
      this.guideBanner.text = '注意躲避地面红圈和冲锋红道，破盾后全力输出！';
      this.guideBanner.accentColor = '#f87171';
    }
    return true;
  }

  private triggerThemeBanner(theme: LevelTheme): void {
    const meta = getLevelThemeMeta(theme);
    this.themeBanner.active = true;
    this.themeBanner.theme = theme;
    this.themeBanner.label = meta.label;
    this.themeBanner.subLabel = meta.subLabel;
    this.themeBanner.accentColor = meta.accentColor;
    this.themeBanner.duration = 2.0;
    this.themeBanner.timer = 2.0;
  }

  private addRunCoins(baseAmount: number, applyGoldThemeBonus = true): number {
    if (baseAmount <= 0) return 0;
    const themeMult = applyGoldThemeBonus && this.currentLevel.theme === 'gold' ? 1.5 : 1.0;
    const permMult = this.saveManager.getPermanentCoinMultiplier();
    const prev = this.runCoins;
    this.runCoinsExact += baseAmount * themeMult * permMult;
    this.runCoins = Math.floor(this.runCoinsExact);
    return Math.max(0, this.runCoins - prev);
  }

  private addSquadWithOverflow(delta: number, fxX: number, fxY: number): void {
    const res = applySquadOverflowBonus(this.squadCount, delta, this.overflowAttackBonus);
    this.squadCount = res.nextSquad;
    if (res.overflowCount > 0) {
      this.overflowAttackBonus = res.nextAttackBonus;
      if (res.coinGain > 0) {
        this.addRunCoins(res.coinGain, false);
      }
      this.spawnParticles(fxX, fxY, '#fde047', 12, 220, 7);
      this.spawnFloatText(fxX, fxY, '满编强化：攻击提升！', '#fde047', 32);
    } else if (delta > 0) {
      this.spawnFloatText(fxX, fxY, `队友 +${delta}`, '#4ade80', 34);
    }
  }

  private render(): void {
    const save = this.saveManager.getData();
    const insets = this.sdk.getLogicalSafeInsets();
    const snap = this.renderSnapshot;

    let hasArmoryRedDot = false;
    for (let i = 0; i < SKINS.length; i++) {
      const sk = SKINS[i];
      if (
        sk.unlockAds > 0 &&
        sk.id !== save.equippedSkin &&
        this.saveManager.isSkinUnlocked(sk.id, sk.unlockAds)
      ) {
        hasArmoryRedDot = true;
        break;
      }
    }

    snap.renderScale = this.canvasScale;
    snap.mode = this.mode;
    snap.endlessWave = this.endlessWave;
    snap.totalSurviveSec = this.totalSurviveSec;
    snap.isNewEndlessRecord = this.isNewEndlessRecord;
    snap.state = this.state;
    snap.clock = this.clock;
    snap.roadScroll = this.roadScroll;
    snap.shakeX = this.shakeTimer > 0 ? (Math.random() - 0.5) * this.shakePower : 0;
    snap.shakeY = this.shakeTimer > 0 ? (Math.random() - 0.5) * this.shakePower : 0;
    snap.damageVignette = this.damageVignette;
    snap.recoil = this.recoil;
    snap.muzzleFlash = this.muzzleFlash;
    snap.squadX = this.squadX;
    snap.squadCount = this.squadCount;
    snap.weapon = WEAPONS[this.weaponId];
    snap.doubleFireTimer = this.doubleFireTimer;
    snap.invincibleTimer = this.invincibleTimer;
    snap.resumeGraceTimer = this.resumeGraceTimer;
    snap.weaponBanner = this.weaponBanner;
    snap.guideBanner = this.guideBanner;
    snap.themeBanner = this.themeBanner;
    snap.stuckAssistActive = this.stuckAssistActive;
    snap.overflowAttackBonus = this.overflowAttackBonus;
    snap.hasArmoryRedDot = hasArmoryRedDot;
    snap.skin = getSkinDef(save.equippedSkin);
    snap.level = this.currentLevel;
    snap.elapsed = this.elapsed;
    snap.bossSpawned = this.bossSpawned;
    snap.bossRef = this.bossRef;
    snap.effectivePlatform = this.sdk.getEffectiveAdPlatform();
    snap.endlessUnlocked = this.saveManager.isEndlessUnlocked();
    snap.tutorialAlpha = this.tutorialFade;
    snap.sidebar = this.sdk.getSidebarStatus();
    snap.recorder = this.sdk.getRecorderSnapshot();
    snap.canClaimSidebarReward = this.saveManager.canClaimDailySidebarReward();
    snap.canClaimVideoReward = this.saveManager.canClaimDailyVideoReward();
    snap.kills = this.kills;
    snap.runCoins = this.runCoins;
    snap.combo = this.combo;
    snap.comboTimer = this.comboTimer;
    snap.comboPulse = this.comboPulse;
    snap.isVictory = this.isVictory;
    snap.justUnlockedEndless = this.justUnlockedEndless;
    snap.milestoneCongrats = this.milestoneCongrats;
    snap.showStuckAssist =
      this.mode === 'campaign' &&
      !this.isVictory &&
      !this.stuckAssistActive &&
      this.saveManager.getConsecutiveFailures(this.currentLevel.id) >= 2;
    snap.hasEliteTitle = this.saveManager.hasEliteTitle();
    snap.hasPermanentCoinBonus = this.saveManager.hasPermanentCoinBonus();
    snap.hasFinalHonorBadge = this.saveManager.hasFinalHonorBadge();
    snap.nextMilestone = getNextMilestone(save.unlockedLevel, save.claimedMilestones);
    snap.reviveProgressPct = Math.min(
      99,
      Math.round((this.elapsed / Math.max(1, this.currentLevel.duration)) * 100),
    );
    snap.revivesRemaining = Math.max(0, AD_RULES.maxRevivesPerRun - this.revivesUsedThisRun);
    snap.resultClaimed = this.resultClaimed;
    snap.airdrop = this.airdrop;
    snap.save = save;
    snap.toast = this.toast;
    snap.safeTop = insets.top;

    snap.upgradeCosts.attack = this.saveManager.getUpgradeCost('attack');
    snap.upgradeCosts.firerate = this.saveManager.getUpgradeCost('firerate');
    snap.upgradeCosts.squad = this.saveManager.getUpgradeCost('squad');
    snap.canAfford.attack = this.saveManager.canUpgrade('attack');
    snap.canAfford.firerate = this.saveManager.canUpgrade('firerate');
    snap.canAfford.squad = this.saveManager.canUpgrade('squad');
    this.saveManager.getCheapestUpgradeGap(
      this.resultClaimed ? 0 : this.runCoins,
      this.upgradeGapCache,
    );
    snap.upgradeGap = this.upgradeGapCache;

    this.renderer.render(snap, this.renderActions);
  }
}
