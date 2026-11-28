import { LEVELS, getMilestoneForLevel } from '../config/levels';
import type { PlatformSDK } from '../sdk/PlatformSDK';
import type { GuideStageKey, MilestoneDef, SaveData, SkinId, UpgradeGapInfo } from './types';

const STORAGE_KEY = 'doomsday_gunner_save_v2';

export const MAX_UPGRADE_LEVEL = 20;

const VALID_SKIN_IDS: ReadonlySet<SkinId> = new Set(['standard', 'crimson', 'pulse', 'dragon']);

function sanitizeInt(
  value: unknown,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const n = Math.floor(value);
  return n < min ? min : n > max ? max : n;
}

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
    claimedMilestones: [],
    stuckLevelId: 1,
    consecutiveFailures: 0,
    stuckAssistPending: false,
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
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return defaults;
      }
      const obj = parsed as Record<string, unknown>;
      const maxLv = Math.max(1, LEVELS.length);
      const unlockedLevel = sanitizeInt(obj.unlockedLevel, defaults.unlockedLevel, 1, maxLv);
      const selectedLevel = sanitizeInt(obj.selectedLevel, defaults.selectedLevel, 1, unlockedLevel);

      const rawSkinProg =
        obj.skinAdProgress && typeof obj.skinAdProgress === 'object' && !Array.isArray(obj.skinAdProgress)
          ? (obj.skinAdProgress as Record<string, unknown>)
          : {};
      const rawGuide =
        obj.guideSeen && typeof obj.guideSeen === 'object' && !Array.isArray(obj.guideSeen)
          ? (obj.guideSeen as Record<string, unknown>)
          : {};
      const equippedSkin: SkinId =
        typeof obj.equippedSkin === 'string' && VALID_SKIN_IDS.has(obj.equippedSkin as SkinId)
          ? (obj.equippedSkin as SkinId)
          : defaults.equippedSkin;

      const claimedMilestones = Array.isArray(obj.claimedMilestones)
        ? Array.from(
            new Set(
              obj.claimedMilestones
                .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
                .map((id) => Math.floor(id))
                .filter((id) => id >= 1 && id <= maxLv),
            ),
          )
        : [];

      return {
        coins: sanitizeInt(obj.coins, defaults.coins, 0),
        bestKills: sanitizeInt(obj.bestKills, defaults.bestKills, 0),
        unlockedLevel,
        selectedLevel,
        attackLevel: sanitizeInt(obj.attackLevel, defaults.attackLevel, 1, MAX_UPGRADE_LEVEL),
        fireRateLevel: sanitizeInt(obj.fireRateLevel, defaults.fireRateLevel, 1, MAX_UPGRADE_LEVEL),
        squadLevel: sanitizeInt(obj.squadLevel, defaults.squadLevel, 2, 6),
        equippedSkin,
        skinAdProgress: {
          standard: sanitizeInt(rawSkinProg.standard, defaults.skinAdProgress.standard, 0),
          crimson: sanitizeInt(rawSkinProg.crimson, defaults.skinAdProgress.crimson, 0),
          pulse: sanitizeInt(rawSkinProg.pulse, defaults.skinAdProgress.pulse, 0),
          dragon: sanitizeInt(rawSkinProg.dragon, defaults.skinAdProgress.dragon, 0),
        },
        totalRunsPlayed: sanitizeInt(obj.totalRunsPlayed, defaults.totalRunsPlayed, 0),
        totalRewardedAds: sanitizeInt(obj.totalRewardedAds, defaults.totalRewardedAds, 0),
        muted: Boolean(obj.muted),
        vibrateEnabled:
          typeof obj.vibrateEnabled === 'boolean' ? obj.vibrateEnabled : defaults.vibrateEnabled,
        tutorialDone: Boolean(obj.tutorialDone),
        guideSeen: {
          barrel: Boolean(rawGuide.barrel),
          gate: Boolean(rawGuide.gate),
          boss: Boolean(rawGuide.boss),
        },
        lastVideoShareRewardDate:
          typeof obj.lastVideoShareRewardDate === 'string' ? obj.lastVideoShareRewardDate : '',
        lastSidebarRewardDate:
          typeof obj.lastSidebarRewardDate === 'string' ? obj.lastSidebarRewardDate : '',
        endlessBestWave: sanitizeInt(obj.endlessBestWave, defaults.endlessBestWave, 0),
        endlessBestKills: sanitizeInt(obj.endlessBestKills, defaults.endlessBestKills, 0),
        endlessBestTimeSec: sanitizeInt(obj.endlessBestTimeSec, defaults.endlessBestTimeSec, 0),
        claimedMilestones,
        stuckLevelId: sanitizeInt(obj.stuckLevelId, selectedLevel, 1, maxLv),
        consecutiveFailures: sanitizeInt(obj.consecutiveFailures, 0, 0),
        stuckAssistPending: Boolean(obj.stuckAssistPending),
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
    if (!Number.isFinite(amount) || amount <= 0) return;
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
      if (this.data.selectedLevel !== levelId) {
        this.data.selectedLevel = levelId;
        this.data.stuckLevelId = levelId;
        this.data.consecutiveFailures = 0;
        this.data.stuckAssistPending = false;
      }
      this.save();
    }
  }

  public markLevelCleared(
    levelId: number,
    maxLevelCount: number,
  ): { newlyClaimedMilestone: MilestoneDef | null } {
    if (levelId >= this.data.unlockedLevel && levelId < maxLevelCount) {
      this.data.unlockedLevel = levelId + 1;
      this.data.selectedLevel = this.data.unlockedLevel;
    }

    let newlyClaimedMilestone: MilestoneDef | null = null;
    const milestone = getMilestoneForLevel(levelId);
    if (milestone && !this.data.claimedMilestones.includes(levelId)) {
      this.data.claimedMilestones = [...this.data.claimedMilestones, levelId];
      if (milestone.rewardCoins > 0) {
        this.data.coins += milestone.rewardCoins;
      }
      newlyClaimedMilestone = milestone;
    }

    this.data.consecutiveFailures = 0;
    this.data.stuckAssistPending = false;
    this.data.stuckLevelId = this.data.selectedLevel;
    this.save();
    return { newlyClaimedMilestone };
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

  public recordLevelFailure(levelId: number): number {
    if (this.data.stuckLevelId !== levelId) {
      this.data.stuckLevelId = levelId;
      this.data.consecutiveFailures = 1;
      this.data.stuckAssistPending = false;
    } else {
      this.data.consecutiveFailures += 1;
    }
    this.save();
    return this.data.consecutiveFailures;
  }

  public resetLevelFailures(): void {
    this.data.consecutiveFailures = 0;
    this.data.stuckAssistPending = false;
    this.save();
  }

  public getConsecutiveFailures(levelId: number): number {
    return this.data.stuckLevelId === levelId ? this.data.consecutiveFailures : 0;
  }

  public armStuckAssist(levelId: number): void {
    this.data.stuckLevelId = levelId;
    this.data.stuckAssistPending = true;
    this.save();
  }

  public consumeStuckAssist(levelId: number): boolean {
    if (this.data.stuckAssistPending && this.data.stuckLevelId === levelId) {
      this.data.stuckAssistPending = false;
      this.data.consecutiveFailures = 0;
      this.save();
      return true;
    }
    return false;
  }

  public hasEliteTitle(): boolean {
    return this.data.claimedMilestones.includes(5) || this.data.unlockedLevel > 5;
  }

  public hasPermanentCoinBonus(): boolean {
    return this.data.claimedMilestones.includes(10) || this.data.unlockedLevel > 10;
  }

  public getPermanentCoinMultiplier(): number {
    return this.hasPermanentCoinBonus() ? 1.15 : 1.0;
  }

  public hasFinalHonorBadge(): boolean {
    return this.data.claimedMilestones.includes(15);
  }
}
