import type { LevelConfig } from '../game/types';

/**
 * 5 大递增关卡配置（1~5 关血量倍率 [1.25, 1.8, 2.5, 3.4, 4.6]，尸王血量上调 1.6 倍）
 */
export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: '荒野街道',
    subtitle: '突破首道封锁线',
    duration: 45,
    hpMult: 1.25,
    bossHp: 2400,
    bossName: '熔岩尸王',
    bossFireballMin: 2,
    bossFireballMax: 2,
    bossPatrolSpeed: 105,
    runnerRate: 0.24,
    tankRate: 0.16,
    clearCoins: 140,
  },
  {
    id: 2,
    name: '封锁立交',
    subtitle: '疾跑变异潮来袭',
    duration: 50,
    hpMult: 1.8,
    bossHp: 3840,
    bossName: '狂暴熔岩尸王',
    bossFireballMin: 2,
    bossFireballMax: 3,
    bossPatrolSpeed: 118,
    runnerRate: 0.35,
    tankRate: 0.20,
    clearCoins: 180,
  },
  {
    id: 3,
    name: '废墟街区',
    subtitle: '重装盾甲尸群',
    duration: 55,
    hpMult: 2.5,
    bossHp: 5600,
    bossName: '重甲熔岩尸王',
    bossFireballMin: 3,
    bossFireballMax: 3,
    bossPatrolSpeed: 130,
    runnerRate: 0.32,
    tankRate: 0.28,
    clearCoins: 220,
  },
  {
    id: 4,
    name: '工业防线',
    subtitle: '密集攻势狂潮',
    duration: 60,
    hpMult: 3.4,
    bossHp: 7680,
    bossName: '裂地熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 142,
    runnerRate: 0.37,
    tankRate: 0.31,
    clearCoins: 260,
  },
  {
    id: 5,
    name: '终末禁区',
    subtitle: '决战尸王核心',
    duration: 65,
    hpMult: 4.6,
    bossHp: 10240,
    bossName: '终末熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 155,
    runnerRate: 0.40,
    tankRate: 0.34,
    clearCoins: 300,
  },
];

export function getLevelConfig(levelId: number): LevelConfig {
  const index = Math.max(0, Math.min(LEVELS.length - 1, levelId - 1));
  return LEVELS[index];
}

/**
 * 无尽模式普通波次血量倍率平滑分段曲线（避免第 10 波后指数爆炸）
 * 1~6 波线性温和抬升；7 波起叠加缓坡增长，第 15 波约 7.19 倍，第 25 波约 15.01 倍。
 */
export function getEndlessWaveScale(wave: number): number {
  const safeWave = Math.max(1, Math.floor(wave));
  const base = 1 + (safeWave - 1) * 0.22;
  const late = safeWave > 6 ? Math.pow(safeWave - 6, 1.38) * 0.15 : 0;
  return Number((base + late).toFixed(2));
}

/**
 * 无尽模式熔岩尸王 Boss 血量平滑层级曲线
 */
export function getEndlessBossHp(tier: number): number {
  const safeTier = Math.max(1, Math.floor(tier));
  const mult =
    1 + (safeTier - 1) * 0.45 + Math.pow(Math.max(0, safeTier - 4), 1.25) * 0.28;
  return Math.round(2600 * mult);
}

/**
 * 无尽狂潮模式动态波次生成器（每 40 秒推进 1 波，偶数波登场强化版熔岩尸王）
 */
export function getEndlessWaveConfig(wave: number): LevelConfig {
  const safeWave = Math.max(1, Math.floor(wave));
  const wOffset = safeWave - 1;
  const themeBase = LEVELS[wOffset % LEVELS.length];
  const bossTier = Math.max(1, Math.floor(safeWave / 2));

  return {
    id: safeWave,
    name: '无尽狂潮',
    subtitle: `第${safeWave}波狂潮`,
    duration: 40,
    hpMult: getEndlessWaveScale(safeWave),
    bossHp: getEndlessBossHp(bossTier),
    bossName: `${themeBase.bossName}`,
    bossFireballMin: safeWave >= 4 ? 4 : safeWave >= 3 ? 3 : 2,
    bossFireballMax: safeWave >= 4 ? 4 : 3,
    bossPatrolSpeed: Math.min(170, 105 + wOffset * 12),
    runnerRate: Math.min(0.46, 0.24 + wOffset * 0.04),
    tankRate: Math.min(0.38, 0.16 + wOffset * 0.04),
    clearCoins: Math.round(80 + wOffset * 22 + Math.max(0, wOffset - 5) * 12),
  };
}
