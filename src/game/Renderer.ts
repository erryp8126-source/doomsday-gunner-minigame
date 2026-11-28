import { getLevelThemeMeta } from '../config/levels';
import { SKINS } from '../config/weapons';
import type { RecorderSnapshot, SidebarStatus } from '../sdk/PlatformSDK';
import type { AssetLoader } from './AssetLoader';
import {
  drawButton,
  drawPanelCard,
  drawProgressBar,
  drawRoundedRect,
  HitBoxRegistry,
  type ButtonStyle,
} from './CanvasUI';
import {
  createTrooperBuffer,
  fillTrooperPositions,
  type TrooperPoint,
} from './GameEngine';
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PLAYER_Y,
  ROAD_LEFT,
  ROAD_RIGHT,
  type AirdropCrate,
  type Barrel,
  type BossCombatState,
  type BossFireball,
  type Bullet,
  type DamageText,
  type GameMode,
  type GameState,
  type Gate,
  type GuideBannerState,
  type LevelConfig,
  type MilestoneDef,
  type Particle,
  type SaveData,
  type SkinDef,
  type ThemeBannerState,
  type ToastMessage,
  type UpgradeGapInfo,
  type WeaponBannerState,
  type WeaponDef,
  type Zombie,
} from './types';

export interface RenderPoolView<T> {
  getRawItems: () => readonly T[];
  forEachActive: (fn: (item: T) => void) => void;
}

export interface RenderSnapshot {
  renderScale: number;
  renderOffsetX?: number;
  renderOffsetY?: number;
  mode: GameMode;
  endlessWave: number;
  totalSurviveSec: number;
  isNewEndlessRecord: boolean;
  state: GameState;
  clock: number;
  roadScroll: number;
  shakeX: number;
  shakeY: number;
  damageVignette: number;
  recoil: number;
  muzzleFlash: number;
  squadX: number;
  squadCount: number;
  weapon: WeaponDef;
  doubleFireTimer: number;
  invincibleTimer: number;
  resumeGraceTimer: number;
  weaponBanner: WeaponBannerState;
  guideBanner: GuideBannerState;
  themeBanner: ThemeBannerState;
  stuckAssistActive: boolean;
  overflowAttackBonus: number;
  hasArmoryRedDot: boolean;
  skin: SkinDef;
  level: LevelConfig;
  elapsed: number;
  bossSpawned: boolean;
  bossRef: Zombie | null;
  bossState: BossCombatState;
  effectivePlatform: 'wechat' | 'douyin';
  endlessUnlocked: boolean;
  tutorialAlpha: number;
  sidebar: SidebarStatus;
  recorder: RecorderSnapshot;
  canClaimSidebarReward: boolean;
  canClaimVideoReward: boolean;
  kills: number;
  runCoins: number;
  combo: number;
  comboTimer: number;
  comboPulse: number;
  isVictory: boolean;
  justUnlockedEndless: boolean;
  milestoneCongrats: MilestoneDef | null;
  showStuckAssist: boolean;
  hasEliteTitle: boolean;
  hasPermanentCoinBonus: boolean;
  hasFinalHonorBadge: boolean;
  nextMilestone: MilestoneDef | null;
  reviveProgressPct: number;
  revivesRemaining: number;
  resultClaimed: boolean;
  airdrop: AirdropCrate;
  save: SaveData;
  toast: ToastMessage | null;
  safeTop: number;
  upgradeCosts: { attack: number; firerate: number; squad: number };
  canAfford: { attack: boolean; firerate: boolean; squad: boolean };
  upgradeGap: UpgradeGapInfo;
  bullets: RenderPoolView<Bullet>;
  zombies: RenderPoolView<Zombie>;
  barrels: RenderPoolView<Barrel>;
  gates: RenderPoolView<Gate>;
  particles: RenderPoolView<Particle>;
  texts: RenderPoolView<DamageText>;
  bossFireballs: RenderPoolView<BossFireball>;
}

export interface RenderActions {
  onStartSuperBattle: () => void;
  onStartBattle: () => void;
  onStartEndless: () => void;
  onPrevLevel: () => void;
  onNextLevel: () => void;
  onUpgradeAttack: () => void;
  onUpgradeFireRate: () => void;
  onUpgradeSquad: () => void;
  onOpenArmory: () => void;
  onCloseArmory: () => void;
  onArmorySkinAction: (skin: SkinDef) => void;
  onTriggerAirdrop: () => void;
  onAirdropChooseRocket: () => void;
  onAirdropChooseDouble: () => void;
  onAirdropDismiss: () => void;
  onReviveWatchAd: () => void;
  onReviveGiveUp: () => void;
  onResultClaimNormal: () => void;
  onResultClaimAd: () => void;
  onRestartBattle: () => void;
  onBackToMenu: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onOpenAgeModal: () => void;
  onCloseAgeModal: () => void;
  onToggleVibrate: () => void;
  onClickSidebarGift: () => void;
  onShareScore: () => void;
  onShareHighlightVideo: () => void;
  onStartStuckAssist: () => void;
}

const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", sans-serif';
const EMPTY_DASH: number[] = [];
const AIRDROP_DASH: number[] = [12, 8];

const HUD_PAUSE_BTN_STYLE: ButtonStyle = {
  fillTop: '#334155',
  fillBottom: '#1e293b',
  borderColor: '#64748b',
  fontSize: 20,
  radius: 12,
};

const HUD_MUTE_ON_BTN_STYLE: ButtonStyle = {
  fillTop: '#475569',
  fillBottom: '#334155',
  borderColor: '#64748b',
  fontSize: 20,
  radius: 12,
};

const HUD_MUTE_OFF_BTN_STYLE: ButtonStyle = {
  fillTop: '#1e293b',
  fillBottom: '#0f172a',
  borderColor: '#64748b',
  fontSize: 20,
  radius: 12,
};

function compareZombieY(a: Zombie, b: Zombie): number {
  return a.y - b.y;
}

function sortTrooperPointsByY(pts: TrooperPoint[], len: number): void {
  for (let i = 1; i < len; i++) {
    const keyX = pts[i].x;
    const keyY = pts[i].y;
    let j = i - 1;
    while (j >= 0 && pts[j].y > keyY) {
      pts[j + 1].x = pts[j].x;
      pts[j + 1].y = pts[j].y;
      j -= 1;
    }
    pts[j + 1].x = keyX;
    pts[j + 1].y = keyY;
  }
}

