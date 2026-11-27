import type { PlatformSDK } from '../sdk/PlatformSDK';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, ROAD_LEFT, ROAD_W } from './types';

export type SpriteKey =
  | 'bg_road'
  | 'player'
  | 'zombie'
  | 'zombie_runner'
  | 'zombie_tank'
  | 'boss'
  | 'barrel'
  | 'weapon_pistol'
  | 'weapon_shotgun'
  | 'weapon_gatling'
  | 'weapon_rocket';

export type WhiteSpriteKey = 'zombie' | 'zombie_runner' | 'zombie_tank' | 'boss' | 'barrel';

export type DrawableSprite = HTMLImageElement | HTMLCanvasElement;

const ASSET_URLS: Record<SpriteKey, string> = {
  bg_road: 'assets/sprites/bg_road.jpg',
  player: 'assets/sprites/player_trooper.png',
  zombie: 'assets/sprites/zombie_normal.png',
  zombie_runner: 'assets/sprites/zombie_runner.png',
  zombie_tank: 'assets/sprites/zombie_tank.png',
  boss: 'assets/sprites/zombie_boss.png',
  barrel: 'assets/sprites/prop_barrel.png',
  weapon_pistol: 'assets/sprites/weapon_pistol.png',
  weapon_shotgun: 'assets/sprites/weapon_shotgun.png',
  weapon_gatling: 'assets/sprites/weapon_gatling.png',
  weapon_rocket: 'assets/sprites/weapon_rocket.png',
};

const WHITE_SILHOUETTE_KEYS = new Set<SpriteKey>([
  'zombie',
  'zombie_runner',
  'zombie_tank',
  'boss',
  'barrel',
]);

/** 按实际渲染逻辑尺寸的 1.5 倍预烘焙离屏精灵，消除每帧大图降采样开销 */
const SPRITE_BAKE_SPECS: Partial<Record<SpriteKey, { w: number; h: number }>> = {
  player: { w: 108, h: 171 },
  zombie: { w: 126, h: 159 },
  zombie_runner: { w: 138, h: 147 },
  zombie_tank: { w: 168, h: 198 },
  boss: { w: 330, h: 330 },
  barrel: { w: 171, h: 147 },
  weapon_pistol: { w: 126, h: 120 },
  weapon_shotgun: { w: 126, h: 120 },
  weapon_gatling: { w: 126, h: 120 },
  weapon_rocket: { w: 126, h: 120 },
};

const RETRY_DELAY_MS = 300;

const WEAPON_ACCENT_COLORS: Partial<Record<SpriteKey, string>> = {
  weapon_pistol: '#ffe066',
  weapon_shotgun: '#ff9f43',
  weapon_gatling: '#38bdf8',
  weapon_rocket: '#ff4757',
};

const HUMANOID_PALETTES: Partial<
  Record<SpriteKey, { outer: string; inner: string; accent: string }>
> = {
  player: { outer: '#0284c7', inner: '#38bdf8', accent: '#e0f2fe' },
  zombie: { outer: '#15803d', inner: '#22c55e', accent: '#fde047' },
  zombie_runner: { outer: '#c2410c', inner: '#f97316', accent: '#fef08a' },
  zombie_tank: { outer: '#6b21a8', inner: '#a855f7', accent: '#e9d5ff' },
  boss: { outer: '#991b1b', inner: '#ef4444', accent: '#fbbf24' },
};

function traceRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * 跨端 2D 精绘资源管理器：
 * 1. 通过 PlatformSDK.createImage() 兼容浏览器 / 微信 wx / 抖音 tt 图片加载
 * 2. 预烘焙 720×2560 无缝滚动街道缓存画布，消除每帧矩阵翻转与双次重绘
 * 3. 按 1.5x 目标尺寸预缩放精灵，并基于紧凑尺寸生成纯白剪影（source-atop）
 * 4. 单图加载失败自动延迟 300ms 重试一次，仍失败时生成离屏矢量兜底占位并记录 failedKeys
 */
export class AssetLoader {
  private readonly sdk: PlatformSDK;
  public readonly sprites: Partial<Record<SpriteKey, DrawableSprite>> = {};
  public readonly whiteSprites: Partial<Record<WhiteSpriteKey, HTMLCanvasElement>> = {};
  public readonly failedKeys: SpriteKey[] = [];
  public cachedRoad: HTMLCanvasElement | null = null;
  public readonly shadowOval: HTMLCanvasElement | null;

