import type { HitRect } from './types';

export interface ButtonStyle {
  fillTop: string;
  fillBottom: string;
  borderColor?: string;
  shadowColor?: string;
  textColor?: string;
  fontSize?: number;
  subText?: string;
  subTextColor?: string;
  radius?: number;
  disabled?: boolean;
  pulseScale?: number;
}

const GRADIENT_CACHE = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();
const MAX_CACHED_GRADIENTS = 128;

function getCachedLinearGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c0: string,
  c1: string,
  cMid?: string,
): CanvasGradient {
  let cache = GRADIENT_CACHE.get(ctx);
  if (!cache) {
    cache = new Map<string, CanvasGradient>();
    GRADIENT_CACHE.set(ctx, cache);
  }
  const rx0 = Math.round(x0);
  const ry0 = Math.round(y0);
  const rx1 = Math.round(x1);
  const ry1 = Math.round(y1);
  const key = `${rx0}_${ry0}_${rx1}_${ry1}_${c0}_${cMid ?? ''}_${c1}`;
  let grad = cache.get(key);
  if (!grad) {
    if (cache.size >= MAX_CACHED_GRADIENTS) {
      cache.clear();
    }
    grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, c0);
    if (cMid !== undefined) {
      grad.addColorStop(0.5, cMid);
    }
    grad.addColorStop(1, c1);
    cache.set(key, grad);
  }
  return grad;
}

/**
 * 纯 Canvas UI 渲染与点击碰撞注册器（零 DOM 依赖，复用槽位避免每帧分配）
 */
export class HitBoxRegistry {
  private readonly boxes: HitRect[] = [];
  private activeCount = 0;

  public clear(): void {
    this.activeCount = 0;
  }

  public registerRect(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void,
  ): void {
    if (this.activeCount < this.boxes.length) {
      const slot = this.boxes[this.activeCount];
      slot.id = id;
      slot.x = x;
      slot.y = y;
      slot.w = w;
      slot.h = h;
      slot.onClick = onClick;
    } else {
      this.boxes.push({ id, x, y, w, h, onClick });
    }
    this.activeCount += 1;
  }

  public register(box: HitRect): void {
    this.registerRect(box.id, box.x, box.y, box.w, box.h, box.onClick);
  }

  public handleTap(x: number, y: number): boolean {
    for (let i = this.activeCount - 1; i >= 0; i--) {
      const b = this.boxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        b.onClick();
        return true;
      }
    }
    return false;
  }
}

export function drawRoundedRect(
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

export function drawButton(
  ctx: CanvasRenderingContext2D,
  registry: HitBoxRegistry,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  style: ButtonStyle,
): void {
  const radius = style.radius ?? 18;
  const scale = style.pulseScale ?? 1;
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;

  ctx.save();
  if (scale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  // 底部立体投影
  ctx.fillStyle = style.disabled ? 'rgba(15, 23, 42, 0.5)' : (style.shadowColor ?? 'rgba(0, 0, 0, 0.45)');
  drawRoundedRect(ctx, x, y + 6, w, h, radius);
  ctx.fill();

  // 主体渐变（查缓存，严禁每帧新建 CanvasGradient）
  ctx.fillStyle = style.disabled
    ? getCachedLinearGradient(ctx, x, y, x, y + h, '#475569', '#334155')
    : getCachedLinearGradient(ctx, x, y, x, y + h, style.fillTop, style.fillBottom);
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fill();

  // 顶部高光条（克制弱化，避免亮白带横切文字区）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  drawRoundedRect(ctx, x + 6, y + 3, w - 12, Math.max(4, h * 0.14), Math.max(3, radius - 4));
  ctx.fill();

  // 描边
  if (style.borderColor) {
    ctx.strokeStyle = style.disabled ? '#64748b' : style.borderColor;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.stroke();
  }

  // 文案
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.disabled ? '#cbd5e1' : (style.textColor ?? '#ffffff');
  const fontSize = style.fontSize ?? 28;
  ctx.font = `900 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;

  if (style.subText) {
    const subSize = Math.max(14, Math.round(fontSize * 0.58));
    const lineGap = Math.max(6, Math.round(fontSize * 0.24));
    const totalH = fontSize + lineGap + subSize;
    const mainY = cy - (totalH - fontSize) * 0.5;
    const subY = cy + (totalH - subSize) * 0.5;
    ctx.fillText(label, cx, mainY, w - 24);
    ctx.font = `700 ${subSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = style.disabled ? '#94a3b8' : (style.subTextColor ?? '#fef08a');
    ctx.fillText(style.subText, cx, subY, w - 24);
  } else {
    ctx.fillText(label, cx, cy + 1, w - 20);
  }

  ctx.restore();

  if (!style.disabled) {
    registry.registerRect(id, x, y, w, h, onClick);
  }
}

export function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  fillColor: string,
  bgColor = 'rgba(15, 23, 42, 0.85)',
  borderColor = 'rgba(255, 255, 255, 0.25)',
): void {
  const clamped = Math.max(0, Math.min(1, ratio));
  ctx.save();
  ctx.fillStyle = bgColor;
  drawRoundedRect(ctx, x, y, w, h, h * 0.5);
  ctx.fill();

  if (clamped > 0.005) {
    const fillW = Math.max(h, w * clamped);
    ctx.fillStyle = fillColor;
    drawRoundedRect(ctx, x + 2, y + 2, Math.min(w - 4, fillW - 4), h - 4, (h - 4) * 0.5);
    ctx.fill();
  }

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, x, y, w, h, h * 0.5);
  ctx.stroke();
  ctx.restore();
}

export function drawPanelCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  accentColor = '#f59e0b',
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 23, 0.7)';
  drawRoundedRect(ctx, x, y + 10, w, h, 24);
  ctx.fill();

  ctx.fillStyle = getCachedLinearGradient(ctx, x, y, x, y + h, '#162033', '#0b1120');
  drawRoundedRect(ctx, x, y, w, h, 24);
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, x, y, w, h, 24);
  ctx.stroke();

  // 顶部标题栏（深底胶囊 + 底部主题细分割线，保证标题高对比度）
  const headerH = 68;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  drawRoundedRect(ctx, x + 12, y + 12, w - 24, headerH, 16);
  ctx.fill();

  ctx.fillStyle = accentColor;
  drawRoundedRect(ctx, x + 28, y + 12 + headerH - 3, w - 56, 3, 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 32px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + w * 0.5, y + 12 + headerH * 0.5 - 1);
  ctx.restore();
}
