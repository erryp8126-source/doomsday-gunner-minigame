export type TargetPlatform = 'wechat' | 'douyin' | 'web';

export type RewardedScene =
  | 'pre_battle_boost'
  | 'airdrop_supply'
  | 'revive_clear'
  | 'result_double'
  | 'result_triple'
  | 'armory_unlock'
  | 'stuck_assist';

/**
 * 微信 / 抖音双端 AppID 配置（个人主体上线前替换为正式 AppID）
 */
export const APP_IDS = {
  wechat: 'touristappid',
  douyin: 'tt_replace_me_appid',
} as const;

/**
 * 双端流量主广告位 ID 集中配置
 * 上线前请将带有 replace-me 的占位符替换为微信公众平台 / 抖音开放平台申请的真实 adUnitId
 */
export const AD_UNITS: Record<'wechat' | 'douyin', {
  rewardedVideo: string;
  banner: string;
  interstitial: string;
}> = {
  wechat: {
    rewardedVideo: 'adunit-wx-rewarded-replace-me',
    banner: 'adunit-wx-banner-replace-me',
    interstitial: 'adunit-wx-interstitial-replace-me',
  },
  douyin: {
    rewardedVideo: 'adunit-tt-rewarded-replace-me',
    banner: 'adunit-tt-banner-replace-me',
    interstitial: 'adunit-tt-interstitial-replace-me',
  },
};

/**
 * 抖音小游戏激励视频「激励再得」能力配置（tt.createRewardedVideoAd）
 * 第一版关闭 multiton，确保广告承诺次数与实际发奖严格一致，稳妥通过提审。
 */
export const DOUYIN_MULTITON_CONFIG = {
  multiton: false,
  multitonRewardMsg: '',
  multitonRewardTimes: 0,
  progressTip: false,
} as const;

/**
 * IAA 合规防骚扰与频控硬性规则
 */
export const AD_RULES = {
  /** 新手前 N 局不弹局间插屏 */
  beginnerNoInterstitialRuns: 2,
  /** 两次插屏最小间隔（毫秒） */
  interstitialCooldownMs: 60_000,
  /** 看完激励视频后 N 毫秒内不叠加弹插屏 */
  postRewardInterstitialCooldownMs: 30_000,
  /** 单局战败复活上限 */
  maxRevivesPerRun: 1,
  /** 开局神装体验倒计时（秒） */
  preBattleCountdownSec: 3,
  /** 超级空投在首领登场前 N 秒降落 */
  airdropLeadSec: 10,
  /** 空投全队火力翻倍持续时间（秒） */
  doubleFireDurationSec: 15,
  /** 军械库 3 款传说涂装累计激励观看解锁次数 */
  armoryUnlockTargets: [3, 5, 8] as const,
} as const;

/**
 * 仅供 Web 端「IAA 商业化调试台」估算模拟变现收益（不会打入小游戏包）
 */
export const MOCK_ECPM_CNY = {
  rewardedVideo: 42.0,
  interstitial: 18.5,
  banner: 4.2,
} as const;

export function isPlaceholderAdUnit(adUnitId: string): boolean {
  return !adUnitId || adUnitId.includes('replace-me');
}
