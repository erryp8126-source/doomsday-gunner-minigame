import type { PlatformSDK } from '../sdk/PlatformSDK';
import type { GuideStageKey, SaveData, SkinId, UpgradeGapInfo } from './types';

const STORAGE_KEY = 'doomsday_gunner_save_v2';

export const MAX_UPGRADE_LEVEL = 20;

export function getTodayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createDefaultSaveData(): SaveData {
  return {
    coins: 0,
    bestKills: 0,
    unlockedLevel: 1,
    selectedLevel: 1,
    attackLevel: 1,
    fireRateLevel: 1,
    squadLevel: 2,
    equippedSkin: 'standard',
    skinAdProgress: {
      standard: 0,
      crimson: 0,
      pulse: 0,
      dragon: 0,
    },
    totalRunsPlayed: 0,
    totalRewardedAds: 0,
    muted: false,
    vibrateEnabled: true,
    tutorialDone: false,
    guideSeen: {
      barrel: false,
      gate: false,
      boss: false,
    },
    lastVideoShareRewardDate: '',
    lastSidebarRewardDate: '',
    endlessBestWave: 0,
    endlessBestKills: 0,
    endlessBestTimeSec: 0,
  };
}

export class SaveManager {
  private data: SaveData;
  private readonly sdk: PlatformSDK;

  constructor(sdk: PlatformSDK) {
    this.sdk = sdk;
    this.data = this.load();
  }

  private load(): SaveData {
    const raw = this.sdk.getStorage(STORAGE_KEY);
    const defaults = createDefaultSaveData();
    if (!raw) return defaults;

    try {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      return {
        ...defaults,
        ...parsed,
        skinAdProgress: {
          ...defaults.skinAdProgress,
          ...(parsed.skinAdProgress || {}),
        },
        guideSeen: {
          ...defaults.guideSeen,
          ...(parsed.guideSeen || {}),
        },
      };
    } catch {
      return defaults;
    }
  }

  public save(): void {
    this.sdk.setStorage(STORAGE_KEY, JSON.stringify(this.data));
  }

  public reset(): SaveData {
    this.data = createDefaultSaveData();
    this.sdk.removeStorage(STORAGE_KEY);
    this.save();
    return this.data;
  }

  public getData(): SaveData {
    return this.data;
  }

  public addCoins(amount: number): void {
    if (amount <= 0) return;
    this.data.coins += Math.floor(amount);
    this.save();
  }

  public recordBestKills(kills: number): boolean {
    if (kills > this.data.bestKills) {
      this.data.bestKills = kills;
      this.save();
      return true;
    }
    return false;
  }

  public getUpgradeCost(type: 'attack' | 'firerate' | 'squad'): number {
    const level =
      type === 'attack'
        ? this.data.attackLevel
        : type === 'firerate'
          ? this.data.fireRateLevel
          : this.data.squadLevel;
    if (type === 'squad') {
      return 120 + Math.max(0, level - 2) * 160;
    }
    return 60 + (level - 1) * 65;
  }

  public canUpgrade(type: 'attack' | 'firerate' | 'squad'): boolean {
    const level =
      type === 'attack'
        ? this.data.attackLevel
        : type === 'firerate'
          ? this.data.fireRateLevel
          : this.data.squadLevel;
    const maxLv = type === 'squad' ? 6 : MAX_UPGRADE_LEVEL;
    return level < maxLv && this.data.coins >= this.getUpgradeCost(type);
  }

  public upgrade(type: 'attack' | 'firerate' | 'squad'): boolean {
    if (!this.canUpgrade(type)) return false;
    const cost = this.getUpgradeCost(type);
    this.data.coins -= cost;
    if (type === 'attack') this.data.attackLevel += 1;
    else if (type === 'firerate') this.data.fireRateLevel += 1;
    else this.data.squadLevel += 1;
    this.save();
    return true;
  }

  public getAttackMultiplier(): number {
    return 1 + (this.data.attackLevel - 1) * 0.12;
  }

  public getFireRateMultiplier(): number {
    return 1 + (this.data.fireRateLevel - 1) * 0.08;
  }

  public getInitialSquadSize(): number {
    return this.data.squadLevel;
  }

  public selectLevel(levelId: number): void {
    if (levelId >= 1 && levelId <= this.data.unlockedLevel) {
      this.data.selectedLevel = levelId;
      this.save();
    }
  }

  public markLevelCleared(levelId: number, maxLevelCount: number): void {
    if (levelId >= this.data.unlockedLevel && levelId < maxLevelCount) {
      this.data.unlockedLevel = levelId + 1;
      this.data.selectedLevel = this.data.unlockedLevel;
    }
    this.save();
  }

  public incrementRunCount(): void {
    this.data.totalRunsPlayed += 1;
    this.save();
  }

  public incrementRewardedAdCount(): void {
    this.data.totalRewardedAds += 1;
    this.save();
  }

