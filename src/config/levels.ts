import type { LevelConfig } from '../game/types';

/**
 * 5 大递增关卡配置（对齐 prototype_reference.html 数值节奏，纯简体中文命名）
 */
export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: '荒野街道',
    subtitle: '突破首道封锁线',
    duration: 45,
    hpMult: 1.0,
    bossHp: 1500,
    bossName: '熔岩尸王',
    runnerRate: 0.22,
    tankRate: 0.14,
    clearCoins: 140,
  },
  {
    id: 2,
    name: '封锁立交',
    subtitle: '疾跑变异潮来袭',
    duration: 50,
    hpMult: 1.35,
    bossHp: 2400,
    bossName: '狂暴熔岩尸王',
    runnerRate: 0.34,
    tankRate: 0.18,
    clearCoins: 180,
  },
  {
    id: 3,
    name: '废墟街区',
    subtitle: '重装盾甲尸群',
    duration: 55,
    hpMult: 1.75,
    bossHp: 3500,
    bossName: '重甲熔岩尸王',
    runnerRate: 0.30,
    tankRate: 0.28,
    clearCoins: 220,
  },
  {
    id: 4,
    name: '工业防线',
    subtitle: '密集攻势狂潮',
    duration: 60,
    hpMult: 2.25,
    bossHp: 4800,
    bossName: '裂地熔岩尸王',
    runnerRate: 0.36,
    tankRate: 0.30,
    clearCoins: 260,
  },
  {
    id: 5,
    name: '终末禁区',
    subtitle: '决战尸王核心',
    duration: 65,
    hpMult: 2.9,
    bossHp: 6400,
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
 * 无尽尸潮模式动态波次生成器（随波次无限递增难度，循环登场熔岩尸王）
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
    hpMult: Number((1.05 * Math.pow(1.34, wOffset)).toFixed(2)),
    bossHp: Math.round(1450 * Math.pow(1.42, wOffset)),
    bossName: `${themeBase.bossName}`,
    runnerRate: Math.min(0.45, 0.22 + wOffset * 0.04),
    tankRate: Math.min(0.38, 0.14 + wOffset * 0.04),
    clearCoins: 90 + safeWave * 45,
  };
}
