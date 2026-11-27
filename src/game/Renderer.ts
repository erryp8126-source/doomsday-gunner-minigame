import { SKINS } from '../config/weapons';
import type { AssetLoader } from './AssetLoader';
import { drawButton, drawPanelCard, drawProgressBar, drawRoundedRect, HitBoxRegistry } from './CanvasUI';
import { getTrooperPositions } from './GameEngine';
import {
  BANNER_ZONE_TOP,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PLAYER_Y,
  type AirdropCrate,
  type Barrel,
  type Bullet,
  type DamageText,
  type GameMode,
  type GameState,
  type Gate,
  type LevelConfig,
  type Particle,
  type SaveData,
  type SkinDef,
  type ToastMessage,
  type WeaponDef,
  type Zombie,
} from './types';

export interface RenderSnapshot {
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
  skin: SkinDef;
  level: LevelConfig;
  elapsed: number;
  bossSpawned: boolean;
  bossRef: Zombie | null;
  kills: number;
  runCoins: number;
  combo: number;
  comboTimer: number;
  comboPulse: number;
  isVictory: boolean;
  reviveProgressPct: number;
  resultClaimed: boolean;
  airdrop: AirdropCrate;
  save: SaveData;
  toast: ToastMessage | null;
  safeTop: number;
  upgradeCosts: { attack: number; firerate: number; squad: number };
  canAfford: { attack: boolean; firerate: boolean; squad: boolean };
  bullets: { forEachActive: (fn: (b: Bullet) => void) => void };
  zombies: { forEachActive: (fn: (z: Zombie) => void) => void };
  barrels: { forEachActive: (fn: (b: Barrel) => void) => void };
  gates: { forEachActive: (fn: (g: Gate) => void) => void };
  particles: { forEachActive: (fn: (p: Particle) => void) => void };
  texts: { forEachActive: (fn: (t: DamageText) => void) => void };
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
}

