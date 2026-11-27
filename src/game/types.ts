import type { SpriteKey } from './AssetLoader';

export const LOGICAL_WIDTH = 720;
export const LOGICAL_HEIGHT = 1280;

/** 2D 精绘街道几何常量（严格对齐 bg_road.jpg 与 prototype_reference.html） */
export const ROAD_LEFT = 192;
export const ROAD_RIGHT = 528;
export const ROAD_W = ROAD_RIGHT - ROAD_LEFT;
export const PLAYER_Y = 1045;

/** 底部 Banner 安全区（严格防止按钮误触） */
export const BANNER_ZONE_TOP = 1145;
export const SAFE_BUTTON_MAX_BOTTOM = 1095;

export type GameMode = 'campaign' | 'endless';

export type GameState =
  | 'MENU'
  | 'PRE_BATTLE'
  | 'PLAYING'
  | 'PAUSED'
  | 'AIRDROP_MODAL'
  | 'REVIVE_MODAL'
  | 'RESULT'
  | 'ARMORY';

export type WeaponId = 'pistol' | 'shotgun' | 'gatling' | 'rocket';

export type SkinId = 'standard' | 'crimson' | 'pulse' | 'dragon';

export type ZombieKind = 'normal' | 'runner' | 'tank' | 'boss';

export type BarrelRewardType = 'weapon' | 'squad' | 'rate';

export type GateBuffKind = 'squad' | 'rate';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;
  iconKey: SpriteKey;
  damage: number;
  fireRate: number;
  bulletSpeed: number;
  pellets: number;
  spread: number;
  color: string;
  radius: number;
  splash: number;
}

export interface SkinDef {
  id: SkinId;
  name: string;
  desc: string;
  unlockAds: number;
  primaryColor: string;
  accentColor: string;
  bulletTint: string;
  damageBonus: number;
  fireRateBonus: number;
  startSquadBonus: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  subtitle: string;
  duration: number;
  hpMult: number;
  bossHp: number;
  bossName: string;
  runnerRate: number;
  tankRate: number;
  clearCoins: number;
}

export interface PoolItem {
  active: boolean;
}

export interface Bullet extends PoolItem {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  color: string;
  splash: number;
}

export interface Zombie extends PoolItem {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  scale: number;
  kind: ZombieKind;
  hitFlash: number;
  phase: number;
  isBoss: boolean;
  dying: boolean;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  dieLife: number;
  rageStage: number;
  rageTimer: number;
}

export interface Barrel extends PoolItem {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  rewardType: BarrelRewardType;
  rewardWeapon: WeaponId;
  rewardVal: number;
  rewardLabel: string;
  iconKey: SpriteKey | '';
  hitScale: number;
  hitFlash: number;
}

export interface Gate extends PoolItem {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  kind: GateBuffKind;
  value: number;
  pairId: number;
  used: boolean;
  hitFlash: number;
  hitAccum: number;
}

export interface Particle extends PoolItem {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface DamageText extends PoolItem {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

export interface AirdropCrate {
  active: boolean;
  x: number;
  y: number;
  speed: number;
  claimed: boolean;
}

export interface HitRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onClick: () => void;
}

export interface SaveData {
  coins: number;
  bestKills: number;
  unlockedLevel: number;
  selectedLevel: number;
  attackLevel: number;
  fireRateLevel: number;
  squadLevel: number;
  equippedSkin: SkinId;
  skinAdProgress: Record<SkinId, number>;
  totalRunsPlayed: number;
  totalRewardedAds: number;
  muted: boolean;
  endlessBestWave: number;
  endlessBestKills: number;
  endlessBestTimeSec: number;
}

export interface ToastMessage {
  text: string;
  color: string;
  timer: number;
  duration: number;
}

export function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}
