import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from './types';

export interface StageLayout {
  /** 画布后备缓冲尺寸 */
  canvasWidth: number;
  canvasHeight: number;
  /** 逻辑坐标到画布像素的等比缩放 */
  scale: number;
  /** 720×1280 舞台在画布内的居中偏移 */
  offsetX: number;
  offsetY: number;
}

/**
 * 等比缩放并居中（contain）：横纵使用同一缩放系数，多出的区域留边，画面不拉伸。
 * 传入 CSS 像素尺寸与 pixelRatio = 1 时，得到触摸换算用的布局。
 */
export function computeStageLayout(width: number, height: number, pixelRatio = 1): StageLayout {
  const canvasWidth = Math.max(1, Math.round(width * pixelRatio));
  const canvasHeight = Math.max(1, Math.round(height * pixelRatio));
  const scale = Math.min(canvasWidth / LOGICAL_WIDTH, canvasHeight / LOGICAL_HEIGHT);
  return {
    canvasWidth,
    canvasHeight,
    scale,
    offsetX: (canvasWidth - LOGICAL_WIDTH * scale) / 2,
    offsetY: (canvasHeight - LOGICAL_HEIGHT * scale) / 2,
  };
}

/** 舞台后备缓冲的缩放上限（对应 1080×1920），控制填充率 */
export const MAX_STAGE_SCALE = 1.5;

/**
 * 小游戏全屏画布的布局：缓冲分辨率跟随设备像素比，但舞台部分不超过 MAX_STAGE_SCALE。
 * 偏移取整，避免背景拼接处出现细缝。
 */
export function computeScreenLayout(width: number, height: number, pixelRatio: number): StageLayout {
  const cssScale = computeStageLayout(width, height).scale;
  const ratio = Math.min(pixelRatio || 1, MAX_STAGE_SCALE / cssScale);
  const layout = computeStageLayout(width, height, ratio);
  layout.offsetX = Math.round(layout.offsetX);
  layout.offsetY = Math.round(layout.offsetY);
  return layout;
}
