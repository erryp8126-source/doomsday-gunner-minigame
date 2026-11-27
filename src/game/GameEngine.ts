import { AD_RULES } from '../config/adConfig';
import { LEVELS, getEndlessWaveConfig, getLevelConfig } from '../config/levels';
import { WEAPONS, getSkinDef } from '../config/weapons';
import type { PlatformSDK } from '../sdk/PlatformSDK';
import { AssetLoader } from './AssetLoader';
import { ObjectPool } from './ObjectPool';
import { Renderer } from './Renderer';
import { SaveManager } from './SaveManager';
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PLAYER_Y,
  ROAD_LEFT,
  ROAD_RIGHT,
  ROAD_W,
  clamp,
  type AirdropCrate,
  type Barrel,
  type BarrelRewardType,
  type Bullet,
  type DamageText,
  type GameMode,
  type GameState,
  type Gate,
  type Particle,
  type SkinDef,
  type ToastMessage,
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
      | 'armory_unlock',
    label: string,
  ) => Promise<boolean>;
  tryInterstitial?: (sceneLabel: string) => Promise<void>;
}

/**
 * 小队同心环站位计算（引擎发射点与渲染绘制共用）
 */
export function getTrooperPositions(
  count: number,
  cx: number,
  cy: number,
): Array<{ x: number; y: number }> {
  const vis = Math.min(Math.max(1, count), 16);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < vis; i++) {
    if (i === 0) {
      pts.push({ x: cx, y: cy });
    } else {
      const ring = i <= 6 ? 1 : 2;
      const idx = ring === 1 ? i - 1 : i - 7;
      const cap = ring === 1 ? 6 : 9;
      const ang = (idx / cap) * Math.PI * 2 + ring * 0.45;
      const r = ring * 34;
      pts.push({
        x: clamp(cx + Math.cos(ang) * r, ROAD_LEFT + 22, ROAD_RIGHT - 22),
        y: cy + Math.sin(ang) * (r * 0.68),
      });
    }
  }
  return pts;
}

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
  private combo = 0;
  private maxCombo = 0;
  private comboTimer = 0;
  private comboPulse = 1;
  private isVictory = false;
  private revivesUsedThisRun = 0;
  private airdropTriggeredThisRun = false;
  private resultClaimed = false;
  private toast: ToastMessage | null = null;
  private unbindFns: Array<() => void> = [];

  private readonly airdrop: AirdropCrate = {
    active: false,
    x: LOGICAL_WIDTH / 2,
    y: -60,
    speed: 145,
    claimed: false,
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
    260,
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
    260,
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
    60,
  );

  constructor(sdk: PlatformSDK, saveManager: SaveManager, adHooks: AdHooks = {}) {
    this.sdk = sdk;
    this.saveManager = saveManager;
    this.adHooks = adHooks;
    this.assetLoader = new AssetLoader(sdk);

    const canvas = this.sdk.getCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('画布上下文初始化失败');
    }
    this.ctx = ctx;
    this.renderer = new Renderer(ctx, this.assetLoader);
    this.syncCanvasResolution();
  }

  public start(): void {
    const data = this.saveManager.getData();
    this.sdk.setMuted(data.muted);
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
            this.setState('PAUSED');
          }
        },
        () => {},
      ),
    );

    this.setState('MENU');

    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTimestamp) / 1000));
      this.lastTimestamp = now;
      this.update(dt);
      this.render();
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
    }
  }

  public syncSaveAfterReset(): void {
    const data = this.saveManager.getData();
    this.currentLevel = getLevelConfig(data.selectedLevel);
    this.sdk.setMuted(data.muted);
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
    canvas.width = Math.round(LOGICAL_WIDTH * Math.min(vp.pixelRatio, 2));
    canvas.height = Math.round(LOGICAL_HEIGHT * Math.min(vp.pixelRatio, 2));
    const scale = canvas.width / LOGICAL_WIDTH;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  public showToast(text: string, color = '#fbbf24', duration = 2.1): void {
    this.toast = { text, color, timer: duration, duration };
  }

  private addShake(power: number, duration: number): void {
    this.shakePower = Math.max(this.shakePower, power);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
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

    const skin = getSkinDef(this.saveManager.getData().equippedSkin);
    const baseSquad = this.saveManager.getInitialSquadSize() + skin.startSquadBonus;

    this.squadX = LOGICAL_WIDTH / 2;
    this.targetX = LOGICAL_WIDTH / 2;
    this.squadCount = withSuperStart ? Math.max(5, baseSquad + 3) : baseSquad;
    this.weaponId = withSuperStart ? 'gatling' : 'pistol';
    this.fireRateBonus = 1;
    this.doubleFireTimer = 0;
    this.invincibleTimer = 0;

    this.fireCd = 0;
    this.recoil = 0;
    this.muzzleFlash = 0;
    this.shakeTimer = 0;
    this.damageVignette = 0;

    this.elapsed = 0;
    this.zombieTimer = 0.55;
    this.barrelTimer = 1.5;
    this.gateTimer = 6.5;
    this.bossSpawned = false;
    this.bossRef = null;

    this.kills = 0;
    this.runCoins = 0;
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

    this.saveManager.incrementRunCount();
    this.setState('PLAYING');

    if (withSuperStart) {
      this.showToast(`满配开局！重型加特林与 ${this.squadCount} 名队友出击`, '#4ade80');
    } else if (mode === 'endless') {
      this.showToast('无尽尸潮第1波 · 准备迎战', '#c084fc');
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
      | 'armory_unlock',
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
    this.saveManager.recordBestKills(this.kills);

    if (this.mode === 'endless') {
      const rec = this.saveManager.recordEndlessResult(
        this.endlessWave,
        this.kills,
        Math.floor(this.totalSurviveSec),
      );
      this.isNewEndlessRecord = rec.isNewRecord;
      this.runCoins = Math.max(30, this.runCoins);
      this.sdk.playSound('defeat');
      this.sdk.vibrate('medium');
    } else if (victory) {
      this.runCoins += this.currentLevel.clearCoins;
      this.saveManager.markLevelCleared(this.currentLevel.id, LEVELS.length);
      this.sdk.playSound('victory');
      this.sdk.vibrate('heavy');
    } else {
      this.runCoins = Math.max(20, this.runCoins);
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

    if (this.keyAxis !== 0) {
      this.targetX += this.keyAxis * 500 * dt;
    }
    this.targetX = clamp(this.targetX, ROAD_LEFT + 30, ROAD_RIGHT - 30);
    this.squadX += (this.targetX - this.squadX) * Math.min(1, dt * 18);

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

    // 局内超级空投（尸王登场前 10 秒空降）
    if (
      !this.airdropTriggeredThisRun &&
      !this.bossSpawned &&
      this.elapsed >= Math.max(8, lv.duration - AD_RULES.airdropLeadSec)
    ) {
      this.airdropTriggeredThisRun = true;
      this.airdrop.active = true;
      this.airdrop.claimed = false;
      this.airdrop.x = LOGICAL_WIDTH / 2 + (Math.random() > 0.5 ? 72 : -72);
      this.airdrop.y = -50;
      this.showToast('空投支援降落，点击可领强力补给', '#fde047');
    }

    if (this.airdrop.active && !this.airdrop.claimed) {
      this.airdrop.y += this.airdrop.speed * dt;
      if (this.airdrop.y >= PLAYER_Y - 18 && Math.abs(this.airdrop.x - this.squadX) < 58) {
        this.openAirdropModal();
        return;
      }
      if (this.airdrop.y > LOGICAL_HEIGHT + 60) {
        this.airdrop.active = false;
      }
    }

    // 尸王登场
    if (!this.bossSpawned && this.elapsed >= lv.duration) {
      this.spawnBoss();
    }

    this.zombieTimer -= dt;
    if (this.zombieTimer <= 0) {
      this.spawnZombieWave();
      if (this.bossSpawned) {
        this.zombieTimer = 2.8;
      } else if (this.elapsed < 12) {
        this.zombieTimer = Math.max(1.75, 2.05 - (this.elapsed / 12) * 0.25);
      } else {
        const p = Math.min(1, this.elapsed / lv.duration);
        const ramp = Math.min(1, (this.elapsed - 12) / Math.max(10, lv.duration - 12));
        const baseInterval = Math.max(0.85, 2.05 - p * 0.95 - (Math.min(5, lv.id) - 1) * 0.08);
        this.zombieTimer = Math.max(0.62, baseInterval * (1 - 0.25 * ramp));
      }
    }

    this.barrelTimer -= dt;
    if (this.barrelTimer <= 0) {
      this.spawnBarrel();
      this.barrelTimer = 4.6 + Math.random() * 1.5;
    }

    this.gateTimer -= dt;
    if (this.gateTimer <= 0 && !this.bossSpawned) {
      this.spawnGatePair();
      this.gateTimer = 11.2;
    }

    this.updateBulletsAndCollisions(dt);
    if (this.state !== 'PLAYING') return;

    this.updateBarrels(dt);
    if (this.state !== 'PLAYING') return;

    this.updateGates(dt);
    if (this.state !== 'PLAYING') return;

    this.updateZombies(dt);
  }

  private fireSquad(): void {
    const w = WEAPONS[this.weaponId];
    const skin = getSkinDef(this.saveManager.getData().equippedSkin);
    const shooters = Math.min(this.squadCount, 8);
    const overflowMult = this.squadCount > 8 ? 1 + (this.squadCount - 8) * 0.08 : 1;
    const totalDmgMult =
      overflowMult *
      this.saveManager.getAttackMultiplier() *
      (1 + skin.damageBonus) *
      (this.doubleFireTimer > 0 ? 2 : 1);

    const pts = getTrooperPositions(shooters, this.squadX, PLAYER_Y);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
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

      if (prog > 0.12 && r < lv.runnerRate) {
        kind = 'runner';
        hp = Math.floor(baseHp * 0.78);
        speed = Math.round((205 + prog * 58) * 1.18);
        scale = 0.96;
        radius = 26;
      } else if (prog > 0.24 && r > 1 - lv.tankRate) {
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

    this.addShake(14, 0.38);
    this.sdk.playSound('boss_alert');
    this.showToast(`警告：${lv.bossName}来袭，全队集火`, '#f87171');
  }

  private spawnSingleBarrel(laneX: number, y: number, forcedIdx?: number): number {
    const b = this.barrelPool.acquire();
    const lv = this.currentLevel;
    const prog = Math.min(1, this.elapsed / lv.duration);

    const picks: Array<{
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
    const idx = forcedIdx !== undefined ? forcedIdx % picks.length : Math.floor(Math.random() * picks.length);
    const pick = picks[idx];
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
    return idx;
  }

  private spawnBarrel(): void {
    const laneXs = [ROAD_LEFT + ROAD_W * 0.24, LOGICAL_WIDTH / 2, ROAD_LEFT + ROAD_W * 0.76];
    if (this.elapsed >= 10 && !this.bossSpawned && Math.random() < 0.35) {
      if (Math.random() < 0.5) {
        // 左右并列双木桶，诱发路径取舍
        const firstIdx = this.spawnSingleBarrel(laneXs[0], -75);
        this.spawnSingleBarrel(laneXs[2], -75, firstIdx + 1 + Math.floor(Math.random() * 4));
      } else {
        // 一侧木桶 + 对侧丧尸群组合，强迫玩家抉择打桶或清怪
        const barrelOnLeft = Math.random() < 0.5;
        this.spawnSingleBarrel(barrelOnLeft ? laneXs[0] : laneXs[2], -75);
        this.spawnZombieWave(barrelOnLeft ? laneXs[2] : laneXs[0], 3 + Math.floor(Math.random() * 2), -85);
      }
      return;
    }
    this.spawnSingleBarrel(laneXs[Math.floor(Math.random() * laneXs.length)], -75);
  }

  private spawnGatePair(): void {
    const pairId = this.gatePairSeq++;
    const leftPos = Math.random() > 0.5;
    const cfgs = [
      { x: ROAD_LEFT + ROAD_W * 0.25, positive: leftPos },
      { x: ROAD_LEFT + ROAD_W * 0.75, positive: !leftPos },
    ];

    for (let i = 0; i < 2; i++) {
      const g = this.gatePool.acquire();
      g.x = cfgs[i].x;
      g.y = -75;
      g.w = ROAD_W * 0.48;
      g.h = 78;
      g.speed = 166;
      g.pairId = pairId;
      g.used = false;
      g.hitFlash = 0;
      g.hitAccum = 0;
      if (cfgs[i].positive) {
        g.kind = Math.random() > 0.35 ? 'squad' : 'rate';
        g.value = g.kind === 'squad' ? 1 + Math.floor(Math.random() * 2) : 15;
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
    if (!isCrit && !isSplash && z.kind === 'tank') {
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
    } else if (boss.rageStage < 2 && ratio <= 0.3) {
      this.triggerBossRage(boss, 2);
    }
  }

  private triggerBossRage(boss: Zombie, stage: number): void {
    boss.rageStage = stage;
    boss.rageTimer = 4.0;
    this.addShake(16, 0.45);
    this.sdk.playSound('boss_alert');
    this.sdk.vibrate('heavy');
    this.showToast('尸王狂暴！召唤尸潮！', '#ef4444', 2.4);

    for (let side = 0; side < 2; side++) {
      const baseX = side === 0 ? ROAD_LEFT + 34 : ROAD_RIGHT - 34;
      const dir = side === 0 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        this.spawnFlankRunner(baseX + dir * k * 14, Math.max(40, boss.y + 15 + k * 28));
      }
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

    this.runCoins += z.isBoss ? 80 : z.kind === 'tank' ? 8 : 3;
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
      if (this.mode === 'endless') {
        this.runCoins += this.currentLevel.clearCoins;
        this.squadCount = Math.min(36, this.squadCount + 2);
        this.sdk.playSound('victory');
        this.sdk.vibrate('heavy');
        this.endlessWave += 1;
        this.currentLevel = getEndlessWaveConfig(this.endlessWave);
        this.elapsed = 0;
        this.bossSpawned = false;
        this.airdropTriggeredThisRun = false;
        this.airdrop.active = false;
        this.airdrop.claimed = false;
        this.showToast(`击破尸王！增援两名队友，进入无尽第${this.endlessWave}波`, '#fde047', 2.8);
      } else {
        this.triggerGameOver(true);
      }
    }
  }

  private updateBulletsAndCollisions(dt: number): void {
    this.bulletPool.forEachActive((b) => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -40 || b.x < ROAD_LEFT - 40 || b.x > ROAD_RIGHT + 40) {
        this.bulletPool.release(b);
        return;
      }

      let hit = false;

      // 1) 红蓝能量门（加大负门转化门槛，避免白嫖）
      this.gatePool.forEachActive((g) => {
        if (hit || g.used) return;
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
        }
      });
      if (hit) {
        this.bulletPool.release(b);
        return;
      }

      // 2) 数字木桶
      this.barrelPool.forEachActive((br) => {
        if (hit) return;
        const dx = b.x - br.x;
        const dy = b.y - br.y;
        if (dx * dx + dy * dy <= (br.radius + b.radius) * (br.radius + b.radius)) {
          br.hp -= b.damage;
          br.hitScale = 1.15;
          br.hitFlash = 0.08;
          this.spawnParticles(b.x, b.y, '#e3a857', 3, 120, 5);
          if (br.hp <= 0) {
            this.sdk.playSound('break_barrel');
            this.addShake(7, 0.16);
            this.spawnParticles(br.x, br.y, '#d99b52', 18, 270, 9);
            this.spawnParticles(br.x, br.y, '#ffe066', 10, 210, 6);
            if (br.rewardType === 'weapon') {
              this.weaponId = br.rewardWeapon;
              this.spawnFloatText(br.x, br.y - 25, `装备 ${br.rewardLabel}`, '#38bdf8', 34);
            } else if (br.rewardType === 'squad') {
              this.squadCount = Math.min(36, this.squadCount + br.rewardVal);
              this.spawnFloatText(br.x, br.y - 25, `队友 +${br.rewardVal}`, '#4ade80', 34);
            } else {
              this.fireRateBonus = Math.min(2.6, this.fireRateBonus + br.rewardVal);
              this.spawnFloatText(br.x, br.y - 25, '射速提升', '#fbbf24', 34);
            }
            this.barrelPool.release(br);
          }
          hit = true;
        }
      });
      if (hit) {
        this.bulletPool.release(b);
        return;
      }

      // 3) 丧尸与尸王
      this.zombiePool.forEachActive((z) => {
        if (hit || z.dying) return;
        const dx = b.x - z.x;
        const dy = b.y - z.y;
        const r = z.radius + b.radius;
        if (dx * dx + dy * dy <= r * r) {
          if (b.splash > 0) {
            this.sdk.playSound('explosion');
            this.addShake(8, 0.15);
            this.spawnParticles(b.x, b.y, '#ff7675', 16, 280, 9);
            this.zombiePool.forEachActive((sz) => {
              if (sz.dying) return;
              const sdx = sz.x - b.x;
              const sdy = sz.y - b.y;
              if (sdx * sdx + sdy * sdy <= b.splash * b.splash) {
                this.applyZombieDamage(sz, b.damage, false, true, b.x, b.y);
              }
            });
          } else {
            const critRate = this.combo >= 25 ? 0.36 : this.combo >= 10 ? 0.28 : 0.2;
            const isCrit = Math.random() < critRate;
            const rawDmg = isCrit ? b.damage * 2.0 : b.damage;
            if (!z.isBoss) z.y -= isCrit ? 10 : 5;
            const dealt = this.applyZombieDamage(z, rawDmg, isCrit, false, b.x, b.y);
            if (isCrit) {
              this.addShake(5.5, 0.09);
              this.sdk.playSound('crit');
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
        }
      });

      if (hit) {
        this.bulletPool.release(b);
      }
    });
  }

  private updateBarrels(dt: number): void {
    this.barrelPool.forEachActive((br) => {
      br.y += br.speed * dt;
      br.hitScale += (1 - br.hitScale) * Math.min(1, dt * 15);
      if (br.hitFlash > 0) br.hitFlash -= dt;

      const dx = br.x - this.squadX;
      const dy = br.y - PLAYER_Y;
      if (dx * dx + dy * dy < (br.radius + 32) * (br.radius + 32)) {
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
          }
        }
        return;
      }

      if (br.y > LOGICAL_HEIGHT + 90) {
        this.barrelPool.release(br);
      }
    });
  }

  private updateGates(dt: number): void {
    this.gatePool.forEachActive((g) => {
      g.y += g.speed * dt;
      if (g.hitFlash > 0) g.hitFlash -= dt;

      if (!g.used && Math.abs(g.y - PLAYER_Y) < 46 && Math.abs(g.x - this.squadX) < g.w / 2 + 12) {
        const pid = g.pairId;
        this.gatePool.forEachActive((other) => {
          if (other.pairId === pid) other.used = true;
        });

        this.sdk.playSound(g.value >= 0 ? 'gate_pos' : 'gate_neg');
        if (g.kind === 'squad') {
          this.squadCount = Math.min(36, this.squadCount + g.value);
          this.spawnFloatText(
            this.squadX,
            PLAYER_Y - 60,
            g.value >= 0 ? `队友 +${g.value}` : `队友 ${g.value}`,
            g.value >= 0 ? '#4ade80' : '#ff4757',
            34,
          );
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
    });
  }

  private updateZombies(dt: number): void {
    this.zombiePool.forEachActive((z) => {
      if (z.dying) {
        z.dieLife -= dt;
        z.x += z.vx * dt;
        z.y += z.vy * dt;
        z.vy += 900 * dt;
        z.rot += z.vrot * dt;
        if (z.dieLife <= 0) this.zombiePool.release(z);
        return;
      }

      z.phase += dt * (z.kind === 'runner' ? 14.5 : 7.5);
      const speedMult = z.isBoss && z.rageTimer > 0 ? 1.3 : 1.0;
      if (z.rageTimer > 0) z.rageTimer = Math.max(0, z.rageTimer - dt);
      z.y += z.speed * speedMult * dt;
      if (z.hitFlash > 0) z.hitFlash -= dt;

      if (z.kind === 'runner' && z.y > 420) {
        const diff = this.squadX - z.x;
        if (Math.abs(diff) > 4) {
          z.x = clamp(z.x + Math.sign(diff) * Math.min(Math.abs(diff), 128 * dt), ROAD_LEFT + 24, ROAD_RIGHT - 24);
        }
      } else if (z.y > 700) {
        z.x += Math.sign(this.squadX - z.x) * (z.isBoss ? 52 : 66) * dt;
      }

      const dx = z.x - this.squadX;
      const dy = z.y - PLAYER_Y;
      const colR = z.radius + Math.min(48, 22 + this.squadCount * 1.3);
      if (dx * dx + dy * dy < colR * colR) {
        if (this.invincibleTimer > 0) {
          if (!z.isBoss) {
            this.spawnParticles(z.x, z.y, '#38bdf8', 10, 210, 7);
            this.zombiePool.release(z);
          }
          return;
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
        }
        return;
      }

      if (z.y > LOGICAL_HEIGHT + 95) {
        if (z.isBoss) {
          this.squadCount = 0;
          this.handleSquadZero();
          return;
        }
        this.zombiePool.release(z);
      }
    });
  }

  private updateEffects(dt: number): void {
    if (this.state === 'PLAYING') {
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.combo = 0;
      }
      this.comboPulse += (1 - this.comboPulse) * Math.min(1, dt * 14);
    }

    this.particlePool.forEachActive((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.93;
      p.vy *= 0.93;
      p.life -= dt;
      if (p.life <= 0) this.particlePool.release(p);
    });

    this.floatTextPool.forEachActive((ft) => {
      ft.y += ft.vy * dt;
      ft.life -= dt;
      if (ft.life <= 0) this.floatTextPool.release(ft);
    });
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
    this.squadCount = 5;
    this.invincibleTimer = 2.5;
    this.sdk.playSound('explosion');
    this.addShake(14, 0.35);

    this.zombiePool.forEachActive((z) => {
      if (z.isBoss) {
        z.y = Math.min(z.y, 160);
        z.hp = Math.max(1, z.hp - z.maxHp * 0.2);
        z.hitFlash = 0.15;
      } else {
        this.spawnParticles(z.x, z.y, '#38bdf8', 8, 220, 7);
        this.zombiePool.release(z);
      }
    });
    this.showToast('满血复活！五名队友回归并全屏清怪', '#4ade80');
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

  private render(): void {
    const save = this.saveManager.getData();
    const insets = this.sdk.getLogicalSafeInsets();
    const skin = getSkinDef(save.equippedSkin);
    const weapon = WEAPONS[this.weaponId];
    const shakeX = this.shakeTimer > 0 ? (Math.random() - 0.5) * this.shakePower : 0;
    const shakeY = this.shakeTimer > 0 ? (Math.random() - 0.5) * this.shakePower : 0;
    const revivePct = Math.min(99, Math.round((this.elapsed / Math.max(1, this.currentLevel.duration)) * 100));

    this.renderer.render(
      {
        mode: this.mode,
        endlessWave: this.endlessWave,
        totalSurviveSec: this.totalSurviveSec,
        isNewEndlessRecord: this.isNewEndlessRecord,
        state: this.state,
        clock: this.clock,
        roadScroll: this.roadScroll,
        shakeX,
        shakeY,
        damageVignette: this.damageVignette,
        recoil: this.recoil,
        muzzleFlash: this.muzzleFlash,
        squadX: this.squadX,
        squadCount: this.squadCount,
        weapon,
        doubleFireTimer: this.doubleFireTimer,
        invincibleTimer: this.invincibleTimer,
        skin,
        level: this.currentLevel,
        elapsed: this.elapsed,
        bossSpawned: this.bossSpawned,
        bossRef: this.bossRef,
        kills: this.kills,
        runCoins: this.runCoins,
        combo: this.combo,
        comboTimer: this.comboTimer,
        comboPulse: this.comboPulse,
        isVictory: this.isVictory,
        reviveProgressPct: revivePct,
        resultClaimed: this.resultClaimed,
        airdrop: this.airdrop,
        save,
        toast: this.toast,
        safeTop: insets.top,
        upgradeCosts: {
          attack: this.saveManager.getUpgradeCost('attack'),
          firerate: this.saveManager.getUpgradeCost('firerate'),
          squad: this.saveManager.getUpgradeCost('squad'),
        },
        canAfford: {
          attack: this.saveManager.canUpgrade('attack'),
          firerate: this.saveManager.canUpgrade('firerate'),
          squad: this.saveManager.canUpgrade('squad'),
        },
        bullets: this.bulletPool,
        zombies: this.zombiePool,
        barrels: this.barrelPool,
        gates: this.gatePool,
        particles: this.particlePool,
        texts: this.floatTextPool,
      },
      {
        onStartSuperBattle: async () => {
          const ok = await this.requestRewardedAction('pre_battle_boost', '重型加特林与五人满配开局');
          if (ok) {
            this.startGame('campaign', true);
          }
        },
        onStartBattle: () => this.startGame('campaign', false),
        onStartEndless: () => this.startGame('endless', false),
        onPrevLevel: () => {
          this.saveManager.selectLevel(save.selectedLevel - 1);
          this.currentLevel = getLevelConfig(this.saveManager.getData().selectedLevel);
        },
        onNextLevel: () => {
          this.saveManager.selectLevel(save.selectedLevel + 1);
          this.currentLevel = getLevelConfig(this.saveManager.getData().selectedLevel);
        },
        onUpgradeAttack: () => {
          if (this.saveManager.upgrade('attack')) this.showToast('基础攻击已提升', '#4ade80');
        },
        onUpgradeFireRate: () => {
          if (this.saveManager.upgrade('firerate')) this.showToast('初始射速已提升', '#4ade80');
        },
        onUpgradeSquad: () => {
          if (this.saveManager.upgrade('squad')) this.showToast('初始人数已增加', '#4ade80');
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
          if (this.state === 'RESULT' && !this.resultClaimed) {
            this.claimResultCoins(1);
          }
          if (this.state === 'RESULT' && this.adHooks.tryInterstitial) {
            await this.adHooks.tryInterstitial('局后重开插屏');
          }
          this.startGame(this.mode, false);
        },
        onBackToMenu: async () => {
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
            this.stateBeforePause = 'PLAYING';
            this.setState('PAUSED');
          } else if (this.state === 'PAUSED') {
            this.setState(this.stateBeforePause);
          }
        },
        onToggleMute: () => {
          const next = !this.saveManager.getData().muted;
          this.saveManager.setMuted(next);
          this.sdk.setMuted(next);
          this.showToast(next ? '已开启静音' : '已开启音效');
        },
      },
    );
  }
}