  public addSkinAdProgress(skinId: SkinId, requiredAds: number): { progress: number; unlockedNow: boolean } {
    const prev = this.data.skinAdProgress[skinId] || 0;
    const next = Math.min(requiredAds, prev + 1);
    this.data.skinAdProgress[skinId] = next;
    const unlockedNow = prev < requiredAds && next >= requiredAds;
    if (unlockedNow) {
      this.data.equippedSkin = skinId;
    }
    this.save();
    return { progress: next, unlockedNow };
  }

  public isSkinUnlocked(skinId: SkinId, requiredAds: number): boolean {
    if (skinId === 'standard' || requiredAds <= 0) return true;
    return (this.data.skinAdProgress[skinId] || 0) >= requiredAds;
  }

  public equipSkin(skinId: SkinId, requiredAds: number): boolean {
    if (!this.isSkinUnlocked(skinId, requiredAds)) return false;
    this.data.equippedSkin = skinId;
    this.save();
    return true;
  }

  public setMuted(muted: boolean): void {
    this.data.muted = muted;
    this.save();
  }

  public isEndlessUnlocked(): boolean {
    return this.data.unlockedLevel >= 2;
  }

  public markTutorialDone(): void {
    if (this.data.tutorialDone) return;
    this.data.tutorialDone = true;
    this.save();
  }

  public hasSeenGuide(stage: GuideStageKey): boolean {
    return Boolean(this.data.guideSeen?.[stage]);
  }

  public markGuideSeen(stage: GuideStageKey): void {
    if (this.data.guideSeen?.[stage]) return;
    if (!this.data.guideSeen) {
      this.data.guideSeen = { barrel: false, gate: false, boss: false };
    }
    this.data.guideSeen[stage] = true;
    this.save();
  }

  public getCheapestUpgradeGap(extraCoins = 0, out?: UpgradeGapInfo): UpgradeGapInfo {
    const target: UpgradeGapInfo = out ?? {
      minCost: 0,
      canUpgradeNow: false,
      gap: 0,
      allMaxed: false,
    };

    let minCost = Infinity;
    if (this.data.attackLevel < MAX_UPGRADE_LEVEL) {
      minCost = Math.min(minCost, this.getUpgradeCost('attack'));
    }
    if (this.data.fireRateLevel < MAX_UPGRADE_LEVEL) {
      minCost = Math.min(minCost, this.getUpgradeCost('firerate'));
    }
    if (this.data.squadLevel < 6) {
      minCost = Math.min(minCost, this.getUpgradeCost('squad'));
    }

    if (!Number.isFinite(minCost)) {
      target.minCost = 0;
      target.canUpgradeNow = false;
      target.gap = 0;
      target.allMaxed = true;
      return target;
    }

    const totalCoins = this.data.coins + Math.max(0, Math.floor(extraCoins));
    const gap = Math.max(0, minCost - totalCoins);
    target.minCost = minCost;
    target.canUpgradeNow = gap === 0;
    target.gap = gap;
    target.allMaxed = false;
    return target;
  }

  public setVibrateEnabled(enabled: boolean): void {
    this.data.vibrateEnabled = enabled;
    this.save();
  }

  public canClaimDailyVideoReward(): boolean {
    return this.data.lastVideoShareRewardDate !== getTodayDateKey();
  }

  public claimDailyVideoReward(coins = 150): boolean {
    if (!this.canClaimDailyVideoReward()) return false;
    this.data.lastVideoShareRewardDate = getTodayDateKey();
    this.data.coins += Math.floor(coins);
    this.save();
    return true;
  }

  public canClaimDailySidebarReward(): boolean {
    return this.data.lastSidebarRewardDate !== getTodayDateKey();
  }

  public claimDailySidebarReward(coins = 200): boolean {
    if (!this.canClaimDailySidebarReward()) return false;
    this.data.lastSidebarRewardDate = getTodayDateKey();
    this.data.coins += Math.floor(coins);
    this.save();
    return true;
  }

  public unlockAllForDebug(maxLevelCount: number): void {
    this.data.unlockedLevel = Math.max(2, maxLevelCount);
    this.save();
  }

  public recordEndlessResult(
    wave: number,
    kills: number,
    surviveSec: number,
  ): { isNewRecord: boolean } {
    const prevWave = this.data.endlessBestWave || 0;
    const prevKills = this.data.endlessBestKills || 0;
    const prevTime = this.data.endlessBestTimeSec || 0;

    const waveBeat = wave > prevWave;
    const killsBeat = wave === prevWave && kills > prevKills;
    const isNewRecord = waveBeat || killsBeat || (prevWave === 0 && kills > 0);

    this.data.endlessBestWave = Math.max(prevWave, wave);
    this.data.endlessBestKills = Math.max(prevKills, kills);
    this.data.endlessBestTimeSec = Math.max(prevTime, surviveSec);
    this.save();
    return { isNewRecord };
  }
}
