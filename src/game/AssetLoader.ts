import type { PlatformSDK } from '../sdk/PlatformSDK';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from './types';

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

/**
 * 跨端 2D 精绘资源管理器：
 * 1. 通过 PlatformSDK.createImage() 兼容浏览器 / 微信 wx / 抖音 tt 图片加载
 * 2. 预烘焙 720×2560 无缝滚动街道缓存画布，消除每帧矩阵翻转与双次重绘
 * 3. 按 1.5x 目标尺寸预缩放精灵，并基于紧凑尺寸生成纯白剪影（source-atop）
 */
export class AssetLoader {
  private readonly sdk: PlatformSDK;
  public readonly sprites: Partial<Record<SpriteKey, DrawableSprite>> = {};
  public readonly whiteSprites: Partial<Record<WhiteSpriteKey, HTMLCanvasElement>> = {};
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

    const keys = Object.keys(ASSET_URLS) as SpriteKey[];
    for (const key of keys) {
      const img = this.sdk.createImage();
      const finishOne = () => {
        this.loadedCount += 1;
        if (this.loadedCount >= this.totalCount) {
          this.isReady = true;
          onComplete?.();
        }
      };

      img.onload = () => {
        if (key === 'bg_road') {
          this.sprites.bg_road = img;
          this.cachedRoad = this.buildSeamlessRoad(img);
        } else {
          const bakeSpec = SPRITE_BAKE_SPECS[key];
          const sprite = bakeSpec ? this.buildPreScaledSprite(img, bakeSpec.w, bakeSpec.h) : img;
          this.sprites[key] = sprite;
          if (WHITE_SILHOUETTE_KEYS.has(key)) {
            this.whiteSprites[key as WhiteSpriteKey] = this.buildWhiteSilhouette(sprite);
          }
        }
        finishOne();
      };

      img.onerror = () => {
        finishOne();
      };

      img.src = ASSET_URLS[key];
    }
  }

  private buildSeamlessRoad(img: HTMLImageElement): HTMLCanvasElement | null {
    try {
      const canvas = this.sdk.createOffscreenCanvas(LOGICAL_WIDTH, LOGICAL_HEIGHT * 2);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.imageSmoothingEnabled = true;

      // 上半段 [0, 1280) 绘制纵向翻转图，使默认向下滚动 0->1280 区间单次 drawImage 覆盖
      ctx.save();
      ctx.translate(0, LOGICAL_HEIGHT);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.restore();

      // 下半段 [1280, 2560) 绘制 1 倍正向图，与上半段在 y=1280 处顶边无缝衔接
      ctx.drawImage(img, 0, LOGICAL_HEIGHT, LOGICAL_WIDTH, LOGICAL_HEIGHT);
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