/**
 * 2D 精绘 Canvas 渲染引擎（严格对齐原型视觉表现 + 零 GC 抖动 + 60fps 批量绘制 + 100% 纯简体中文）
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly assets: AssetLoader;
  public readonly hitBoxes = new HitBoxRegistry();

  private readonly renderSortBuf: Zombie[] = [];
  private readonly squadPosBuf = createTrooperBuffer();
  private readonly floatFontCache = new Map<number, string>();
  private readonly armoryClickFns = new Map<string, () => void>();
  private lastHudBottomY = 122;

  private readonly damageVignetteGrad: CanvasGradient;
  private readonly menuOverlayGrad: CanvasGradient;

  private readonly menuSuperBtnStyle: ButtonStyle = {
    fillTop: '#ea580c',
    fillBottom: '#c2410c',
    borderColor: '#fed7aa',
    textColor: '#ffffff',
    fontSize: 22,
    subText: '加特林 + 5人开局',
    subTextColor: '#fef3c7',
    radius: 16,
  };

  private readonly menuStartBtnStyle: ButtonStyle = {
    fillTop: '#10b981',
    fillBottom: '#059669',
    borderColor: '#a7f3d0',
    fontSize: 34,
    subText: '',
    radius: 16,
    pulseScale: 1,
  };

  private readonly menuEndlessBtnStyle: ButtonStyle = {
    fillTop: '#9333ea',
    fillBottom: '#6b21a8',
    borderColor: '#f5d0fe',
    fontSize: 26,
    subText: '',
    subTextColor: '#fde047',
    radius: 16,
  };

  private readonly menuEndlessLockedBtnStyle: ButtonStyle = {
    fillTop: '#475569',
    fillBottom: '#334155',
    borderColor: '#64748b',
    textColor: '#cbd5e1',
    fontSize: 24,
    subText: '完成第 1 关解锁（奖励丰厚金币）',
    subTextColor: '#fde047',
    radius: 16,
  };

  private readonly upgradeBuyStyle: ButtonStyle = {
    fillTop: '#22c55e',
    fillBottom: '#16a34a',
    fontSize: 18,
    radius: 12,
    disabled: false,
  };

  private readonly upgradeDisabledStyle: ButtonStyle = {
    fillTop: '#334155',
    fillBottom: '#1e293b',
    fontSize: 18,
    radius: 12,
    disabled: true,
  };

  constructor(ctx: CanvasRenderingContext2D, assets: AssetLoader) {
    this.ctx = ctx;
    this.assets = assets;

    this.damageVignetteGrad = ctx.createRadialGradient(
      LOGICAL_WIDTH * 0.5,
      LOGICAL_HEIGHT * 0.5,
      220,
      LOGICAL_WIDTH * 0.5,
      LOGICAL_HEIGHT * 0.5,
      680,
    );
    this.damageVignetteGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
    this.damageVignetteGrad.addColorStop(1, 'rgba(220, 38, 38, 1)');

    this.menuOverlayGrad = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
    this.menuOverlayGrad.addColorStop(0, 'rgba(9, 13, 20, 0.72)');
    this.menuOverlayGrad.addColorStop(0.55, 'rgba(9, 13, 20, 0.48)');
    this.menuOverlayGrad.addColorStop(1, 'rgba(9, 13, 20, 0.88)');
  }

  private getFloatFont(size: number): string {
    let font = this.floatFontCache.get(size);
    if (!font) {
      font = `900 ${size}px ${FONT_FAMILY}`;
      this.floatFontCache.set(size, font);
    }
    return font;
  }

  public render(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    const s = snap.renderScale || 1;
    const ox = snap.renderOffsetX || 0;
    const oy = snap.renderOffsetY || 0;
    const tx = snap.state === 'PLAYING' ? snap.shakeX : 0;
    const ty = snap.state === 'PLAYING' ? snap.shakeY : 0;
    this.hitBoxes.clear();
    this.lastHudBottomY = Math.max(22, snap.safeTop) + 104;

    ctx.save();
    ctx.setTransform(s, 0, 0, s, ox + s * tx, oy + s * ty);

    this.renderRoad(snap.roadScroll);
    this.renderBossGroundTelegraphs(snap);
    this.renderGates(snap);
    this.renderBarrels(snap);
    this.renderZombies(snap);
    if (snap.state !== 'MENU' && snap.state !== 'ARMORY' && snap.state !== 'AGE_MODAL') {
      this.renderSquad(snap);
    }
    this.renderBossProjectiles(snap);
    this.renderBulletsAndEffects(snap);

    if (snap.state === 'PLAYING') {
      this.renderHUD(snap, actions);
      if (snap.tutorialAlpha > 0.01) {
        this.renderSwipeTutorial(snap);
      }
    } else if (snap.state === 'MENU') {
      this.renderMenuOverlay(snap, actions);
    } else if (snap.state === 'AGE_MODAL') {
      this.renderMenuOverlay(snap, actions, true);
      this.renderAgeModal(actions);
    } else if (snap.state === 'ARMORY') {
      this.renderMenuOverlay(snap, actions, true);
      this.renderArmoryModal(snap, actions);
    } else if (snap.state === 'PAUSED') {
      this.renderHUD(snap, actions);
      this.renderPauseModal(snap, actions);
    } else if (snap.state === 'AIRDROP_MODAL') {
      this.renderHUD(snap, actions);
      this.renderAirdropModal(actions);
    } else if (snap.state === 'REVIVE_MODAL') {
      this.renderHUD(snap, actions);
      this.renderReviveModal(snap, actions);
    } else if (snap.state === 'RESULT') {
      this.renderResultModal(snap, actions);
    }

    ctx.restore();
    ctx.setTransform(s, 0, 0, s, ox, oy);

    if (snap.state === 'PLAYING') {
      this.renderThumbRail(snap);
    }

    const lowHpAlpha =
      snap.state === 'PLAYING' && snap.squadCount > 0 && snap.squadCount <= 2
        ? 0.18 + 0.15 * (1 + Math.sin(snap.clock * 6))
        : 0;
    const vignetteAlpha = Math.max(Math.min(0.65, snap.damageVignette), lowHpAlpha);
    if (vignetteAlpha > 0.01) {
      ctx.globalAlpha = vignetteAlpha;
      ctx.fillStyle = this.damageVignetteGrad;
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.globalAlpha = 1;
    }

    if (snap.toast) {
      const inCombatHud = snap.state === 'PLAYING' || snap.state === 'PAUSED';
      this.renderToast(snap.toast, snap.safeTop, inCombatHud);
    }
  }

  private renderThumbRail(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const trackX = 128;
    const trackW = LOGICAL_WIDTH - 256;
    const trackY = 1196;
    const trackH = 10;
    const minX = ROAD_LEFT + 30;
    const maxX = ROAD_RIGHT - 30;
    const t = Math.max(0, Math.min(1, (snap.squadX - minX) / Math.max(1, maxX - minX)));
    const knobW = 52;
    const knobX = trackX + (trackW - knobW) * t;

    ctx.save();
    drawRoundedRect(ctx, trackX, trackY, trackW, trackH, 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.11)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    drawRoundedRect(ctx, knobX, trackY - 2, knobW, trackH + 4, 7);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 17px ${FONT_FAMILY}`;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.65)';
    ctx.fillText('单指左右滑动操控', LOGICAL_WIDTH / 2 + 1, 1233);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.68)';
    ctx.fillText('单指左右滑动操控', LOGICAL_WIDTH / 2, 1232);
    ctx.restore();
  }

  private renderRoad(roadScroll: number): void {
    const ctx = this.ctx;
    const cachedRoad = this.assets.cachedRoad;
    if (cachedRoad) {
      const period = LOGICAL_HEIGHT * 2;
      const offset = ((roadScroll % period) + period) % period;
      const srcY = Math.floor((LOGICAL_HEIGHT - offset + period) % period);
      if (srcY <= LOGICAL_HEIGHT) {
        ctx.drawImage(
          cachedRoad,
          0,
          srcY,
          LOGICAL_WIDTH,
          LOGICAL_HEIGHT,
          0,
          0,
          LOGICAL_WIDTH,
          LOGICAL_HEIGHT,
        );
      } else {
        const h1 = period - srcY;
        const h2 = LOGICAL_HEIGHT - h1;
        ctx.drawImage(cachedRoad, 0, srcY, LOGICAL_WIDTH, h1, 0, 0, LOGICAL_WIDTH, h1);
        ctx.drawImage(cachedRoad, 0, 0, LOGICAL_WIDTH, h2, 0, h1, LOGICAL_WIDTH, h2);
      }
      return;
    }

    const bg = this.assets.sprites.bg_road;
    if (bg) {
      const y0 = roadScroll % LOGICAL_HEIGHT;
      ctx.drawImage(bg, 0, y0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.save();
      ctx.translate(0, y0);
      ctx.scale(1, -1);
      ctx.drawImage(bg, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.restore();
    } else {
      ctx.fillStyle = '#2d3440';
      ctx.fillRect(-20, -20, LOGICAL_WIDTH + 40, LOGICAL_HEIGHT + 40);
    }
  }

  private renderBossGroundTelegraphs(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const bs = snap.bossState;

    // 1. 熔岩冲锋践踏纵向红色警戒跑道
    if (bs.action === 'CHARGE_WARN' || bs.action === 'CHARGE_DASH') {
      const rx = bs.chargeTargetX - bs.chargeHalfWidth;
      const rw = bs.chargeHalfWidth * 2;
      const ry = snap.bossRef ? Math.max(120, snap.bossRef.y) : 260;
      const rh = Math.max(120, PLAYER_Y + 60 - ry);
      const blink =
        bs.action === 'CHARGE_DASH'
          ? 0.36
          : 0.16 + 0.16 * Math.abs(Math.sin(snap.clock * 18));

      ctx.globalAlpha = blink;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(rx, ry, rw, rh);

      if (bs.action === 'CHARGE_WARN') {
        const prog = 1 - Math.max(0, Math.min(1, bs.chargeTimer / Math.max(0.01, bs.chargeDuration)));
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(rx + 4, ry, rw - 8, rh * prog);
      }

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fca5a5';
      ctx.fillRect(rx, ry, 4, rh);
      ctx.fillRect(rx + rw - 4, ry, 4, rh);

      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#fecaca';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let ay = ry + 48; ay < PLAYER_Y + 20; ay += 96) {
        ctx.moveTo(bs.chargeTargetX - 24, ay);
        ctx.lineTo(bs.chargeTargetX, ay + 22);
        ctx.lineTo(bs.chargeTargetX + 24, ay);
      }
      ctx.stroke();
    }

    // 2. 熔岩火球地面扩散红圈预警与爆炸环
    const fireballs = snap.bossFireballs.getRawItems();
    for (let i = 0; i < fireballs.length; i++) {
      const fb = fireballs[i];
      if (!fb.active) continue;

      if (!fb.exploded) {
        const p = 1 - Math.max(0, Math.min(1, fb.timer / Math.max(0.01, fb.duration)));
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(fb.targetX, fb.targetY, fb.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#fca5a5';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.globalAlpha = 0.44;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(fb.targetX, fb.targetY, Math.max(4, fb.radius * p), 0, Math.PI * 2);
        ctx.fill();
      } else if (fb.explodeFlash > 0) {
        const ep = 1 - fb.explodeFlash / 0.22;
        ctx.globalAlpha = Math.max(0, fb.explodeFlash / 0.22) * 0.78;
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(fb.targetX, fb.targetY, fb.radius * (0.9 + ep * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 3. 破盾超时全屏熔岩冲击波
    if (bs.shockwaveFlash > 0) {
      const sp = 1 - bs.shockwaveFlash / 0.55;
      const sx = snap.bossRef ? snap.bossRef.x : LOGICAL_WIDTH * 0.5;
      const sy = snap.bossRef ? snap.bossRef.y : 320;
      ctx.globalAlpha = Math.max(0, bs.shockwaveFlash / 0.55) * 0.85;
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(sx, sy, 80 + sp * 960, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  private renderBossProjectiles(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const fireballs = snap.bossFireballs.getRawItems();
    for (let i = 0; i < fireballs.length; i++) {
      const fb = fireballs[i];
      if (!fb.active || fb.exploded) continue;

      const t = 1 - Math.max(0, Math.min(1, fb.timer / Math.max(0.01, fb.duration)));
      const x = fb.startX + (fb.targetX - fb.startX) * t;
      const y = fb.startY + (fb.targetY - fb.startY) * t - Math.sin(t * Math.PI) * 180;
      const sc = 0.65 + 0.55 * t;

      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(x, y, 22 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(x, y, 15 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(x, y, 8 * sc, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderGates(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const gateItems = snap.gates.getRawItems();
    ctx.save();
    ctx.lineWidth = 4;
    ctx.font = `900 28px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < gateItems.length; i++) {
      const g = gateItems[i];
      if (!g.active || g.used) continue;

      const pos = g.value >= 0;
      const gx = g.x - g.w * 0.5;
      const gy = g.y - g.h * 0.5;
      drawRoundedRect(ctx, gx, gy, g.w, g.h, 14);
      ctx.fillStyle =
        g.hitFlash > 0
          ? 'rgba(255, 255, 255, 0.75)'
          : pos
            ? 'rgba(14, 165, 233, 0.62)'
            : 'rgba(239, 68, 68, 0.65)';
      ctx.fill();
      ctx.strokeStyle = pos ? '#7dd3fc' : '#fca5a5';
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(gx - 5, gy - 8, 10, g.h + 16);
      ctx.fillRect(gx + g.w - 5, gy - 8, 10, g.h + 16);

      const txt =
        g.kind === 'squad'
          ? `队友 ${g.value >= 0 ? '+' : ''}${g.value}`
          : `射速 ${g.value >= 0 ? '+' : ''}${g.value}%`;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillText(txt, g.x + 2, g.y + 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(txt, g.x, g.y + 1);
    }
    ctx.restore();
  }

  private renderBarrels(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const img = this.assets.sprites.barrel;
    const whiteImg = this.assets.whiteSprites.barrel;
    const shadowOval = this.assets.shadowOval;
    const barrelItems = snap.barrels.getRawItems();
    const bw = 114;
    const bh = 98;
    let idx = 0;

    for (let i = 0; i < barrelItems.length; i++) {
      const b = barrelItems[i];
      if (!b.active) continue;
      idx += 1;

      if (shadowOval) {
        ctx.drawImage(shadowOval, b.x - 54, b.y + 42 - 18, 108, 36);
      } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.beginPath();
        ctx.ellipse(b.x, b.y + 42, 54, 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      const hasScale = Math.abs(b.hitScale - 1) > 0.002;
      if (hasScale) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(b.hitScale, b.hitScale);
      }
      const ox = hasScale ? 0 : b.x;
      const oy = hasScale ? 0 : b.y;

      if (img) {
        ctx.drawImage(img, ox - bw * 0.5, oy - bh * 0.5, bw, bh);
        if (b.hitFlash > 0 && whiteImg) {
          ctx.globalAlpha = 0.72;
          ctx.drawImage(whiteImg, ox - bw * 0.5, oy - bh * 0.5, bw, bh);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = b.hitFlash > 0 ? '#fef3c7' : '#b45309';
        drawRoundedRect(ctx, ox - bw * 0.5, oy - bh * 0.5, bw, bh, 16);
        ctx.fill();
      }

      if (b.highlightGuide) {
        const ringPulse = 1 + Math.sin(snap.clock * 8) * 0.06;
        const rw = (bw + 24) * ringPulse;
        const rh = (bh + 24) * ringPulse;
        drawRoundedRect(ctx, ox - rw * 0.5, oy - rh * 0.5, rw, rh, 22);
        ctx.fillStyle = 'rgba(253, 224, 71, 0.14)';
        ctx.fill();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

      ctx.font = `900 40px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hpStr = String(Math.ceil(b.hp));
      ctx.fillStyle = '#1f1004';
      ctx.fillText(hpStr, ox + 2, oy + 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(hpStr, ox, oy + 2);

      if (hasScale) {
        ctx.restore();
      }

      const bob = Math.sin(snap.clock * 6 + idx) * 6;
      if (b.iconKey && this.assets.sprites[b.iconKey]) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.beginPath();
        ctx.arc(b.x, b.y - 68 + bob, 38, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(this.assets.sprites[b.iconKey]!, b.x - 42, b.y - 108 + bob, 84, 80);
      }

      drawRoundedRect(ctx, b.x - 58, b.y - 138 + bob, 116, 30, 10);
      ctx.fillStyle =
        b.rewardType === 'weapon' ? '#0284c7' : b.rewardType === 'squad' ? '#059669' : '#7c3aed';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 18px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.rewardLabel, b.x, b.y - 122 + bob);
    }
  }

  private renderZombies(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const zImg = this.assets.sprites.zombie;
    const zWhite = this.assets.whiteSprites.zombie;
    const rImg = this.assets.sprites.zombie_runner || zImg;
    const rWhite = this.assets.whiteSprites.zombie_runner || zWhite;
    const tImg = this.assets.sprites.zombie_tank || zImg;
    const tWhite = this.assets.whiteSprites.zombie_tank || zWhite;
    const bImg = this.assets.sprites.boss;
    const bWhite = this.assets.whiteSprites.boss;
    const shadowOval = this.assets.shadowOval;

    const list = this.renderSortBuf;
    list.length = 0;
    const zombieItems = snap.zombies.getRawItems();
    for (let i = 0; i < zombieItems.length; i++) {
      const z = zombieItems[i];
      if (z.active && z.y >= -140 && z.y <= LOGICAL_HEIGHT + 140) {
        list.push(z);
      }
    }
    list.sort(compareZombieY);

    const s = snap.renderScale || 1;
    const ox = snap.renderOffsetX || 0;
    const oy = snap.renderOffsetY || 0;
    const tx = snap.state === 'PLAYING' ? snap.shakeX : 0;
    const ty = snap.state === 'PLAYING' ? snap.shakeY : 0;

    // 通道 0：地面阴影（预烘焙贴图替代路径光栅化）与尸王狂暴光环
    if (!shadowOval) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    }
    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      if (z.dying) continue;
      const drawW =
        (z.isBoss ? 204 : z.kind === 'tank' ? 112 : z.kind === 'runner' ? 92 : 84) *
        (z.isBoss ? 1 : z.kind === 'normal' ? z.scale : 1);
      const drawH =
        (z.isBoss ? 204 : z.kind === 'tank' ? 132 : z.kind === 'runner' ? 98 : 106) *
        (z.isBoss ? 1 : z.kind === 'normal' ? z.scale : 1);
      const rx = drawW * 0.36;
      const ry = drawH * 0.13;
      const sy = z.y + drawH * 0.42;

      if (shadowOval) {
        ctx.drawImage(shadowOval, z.x - rx, sy - ry, rx * 2, ry * 2);
      } else {
        ctx.beginPath();
        ctx.ellipse(z.x, sy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (z.isBoss && z.rageTimer > 0) {
        const ragePulse = 1 + Math.sin(snap.clock * 16) * 0.08;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(z.x, z.y, 108 * ragePulse, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 通道 1：直接通过 setTransform 写入旋转/缩放矩阵，彻底去掉每只丧尸 save/restore 压栈
    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      const img = z.isBoss ? bImg : z.kind === 'runner' ? rImg : z.kind === 'tank' ? tImg : zImg;
      const wImg = z.isBoss ? bWhite : z.kind === 'runner' ? rWhite : z.kind === 'tank' ? tWhite : zWhite;
      const drawW =
        (z.isBoss ? 204 : z.kind === 'tank' ? 112 : z.kind === 'runner' ? 92 : 84) *
        (z.isBoss ? 1 : z.kind === 'normal' ? z.scale : 1);
      const drawH =
        (z.isBoss ? 204 : z.kind === 'tank' ? 132 : z.kind === 'runner' ? 98 : 106) *
        (z.isBoss ? 1 : z.kind === 'normal' ? z.scale : 1);

      if (z.dying) {
        const sc = 0.65 + 0.45 * (z.dieLife / 0.48);
        const c = Math.cos(z.rot);
        const sn = Math.sin(z.rot);
        ctx.globalAlpha = Math.max(0, z.dieLife / 0.48);
        ctx.setTransform(
          s * c * sc,
          s * sn * sc,
          -s * sn * sc,
          s * c * sc,
          ox + s * (z.x + tx),
          oy + s * (z.y + ty),
        );
        if (img) ctx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
        ctx.globalAlpha = 1;
        continue;
      }

      const wobbleRot = Math.sin(z.phase) * (z.isBoss ? 0.06 : 0.13);
      const squashY = 1 + Math.abs(Math.sin(z.phase)) * 0.06;
      const squashX = 1 / squashY;
      const c = Math.cos(wobbleRot);
      const sn = Math.sin(wobbleRot);

      ctx.setTransform(
        s * c * squashX,
        s * sn * squashX,
        -s * sn * squashY,
        s * c * squashY,
        ox + s * (z.x + tx),
        oy + s * (z.y + ty),
      );

      if (img) {
        ctx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
        if (z.hitFlash > 0 && wImg) {
          ctx.globalAlpha = 0.78;
          ctx.drawImage(wImg, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = z.hitFlash > 0 ? '#ffffff' : z.isBoss ? '#dc2626' : '#65a30d';
        ctx.beginPath();
        ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.setTransform(s, 0, 0, s, ox + s * tx, oy + s * ty);

    // 通道 1.5：熔岩尸王冲锋蓄力红光 / 熔岩护盾 / 破盾虚弱闪金光（纯色半透明+边框，零 shadowBlur）
    if (snap.bossRef && snap.bossRef.active && !snap.bossRef.dying && snap.bossRef.y >= -140) {
      const boss = snap.bossRef;
      const bs = snap.bossState;

      if (bs.action === 'CHARGE_WARN') {
        ctx.globalAlpha = 0.55 + 0.4 * Math.abs(Math.sin(snap.clock * 18));
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, 102 + Math.sin(snap.clock * 20) * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (bs.shieldActive) {
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, 106, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 5;
        ctx.stroke();

        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, 114 + Math.sin(snap.clock * 10) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (bs.action === 'STUNNED' && bs.stunTimer > 0) {
        const flash = Math.sin(snap.clock * 24) > 0;
        ctx.globalAlpha = flash ? 0.32 : 0.16;
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, 104, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = flash ? '#fef08a' : '#f59e0b';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.font = `900 24px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0f172a';
        ctx.fillText('破盾虚弱', boss.x + 2, boss.y - 134);
        ctx.fillStyle = '#fde047';
        ctx.fillText('破盾虚弱', boss.x, boss.y - 136);
      }
    }

    // 通道 2：无 save/restore 批量绘制血条底槽与血条前景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      if (z.dying || (z.hp >= z.maxHp && !z.isBoss)) continue;
      const drawH =
        (z.isBoss ? 204 : z.kind === 'tank' ? 132 : z.kind === 'runner' ? 98 : 106) *
        (z.isBoss ? 1 : z.kind === 'normal' ? z.scale : 1);
      const bw = z.isBoss ? 150 : 52;
      const bh = z.isBoss ? 12 : 7;
      ctx.fillRect(z.x - bw * 0.5, z.y - drawH * 0.5 - 14, bw, bh);
    }

    ctx.fillStyle = '#2ed573';
    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      if (z.dying || z.isBoss || z.hp >= z.maxHp) continue;
      const drawH =
        (z.kind === 'tank' ? 132 : z.kind === 'runner' ? 98 : 106) *
        (z.kind === 'normal' ? z.scale : 1);
      const bw = 52;
      const bh = 7;
      ctx.fillRect(z.x - bw * 0.5, z.y - drawH * 0.5 - 14, bw * Math.max(0, z.hp / z.maxHp), bh);
    }

    ctx.fillStyle = '#ff4757';
    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      if (z.dying || !z.isBoss) continue;
      const bw = 150;
      const bh = 12;
      ctx.fillRect(z.x - bw * 0.5, z.y - 102 - 14, bw * Math.max(0, z.hp / z.maxHp), bh);
    }
  }

  private renderSquad(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const pImg = this.assets.sprites.player;
    const shadowOval = this.assets.shadowOval;
    const vis = fillTrooperPositions(snap.squadCount, snap.squadX, PLAYER_Y, this.squadPosBuf);
    sortTrooperPointsByY(this.squadPosBuf, vis);

    if (snap.invincibleTimer > 0 || snap.doubleFireTimer > 0) {
      ctx.strokeStyle = snap.invincibleTimer > 0 ? '#38bdf8' : '#f59e0b';
      ctx.lineWidth = 4;
      ctx.setLineDash(AIRDROP_DASH);
      ctx.beginPath();
      ctx.ellipse(snap.squadX, PLAYER_Y + 20, 82, 42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash(EMPTY_DASH);
    }

    const recoilOffset = snap.state === 'PLAYING' ? snap.recoil * 0.5 : 0;
    const showLegendRing = snap.skin.id !== 'standard';
    const showFlash = snap.muzzleFlash > 0 && snap.state === 'PLAYING';
    const isPlaying = snap.state === 'PLAYING';
    const s = snap.renderScale || 1;
    const ox = snap.renderOffsetX || 0;
    const oy = snap.renderOffsetY || 0;
    const tx = isPlaying ? snap.shakeX : 0;
    const ty = isPlaying ? snap.shakeY : 0;

    // 士兵地面阴影与传说脚环
    for (let i = 0; i < vis; i++) {
      const p = this.squadPosBuf[i];
      const py = p.y + recoilOffset;
      if (shadowOval) {
        ctx.drawImage(shadowOval, p.x - 28, py + 44 - 11, 56, 22);
      } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.ellipse(p.x, py + 44, 28, 11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (showLegendRing) {
        ctx.strokeStyle = snap.skin.primaryColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(p.x, py + 42, 26, 10, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 士兵立绘与枪口火光（direct setTransform 零 save/restore）
    for (let i = 0; i < vis; i++) {
      const p = this.squadPosBuf[i];
      const py = p.y + recoilOffset;
      const wob = isPlaying ? Math.sin(snap.clock * 14 + i) * 0.08 : 0;
      const c = wob !== 0 ? Math.cos(wob) : 1;
      const sn = wob !== 0 ? Math.sin(wob) : 0;

      ctx.setTransform(s * c, s * sn, -s * sn, s * c, ox + s * (p.x + tx), oy + s * (py + ty));

      if (pImg) {
        ctx.drawImage(pImg, -36, -56, 72, 114);
      } else {
        ctx.fillStyle = snap.skin.primaryColor;
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
      }

      if (showFlash && i < 8) {
        ctx.fillStyle = snap.weapon.color;
        ctx.beginPath();
        ctx.arc(16, -54, 11 + Math.random() * 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(16, -54, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.setTransform(s, 0, 0, s, ox + s * tx, oy + s * ty);

    // 小队人数徽章
    drawRoundedRect(ctx, snap.squadX - 50, PLAYER_Y + 56, 100, 34, 17);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = snap.skin.primaryColor;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 22px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`小队 ${snap.squadCount}`, snap.squadX, PLAYER_Y + 74);
  }

  private renderBulletsAndEffects(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const bulletItems = snap.bullets.getRawItems();
    const particleItems = snap.particles.getRawItems();
    const textItems = snap.texts.getRawItems();

    // 1. 子弹批量通道：按同色同宽合并拖尾路径 + 单路径合并全部弹头核心（零 save/restore）
    ctx.globalAlpha = 0.55;
    ctx.lineCap = 'round';
    let trailStarted = false;
    let lastTrailColor = '';
    let lastTrailWidth = -1;

    for (let i = 0; i < bulletItems.length; i++) {
      const b = bulletItems[i];
      if (!b.active) continue;
      const lw = b.radius * 1.4;
      if (!trailStarted || b.color !== lastTrailColor || lw !== lastTrailWidth) {
        if (trailStarted) ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = lw;
        lastTrailColor = b.color;
        lastTrailWidth = lw;
        trailStarted = true;
      }
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
    }
    if (trailStarted) ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    let hasCores = false;
    for (let i = 0; i < bulletItems.length; i++) {
      const b = bulletItems[i];
      if (!b.active) continue;
      const coreR = b.radius * 0.85;
      ctx.moveTo(b.x + coreR, b.y);
      ctx.arc(b.x, b.y, coreR, 0, Math.PI * 2);
      hasCores = true;
    }
    if (hasCores) ctx.fill();

    // 2. 粒子绘制通道（上限 80 个，无 save/restore）
    let lastParticleColor = '';
    for (let i = 0; i < particleItems.length; i++) {
      const p = particleItems[i];
      if (!p.active) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      if (p.color !== lastParticleColor) {
        ctx.fillStyle = p.color;
        lastParticleColor = p.color;
      }
      ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
    }

    // 3. 飘字绘制通道（上限 18 个，用 2px 深色偏移 fillText 替代高耗时 strokeText）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lastFontSize = -1;
    for (let i = 0; i < textItems.length; i++) {
      const ft = textItems[i];
      if (!ft.active) continue;
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      if (ft.size !== lastFontSize) {
        ctx.font = this.getFloatFont(ft.size);
        lastFontSize = ft.size;
      }
      ctx.fillStyle = '#0f172a';
      ctx.fillText(ft.text, ft.x + 2, ft.y + 2);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }

    ctx.globalAlpha = 1;
  }

  private renderHUD(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    const top = Math.max(22, snap.safeTop);

    ctx.save();
    drawRoundedRect(ctx, 18, top, LOGICAL_WIDTH - 196, 92, 18);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.stroke();

    const wIcon = this.assets.sprites[snap.weapon.iconKey];
    if (wIcon) {
      ctx.drawImage(wIcon, 28, top + 12, 64, 64);
    }

    ctx.fillStyle = '#38bdf8';
    ctx.font = '900 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const hudTitle =
      snap.mode === 'endless'
        ? `${snap.weapon.name} · 无尽第${snap.endlessWave}波`
        : `${snap.weapon.name} · ${snap.level.name}`;
    ctx.fillText(hudTitle, 102, top + 30, 224);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    const subStats =
      snap.mode === 'endless'
        ? `击杀 ${snap.kills}  金币 ${snap.runCoins}  ${Math.floor(snap.totalSurviveSec)}秒`
        : `击杀 ${snap.kills}  金币 ${snap.runCoins}`;
    ctx.fillText(subStats, 102, top + 64, 232);

    // 进度条
    const bx = 350;
    const by = top + 20;
    const bw = 178;
    const bh = 18;
    const prog = snap.bossState.alertPending
      ? 1
      : Math.min(1, snap.elapsed / Math.max(1, snap.level.duration));
    drawProgressBar(
      ctx,
      bx,
      by,
      bw,
      bh,
      prog,
      snap.bossSpawned || snap.bossState.alertPending ? '#ff4757' : '#34d399',
    );

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 17px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    const remainSec = Math.max(0, Math.ceil(snap.level.duration - snap.elapsed));
    const progText = snap.bossState.alertPending
      ? '尸王警报'
      : snap.bossSpawned
        ? snap.mode === 'endless'
          ? `第${snap.endlessWave}波 · 尸王战`
          : '熔岩尸王战'
        : snap.mode === 'endless' && snap.endlessWave % 2 === 1
          ? `下一波 ${remainSec} 秒`
          : `距尸王 ${remainSec} 秒`;
    ctx.fillText(progText, bx + bw / 2, top + 64);
    ctx.restore();

    // 右上角暂停与静音按钮
    drawButton(
      ctx,
      this.hitBoxes,
      'hud_pause',
      LOGICAL_WIDTH - 166,
      top + 4,
      70,
      82,
      '暂停',
      actions.onTogglePause,
      HUD_PAUSE_BTN_STYLE,
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'hud_mute',
      LOGICAL_WIDTH - 88,
      top + 4,
      70,
      82,
      snap.save.muted ? '静音' : '音效',
      actions.onToggleMute,
      snap.save.muted ? HUD_MUTE_ON_BTN_STYLE : HUD_MUTE_OFF_BTN_STYLE,
    );

    // 熔岩尸王顶部大血条（叠加护盾条与破盾虚弱态）
    if (snap.bossRef && snap.bossRef.active && !snap.bossRef.dying) {
      ctx.save();
      const bs = snap.bossState;
      const bossBarY = top + 104;
      const barW = LOGICAL_WIDTH - 148;
      drawRoundedRect(ctx, 74, bossBarY, barW, 34, 12);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fill();

      const ratio = Math.max(0, snap.bossRef.hp / Math.max(1, snap.bossRef.maxHp));
      if (ratio > 0.01) {
        drawRoundedRect(ctx, 78, bossBarY + 4, Math.max(16, (barW - 8) * ratio), 26, 9);
        ctx.fillStyle = bs.action === 'STUNNED' ? '#eab308' : '#ef4444';
        ctx.fill();
      }

      if (bs.shieldActive && bs.shieldMaxHp > 0) {
        const sRatio = Math.max(0, Math.min(1, bs.shieldHp / bs.shieldMaxHp));
        if (sRatio > 0.01) {
          drawRoundedRect(ctx, 78, bossBarY + 4, Math.max(14, (barW - 8) * sRatio), 26, 9);
          ctx.fillStyle = 'rgba(56, 189, 248, 0.82)';
          ctx.fill();
        }
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 2.5;
        drawRoundedRect(ctx, 74, bossBarY, barW, 34, 12);
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = `900 19px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const prefix =
        snap.mode === 'endless' ? `第${snap.endlessWave}波 ${snap.level.bossName}` : snap.level.bossName;
      let bossBarLabel = `${prefix}  ${Math.ceil(snap.bossRef.hp)} / ${snap.bossRef.maxHp}`;
      if (bs.shieldActive) {
        bossBarLabel = `${prefix}  护盾 ${Math.ceil(bs.shieldHp)} (${Math.ceil(bs.shieldTimer)}秒)`;
      } else if (bs.action === 'STUNNED' && bs.stunTimer > 0) {
        bossBarLabel = `${prefix}  破盾虚弱 ${bs.stunTimer.toFixed(1)}秒`;
      }
      ctx.fillStyle = '#0f172a';
      ctx.fillText(bossBarLabel, LOGICAL_WIDTH / 2 + 1.5, bossBarY + 18.5);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(bossBarLabel, LOGICAL_WIDTH / 2, bossBarY + 17);
      ctx.restore();
    }

    // 登场 1.5 秒红色闪烁警戒横幅
    if (snap.bossState.alertPending && snap.bossState.alertTimer > 0) {
      const pulse = Math.abs(Math.sin(snap.clock * 16));
      const bannerY = Math.max(330, top + 210);
      const bannerH = 114;
      ctx.save();
      ctx.fillStyle = `rgba(185, 28, 28, ${(0.58 + 0.3 * pulse).toFixed(2)})`;
      ctx.fillRect(0, bannerY, LOGICAL_WIDTH, bannerH);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(0, bannerY, LOGICAL_WIDTH, 6);
      ctx.fillRect(0, bannerY + bannerH - 6, LOGICAL_WIDTH, 6);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 40px ${FONT_FAMILY}`;
      ctx.fillStyle = '#1f1004';
      ctx.fillText('警告：熔岩尸王逼近！', LOGICAL_WIDTH / 2 + 2, bannerY + bannerH * 0.5 + 2);
      ctx.fillStyle = pulse > 0.45 ? '#ffffff' : '#fef08a';
      ctx.fillText('警告：熔岩尸王逼近！', LOGICAL_WIDTH / 2, bannerY + bannerH * 0.5);
      ctx.restore();
    }

    // 主题关横幅、分段引导横幅、切枪高光横幅、火力翻倍 / 助战 / 满编强化提示条 & 实时连击 / 右侧空投按钮
    let subY =
      snap.bossRef && snap.bossRef.active && !snap.bossRef.dying ? top + 148 : top + 104;
    if (snap.themeBanner.active) {
      this.renderThemeBanner(snap, subY);
      subY += 74;
    }
    if (snap.guideBanner.active) {
      this.renderGuideBanner(snap, subY);
      subY += 62;
    }
    if (snap.weaponBanner.active) {
      this.renderWeaponBanner(snap, subY);
      subY += 72;
    }
    if (snap.doubleFireTimer > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.92)';
      drawRoundedRect(ctx, 180, subY, 360, 34, 17);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 18px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`全队火力翻倍剩余 ${Math.ceil(snap.doubleFireTimer)} 秒`, LOGICAL_WIDTH / 2, subY + 17);
      ctx.restore();
      subY += 44;
    }
    if (snap.stuckAssistActive) {
      ctx.save();
      drawRoundedRect(ctx, 186, subY, 348, 32, 16);
      ctx.fillStyle = 'rgba(180, 83, 9, 0.92)';
      ctx.fill();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fef08a';
      ctx.font = `900 17px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('传说助战火力生效中', LOGICAL_WIDTH / 2, subY + 16);
      ctx.restore();
      subY += 38;
    }
    if (snap.overflowAttackBonus > 0) {
      ctx.save();
      drawRoundedRect(ctx, 190, subY, 340, 32, 16);
      ctx.fillStyle = 'rgba(22, 101, 52, 0.9)';
      ctx.fill();
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#dcfce7';
      ctx.font = `900 17px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `满编强化 攻击+${Math.round(snap.overflowAttackBonus * 100)}%`,
        LOGICAL_WIDTH / 2,
        subY + 16,
      );
      ctx.restore();
      subY += 38;
    }

    this.lastHudBottomY = subY;

    // 实时连击 ×N 徽章（避让顶部血条、各类引导横幅与 Toast）
    if (snap.combo >= 2) {
      const toastReserve = snap.toast ? 54 : 0;
      const comboY = Math.max(top + 224, subY + toastReserve + 44);
      ctx.save();
      ctx.translate(LOGICAL_WIDTH - 108, comboY);
      ctx.scale(snap.comboPulse, snap.comboPulse);
      drawRoundedRect(ctx, -88, -38, 176, 76, 12);
      ctx.fillStyle = snap.combo >= 25 ? 'rgba(220, 38, 38, 0.86)' : 'rgba(217, 119, 6, 0.86)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fde047';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#fef08a';
      ctx.font = '900 32px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`连击 ×${snap.combo}`, 0, -4);

      drawRoundedRect(ctx, -68, 20, 136, 8, 4);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fill();
      drawRoundedRect(ctx, -68, 20, 136 * Math.max(0, snap.comboTimer / 2.7), 8, 4);
      ctx.fillStyle = '#fef08a';
      ctx.fill();
      ctx.restore();
    }

    if (snap.airdrop.active && !snap.airdrop.claimed && snap.state === 'PLAYING') {
      this.renderAirdropButton(snap, top, actions);
    }

    if (snap.state === 'PLAYING' && snap.resumeGraceTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, snap.resumeGraceTimer * 1.4);
      drawRoundedRect(ctx, LOGICAL_WIDTH / 2 - 74, PLAYER_Y - 120, 148, 32, 16);
      ctx.fillStyle = 'rgba(14, 165, 233, 0.88)';
      ctx.fill();
      ctx.strokeStyle = '#bae6fd';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 17px ${FONT_FAMILY}`;
      ctx.fillText('恢复保护中', LOGICAL_WIDTH / 2, PLAYER_Y - 104);
      ctx.restore();
    }
  }

  private renderThemeBanner(snap: RenderSnapshot, baseY: number): void {
    const tb = snap.themeBanner;
    if (!tb.active || tb.duration <= 0) return;

    const ctx = this.ctx;
    const elapsed = Math.max(0, tb.duration - tb.timer);
    const slideIn = Math.min(1, elapsed / 0.2);
    const easedIn = 1 - (1 - slideIn) * (1 - slideIn);
    const alpha = tb.timer < 0.3 ? Math.max(0, tb.timer / 0.3) : easedIn;

    const bannerW = 636;
    const bannerH = 66;
    const drawX = (LOGICAL_WIDTH - bannerW) * 0.5;
    const drawY = baseY - (1 - easedIn) * 20;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawRoundedRect(ctx, drawX, drawY, bannerW, bannerH, 18);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.fill();
    ctx.strokeStyle = tb.accentColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 24px ${FONT_FAMILY}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`主题关：${tb.label}`, LOGICAL_WIDTH / 2 + 1.5, drawY + 23.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`主题关：${tb.label}`, LOGICAL_WIDTH / 2, drawY + 22);

    ctx.font = `700 17px ${FONT_FAMILY}`;
    ctx.fillStyle = tb.accentColor;
    ctx.fillText(tb.subLabel, LOGICAL_WIDTH / 2, drawY + 49);
    ctx.restore();
  }

  private renderGuideBanner(snap: RenderSnapshot, baseY: number): void {
    const gb = snap.guideBanner;
    if (!gb.active || gb.duration <= 0) return;

    const ctx = this.ctx;
    const elapsed = Math.max(0, gb.duration - gb.timer);
    const slideIn = Math.min(1, elapsed / 0.2);
    const easedIn = 1 - (1 - slideIn) * (1 - slideIn);
    const alpha = gb.timer < 0.28 ? Math.max(0, gb.timer / 0.28) : easedIn;

    const bannerW = 636;
    const bannerH = 52;
    const drawX = (LOGICAL_WIDTH - bannerW) * 0.5;
    const drawY = baseY - (1 - easedIn) * 24;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawRoundedRect(ctx, drawX, drawY, bannerW, bannerH, 16);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fill();
    ctx.strokeStyle = gb.accentColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 20px ${FONT_FAMILY}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(gb.text, LOGICAL_WIDTH / 2 + 1.5, drawY + bannerH * 0.5 + 1.5);
    ctx.fillStyle = '#fef08a';
    ctx.fillText(gb.text, LOGICAL_WIDTH / 2, drawY + bannerH * 0.5);
    ctx.restore();
  }

  private renderAirdropButton(
    snap: RenderSnapshot,
    safeTop: number,
    actions: RenderActions,
  ): void {
    const ad = snap.airdrop;
    const duration = Math.max(1, ad.duration || 8);
    const ratio = Math.max(0, Math.min(1, ad.timer / duration));
    const elapsed = Math.max(0, duration - ad.timer);
    const fadeIn = Math.min(1, elapsed / 0.25);
    const fadeOut = ad.timer < 0.8 ? Math.max(0, ad.timer / 0.8) : 1;
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha <= 0.01) return;

    const cx = 632;
    const cy = Math.max(safeTop + 330, 440);
    const radius = 52;
    const scale = 1 + Math.sin(snap.clock * 6) * 0.055;

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.beginPath();
    ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 1, 0, Math.PI * 2);
    ctx.stroke();

    if (ratio > 0.01) {
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, radius + 1, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * ratio);
      ctx.stroke();
    }

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(0, 0, radius - 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.font = `900 18px ${FONT_FAMILY}`;
    ctx.fillText('超级空投', 0, -10);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 20px ${FONT_FAMILY}`;
    ctx.fillText(`${Math.ceil(ad.timer)}秒`, 0, 14);
    ctx.restore();

    this.hitBoxes.registerRect(
      'hud_airdrop_btn',
      cx - 60,
      cy - 60,
      120,
      120,
      actions.onTriggerAirdrop,
    );
  }

  private renderWeaponBanner(snap: RenderSnapshot, baseY: number): void {
    const wb = snap.weaponBanner;
    if (!wb.active || wb.duration <= 0) return;

    const ctx = this.ctx;
    const elapsed = Math.max(0, wb.duration - wb.timer);
    const slideIn = Math.min(1, elapsed / 0.18);
    const easedIn = 1 - (1 - slideIn) * (1 - slideIn);
    const alpha = wb.timer < 0.22 ? Math.max(0, wb.timer / 0.22) : easedIn;

    const bannerW = 480;
    const bannerH = 62;
    const targetX = (LOGICAL_WIDTH - bannerW) * 0.5;
    const drawX = targetX - (1 - easedIn) * 180;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawRoundedRect(ctx, drawX, baseY, bannerW, bannerH, 18);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fill();
    ctx.strokeStyle = wb.accentColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    const icon = wb.iconKey ? this.assets.sprites[wb.iconKey] : undefined;
    if (icon) {
      ctx.drawImage(icon, drawX + 18, baseY + 8, 46, 46);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `900 26px ${FONT_FAMILY}`;
    const label = `火力升级：${wb.weaponName}！`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(label, drawX + 78 + 2, baseY + bannerH * 0.5 + 2);
    ctx.fillStyle = '#fef08a';
    ctx.fillText(label, drawX + 78, baseY + bannerH * 0.5);
    ctx.restore();
  }

  private drawRedDot(x: number, y: number, clock: number): void {
    const ctx = this.ctx;
    const pulse = Math.sin(clock * 7);
    const r = 8 + pulse * 1.5;
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.34)';
    ctx.beginPath();
    ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawMenuUpgradeCard(
    cx: number,
    cy: number,
    cardW: number,
    id: string,
    title: string,
    levelText: string,
    cost: number,
    canBuy: boolean,
    isMax: boolean,
    onClick: () => void,
    disableInteraction: boolean,
    clock: number,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    drawRoundedRect(ctx, cx, cy, cardW, 146, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, cx, cy, cardW, 146, 16);
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = `800 20px ${FONT_FAMILY}`;
    ctx.fillText(title, cx + cardW * 0.5, cy + 28);

    ctx.fillStyle = '#38bdf8';
    ctx.font = `900 24px ${FONT_FAMILY}`;
    ctx.fillText(levelText, cx + cardW * 0.5, cy + 62);

    if (!disableInteraction) {
      drawButton(
        ctx,
        this.hitBoxes,
        id,
        cx + 14,
        cy + 86,
        cardW - 28,
        48,
        isMax ? '已满级' : `${cost} 金币`,
        onClick,
        canBuy && !isMax ? this.upgradeBuyStyle : this.upgradeDisabledStyle,
      );
      if (canBuy && !isMax) {
        this.drawRedDot(cx + cardW - 10, cy + 10, clock);
      }
    }
  }

  private renderMenuOverlay(
    snap: RenderSnapshot,
    actions: RenderActions,
    disableInteraction = false,
  ): void {
    const ctx = this.ctx;
    const top = Math.max(22, snap.safeTop);

    ctx.save();
    ctx.fillStyle = this.menuOverlayGrad;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // 顶部金币栏、军械库、震动、音效按钮
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    drawRoundedRect(ctx, 22, top, 178, 48, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 22, top, 178, 48, 24);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde047';
    ctx.font = `900 20px ${FONT_FAMILY}`;
    ctx.fillText(`金币：${snap.save.coins}`, 111, top + 24);

    if (!disableInteraction) {
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_armory',
        394,
        top,
        104,
        48,
        '军械库',
        actions.onOpenArmory,
        {
          fillTop: '#7c3aed',
          fillBottom: '#5b21b6',
          borderColor: '#ddd6fe',
          fontSize: 19,
          radius: 12,
        },
      );
      if (snap.hasArmoryRedDot) {
        this.drawRedDot(394 + 100, top + 4, snap.clock);
      }

      drawButton(
        ctx,
        this.hitBoxes,
        'menu_vibrate',
        506,
        top,
        96,
        48,
        snap.save.vibrateEnabled ? '震动开' : '震动关',
        actions.onToggleVibrate,
        {
          fillTop: snap.save.vibrateEnabled ? '#0284c7' : '#334155',
          fillBottom: snap.save.vibrateEnabled ? '#0369a1' : '#1e293b',
          borderColor: snap.save.vibrateEnabled ? '#7dd3fc' : '#64748b',
          fontSize: 18,
          radius: 12,
        },
      );

      drawButton(
        ctx,
        this.hitBoxes,
        'menu_mute',
        610,
        top,
        88,
        48,
        snap.save.muted ? '静音' : '音效',
        actions.onToggleMute,
        {
          fillTop: '#334155',
          fillBottom: '#1e293b',
          fontSize: 18,
          radius: 12,
        },
      );
    }

    // 左上角「12+ 适龄提示」纯 Canvas 标准徽章
    const ageX = 22;
    const ageY = top + 56;
    const ageW = 74;
    const ageH = 62;
    drawRoundedRect(ctx, ageX, ageY, ageW, ageH, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    drawRoundedRect(ctx, ageX, ageY, ageW, 38, 10);
    ctx.fillStyle = '#16a34a';
    ctx.fill();
    ctx.fillRect(ageX, ageY + 26, ageW, 12);
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, ageX, ageY, ageW, ageH, 10);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 22px ${FONT_FAMILY}`;
    ctx.fillText('12+', ageX + ageW * 0.5, ageY + 20);
    ctx.fillStyle = '#166534';
    ctx.font = `900 14px ${FONT_FAMILY}`;
    ctx.fillText('适龄提示', ageX + ageW * 0.5, ageY + 50);

    if (!disableInteraction) {
      this.hitBoxes.registerRect('menu_age_badge', ageX - 6, ageY - 6, ageW + 12, ageH + 12, actions.onOpenAgeModal);

      // 抖音侧边栏复访领奖入口
      if (snap.sidebar.supported) {
        const sidebarSub = !snap.canClaimSidebarReward
          ? '今日已领 200'
          : snap.sidebar.fromSidebar
            ? '点击领 200 金币'
            : '去侧边栏领 200';
        drawButton(
          ctx,
          this.hitBoxes,
          'menu_sidebar_gift',
          LOGICAL_WIDTH - 196,
          top + 56,
          174,
          56,
          '侧边栏复访礼',
          actions.onClickSidebarGift,
          {
            fillTop: !snap.canClaimSidebarReward ? '#475569' : snap.sidebar.fromSidebar ? '#22c55e' : '#0284c7',
            fillBottom: !snap.canClaimSidebarReward ? '#334155' : snap.sidebar.fromSidebar ? '#16a34a' : '#0369a1',
            borderColor: '#fef08a',
            fontSize: 16,
            subText: sidebarSub,
            subTextColor: '#fef08a',
            radius: 12,
            disabled: !snap.canClaimSidebarReward,
          },
        );
        if (snap.canClaimSidebarReward) {
          this.drawRedDot(LOGICAL_WIDTH - 24, top + 60, snap.clock);
        }
      }
    }

    const isCapsule = top > 70;
    const offsetY = isCapsule ? 40 : 0;
    const titleFontSize = isCapsule ? 50 : 60;
    const titleY = isCapsule ? top + 142 : 174;
    const levelY = titleY + (isCapsule ? 48 : 46);
    const hasThemeTag = snap.level.theme !== 'normal';
    const levelBottom = levelY + (hasThemeTag ? 78 : 48);
    const bossAvailH = Math.max(0, 472 + offsetY - levelBottom);
    const bossSize = bossAvailH >= 48 ? Math.min(196, Math.round(bossAvailH - 12)) : 0;
    const bossY = levelBottom + Math.round((bossAvailH - bossSize) * 0.5);

    // 2D 精绘熔岩尸王展示
    if (this.assets.sprites.boss && bossSize > 0) {
      const bob = Math.sin(snap.clock * 3) * 8;
      ctx.drawImage(
        this.assets.sprites.boss,
        LOGICAL_WIDTH / 2 - bossSize * 0.5,
        bossY + bob,
        bossSize,
        bossSize,
      );
    }

    // 主菜单标题描边改用偏移深色 fillText 加速
    ctx.textAlign = 'center';
    ctx.font = `900 ${titleFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = '#1e1004';
    ctx.fillText('末日枪手突围', LOGICAL_WIDTH / 2 + 3, titleY + 3);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('末日枪手突围', LOGICAL_WIDTH / 2, titleY);

    // 关卡切换铭牌
    drawRoundedRect(ctx, 130, levelY, LOGICAL_WIDTH - 260, 46, 23);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();
    ctx.fillStyle = '#e0f2fe';
    ctx.font = 'bold 21px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(
      `第${snap.level.id}关·${snap.level.name}（已解锁 ${snap.save.unlockedLevel} 关）`,
      LOGICAL_WIDTH / 2,
      levelY + 24,
    );

    if (hasThemeTag) {
      const themeMeta = getLevelThemeMeta(snap.level.theme);
      const pillW = 248;
      const pillY = levelY + 50;
      drawRoundedRect(ctx, (LOGICAL_WIDTH - pillW) * 0.5, pillY, pillW, 24, 12);
      ctx.fillStyle = themeMeta.badgeBg;
      ctx.fill();
      ctx.strokeStyle = themeMeta.badgeBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 15px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`主题关 · ${themeMeta.label}`, LOGICAL_WIDTH / 2, pillY + 12);
    }

    if (!disableInteraction) {
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_prev_lvl',
        56,
        levelY - 1,
        64,
        48,
        '上关',
        actions.onPrevLevel,
        {
          fillTop: '#334155',
          fillBottom: '#1e293b',
          fontSize: 18,
          radius: 12,
          disabled: snap.save.selectedLevel <= 1,
        },
      );
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_next_lvl',
        LOGICAL_WIDTH - 120,
        levelY - 1,
        64,
        48,
        '下关',
        actions.onNextLevel,
        {
          fillTop: '#334155',
          fillBottom: '#1e293b',
          fontSize: 18,
          radius: 12,
          disabled: snap.save.selectedLevel >= snap.save.unlockedLevel,
        },
      );
    }

    // 纪录、称号与涂装条
    const titlePrefix = snap.hasFinalHonorBadge
      ? '【末日传奇】 '
      : snap.hasEliteTitle
        ? '【精英战区】 '
        : '';
    const coinSuffix = snap.hasPermanentCoinBonus ? ' · 金币+15%' : '';
    ctx.fillStyle = '#fef08a';
    ctx.font = `bold 19px ${FONT_FAMILY}`;
    ctx.fillText(
      `${titlePrefix}最高击杀：${snap.save.bestKills} · 涂装：${snap.skin.name}${coinSuffix}`,
      LOGICAL_WIDTH / 2,
      480 + offsetY,
    );

    // 里程碑解锁预告条
    drawRoundedRect(ctx, 56, 498 + offsetY, LOGICAL_WIDTH - 112, 32, 12);
    ctx.fillStyle = snap.nextMilestone ? 'rgba(15, 23, 42, 0.86)' : 'rgba(120, 53, 15, 0.88)';
    ctx.fill();
    ctx.strokeStyle = snap.nextMilestone ? '#38bdf8' : '#fde047';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = snap.nextMilestone ? '#bae6fd' : '#fef08a';
    ctx.font = `800 16px ${FONT_FAMILY}`;
    const milestoneText = snap.nextMilestone
      ? `距离下一里程碑：通关第 ${snap.nextMilestone.clearLevel} 关解锁${snap.nextMilestone.titleText}`
      : '终极荣誉徽章已解锁：末日传奇（主线 15 关全通）';
    ctx.fillText(milestoneText, LOGICAL_WIDTH / 2, 514 + offsetY);

    // 局外永久养成区（3 项紧凑卡片，零临时对象数组分配）
    const cardW = 198;
    const gap = 16;
    const startX = (LOGICAL_WIDTH - (cardW * 3 + gap * 2)) / 2;
    const upgY = 540 + offsetY;
    this.drawMenuUpgradeCard(
      startX,
      upgY,
      cardW,
      'upg_atk',
      '基础攻击',
      `${snap.save.attackLevel}级`,
      snap.upgradeCosts.attack,
      snap.canAfford.attack,
      snap.save.attackLevel >= 20,
      actions.onUpgradeAttack,
      disableInteraction,
      snap.clock,
    );
    this.drawMenuUpgradeCard(
      startX + cardW + gap,
      upgY,
      cardW,
      'upg_spd',
      '初始射速',
      `${snap.save.fireRateLevel}级`,
      snap.upgradeCosts.firerate,
      snap.canAfford.firerate,
      snap.save.fireRateLevel >= 20,
      actions.onUpgradeFireRate,
      disableInteraction,
      snap.clock,
    );
    this.drawMenuUpgradeCard(
      startX + (cardW + gap) * 2,
      upgY,
      cardW,
      'upg_sqd',
      '初始人数',
      `${snap.save.squadLevel}人`,
      snap.upgradeCosts.squad,
      snap.canAfford.squad,
      snap.save.squadLevel >= 6,
      actions.onUpgradeSquad,
      disableInteraction,
      snap.clock,
    );

    // 主菜单核心开局按钮区（「开始突围」设为最醒目大主按钮；首局先不推销满配广告）
    if (!disableInteraction) {
      this.menuStartBtnStyle.subText = `第${snap.level.id}关 · ${snap.level.name}`;
      this.menuStartBtnStyle.pulseScale = 1 + Math.sin(snap.clock * 4) * 0.015;
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_start',
        64,
        698 + offsetY,
        LOGICAL_WIDTH - 128,
        isCapsule ? 88 : 92,
        '开始突围',
        actions.onStartBattle,
        this.menuStartBtnStyle,
      );

      this.menuEndlessBtnStyle.subText =
        snap.save.endlessBestWave > 0
          ? `最高第 ${snap.save.endlessBestWave} 波 · 最高击杀 ${snap.save.endlessBestKills}`
          : '40秒进阶·偶数波强化尸王';

      if (snap.save.totalRunsPlayed === 0) {
        drawButton(
          ctx,
          this.hitBoxes,
          'menu_endless',
          96,
          (isCapsule ? 802 : 808) + offsetY,
          LOGICAL_WIDTH - 192,
          74,
          '无尽狂潮模式',
          actions.onStartEndless,
          snap.endlessUnlocked ? this.menuEndlessBtnStyle : this.menuEndlessLockedBtnStyle,
        );
        ctx.fillStyle = '#cbd5e1';
        ctx.font = `700 18px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          '单指左右滑动自动射击，打爆木桶秒换神装',
          LOGICAL_WIDTH / 2,
          (isCapsule ? 912 : 922) + offsetY,
        );
      } else {
        drawButton(
          ctx,
          this.hitBoxes,
          'menu_super_start',
          96,
          (isCapsule ? 800 : 806) + offsetY,
          LOGICAL_WIDTH - 192,
          isCapsule ? 66 : 68,
          '看广告满配开局',
          actions.onStartSuperBattle,
          this.menuSuperBtnStyle,
        );

        drawButton(
          ctx,
          this.hitBoxes,
          'menu_endless',
          96,
          (isCapsule ? 880 : 890) + offsetY,
          LOGICAL_WIDTH - 192,
          isCapsule ? 72 : 74,
          '无尽狂潮模式',
          actions.onStartEndless,
          snap.endlessUnlocked ? this.menuEndlessBtnStyle : this.menuEndlessLockedBtnStyle,
        );
      }
    }

    // 标准《健康游戏忠告》（位于 Banner 上方安全区）
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    drawRoundedRect(ctx, 26, 1044, LOGICAL_WIDTH - 52, 84, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 26, 1044, LOGICAL_WIDTH - 52, 84, 12);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `600 18px ${FONT_FAMILY}`;
    ctx.fillText('抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。', LOGICAL_WIDTH / 2, 1070);
    ctx.fillText('适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。', LOGICAL_WIDTH / 2, 1102);

    // 若素材仍在初始化加载，安全空白处显示进度提示
    if (!this.assets.isReady) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(
        `精绘资源加载中 ${this.assets.loadedCount} / ${this.assets.totalCount}`,
        LOGICAL_WIDTH / 2,
        1018,
      );
    }

    ctx.restore();
  }

  private renderSwipeTutorial(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const cx = Math.max(232, Math.min(LOGICAL_WIDTH - 232, snap.squadX));
    const y = PLAYER_Y + 132;
    const offset = Math.sin(snap.clock * 6) * 14;

    ctx.save();
    ctx.globalAlpha = snap.tutorialAlpha;
    drawRoundedRect(ctx, cx - 218, y - 28, 436, 56, 28);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.78)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 178 - offset, y - 10);
    ctx.lineTo(cx - 196 - offset, y);
    ctx.lineTo(cx - 178 - offset, y + 10);
    ctx.moveTo(cx + 178 + offset, y - 10);
    ctx.lineTo(cx + 196 + offset, y);
    ctx.lineTo(cx + 178 + offset, y + 10);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 21px ${FONT_FAMILY}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('左右滑动躲避，小队会自动开火', cx, y + 1);
    ctx.restore();
  }

  private renderAgeModal(actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.86)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawPanelCard(ctx, 56, 260, LOGICAL_WIDTH - 112, 620, '适龄提示说明', '#22c55e');

    drawRoundedRect(ctx, LOGICAL_WIDTH / 2 - 48, 360, 96, 54, 12);
    ctx.fillStyle = '#16a34a';
    ctx.fill();
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 32px ${FONT_FAMILY}`;
    ctx.fillText('12+', LOGICAL_WIDTH / 2, 388);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = `700 22px ${FONT_FAMILY}`;
    ctx.fillText('1. 本游戏为架空末日题材单机休闲射击玩法，', LOGICAL_WIDTH / 2, 466);
    ctx.fillText('适用于年满 12 周岁及以上的用户使用。', LOGICAL_WIDTH / 2, 506);
    ctx.fillText('2. 游戏内不含任何付费充值或现金交易系统，', LOGICAL_WIDTH / 2, 562);
    ctx.fillText('所有玩法道具均可通过局内体验与养成解锁。', LOGICAL_WIDTH / 2, 602);
    ctx.fillText('3. 请合理安排游戏时间，注意用眼与劳逸结合。', LOGICAL_WIDTH / 2, 658);

    drawButton(
      ctx,
      this.hitBoxes,
      'age_modal_ok',
      160,
      756,
      LOGICAL_WIDTH - 320,
      78,
      '我知道了',
      actions.onCloseAgeModal,
      {
        fillTop: '#22c55e',
        fillBottom: '#16a34a',
        borderColor: '#bbf7d0',
        fontSize: 28,
        radius: 16,
      },
    );
    ctx.restore();
  }

  private renderPauseModal(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawPanelCard(ctx, 84, 320, LOGICAL_WIDTH - 168, 500, '战斗已暂停', '#38bdf8');

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_resume',
      140,
      434,
      LOGICAL_WIDTH - 280,
      76,
      '继续战斗',
      actions.onTogglePause,
      {
        fillTop: '#22c55e',
        fillBottom: '#16a34a',
        fontSize: 28,
        radius: 16,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_mute',
      140,
      528,
      212,
      64,
      snap.save.muted ? '音效：关' : '音效：开',
      actions.onToggleMute,
      {
        fillTop: snap.save.muted ? '#475569' : '#0284c7',
        fillBottom: snap.save.muted ? '#334155' : '#0369a1',
        fontSize: 22,
        radius: 12,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_vibrate',
      368,
      528,
      212,
      64,
      snap.save.vibrateEnabled ? '震动：开' : '震动：关',
      actions.onToggleVibrate,
      {
        fillTop: snap.save.vibrateEnabled ? '#0284c7' : '#475569',
        fillBottom: snap.save.vibrateEnabled ? '#0369a1' : '#334155',
        fontSize: 22,
        radius: 12,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_restart',
      140,
      612,
      LOGICAL_WIDTH - 280,
      70,
      '重新开始',
      actions.onRestartBattle,
      {
        fillTop: '#f59e0b',
        fillBottom: '#d97706',
        fontSize: 24,
        radius: 12,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_menu',
      140,
      700,
      LOGICAL_WIDTH - 280,
      66,
      '返回主菜单',
      actions.onBackToMenu,
      {
        fillTop: '#475569',
        fillBottom: '#334155',
        fontSize: 22,
        radius: 12,
      },
    );
    ctx.restore();
  }

  private renderAirdropModal(actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawPanelCard(ctx, 56, 290, LOGICAL_WIDTH - 112, 590, '局内超级空投', '#fbbf24');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('熔岩尸王即将登场，任选一项空投支援', LOGICAL_WIDTH / 2, 412);

    drawButton(
      ctx,
      this.hitBoxes,
      'airdrop_rocket',
      104,
      472,
      LOGICAL_WIDTH - 208,
      96,
      '看广告领高爆火箭筒',
      actions.onAirdropChooseRocket,
      {
        fillTop: '#ef4444',
        fillBottom: '#b91c1c',
        borderColor: '#fecaca',
        fontSize: 28,
        subText: '超大范围爆炸溅射清屏',
        radius: 16,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'airdrop_double',
      104,
      594,
      LOGICAL_WIDTH - 208,
      96,
      '看广告火力翻倍十五秒',
      actions.onAirdropChooseDouble,
      {
        fillTop: '#f59e0b',
        fillBottom: '#d97706',
        borderColor: '#fef08a',
        fontSize: 28,
        subText: '全队伤害与射速双重暴涨',
        radius: 16,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'airdrop_skip',
      176,
      726,
      LOGICAL_WIDTH - 352,
      68,
      '暂不领取，继续战斗',
      actions.onAirdropDismiss,
      {
        fillTop: '#475569',
        fillBottom: '#334155',
        fontSize: 22,
        radius: 12,
      },
    );
    ctx.restore();
  }

  private renderReviveModal(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.84)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawPanelCard(ctx, 58, 264, LOGICAL_WIDTH - 116, 584, '小队全员倒下', '#ef4444');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fecaca';
    ctx.font = '800 24px "PingFang SC", "Microsoft YaHei", sans-serif';
    const reviveSubText =
      snap.mode === 'endless'
        ? `当前进度：无尽第 ${snap.endlessWave} 波 · 击杀 ${snap.kills}`
        : `当前突围进度：${snap.reviveProgressPct}%`;
    ctx.fillText(reviveSubText, LOGICAL_WIDTH / 2, 382);

    ctx.fillStyle = '#fde047';
    ctx.font = '900 24px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`本局已累计获得 ${snap.runCoins} 金币`, LOGICAL_WIDTH / 2, 420);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    drawRoundedRect(ctx, 92, 448, LOGICAL_WIDTH - 184, 94, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('复活立即恢复 6 名队友并清空周围尸潮', LOGICAL_WIDTH / 2, 480);

    ctx.fillStyle = '#86efac';
    ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(
      `（本局剩余 ${snap.revivesRemaining} 次 · 含 2.5 秒无敌护盾）`,
      LOGICAL_WIDTH / 2,
      516,
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'revive_ad',
      108,
      570,
      LOGICAL_WIDTH - 216,
      96,
      '看广告复活并清屏',
      actions.onReviveWatchAd,
      {
        fillTop: '#22c55e',
        fillBottom: '#16a34a',
        borderColor: '#bbf7d0',
        fontSize: 30,
        subText: `保住已得 ${snap.runCoins} 金币继续冲关`,
        radius: 16,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'revive_giveup',
      180,
      696,
      LOGICAL_WIDTH - 360,
      68,
      '放弃复活，前往结算',
      actions.onReviveGiveUp,
      {
        fillTop: '#475569',
        fillBottom: '#334155',
        fontSize: 22,
        radius: 12,
      },
    );
    ctx.restore();
  }

  private renderResultModal(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const resultTitle =
      snap.mode === 'endless'
        ? '无尽挑战结算'
        : snap.isVictory
          ? '防线突围成功'
          : '突围行动失败';
    const resultBorder =
      snap.mode === 'endless' ? '#a855f7' : snap.isVictory ? '#22c55e' : '#ef4444';

    const resultCardH = snap.showStuckAssist ? 832 : 736;
    drawPanelCard(ctx, 56, 178, LOGICAL_WIDTH - 112, resultCardH, resultTitle, resultBorder);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (snap.mode === 'endless') {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(
        `到达波次：第${snap.endlessWave}波（最高 第${Math.max(snap.endlessWave, snap.save.endlessBestWave)}波）`,
        LOGICAL_WIDTH / 2,
        304,
      );

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 21px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(
        `消灭感染者：${snap.kills}（最高 ${Math.max(snap.kills, snap.save.endlessBestKills)}） · 生存${Math.floor(snap.totalSurviveSec)}秒`,
        LOGICAL_WIDTH / 2,
        342,
      );

      if (snap.isNewEndlessRecord) {
        ctx.fillStyle = '#c084fc';
        ctx.font = '900 22px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(`新纪录！最高波次突破至第 ${snap.endlessWave} 波！`, LOGICAL_WIDTH / 2, 382);
      }

      ctx.fillStyle = '#fde047';
      ctx.font = '900 36px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`基础金币：+${snap.runCoins}`, LOGICAL_WIDTH / 2, 424);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 25px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`关卡：第${snap.level.id}关·${snap.level.name}`, LOGICAL_WIDTH / 2, 308);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 23px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`本局消灭感染者：${snap.kills}`, LOGICAL_WIDTH / 2, 346);

      if (snap.milestoneCongrats) {
        const ms = snap.milestoneCongrats;
        drawRoundedRect(ctx, 84, 364, LOGICAL_WIDTH - 168, 40, 12);
        ctx.fillStyle = 'rgba(113, 63, 18, 0.9)';
        ctx.fill();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.font = `900 18px ${FONT_FAMILY}`;
        const msPraise =
          ms.rewardCoins > 0
            ? `里程碑达成！已奖励 ${ms.rewardCoins} 金币 · ${ms.badgeText}`
            : `里程碑达成！已解锁${ms.titleText}`;
        ctx.fillText(msPraise, LOGICAL_WIDTH / 2, 384);
      } else if (snap.justUnlockedEndless) {
        ctx.fillStyle = '#4ade80';
        ctx.font = '900 22px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText('已解锁新模式：无尽狂潮！', LOGICAL_WIDTH / 2, 384);
      }

      ctx.fillStyle = '#fde047';
      ctx.font = '900 36px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`基础金币：+${snap.runCoins}`, LOGICAL_WIDTH / 2, 424);
    }

    const mult =
      snap.isVictory ||
      (snap.mode === 'endless' && (snap.endlessWave >= 3 || snap.isNewEndlessRecord))
        ? 3
        : 2;

    const gapInfo = snap.upgradeGap;
    let growthText = '';
    let growthReady = false;
    if (gapInfo.allMaxed) {
      growthText = '全部局外战力已满级，冲刺更高无尽波次！';
      growthReady = true;
    } else if (gapInfo.canUpgradeNow) {
      growthText = '金币已充足，可回主界面升级战力！';
      growthReady = true;
    } else if (!snap.resultClaimed) {
      const withAdTotal = snap.save.coins + snap.runCoins * mult;
      growthText =
        withAdTotal >= gapInfo.minCost
          ? `距离下次升级仅差 ${gapInfo.gap} 金币（看广告翻倍即可升级）`
          : `距离下次升级仅差 ${gapInfo.gap} 金币（看广告翻倍加速升级）`;
    } else {
      growthText = `距离下次升级仅差 ${gapInfo.gap} 金币，再来一局即可凑齐`;
    }

    ctx.fillStyle = growthReady ? 'rgba(22, 101, 52, 0.55)' : 'rgba(15, 23, 42, 0.78)';
    drawRoundedRect(ctx, 76, 452, LOGICAL_WIDTH - 152, 48, 12);
    ctx.fill();
    ctx.strokeStyle = growthReady ? '#4ade80' : '#fbbf24';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = growthReady ? '#bbf7d0' : '#fde047';
    ctx.font = '800 19px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(growthText, LOGICAL_WIDTH / 2, 476);

    if (!snap.resultClaimed) {
      drawButton(
        ctx,
        this.hitBoxes,
        'res_claim_ad',
        104,
        520,
        LOGICAL_WIDTH - 208,
        88,
        `看广告 ${mult}倍领取`,
        actions.onResultClaimAd,
        {
          fillTop: '#f59e0b',
          fillBottom: '#d97706',
          borderColor: '#fef08a',
          fontSize: 28,
          subText: `可领 ${snap.runCoins * mult} 金币`,
          radius: 16,
        },
      );

      drawButton(
        ctx,
        this.hitBoxes,
        'res_claim_normal',
        136,
        626,
        LOGICAL_WIDTH - 272,
        60,
        `普通领取 ${snap.runCoins} 金币`,
        actions.onResultClaimNormal,
        {
          fillTop: '#334155',
          fillBottom: '#1e293b',
          borderColor: 'rgba(148, 163, 184, 0.4)',
          textColor: '#e2e8f0',
          fontSize: 22,
          radius: 12,
        },
      );
    } else {
      ctx.fillStyle = '#4ade80';
      ctx.font = '900 28px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('本局奖励已入账', LOGICAL_WIDTH / 2, 604);
    }

    drawButton(
      ctx,
      this.hitBoxes,
      'res_retry',
      104,
      708,
      244,
      68,
      snap.mode === 'endless' ? '再战无尽' : snap.isVictory ? '挑战下一关' : '再次挑战',
      actions.onRestartBattle,
      {
        fillTop: '#0ea5e9',
        fillBottom: '#0284c7',
        fontSize: 23,
        radius: 16,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'res_menu',
      372,
      708,
      244,
      68,
      '返回主菜单',
      actions.onBackToMenu,
      {
        fillTop: '#334155',
        fillBottom: '#1e293b',
        borderColor: 'rgba(148, 163, 184, 0.3)',
        fontSize: 23,
        radius: 16,
      },
    );

    if (snap.effectivePlatform === 'douyin' && snap.recorder.hasVideo) {
      drawButton(
        ctx,
        this.hitBoxes,
        'res_share_video',
        104,
        798,
        LOGICAL_WIDTH - 208,
        74,
        '发布高光视频',
        actions.onShareHighlightVideo,
        {
          fillTop: '#1f1024',
          fillBottom: '#0f172a',
          borderColor: '#ec4899',
          textColor: '#fbcfe8',
          fontSize: 22,
          subText: snap.canClaimVideoReward ? '今日首发布奖励 150 金币' : '分享本局精彩瞬间',
          subTextColor: '#fde68a',
          radius: 16,
        },
      );
    } else {
      drawButton(
        ctx,
        this.hitBoxes,
        'res_share_score',
        104,
        798,
        LOGICAL_WIDTH - 208,
        74,
        '分享战绩给好友',
        actions.onShareScore,
        {
          fillTop: '#0f172a',
          fillBottom: '#0f172a',
          borderColor: '#10b981',
          textColor: '#a7f3d0',
          fontSize: 22,
          subText: '邀请好友挑战更高波次',
          subTextColor: '#94a3b8',
          radius: 16,
        },
      );
    }

    if (snap.showStuckAssist) {
      drawButton(
        ctx,
        this.hitBoxes,
        'res_stuck_assist',
        104,
        894,
        LOGICAL_WIDTH - 208,
        80,
        '卡关助战：看广告借用满级传说武器 1 局',
        actions.onStartStuckAssist,
        {
          fillTop: '#991b1b',
          fillBottom: '#7f1d1d',
          borderColor: 'rgba(253, 224, 71, 0.72)',
          fontSize: 19,
          subText: '单局有效 · 满级传说火力与3名增援队友',
          subTextColor: '#fef08a',
          radius: 16,
        },
      );
    }
    ctx.restore();
  }

  private renderArmoryModal(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.86)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawPanelCard(ctx, 42, 130, LOGICAL_WIDTH - 84, 920, '免氪金传说军械库', '#8b5cf6');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('累计观看广告即可永久解锁传说涂装，零氪金免费换装', LOGICAL_WIDTH / 2, 240);

    let cardY = 276;
    for (const skin of SKINS) {
      const progress = snap.save.skinAdProgress[skin.id] || 0;
      const unlocked = skin.unlockAds <= 0 || progress >= skin.unlockAds;
      const equipped = snap.save.equippedSkin === skin.id;

      ctx.fillStyle = equipped ? 'rgba(88, 28, 135, 0.55)' : 'rgba(15, 23, 42, 0.88)';
      drawRoundedRect(ctx, 68, cardY, LOGICAL_WIDTH - 136, 152, 16);
      ctx.fill();
      ctx.strokeStyle = equipped ? '#fde047' : skin.primaryColor;
      ctx.lineWidth = equipped ? 3 : 2;
      drawRoundedRect(ctx, 68, cardY, LOGICAL_WIDTH - 136, 152, 16);
      ctx.stroke();

      ctx.fillStyle = skin.primaryColor;
      ctx.beginPath();
      ctx.arc(124, cardY + 76, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = skin.accentColor;
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 26px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(skin.name, 178, cardY + 42);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(skin.desc, 178, cardY + 78);

      if (skin.unlockAds > 0 && !unlocked) {
        drawProgressBar(ctx, 178, cardY + 104, 240, 20, progress / skin.unlockAds, skin.primaryColor);
        ctx.fillStyle = '#fde047';
        ctx.font = '800 16px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(`${progress} / ${skin.unlockAds} 次`, 432, cardY + 114);
      } else {
        ctx.fillStyle = equipped ? '#fde047' : '#4ade80';
        ctx.font = '800 18px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(equipped ? '当前已装备' : '已永久解锁', 178, cardY + 114);
      }

      const btnLabel = equipped ? '已装备' : unlocked ? '立即装备' : '看广告加1';
      let clickFn = this.armoryClickFns.get(skin.id);
      if (!clickFn) {
        clickFn = () => actions.onArmorySkinAction(skin);
        this.armoryClickFns.set(skin.id, clickFn);
      }
      drawButton(
        ctx,
        this.hitBoxes,
        `armory_${skin.id}`,
        LOGICAL_WIDTH - 228,
        cardY + 40,
        140,
        72,
        btnLabel,
        clickFn,
        {
          fillTop: equipped ? '#475569' : unlocked ? '#22c55e' : '#f59e0b',
          fillBottom: equipped ? '#334155' : unlocked ? '#16a34a' : '#d97706',
          fontSize: 20,
          radius: 12,
          disabled: equipped,
        },
      );

      cardY += 168;
    }

    drawButton(
      ctx,
      this.hitBoxes,
      'armory_close',
      180,
      958,
      LOGICAL_WIDTH - 360,
      70,
      '关闭军械库',
      actions.onCloseArmory,
      {
        fillTop: '#475569',
        fillBottom: '#334155',
        fontSize: 24,
        radius: 16,
      },
    );
    ctx.restore();
  }

  private renderToast(toast: ToastMessage, safeTop: number, inCombatHud = false): void {
    const ctx = this.ctx;
    const topBase = Math.max(22, safeTop) + 106;
    const y = inCombatHud ? Math.max(topBase, this.lastHudBottomY + 8) : Math.max(96, safeTop + 98);
    ctx.save();
    ctx.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    const textW = Math.min(640, Math.max(260, ctx.measureText(toast.text).width + 56));
    const x = (LOGICAL_WIDTH - textW) / 2;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    drawRoundedRect(ctx, x, y, textW, 46, 23);
    ctx.fill();
    ctx.strokeStyle = toast.color;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, x, y, textW, 46, 23);
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(toast.text, LOGICAL_WIDTH / 2, y + 23, textW - 36);
    ctx.restore();
  }
}
