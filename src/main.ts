import { GameEngine } from './game/GameEngine';
import { SaveManager } from './game/SaveManager';
import { SoundSynth } from './game/SoundSynth';
import { AdManager } from './sdk/AdManager';
import { PlatformSDK } from './sdk/PlatformSDK';
import { mountWebAdOverlay } from './web/WebAdOverlay';

function bootstrap(): void {
  const sdk = new PlatformSDK();
  const saveManager = new SaveManager(sdk);
  const adManager = AdManager.getInstance(sdk);
  adManager.syncTotalRuns(saveManager.getData().totalRunsPlayed);

  let engineRef: GameEngine | null = null;

  if (import.meta.env.VITE_TARGET === 'web') {
    const synth = new SoundSynth();
    sdk.registerWebAudio(
      (name, pitch) => synth.play(name, pitch),
      (suspended) => synth.setSuspended(suspended),
    );

    const bridge = mountWebAdOverlay(adManager, {
      onResetSave: () => {
        saveManager.reset();
        adManager.resetTracking();
        engineRef?.syncSaveAfterReset();
      },
      getPerfMetrics: () => engineRef?.getPerfMetrics() ?? null,
      onStartStressTest: () => engineRef?.startStressTest(),
      onUnlockAll: () => engineRef?.unlockAllForDebug(),
    });
    sdk.registerWebBridge(bridge);
  }

  const engine = new GameEngine(sdk, saveManager, {
    onStateChanged: (state) => {
      adManager.syncTotalRuns(saveManager.getData().totalRunsPlayed);
      adManager.syncBannerForState(state);
    },
    requestRewarded: (scene, label) => adManager.showRewardedVideo(scene, label),
    tryInterstitial: async (sceneLabel) => {
      await adManager.tryShowInterstitial(sceneLabel, saveManager.getData().totalRunsPlayed);
    },
  });
  engineRef = engine;

  adManager.bindCallbacks({
    onPauseChanged: (paused) => engine.setAdPause(paused),
    onToast: (text, color) => engine.showToast(text, color),
    onRewardCompleted: () => {
      saveManager.incrementRewardedAdCount();
    },
  });

  engine.start();
}

bootstrap();
