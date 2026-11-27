export {};

declare global {
  interface MinigameSafeArea {
    top: number;
    bottom: number;
    left?: number;
    right?: number;
    width?: number;
    height?: number;
  }

  interface MinigameSystemInfo {
    windowWidth: number;
    windowHeight: number;
    pixelRatio?: number;
    statusBarHeight?: number;
    safeArea?: MinigameSafeArea;
  }

  interface MinigameMenuButtonRect {
    top?: number;
    bottom: number;
    left?: number;
    right?: number;
    width?: number;
    height?: number;
  }

  interface MinigameTouchPoint {
    clientX: number;
    clientY: number;
  }

  interface MinigameTouchEvent {
    touches?: MinigameTouchPoint[];
    changedTouches?: MinigameTouchPoint[];
  }

  interface MinigameLaunchOptions {
    launch_from?: string;
    location?: string;
  }

  interface MinigameInnerAudioContext {
    src: string;
    volume: number;
    obeyMuteSwitch: boolean;
    play: () => void;
    pause?: () => void;
    stop?: () => void;
    seek?: (position: number) => void;
    destroy?: () => void;
    onError?: (cb: (err: unknown) => void) => void;
  }

  interface MinigameRewardedVideoCloseResult {
    isEnded?: boolean;
    count?: number;
  }

  interface MinigameRewardedVideoAd {
    show: () => Promise<void>;
    load: () => Promise<void>;
    onClose: (cb: (res?: MinigameRewardedVideoCloseResult) => void) => void;
    onError: (cb: (err: unknown) => void) => void;
  }

  interface MinigameBannerAd {
    style: {
      left: number;
      top: number;
      width: number;
    };
    onResize: (cb: (size: { width: number; height: number }) => void) => void;
    onError: (cb: (err: unknown) => void) => void;
    show?: () => Promise<void>;
    hide?: () => void;
  }

  interface MinigameInterstitialAd {
    load: () => Promise<void>;
    show: () => Promise<void>;
    onError: (cb: (err: unknown) => void) => void;
  }

  interface DouyinGameRecorderStopResult {
    videoPath?: string;
    duration?: number;
  }

  interface DouyinGameRecorderManager {
    start: (options: { duration: number }) => void;
    stop: () => void;
    onStart?: (cb: () => void) => void;
    onStop?: (cb: (res?: DouyinGameRecorderStopResult) => void) => void;
    onError?: (cb: (err: unknown) => void) => void;
  }

  interface MinigameCommonAPI {
    createCanvas: () => HTMLCanvasElement;
    createImage: () => HTMLImageElement;
    getSystemInfoSync: () => MinigameSystemInfo;
    getMenuButtonBoundingClientRect?: () => MinigameMenuButtonRect;
    onTouchStart: (cb: (e: MinigameTouchEvent) => void) => void;
    onTouchMove: (cb: (e: MinigameTouchEvent) => void) => void;
    onTouchEnd: (cb: (e: MinigameTouchEvent) => void) => void;
    onTouchCancel: (cb: (e: MinigameTouchEvent) => void) => void;
    offTouchStart?: (cb: (e: MinigameTouchEvent) => void) => void;
    offTouchMove?: (cb: (e: MinigameTouchEvent) => void) => void;
    offTouchEnd?: (cb: (e: MinigameTouchEvent) => void) => void;
    offTouchCancel?: (cb: (e: MinigameTouchEvent) => void) => void;
    onWindowResize?: (cb: () => void) => void;
    offWindowResize?: (cb: () => void) => void;
    onHide?: (cb: () => void) => void;
    offHide?: (cb: () => void) => void;
    onShow?: (cb: (res?: MinigameLaunchOptions) => void) => void;
    offShow?: (cb: (res?: MinigameLaunchOptions) => void) => void;
    getStorageSync: (key: string) => unknown;
    setStorageSync: (key: string, value: string) => void;
    removeStorageSync?: (key: string) => void;
    createInnerAudioContext: () => MinigameInnerAudioContext;
    createBannerAd?: (options: {
      adUnitId: string;
      adIntervals?: number;
      style: { left: number; top: number; width: number };
    }) => MinigameBannerAd;
    createInterstitialAd?: (options: { adUnitId: string }) => MinigameInterstitialAd;
    onShareAppMessage?: (cb: () => { title: string; imageUrl?: string }) => void;
  }

  interface WeChatMinigameAPI extends MinigameCommonAPI {
    getWindowInfo?: () => MinigameSystemInfo;
    vibrateShort?: (options: { type: 'heavy' | 'medium' | 'light' }) => void;
    showShareMenu?: (options: { withShareTicket?: boolean; menus?: string[] }) => void;
    onShareTimeline?: (cb: () => { title: string; imageUrl?: string }) => void;
    shareAppMessage?: (options: { title: string; imageUrl?: string }) => void;
    createRewardedVideoAd?: (options: { adUnitId: string }) => MinigameRewardedVideoAd;
  }

  interface DouyinMinigameAPI extends MinigameCommonAPI {
    vibrateShort?: () => void;
    showShareMenu?: (options: { withShareTicket?: boolean }) => void;
    shareAppMessage?: (options: {
      channel?: string;
      title: string;
      imageUrl?: string;
      extra?: { videoPath?: string; videoTopics?: string[] };
      success?: () => void;
      fail?: () => void;
    }) => void;
    createRewardedVideoAd?: (options: {
      adUnitId: string;
      multiton?: boolean;
      multitonRewardMsg?: string;
      multitonRewardTimes?: number;
      progressTip?: boolean;
    }) => MinigameRewardedVideoAd;
    getGameRecorderManager?: () => DouyinGameRecorderManager;
    checkScene?: (options: {
      scene: string;
      success?: (res?: { isExist?: boolean }) => void;
      fail?: () => void;
    }) => void;
    navigateToScene?: (options: {
      scene: string;
      success?: () => void;
      fail?: () => void;
    }) => void;
    getLaunchOptionsSync?: () => MinigameLaunchOptions;
  }

  const wx: WeChatMinigameAPI;
  const tt: DouyinMinigameAPI;
}
