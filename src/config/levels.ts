import type { LevelConfig, LevelTheme, MilestoneDef } from '../game/types';

export interface LevelThemeMeta {
  theme: LevelTheme;
  label: string;
  subLabel: string;
  accentColor: string;
  badgeBg: string;
  badgeBorder: string;
}

const THEME_META_MAP: Record<LevelTheme, LevelThemeMeta> = {
  normal: {
    theme: 'normal',
    label: '常规突围',
    subLabel: '均衡尸潮防线，稳步推进消灭尸王',
    accentColor: '#38bdf8',
    badgeBg: 'rgba(14, 116, 144, 0.55)',
    badgeBorder: '#38bdf8',
  },
  speed: {
    theme: 'speed',
    label: '极速疾跑关',
    subLabel: '疾跑丧尸占比极高，高频走位拉扯避险',
    accentColor: '#f43f5e',
    badgeBg: 'rgba(159, 18, 57, 0.65)',
    badgeBorder: '#fb7185',
  },
  shield: {
    theme: 'shield',
    label: '铁壁重盾关',
    subLabel: '重盾丧尸云集，木桶高爆火箭筒概率大幅提升',
    accentColor: '#60a5fa',
    badgeBg: 'rgba(30, 64, 175, 0.65)',
    badgeBorder: '#93c5fd',
  },
  gold: {
    theme: 'gold',
    label: '黄金木桶爽刷关',
    subLabel: '双倍木桶与双蓝增益门来袭，金币产出额外提升',
    accentColor: '#fbbf24',
    badgeBg: 'rgba(161, 98, 7, 0.7)',
    badgeBorder: '#fde047',
  },
};

export function getLevelThemeMeta(theme: LevelTheme): LevelThemeMeta {
  return THEME_META_MAP[theme] ?? THEME_META_MAP.normal;
}

export const CAMPAIGN_MILESTONES: readonly MilestoneDef[] = [
  {
    clearLevel: 1,
    titleText: '无尽狂潮模式',
    descText: '通关第 1 关解锁无尽狂潮模式',
    rewardCoins: 0,
    badgeText: '无尽模式已解锁',
  },
  {
    clearLevel: 5,
    titleText: '500金币与精英战区',
    descText: '通关第 5 关奖励 500 金币并解锁精英战区称号',
    rewardCoins: 500,
    badgeText: '精英战区',
  },
  {
    clearLevel: 10,
    titleText: '1000金币与永久金币加成',
    descText: '通关第 10 关奖励 1000 金币并永久提升金币产出',
    rewardCoins: 1000,
    badgeText: '永久金币加成已激活',
  },
  {
    clearLevel: 15,
    titleText: '末日传奇荣誉徽章',
    descText: '通关全部 15 关主线并解锁终极荣誉徽章',
    rewardCoins: 0,
    badgeText: '末日传奇徽章',
  },
];

export function getMilestoneForLevel(levelId: number): MilestoneDef | null {
  return CAMPAIGN_MILESTONES.find((m) => m.clearLevel === levelId) ?? null;
}

export function getNextMilestone(
  unlockedLevel: number,
  claimedMilestones: readonly number[] = [],
): MilestoneDef | null {
  for (const m of CAMPAIGN_MILESTONES) {
    const isCleared =
      claimedMilestones.includes(m.clearLevel) ||
      (m.clearLevel < LEVELS.length && unlockedLevel > m.clearLevel);
    if (!isCleared) {
      return m;
    }
  }
  return null;
}

/**
 * 15 大递增主线关卡配置（平滑递增曲线 + 穿插极速疾跑/铁壁重盾/黄金木桶三类主题关）
 */