/**
 * 2D 精绘 Canvas 渲染引擎（严格对齐 prototype_reference.html 视觉表现 + 100% 纯简体中文）
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly assets: AssetLoader;
  public readonly hitBoxes = new HitBoxRegistry();

  constructor(ctx: CanvasRenderingContext2D, assets: AssetLoader) {
    this.ctx = ctx;
    this.assets = assets;
  }

  public render(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    this.hitBoxes.clear();

    ctx.save();
    if (snap.state === 'PLAYING') {
      ctx.translate(snap.shakeX, snap.shakeY);
    }

    this.renderRoad(snap.roadScroll);
    this.renderGates(snap);
    this.renderBarrels(snap);
    this.renderZombies(snap);

    if (snap.airdrop.active && !snap.airdrop.claimed) {
      this.renderAirdropCrate(snap.airdrop, snap.clock, actions.onTriggerAirdrop, snap.state === 'PLAYING');
    }

    this.renderSquad(snap);
    this.renderBulletsAndEffects(snap);

    if (snap.state === 'PLAYING') {
      this.renderHUD(snap, actions);
    } else if (snap.state === 'MENU') {
      this.renderMenuOverlay(snap, actions);
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

    if (snap.damageVignette > 0.01) {
      ctx.save();
      const grad = ctx.createRadialGradient(
        LOGICAL_WIDTH * 0.5,
        LOGICAL_HEIGHT * 0.5,
        220,
        LOGICAL_WIDTH * 0.5,
        LOGICAL_HEIGHT * 0.5,
        680,
      );
      grad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      grad.addColorStop(1, `rgba(220, 38, 38, ${Math.min(0.65, snap.damageVignette)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.restore();
    }

    if (snap.toast) {
      this.renderToast(snap.toast, snap.safeTop);
    }
  }

  private renderRoad(roadScroll: number): void {
    const ctx = this.ctx;
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

  private renderGates(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    snap.gates.forEachActive((g) => {
      if (g.used) return;
      const pos = g.value >= 0;
      const gx = g.x - g.w / 2;
      const gy = g.y - g.h / 2;
      ctx.save();
      drawRoundedRect(ctx, gx, gy, g.w, g.h, 14);
      ctx.fillStyle =
        g.hitFlash > 0
          ? 'rgba(255, 255, 255, 0.75)'
          : pos
            ? 'rgba(14, 165, 233, 0.62)'
            : 'rgba(239, 68, 68, 0.65)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = pos ? '#7dd3fc' : '#fca5a5';
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(gx - 5, gy - 8, 10, g.h + 16);
      ctx.fillRect(gx + g.w - 5, gy - 8, 10, g.h + 16);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 28px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
      const txt =
        g.kind === 'squad'
          ? `队友 ${g.value >= 0 ? '+' : ''}${g.value}`
          : `射速 ${g.value >= 0 ? '+' : ''}${g.value}%`;
      ctx.strokeText(txt, g.x, g.y + 1);
      ctx.fillText(txt, g.x, g.y + 1);
      ctx.restore();
    });
  }

  private renderBarrels(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const img = this.assets.sprites.barrel;
    const whiteImg = this.assets.whiteSprites.barrel;
    let idx = 0;

    snap.barrels.forEachActive((b) => {
      idx += 1;
      ctx.save();
      ctx.translate(b.x, b.y);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(0, 42, 54, 18, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.scale(b.hitScale, b.hitScale);
      const bw = 114;
      const bh = 98;
      if (img) {
        ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh);
        if (b.hitFlash > 0 && whiteImg) {
          ctx.globalAlpha = 0.72;
          ctx.drawImage(whiteImg, -bw / 2, -bh / 2, bw, bh);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = b.hitFlash > 0 ? '#fef3c7' : '#b45309';
        drawRoundedRect(ctx, -bw / 2, -bh / 2, bw, bh, 16);
        ctx.fill();
      }

      ctx.font = '900 40px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#1f1004';
      const hpStr = String(Math.ceil(b.hp));
      ctx.strokeText(hpStr, 0, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(hpStr, 0, 2);
      ctx.restore();

      const bob = Math.sin(snap.clock * 6 + idx) * 6;
      if (b.iconKey && this.assets.sprites[b.iconKey]) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.beginPath();
        ctx.arc(0, -68 + bob, 38, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(this.assets.sprites[b.iconKey]!, -42, -108 + bob, 84, 80);
      }

      drawRoundedRect(ctx, -58, -138 + bob, 116, 30, 10);
      ctx.fillStyle =
        b.rewardType === 'weapon' ? '#0284c7' : b.rewardType === 'squad' ? '#059669' : '#7c3aed';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.rewardLabel, 0, -122 + bob);
      ctx.restore();
    });
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

    const list: Zombie[] = [];
    snap.zombies.forEachActive((z) => list.push(z));
    list.sort((a, b) => a.y - b.y);

    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      ctx.save();
      ctx.translate(z.x, z.y);

      const img = z.isBoss ? bImg : z.kind === 'runner' ? rImg : z.kind === 'tank' ? tImg : zImg;
      const wImg = z.isBoss ? bWhite : z.kind === 'runner' ? rWhite : z.kind === 'tank' ? tWhite : zWhite;
      const drawW =
        (z.isBoss ? 204 : z.kind === 'tank' ? 112 : z.kind === 'runner' ? 92 : 84) *
        (z.isBoss ? 1 : z.kind === 'normal' ? z.scale : 1);
      const drawH =
        (z.isBoss ? 204 : z.kind === 'tank' ? 132 : z.kind === 'runner' ? 98 : 106) *
        (z.isBoss ? 1 : z.kind === 'normal' ? z.scale : 1);

      if (z.dying) {
        ctx.globalAlpha = Math.max(0, z.dieLife / 0.48);
        ctx.rotate(z.rot);
        const sc = 0.65 + 0.45 * (z.dieLife / 0.48);
        ctx.scale(sc, sc);
        if (img) ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
        continue;
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(0, drawH * 0.42, drawW * 0.36, drawH * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();

      const wobbleRot = Math.sin(z.phase) * (z.isBoss ? 0.06 : 0.13);
      const squashY = 1 + Math.abs(Math.sin(z.phase)) * 0.06;
      const squashX = 1 / squashY;

      ctx.save();
      ctx.rotate(wobbleRot);
      ctx.scale(squashX, squashY);
      if (img) {
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        if (z.hitFlash > 0 && wImg) {
          ctx.globalAlpha = 0.78;
          ctx.drawImage(wImg, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = z.hitFlash > 0 ? '#ffffff' : z.isBoss ? '#dc2626' : '#65a30d';
        ctx.beginPath();
        ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (z.hp < z.maxHp || z.isBoss) {
        const bw = z.isBoss ? 150 : 52;
        const bh = z.isBoss ? 12 : 7;
        const by = -drawH / 2 - 14;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
        ctx.fillRect(-bw / 2, by, bw, bh);
        ctx.fillStyle = z.isBoss ? '#ff4757' : '#2ed573';
        ctx.fillRect(-bw / 2, by, bw * Math.max(0, z.hp / z.maxHp), bh);
      }
      ctx.restore();
    }
  }

  private renderAirdropCrate(
    airdrop: AirdropCrate,
    clock: number,
    onTrigger: () => void,
    interactive: boolean,
  ): void {
    const ctx = this.ctx;
    const pulse = 1 + Math.sin(clock * 8) * 0.07;
    const w = 88 * pulse;
    const h = 88 * pulse;
    const x = airdrop.x - w / 2;
    const y = airdrop.y - h / 2;

    ctx.save();
    const beam = ctx.createLinearGradient(airdrop.x, y - 160, airdrop.x, y + h);
    beam.addColorStop(0, 'rgba(250, 204, 21, 0)');
    beam.addColorStop(1, 'rgba(250, 204, 21, 0.45)');
    ctx.fillStyle = beam;
    ctx.fillRect(airdrop.x - 28, y - 150, 56, 160 + h * 0.5);

    ctx.fillStyle = '#f59e0b';
    drawRoundedRect(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, x, y, w, h, 16);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('超级空投', airdrop.x, airdrop.y - 11);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 15px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('点击领取', airdrop.x, airdrop.y + 14);
    ctx.restore();

    if (interactive) {
      this.hitBoxes.register({
        id: 'airdrop_crate',
        x: x - 18,
        y: y - 18,
        w: w + 36,
        h: h + 36,
        onClick: onTrigger,
      });
    }
  }

  private renderSquad(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const pImg = this.assets.sprites.player;
    const pts = getTrooperPositions(snap.squadCount, snap.squadX, PLAYER_Y);
    pts.sort((a, b) => a.y - b.y);

    if (snap.invincibleTimer > 0 || snap.doubleFireTimer > 0) {
      ctx.save();
      ctx.strokeStyle = snap.invincibleTimer > 0 ? '#38bdf8' : '#f59e0b';
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.ellipse(snap.squadX, PLAYER_Y + 20, 82, 42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.save();
      ctx.translate(p.x, p.y + (snap.state === 'PLAYING' ? snap.recoil * 0.5 : 0));

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 44, 28, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // 传说涂装脚底专属能量环
      if (snap.skin.id !== 'standard') {
        ctx.strokeStyle = snap.skin.primaryColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 42, 26, 10, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      const wob = snap.state === 'PLAYING' ? Math.sin(snap.clock * 14 + i) * 0.08 : 0;
      ctx.rotate(wob);

      if (pImg) {
        ctx.drawImage(pImg, -36, -56, 72, 114);
      } else {
        ctx.fillStyle = snap.skin.primaryColor;
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
      }

      if (snap.muzzleFlash > 0 && i < 7 && snap.state === 'PLAYING') {
        ctx.fillStyle = snap.weapon.color;
        ctx.beginPath();
        ctx.arc(16, -54, 11 + Math.random() * 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(16, -54, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 小队人数徽章
    ctx.save();
    drawRoundedRect(ctx, snap.squadX - 50, PLAYER_Y + 56, 100, 34, 17);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = snap.skin.primaryColor;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`小队 ${snap.squadCount}`, snap.squadX, PLAYER_Y + 74);
    ctx.restore();
  }

  private renderBulletsAndEffects(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    snap.bullets.forEachActive((b) => {
      ctx.save();
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = b.radius * 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    snap.particles.forEachActive((p) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.restore();
    });

    snap.texts.forEachActive((ft) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.font = `900 ${ft.size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#0f172a';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });
  }

  private renderHUD(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    const top = Math.max(20, snap.safeTop + 6);

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
    ctx.fillText(hudTitle, 102, top + 30);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    const subStats =
      snap.mode === 'endless'
        ? `击杀 ${snap.kills}  金币 ${snap.runCoins}  ${Math.floor(snap.totalSurviveSec)}秒`
        : `击杀 ${snap.kills}  金币 ${snap.runCoins}`;
    ctx.fillText(subStats, 102, top + 64);

    // 进度条
    const bx = 342;
    const by = top + 20;
    const bw = 186;
    const bh = 18;
    const prog = Math.min(1, snap.elapsed / Math.max(1, snap.level.duration));
    drawProgressBar(ctx, bx, by, bw, bh, prog, snap.bossSpawned ? '#ff4757' : '#34d399');

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 17px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    const remainSec = Math.max(0, Math.ceil(snap.level.duration - snap.elapsed));
    const progText = snap.bossSpawned
      ? snap.mode === 'endless'
        ? `第${snap.endlessWave}波 · 尸王战`
        : '熔岩尸王战'
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
      {
        fillTop: '#334155',
        fillBottom: '#1e293b',
        borderColor: '#64748b',
        fontSize: 20,
        radius: 16,
      },
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
      {
        fillTop: snap.save.muted ? '#475569' : '#1e293b',
        fillBottom: snap.save.muted ? '#334155' : '#0f172a',
        borderColor: '#64748b',
        fontSize: 20,
        radius: 16,
      },
    );

    // 熔岩尸王顶部大血条
    if (snap.bossRef && snap.bossRef.active && !snap.bossRef.dying) {
      ctx.save();
      const bossBarY = top + 106;
      drawRoundedRect(ctx, 74, bossBarY, LOGICAL_WIDTH - 148, 34, 12);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fill();
      const ratio = Math.max(0, snap.bossRef.hp / snap.bossRef.maxHp);
      if (ratio > 0.01) {
        drawRoundedRect(ctx, 78, bossBarY + 4, Math.max(16, (LOGICAL_WIDTH - 156) * ratio), 26, 9);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 19px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bossBarLabel =
        snap.mode === 'endless'
          ? `第${snap.endlessWave}波 ${snap.level.bossName}  ${Math.ceil(snap.bossRef.hp)} / ${snap.bossRef.maxHp}`
          : `${snap.level.bossName}  ${Math.ceil(snap.bossRef.hp)} / ${snap.bossRef.maxHp}`;
      ctx.fillText(bossBarLabel, LOGICAL_WIDTH / 2, bossBarY + 17);
      ctx.restore();
    }

    // 实时连击 ×N 徽章
    if (snap.combo >= 2) {
      ctx.save();
      ctx.translate(LOGICAL_WIDTH - 108, top + 206);
      ctx.scale(snap.comboPulse, snap.comboPulse);
      drawRoundedRect(ctx, -88, -38, 176, 76, 16);
      ctx.fillStyle = snap.combo >= 25 ? 'rgba(220, 38, 38, 0.86)' : 'rgba(217, 119, 6, 0.86)';
      ctx.fill();
      ctx.lineWidth = 3;
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

    // 火力翻倍提示条 & 超级空投快捷键
    let subY = top + 148;
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

    if (snap.airdrop.active && !snap.airdrop.claimed && snap.state === 'PLAYING') {
      drawButton(
        ctx,
        this.hitBoxes,
        'hud_airdrop_btn',
        LOGICAL_WIDTH - 208,
        subY + 110,
        186,
        52,
        '超级空投',
        actions.onTriggerAirdrop,
        {
          fillTop: '#fbbf24',
          fillBottom: '#d97706',
          borderColor: '#fef9c3',
          textColor: '#0f172a',
          fontSize: 20,
          radius: 16,
          pulseScale: 1 + Math.sin(snap.clock * 8) * 0.04,
        },
      );
    }
  }

  private renderMenuOverlay(
    snap: RenderSnapshot,
    actions: RenderActions,
    disableInteraction = false,
  ): void {
    const ctx = this.ctx;
    const top = Math.max(20, snap.safeTop + 10);

    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
    grad.addColorStop(0, 'rgba(9, 13, 20, 0.72)');
    grad.addColorStop(0.55, 'rgba(9, 13, 20, 0.48)');
    grad.addColorStop(1, 'rgba(9, 13, 20, 0.88)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // 顶部金币栏、军械库、静音按钮
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    drawRoundedRect(ctx, 22, top, 210, 50, 25);
    ctx.fill();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 22, top, 210, 50, 25);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde047';
    ctx.font = '900 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`金币：${snap.save.coins}`, 127, top + 25);

    if (!disableInteraction) {
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_armory',
        LOGICAL_WIDTH - 252,
        top,
        130,
        50,
        '军械库',
        actions.onOpenArmory,
        {
          fillTop: '#7c3aed',
          fillBottom: '#5b21b6',
          borderColor: '#ddd6fe',
          fontSize: 20,
          radius: 16,
        },
      );

      drawButton(
        ctx,
        this.hitBoxes,
        'menu_mute',
        LOGICAL_WIDTH - 112,
        top,
        90,
        50,
        snap.save.muted ? '静音' : '音效',
        actions.onToggleMute,
        {
          fillTop: '#334155',
          fillBottom: '#1e293b',
          fontSize: 19,
          radius: 16,
        },
      );
    }

    // 2D 精绘熔岩尸王展示
    if (this.assets.sprites.boss) {
      const bob = Math.sin(snap.clock * 3) * 8;
      ctx.drawImage(this.assets.sprites.boss, LOGICAL_WIDTH / 2 - 110, 268 + bob, 220, 220);
    }

    // 游戏主标题
    ctx.textAlign = 'center';
    ctx.font = '900 68px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#1e1004';
    ctx.strokeText('末日枪手突围', LOGICAL_WIDTH / 2, 162);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('末日枪手突围', LOGICAL_WIDTH / 2, 162);

    // 关卡切换铭牌
    drawRoundedRect(ctx, 130, 206, LOGICAL_WIDTH - 260, 46, 23);
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
      230,
    );

    if (!disableInteraction) {
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_prev_lvl',
        56,
        205,
        64,
        48,
        '上关',
        actions.onPrevLevel,
        {
          fillTop: '#334155',
          fillBottom: '#1e293b',
          fontSize: 18,
          radius: 14,
          disabled: snap.save.selectedLevel <= 1,
        },
      );
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_next_lvl',
        LOGICAL_WIDTH - 120,
        205,
        64,
        48,
        '下关',
        actions.onNextLevel,
        {
          fillTop: '#334155',
          fillBottom: '#1e293b',
          fontSize: 18,
          radius: 14,
          disabled: snap.save.selectedLevel >= snap.save.unlockedLevel,
        },
      );
    }

    // 纪录与涂装条
    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 21px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(
      `最高击杀：${snap.save.bestKills}  ·  当前涂装：${snap.skin.name}`,
      LOGICAL_WIDTH / 2,
      512,
    );

    // 局外永久养成区（3 项紧凑卡片）
    const cardW = 198;
    const gap = 16;
    const startX = (LOGICAL_WIDTH - (cardW * 3 + gap * 2)) / 2;
    const upgrades = [
      {
        id: 'upg_atk',
        title: '基础攻击',
        levelText: `${snap.save.attackLevel}级`,
        cost: snap.upgradeCosts.attack,
        canBuy: snap.canAfford.attack,
        isMax: snap.save.attackLevel >= 20,
        onClick: actions.onUpgradeAttack,
      },
      {
        id: 'upg_spd',
        title: '初始射速',
        levelText: `${snap.save.fireRateLevel}级`,
        cost: snap.upgradeCosts.firerate,
        canBuy: snap.canAfford.firerate,
        isMax: snap.save.fireRateLevel >= 20,
        onClick: actions.onUpgradeFireRate,
      },
      {
        id: 'upg_sqd',
        title: '初始人数',
        levelText: `${snap.save.squadLevel}人`,
        cost: snap.upgradeCosts.squad,
        canBuy: snap.canAfford.squad,
        isMax: snap.save.squadLevel >= 6,
        onClick: actions.onUpgradeSquad,
      },
    ];

    upgrades.forEach((u, idx) => {
      const cx = startX + idx * (cardW + gap);
      const cy = 540;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      drawRoundedRect(ctx, cx, cy, cardW, 146, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, cx, cy, cardW, 146, 16);
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 20px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(u.title, cx + cardW / 2, cy + 28);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '900 24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(u.levelText, cx + cardW / 2, cy + 62);

      if (!disableInteraction) {
        drawButton(
          ctx,
          this.hitBoxes,
          u.id,
          cx + 14,
          cy + 86,
          cardW - 28,
          48,
          u.isMax ? '已满级' : `${u.cost} 金币`,
          u.onClick,
          {
            fillTop: u.canBuy ? '#22c55e' : '#334155',
            fillBottom: u.canBuy ? '#16a34a' : '#1e293b',
            fontSize: 18,
            radius: 12,
            disabled: !u.canBuy || u.isMax,
          },
        );
      }
    });

    // 主菜单核心开局按钮区（底边最高 998 <= 1095，严格保留防误触间距）
    if (!disableInteraction) {
      drawButton(
        ctx,
        this.hitBoxes,
        'menu_super_start',
        70,
        718,
        LOGICAL_WIDTH - 140,
        88,
        '看广告满配开局（加特林+5人）',
        actions.onStartSuperBattle,
        {
          fillTop: '#f59e0b',
          fillBottom: '#d97706',
          borderColor: '#fde68a',
          textColor: '#0f172a',
          fontSize: 27,
          radius: 22,
          pulseScale: 1 + Math.sin(snap.clock * 4) * 0.015,
        },
      );

      drawButton(
        ctx,
        this.hitBoxes,
        'menu_start',
        70,
        826,
        LOGICAL_WIDTH - 140,
        86,
        '开始关卡突围',
        actions.onStartBattle,
        {
          fillTop: '#10b981',
          fillBottom: '#059669',
          borderColor: '#6ee7b7',
          fontSize: 32,
          subText: `第${snap.level.id}关 · ${snap.level.name}`,
          radius: 22,
        },
      );

      const endlessSub =
        snap.save.endlessBestWave > 0
          ? `最高第 ${snap.save.endlessBestWave} 波 · 最高击杀 ${snap.save.endlessBestKills}`
          : '无限波次尸王 · 挑战生存极限';

      drawButton(
        ctx,
        this.hitBoxes,
        'menu_endless',
        70,
        928,
        LOGICAL_WIDTH - 140,
        76,
        '无尽尸潮模式',
        actions.onStartEndless,
        {
          fillTop: '#9333ea',
          fillBottom: '#6b21a8',
          borderColor: '#f5d0fe',
          fontSize: 26,
          subText: endlessSub,
          subTextColor: '#fde047',
          radius: 20,
        },
      );
    }

    // 底部 Banner 安全区提示
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    drawRoundedRect(ctx, 44, BANNER_ZONE_TOP + 12, LOGICAL_WIDTH - 88, 76, 16);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('底部广告安全区 · 严禁误触区域', LOGICAL_WIDTH / 2, BANNER_ZONE_TOP + 50);

    // 若素材仍在初始化加载，底部显示小进度提示
    if (!this.assets.isReady) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(
        `精绘资源加载中 ${this.assets.loadedCount} / ${this.assets.totalCount}`,
        LOGICAL_WIDTH / 2,
        1048,
      );
    }

    ctx.restore();
  }

  private renderPauseModal(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawPanelCard(ctx, 84, 360, LOGICAL_WIDTH - 168, 430, '战斗已暂停', '#38bdf8');

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_resume',
      140,
      490,
      LOGICAL_WIDTH - 280,
      82,
      '继续突围',
      actions.onTogglePause,
      {
        fillTop: '#22c55e',
        fillBottom: '#16a34a',
        fontSize: 28,
        radius: 20,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_restart',
      140,
      592,
      LOGICAL_WIDTH - 280,
      74,
      snap.mode === 'endless' ? '重开无尽' : '重新本关',
      actions.onRestartBattle,
      {
        fillTop: '#f59e0b',
        fillBottom: '#d97706',
        fontSize: 24,
        radius: 18,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'pause_menu',
      140,
      686,
      LOGICAL_WIDTH - 280,
      68,
      '返回主菜单',
      actions.onBackToMenu,
      {
        fillTop: '#475569',
        fillBottom: '#334155',
        fontSize: 22,
        radius: 18,
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
        radius: 20,
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
        radius: 20,
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
        radius: 18,
      },
    );
    ctx.restore();
  }

  private renderReviveModal(snap: RenderSnapshot, actions: RenderActions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.84)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawPanelCard(ctx, 58, 300, LOGICAL_WIDTH - 116, 540, '小队全员倒下', '#ef4444');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fecaca';
    ctx.font = '800 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    const reviveSubText =
      snap.mode === 'endless'
        ? `当前进度：无尽第 ${snap.endlessWave} 波 · 击杀 ${snap.kills}`
        : `当前突围进度：${snap.reviveProgressPct}%`;
    ctx.fillText(reviveSubText, LOGICAL_WIDTH / 2, 434);

    ctx.fillStyle = '#fde047';
    ctx.font = '900 28px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('复活恢复五名队友并全屏清怪', LOGICAL_WIDTH / 2, 492);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('本局仅限复活一次', LOGICAL_WIDTH / 2, 536);

    drawButton(
      ctx,
      this.hitBoxes,
      'revive_ad',
      108,
      588,
      LOGICAL_WIDTH - 216,
      98,
      '看广告复活并清屏',
      actions.onReviveWatchAd,
      {
        fillTop: '#22c55e',
        fillBottom: '#16a34a',
        borderColor: '#bbf7d0',
        fontSize: 30,
        subText: '含两秒半无敌护盾保护',
        radius: 22,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'revive_giveup',
      180,
      714,
      LOGICAL_WIDTH - 360,
      68,
      '放弃复活，前往结算',
      actions.onReviveGiveUp,
      {
        fillTop: '#475569',
        fillBottom: '#334155',
        fontSize: 22,
        radius: 18,
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

    drawPanelCard(ctx, 56, 210, LOGICAL_WIDTH - 112, 820, resultTitle, resultBorder);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (snap.mode === 'endless') {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 26px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(
        `到达波次：第${snap.endlessWave}波 · 生存${Math.floor(snap.totalSurviveSec)}秒`,
        LOGICAL_WIDTH / 2,
        338,
      );

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(
        `消灭感染者：${snap.kills}（纪录 ${snap.save.endlessBestKills}）`,
        LOGICAL_WIDTH / 2,
        384,
      );

      if (snap.isNewEndlessRecord) {
        ctx.fillStyle = '#4ade80';
        ctx.font = '900 22px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText('突破历史最高纪录', LOGICAL_WIDTH / 2, 424);
      }

      ctx.fillStyle = '#fde047';
      ctx.font = '900 40px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`基础金币：+${snap.runCoins}`, LOGICAL_WIDTH / 2, 472);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 26px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`关卡：第${snap.level.id}关·${snap.level.name}`, LOGICAL_WIDTH / 2, 342);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`本局消灭感染者：${snap.kills}`, LOGICAL_WIDTH / 2, 394);

      ctx.fillStyle = '#fde047';
      ctx.font = '900 42px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`基础金币：+${snap.runCoins}`, LOGICAL_WIDTH / 2, 464);
    }

    const mult =
      snap.isVictory ||
      (snap.mode === 'endless' && (snap.endlessWave >= 3 || snap.isNewEndlessRecord))
        ? 3
        : 2;

    if (!snap.resultClaimed) {
      drawButton(
        ctx,
        this.hitBoxes,
        'res_claim_ad',
        104,
        546,
        LOGICAL_WIDTH - 208,
        98,
        `看广告 ${mult}倍领取`,
        actions.onResultClaimAd,
        {
          fillTop: '#f59e0b',
          fillBottom: '#d97706',
          borderColor: '#fef08a',
          fontSize: 32,
          subText: `可领 ${snap.runCoins * mult} 金币`,
          radius: 22,
        },
      );

      drawButton(
        ctx,
        this.hitBoxes,
        'res_claim_normal',
        136,
        668,
        LOGICAL_WIDTH - 272,
        74,
        `普通领取 ${snap.runCoins} 金币`,
        actions.onResultClaimNormal,
        {
          fillTop: '#22c55e',
          fillBottom: '#16a34a',
          fontSize: 24,
          radius: 18,
        },
      );
    } else {
      ctx.fillStyle = '#4ade80';
      ctx.font = '900 28px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('本局奖励已入账', LOGICAL_WIDTH / 2, 610);
    }

    drawButton(
      ctx,
      this.hitBoxes,
      'res_retry',
      104,
      790,
      244,
      82,
      snap.mode === 'endless' ? '再战无尽' : snap.isVictory ? '挑战下一关' : '再次挑战',
      actions.onRestartBattle,
      {
        fillTop: '#38bdf8',
        fillBottom: '#0284c7',
        fontSize: 24,
        radius: 18,
      },
    );

    drawButton(
      ctx,
      this.hitBoxes,
      'res_menu',
      372,
      790,
      244,
      82,
      '返回主菜单',
      actions.onBackToMenu,
      {
        fillTop: '#475569',
        fillBottom: '#334155',
        fontSize: 24,
        radius: 18,
      },
    );

    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    drawRoundedRect(ctx, 44, BANNER_ZONE_TOP + 12, LOGICAL_WIDTH - 88, 76, 16);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('底部广告安全区 · 严禁误触区域', LOGICAL_WIDTH / 2, BANNER_ZONE_TOP + 50);
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
      drawRoundedRect(ctx, 68, cardY, LOGICAL_WIDTH - 136, 152, 20);
      ctx.fill();
      ctx.strokeStyle = equipped ? '#fde047' : skin.primaryColor;
      ctx.lineWidth = equipped ? 3 : 2;
      drawRoundedRect(ctx, 68, cardY, LOGICAL_WIDTH - 136, 152, 20);
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
      drawButton(
        ctx,
        this.hitBoxes,
        `armory_${skin.id}`,
        LOGICAL_WIDTH - 228,
        cardY + 40,
        140,
        72,
        btnLabel,
        () => actions.onArmorySkinAction(skin),
        {
          fillTop: equipped ? '#475569' : unlocked ? '#22c55e' : '#f59e0b',
          fillBottom: equipped ? '#334155' : unlocked ? '#16a34a' : '#d97706',
          fontSize: 20,
          radius: 16,
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
        radius: 18,
      },
    );
    ctx.restore();
  }

  private renderToast(toast: ToastMessage, safeTop: number): void {
    const ctx = this.ctx;
    const y = Math.max(96, safeTop + 88);
    ctx.save();
    ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    const textW = Math.min(620, Math.max(260, ctx.measureText(toast.text).width + 64));
    const x = (LOGICAL_WIDTH - textW) / 2;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    drawRoundedRect(ctx, x, y, textW, 56, 28);
    ctx.fill();
    ctx.strokeStyle = toast.color;
    ctx.lineWidth = 2.5;
    drawRoundedRect(ctx, x, y, textW, 56, 28);
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(toast.text, LOGICAL_WIDTH / 2, y + 28);
    ctx.restore();
  }
}