  public readonly totalCount: number;
  public loadedCount = 0;
  public isReady = false;
  private started = false;

  constructor(sdk: PlatformSDK) {
    this.sdk = sdk;
    this.totalCount = Object.keys(ASSET_URLS).length;
    this.shadowOval = this.buildShadowOval();
  }

  private buildShadowOval(): HTMLCanvasElement | null {
    try {
      const canvas = this.sdk.createOffscreenCanvas(64, 32);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.clearRect(0, 0, 64, 32);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(32, 16, 30, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      return canvas;
    } catch {
      return null;
    }
  }

  public loadAll(onComplete?: () => void): void {
    if (this.started) return;
    this.started = true;

    const finishOne = () => {
      this.loadedCount += 1;
      if (this.loadedCount >= this.totalCount) {
        this.isReady = true;
        onComplete?.();
      }
    };

    const keys = Object.keys(ASSET_URLS) as SpriteKey[];
    for (const key of keys) {
      this.loadSingleSprite(key, finishOne);
    }
  }

  private loadSingleSprite(key: SpriteKey, onDone: () => void): void {
    const img = this.sdk.createImage();
    let retried = false;
    let settled = false;

    const attemptLoad = () => {
      img.src = ASSET_URLS[key];
    };

    img.onload = () => {
      if (settled) return;
      settled = true;
      this.applyLoadedSprite(key, img);
      onDone();
    };

    img.onerror = () => {
      if (settled) return;
      if (!retried) {
        retried = true;
        setTimeout(() => {
          if (!settled) {
            attemptLoad();
          }
        }, RETRY_DELAY_MS);
        return;
      }
      settled = true;
      this.applyFallbackSprite(key);
      onDone();
    };

    attemptLoad();
  }

  private applyLoadedSprite(key: SpriteKey, img: HTMLImageElement): void {
    if (key === 'bg_road') {
      this.sprites.bg_road = img;
      this.cachedRoad = this.buildSeamlessRoad(img);
      return;
    }
    const bakeSpec = SPRITE_BAKE_SPECS[key];
    const sprite = bakeSpec ? this.buildPreScaledSprite(img, bakeSpec.w, bakeSpec.h) : img;
    this.sprites[key] = sprite;
    if (WHITE_SILHOUETTE_KEYS.has(key)) {
      this.whiteSprites[key as WhiteSpriteKey] = this.buildWhiteSilhouette(sprite);
    }
  }

  private applyFallbackSprite(key: SpriteKey): void {
    if (!this.failedKeys.includes(key)) {
      this.failedKeys.push(key);
    }
    const fallback = this.buildFallbackSprite(key);
    if (!fallback) return;

    this.sprites[key] = fallback;
    if (key === 'bg_road') {
      this.cachedRoad = this.buildSeamlessRoad(fallback);
    } else if (WHITE_SILHOUETTE_KEYS.has(key)) {
      this.whiteSprites[key as WhiteSpriteKey] = this.buildWhiteSilhouette(fallback);
    }
  }

  private buildFallbackSprite(key: SpriteKey): HTMLCanvasElement | null {
    const size =
      key === 'bg_road'
        ? { w: LOGICAL_WIDTH, h: LOGICAL_HEIGHT }
        : (SPRITE_BAKE_SPECS[key] ?? { w: 128, h: 128 });

    try {
      const canvas = this.sdk.createOffscreenCanvas(size.w, size.h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.clearRect(0, 0, size.w, size.h);
      if (key === 'bg_road') {
        this.drawRoadFallback(ctx, size.w, size.h);
      } else if (key === 'barrel') {
        this.drawBarrelFallback(ctx, size.w, size.h);
      } else if (key in WEAPON_ACCENT_COLORS) {
        this.drawWeaponFallback(ctx, size.w, size.h, WEAPON_ACCENT_COLORS[key] || '#fbbf24');
      } else {
        const pal = HUMANOID_PALETTES[key] ?? {
          outer: '#475569',
          inner: '#64748b',
          accent: '#f8fafc',
        };
        this.drawHumanoidFallback(ctx, size.w, size.h, pal, key === 'boss');
      }
      return canvas;
    } catch {
      return null;
    }
  }

  private drawRoadFallback(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#2d3440';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3b4252';
    ctx.fillRect(ROAD_LEFT, 0, ROAD_W, h);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(ROAD_LEFT, 0, 8, h);
    ctx.fillRect(ROAD_LEFT + ROAD_W - 8, 0, 8, h);
    ctx.fillStyle = '#cbd5e1';
    for (let y = 20; y < h; y += 96) {
      ctx.fillRect(w * 0.5 - 4, y, 8, 48);
    }
  }

  private drawBarrelFallback(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const padX = w * 0.14;
    const padY = h * 0.12;
    const bw = w - padX * 2;
    const bh = h - padY * 2;
    ctx.fillStyle = '#92400e';
    traceRoundRect(ctx, padX, padY, bw, bh, 18);
    ctx.fill();
    ctx.fillStyle = '#d97706';
    traceRoundRect(ctx, padX + 8, padY + 8, bw - 16, bh - 16, 14);
    ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.fillRect(padX + 2, padY + bh * 0.22, bw - 4, bh * 0.12);
    ctx.fillRect(padX + 2, padY + bh * 0.66, bw - 4, bh * 0.12);
  }

  private drawWeaponFallback(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    accent: string,
  ): void {
    ctx.fillStyle = '#1e293b';
    traceRoundRect(ctx, w * 0.12, h * 0.28, w * 0.76, h * 0.34, 12);
    ctx.fill();
    ctx.fillStyle = accent;
    traceRoundRect(ctx, w * 0.18, h * 0.35, w * 0.52, h * 0.18, 8);
    ctx.fill();
    ctx.fillStyle = '#475569';
    traceRoundRect(ctx, w * 0.22, h * 0.56, w * 0.18, h * 0.28, 6);
    ctx.fill();
  }

  private drawHumanoidFallback(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    pal: { outer: string; inner: string; accent: string },
    isBoss: boolean,
  ): void {
    const cx = w * 0.5;
    if (isBoss) {
      ctx.fillStyle = pal.accent;
      traceRoundRect(ctx, cx - w * 0.34, h * 0.1, w * 0.12, h * 0.16, 8);
      ctx.fill();
      traceRoundRect(ctx, cx + w * 0.22, h * 0.1, w * 0.12, h * 0.16, 8);
      ctx.fill();
    }
    // 躯干剪影
    ctx.fillStyle = pal.outer;
    traceRoundRect(ctx, cx - w * 0.3, h * 0.34, w * 0.6, h * 0.54, 18);
    ctx.fill();
    ctx.fillStyle = pal.inner;
    traceRoundRect(ctx, cx - w * 0.22, h * 0.38, w * 0.44, h * 0.42, 14);
    ctx.fill();
    // 头部剪影与目镜/高光
    ctx.fillStyle = pal.outer;
    ctx.beginPath();
    ctx.arc(cx, h * 0.26, Math.min(w, h) * 0.19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.accent;
    traceRoundRect(ctx, cx - w * 0.14, h * 0.21, w * 0.28, h * 0.09, 6);
    ctx.fill();
  }

  private buildSeamlessRoad(src: DrawableSprite): HTMLCanvasElement | null {
    try {
      const canvas = this.sdk.createOffscreenCanvas(LOGICAL_WIDTH, LOGICAL_HEIGHT * 2);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.imageSmoothingEnabled = true;

      // 上半段 [0, 1280) 绘制纵向翻转图，使默认向下滚动 0->1280 区间单次 drawImage 覆盖
      ctx.save();
      ctx.translate(0, LOGICAL_HEIGHT);
      ctx.scale(1, -1);
      ctx.drawImage(src, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.restore();

      // 下半段 [1280, 2560) 绘制 1 倍正向图，与上半段在 y=1280 处顶边无缝衔接
      ctx.drawImage(src, 0, LOGICAL_HEIGHT, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      return canvas;
    } catch {
      return null;
    }
  }

  private buildPreScaledSprite(
    img: HTMLImageElement,
    targetW: number,
    targetH: number,
  ): DrawableSprite {
    try {
      const canvas = this.sdk.createOffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return img;
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) {
        (ctx as CanvasRenderingContext2D & { imageSmoothingQuality: string }).imageSmoothingQuality =
          'high';
      }
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      return canvas;
    } catch {
      return img;
    }
  }

  private buildWhiteSilhouette(src: DrawableSprite): HTMLCanvasElement {
    const w = ('naturalWidth' in src && src.naturalWidth) || src.width || 64;
    const h = ('naturalHeight' in src && src.naturalHeight) || src.height || 64;
    const canvas = this.sdk.createOffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    return canvas;
  }
}
