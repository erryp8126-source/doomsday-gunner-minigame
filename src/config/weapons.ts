import { AD_RULES } from './adConfig';
import type { SkinDef, SkinId, WeaponDef, WeaponId } from '../game/types';

/**
 * 4 把 2D 精绘武器数值配置（严格对齐 prototype_reference.html 手感与 100% 纯简体中文）
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: '战术手枪',
    desc: '稳健点射，起步防线主力',
    iconKey: 'weapon_pistol',
    damage: 11,
    fireRate: 4.8,
    bulletSpeed: 1320,
    pellets: 1,
    spread: 0.03,
    color: '#ffe066',
    radius: 6,
    splash: 0,
  },
  shotgun: {
    id: 'shotgun',
    name: '连发霰弹',
    desc: '五发扇形齐射，近战击飞',
    iconKey: 'weapon_shotgun',
    damage: 9,
    fireRate: 2.35,
    bulletSpeed: 1200,
    pellets: 5,
    spread: 0.25,
    color: '#ff9f43',
    radius: 6.5,
    splash: 0,
  },
  gatling: {
    id: 'gatling',
    name: '重型加特林',
    desc: '超高射速倾泻金属风暴',
    iconKey: 'weapon_gatling',
    damage: 8,
    fireRate: 12.0,
    bulletSpeed: 1460,
    pellets: 1,
    spread: 0.09,
    color: '#38bdf8',
    radius: 5.5,
    splash: 0,
  },
  rocket: {
    id: 'rocket',
    name: '高爆火箭筒',
    desc: '大范围高爆溅射清场神器',
    iconKey: 'weapon_rocket',
    damage: 44,
    fireRate: 1.5,
    bulletSpeed: 980,
    pellets: 1,
    spread: 0.02,
    color: '#ff4757',
    radius: 11,
    splash: 130,
  },
};

export const WEAPON_LIST: WeaponDef[] = [
  WEAPONS.pistol,
  WEAPONS.shotgun,
  WEAPONS.gatling,
  WEAPONS.rocket,
];

/**
 * 免氪金传说军械库涂装（累计观看 3 / 5 / 8 次激励视频永久解锁，零充值）
 */
export const SKINS: SkinDef[] = [
  {
    id: 'standard',
    name: '标准战术',
    desc: '特战小队制式涂装',
    unlockAds: 0,
    primaryColor: '#38bdf8',
    accentColor: '#e0f2fe',
    bulletTint: '#ffe066',
    damageBonus: 0,
    fireRateBonus: 0,
    startSquadBonus: 0,
  },
  {
    id: 'crimson',
    name: '赤焰战神',
    desc: '伤害额外提升百分之十二',
    unlockAds: AD_RULES.armoryUnlockTargets[0],
    primaryColor: '#ef4444',
    accentColor: '#fef08a',
    bulletTint: '#fb923c',
    damageBonus: 0.12,
    fireRateBonus: 0,
    startSquadBonus: 0,
  },
  {
    id: 'pulse',
    name: '幽蓝脉冲',
    desc: '射速额外提升百分之十五',
    unlockAds: AD_RULES.armoryUnlockTargets[1],
    primaryColor: '#8b5cf6',
    accentColor: '#67e8f9',
    bulletTint: '#67e8f9',
    damageBonus: 0,
    fireRateBonus: 0.15,
    startSquadBonus: 0,
  },
  {
    id: 'dragon',
    name: '苍穹金龙',
    desc: '攻速提升一成且开局加两人',
    unlockAds: AD_RULES.armoryUnlockTargets[2],
    primaryColor: '#f59e0b',
    accentColor: '#fef9c3',
    bulletTint: '#fde047',
    damageBonus: 0.1,
    fireRateBonus: 0.1,
    startSquadBonus: 2,
  },
];

export function getSkinDef(skinId: SkinId): SkinDef {
  return SKINS.find((s) => s.id === skinId) ?? SKINS[0];
}
