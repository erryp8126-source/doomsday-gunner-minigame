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
 * 无尽尸潮模式动态波次生成器（同步对齐加强后难度基准，循环登场熔岩尸王）
 */
export function getEndlessWaveConfig(wave: number): LevelConfig {
  const safeWave = Math.max(1, Math.floor(wave));
  const wOffset = safeWave - 1;
  const themeBase = LEVELS[wOffset % LEVELS.length];

  return {
    id: safeWave,
    name: '无尽尸潮',
    subtitle: `第${safeWave}波狂潮`,
    duration: safeWave === 1 ? 38 : 42,
    hpMult: Number((1.25 * Math.pow(1.38, wOffset)).toFixed(2)),
    bossHp: Math.round(2400 * Math.pow(1.45, wOffset)),
    bossName: `${themeBase.bossName}`,
    runnerRate: Math.min(0.46, 0.24 + wOffset * 0.04),
    tankRate: Math.min(0.38, 0.16 + wOffset * 0.04),
    clearCoins: 90 + safeWave * 45,
  };
}
