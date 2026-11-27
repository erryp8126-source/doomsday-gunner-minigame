import type { PlatformSDK } from '../sdk/PlatformSDK';

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

/**
 * 跨端 2D 精绘资源管理器：
 * 1. 通过 PlatformSDK.createImage() 兼容浏览器 / 微信 wx / 抖音 tt 图片加载
 * 2. 加载完成后使用离屏 Canvas source-atop 自动生成纯白剪影，实现零开销受击闪白
 */
export class AssetLoader {
  private readonly sdk: PlatformSDK;
  public readonly sprites: Partial<Record<SpriteKey, HTMLImageElement>> = {};
  public readonly whiteSprites: Partial<Record<WhiteSpriteKey, HTMLCanvasElement>> = {};

  public readonly totalCount: number;
  public loadedCount = 0;
  public isReady = false;
  private started = false;

  constructor(sdk: PlatformSDK) {
    this.sdk = sdk;
    this.totalCount = Object.keys(ASSET_URLS).length;
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
        this.sprites[key] = img;
        if (WHITE_SILHOUETTE_KEYS.has(key)) {
          this.whiteSprites[key as WhiteSpriteKey] = this.buildWhiteSilhouette(img);
        }
        finishOne();
      };

      img.onerror = () => {
        finishOne();
      };

      img.src = ASSET_URLS[key];
    }
  }

  private buildWhiteSilhouette(img: HTMLImageElement): HTMLCanvasElement {
    const w = img.naturalWidth || img.width || 64;
    const h = img.naturalHeight || img.height || 64;
    const canvas = this.sdk.createOffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    return canvas;
  }
}