export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: '荒野街道',
    subtitle: '突破首道封锁线',
    theme: 'normal',
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
    theme: 'normal',
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
    subtitle: '双倍木桶狂欢，金币暴涨',
    theme: 'gold',
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
    subtitle: '极速疾跑狂潮，高频走位突围',
    theme: 'speed',
    duration: 60,
    hpMult: 3.4,
    bossHp: 7680,
    bossName: '裂地熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 142,
    runnerRate: 0.66,
    tankRate: 0.16,
    clearCoins: 260,
  },
  {
    id: 5,
    name: '终末禁区',
    subtitle: '冲刺精英防线，迎战强力尸王',
    theme: 'normal',
    duration: 65,
    hpMult: 4.6,
    bossHp: 10240,
    bossName: '焦土熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 155,
    runnerRate: 0.40,
    tankRate: 0.34,
    clearCoins: 320,
  },
  {
    id: 6,
    name: '钢铁堡垒',
    subtitle: '重盾云集，打桶高概率爆火箭筒',
    theme: 'shield',
    duration: 52,
    hpMult: 5.1,
    bossHp: 11800,
    bossName: '重铠熔岩尸王',
    bossFireballMin: 3,
    bossFireballMax: 4,
    bossPatrolSpeed: 158,
    runnerRate: 0.18,
    tankRate: 0.52,
    clearCoins: 340,
  },
  {
    id: 7,
    name: '暮色高速',
    subtitle: '全速突防，清剿高架尸群',
    theme: 'normal',
    duration: 54,
    hpMult: 5.6,
    bossHp: 13200,
    bossName: '狂怒熔岩尸王',
    bossFireballMin: 3,
    bossFireballMax: 4,
    bossPatrolSpeed: 162,
    runnerRate: 0.38,
    tankRate: 0.32,
    clearCoins: 360,
  },
  {
    id: 8,
    name: '黄金金库区',
    subtitle: '双倍木桶与双蓝增益门狂刷',
    theme: 'gold',
    duration: 55,
    hpMult: 6.1,
    bossHp: 14800,
    bossName: '赤金熔岩尸王',
    bossFireballMin: 3,
    bossFireballMax: 4,
    bossPatrolSpeed: 166,
    runnerRate: 0.36,
    tankRate: 0.30,
    clearCoins: 400,
  },
  {
    id: 9,
    name: '风暴隧道',
    subtitle: '极速疾跑尸群，灵巧拉扯防线',
    theme: 'speed',
    duration: 56,
    hpMult: 6.6,
    bossHp: 16400,
    bossName: '疾风熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 170,
    runnerRate: 0.68,
    tankRate: 0.15,
    clearCoins: 420,
  },
  {
    id: 10,
    name: '核心发电站',
    subtitle: '突破核心防区，解锁永久收益加成',
    theme: 'normal',
    duration: 60,
    hpMult: 7.2,
    bossHp: 18200,
    bossName: '核能熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 174,
    runnerRate: 0.40,
    tankRate: 0.34,
    clearCoins: 460,
  },
  {
    id: 11,
    name: '重装防空洞',
    subtitle: '铁壁盾阵压境，火箭轰破防线',
    theme: 'shield',
    duration: 58,
    hpMult: 7.7,
    bossHp: 19800,
    bossName: '玄铁熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 176,
    runnerRate: 0.20,
    tankRate: 0.54,
    clearCoins: 480,
  },
  {
    id: 12,
    name: '宝藏物流港',
    subtitle: '海量补给桶与双蓝门助力冲刺',
    theme: 'gold',
    duration: 58,
    hpMult: 8.2,
    bossHp: 21600,
    bossName: '耀金熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 180,
    runnerRate: 0.38,
    tankRate: 0.32,
    clearCoins: 520,
  },
  {
    id: 13,
    name: '血色立交桥',
    subtitle: '迅猛尸潮狂飙突进，全神走位',
    theme: 'speed',
    duration: 60,
    hpMult: 8.7,
    bossHp: 23400,
    bossName: '残影熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 184,
    runnerRate: 0.70,
    tankRate: 0.14,
    clearCoins: 540,
  },
  {
    id: 14,
    name: '钢铁城墙',
    subtitle: '极限重盾阵线，强力爆破清障',
    theme: 'shield',
    duration: 62,
    hpMult: 9.2,
    bossHp: 25200,
    bossName: '堡垒熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 186,
    runnerRate: 0.20,
    tankRate: 0.56,
    clearCoins: 580,
  },
  {
    id: 15,
    name: '终焉核心',
    subtitle: '终极主线决战，问鼎末日传奇',
    theme: 'normal',
    duration: 65,
    hpMult: 9.8,
    bossHp: 27200,
    bossName: '终焉熔岩尸王',
    bossFireballMin: 4,
    bossFireballMax: 4,
    bossPatrolSpeed: 190,
    runnerRate: 0.42,
    tankRate: 0.36,
    clearCoins: 680,
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
    theme: 'normal',
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
