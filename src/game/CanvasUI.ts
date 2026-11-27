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

/**
 * 纯 Canvas UI 渲染与点击碰撞注册器（零 DOM 依赖）
 */
export class HitBoxRegistry {
  private readonly boxes: HitRect[] = [];

  public clear(): void {
    this.boxes.length = 0;
  }

  public register(box: HitRect): void {
    this.boxes.push(box);
  }

  public handleTap(x: number, y: number): boolean {
    for (let i = this.boxes.length - 1; i >= 0; i--) {
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

  // 主体渐变
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (style.disabled) {
    grad.addColorStop(0, '#475569');
    grad.addColorStop(1, '#334155');
  } else {
    grad.addColorStop(0, style.fillTop);
    grad.addColorStop(1, style.fillBottom);
  }
  ctx.fillStyle = grad;
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fill();

  // 顶部高光条
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  drawRoundedRect(ctx, x + 6, y + 4, w - 12, Math.max(8, h * 0.24), Math.max(4, radius - 6));
  ctx.fill();

  // 描边
  if (style.borderColor) {
    ctx.strokeStyle = style.disabled ? '#64748b' : style.borderColor;
    ctx.lineWidth = 2.5;
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
    ctx.fillText(label, cx, cy - fontSize * 0.34);
    ctx.font = `700 ${Math.max(16, Math.round(fontSize * 0.62))}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = style.disabled ? '#94a3b8' : (style.subTextColor ?? '#fef08a');
    ctx.fillText(style.subText, cx, cy + fontSize * 0.46);
  } else {
    ctx.fillText(label, cx, cy + 1);
  }

  ctx.restore();

  if (!style.disabled) {
    registry.register({ id, x, y, w, h, onClick });
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
  ctx.fillStyle = 'rgba(2, 6, 23, 0.65)';
  drawRoundedRect(ctx, x, y + 10, w, h, 28);
  ctx.fill();

  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#1e293b');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  drawRoundedRect(ctx, x, y, w, h, 28);
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, x, y, w, h, 28);
  ctx.stroke();

  // 顶部标题丝带
  const headerH = 68;
  const headerGrad = ctx.createLinearGradient(x, y, x + w, y);
  headerGrad.addColorStop(0, '#0f172a');
  headerGrad.addColorStop(0.5, accentColor);
  headerGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = headerGrad;
  drawRoundedRect(ctx, x + 10, y + 10, w - 20, headerH, 20);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 32px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + w * 0.5, y + 10 + headerH * 0.5);
  ctx.restore();
}
