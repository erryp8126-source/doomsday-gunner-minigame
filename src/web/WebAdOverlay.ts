import type { RewardedScene } from '../config/adConfig';
import type { AdManager } from '../sdk/AdManager';
import type { InterstitialAdResult, RewardedAdResult, WebSimulatorBridge } from '../sdk/PlatformSDK';

export interface WebOverlayHooks {
  onResetSave: () => void;
}

const SCENE_TITLES: Record<RewardedScene, string> = {
  pre_battle_boost: '开局神装支援（加特林+5人）',
  airdrop_supply: '局内超级空投支援',
  revive_clear: '战败原地复活并清屏',
  result_double: '战败结算双倍金币',
  result_triple: '通关结算三倍金币',
  armory_unlock: '传说军械库永久解锁进度',
};

/**
 * 浏览器本地调试伴侣（小游戏构建时会通过 VITE_TARGET 条件编译自动彻底排除）：
 * 1. 手机框内高仿真激励视频 / 插屏 / 底部安全区 Banner 模拟器
 * 2. 右上角可折叠「IAA 商业化调试台」
 */
export function mountWebAdOverlay(
  adManager: AdManager,
  hooks: WebOverlayHooks,
): WebSimulatorBridge {
  const phoneFrame = document.getElementById('phone-frame');
  if (!phoneFrame) {
    throw new Error('未找到手机模拟器容器');
  }

  // 1. 底部安全区 Banner 模拟器
  const bannerEl = document.createElement('div');
  bannerEl.className = 'sim-banner hidden';
  bannerEl.innerHTML = `
    <span class="sim-banner-badge">微信Banner</span>
    <span class="sim-banner-text">模拟安全区横幅广告 · 战斗中自动隐藏</span>
    <span class="sim-banner-cta">去看看</span>
  `;
  phoneFrame.appendChild(bannerEl);

  // 2. 全屏激励视频 / 插屏模拟器弹窗
  const modalEl = document.createElement('div');
  modalEl.className = 'sim-ad-modal hidden';
  modalEl.innerHTML = `
    <div class="sim-ad-topbar">
      <span class="sim-ad-pill" data-role="platform-pill">微信激励视频模拟器</span>
      <span class="sim-ad-pill" data-role="countdown-pill">3 秒后可领奖</span>
    </div>
    <div class="sim-ad-stage">
      <div class="sim-ad-poster">
        <h3 data-role="ad-title">高仿真广告测试视频</h3>
        <p data-role="ad-desc">正在模拟流量主视频播放，支持验证完播发奖与中途关闭拦截。</p>
      </div>
      <div class="sim-ad-progress-wrap">
        <div class="sim-ad-progress-fill" data-role="progress-fill"></div>
      </div>
    </div>
    <div class="sim-ad-actions">
      <button type="button" class="sim-btn sim-btn-secondary" data-role="btn-close">中途关闭（不发奖）</button>
      <button type="button" class="sim-btn sim-btn-primary" data-role="btn-finish" disabled>完整看完领奖 (3s)</button>
    </div>
  `;
  phoneFrame.appendChild(modalEl);

  const platformPill = modalEl.querySelector('[data-role="platform-pill"]') as HTMLElement;
  const countdownPill = modalEl.querySelector('[data-role="countdown-pill"]') as HTMLElement;
  const adTitle = modalEl.querySelector('[data-role="ad-title"]') as HTMLElement;
  const adDesc = modalEl.querySelector('[data-role="ad-desc"]') as HTMLElement;
  const progressFill = modalEl.querySelector('[data-role="progress-fill"]') as HTMLElement;
  const btnClose = modalEl.querySelector('[data-role="btn-close"]') as HTMLButtonElement;
  const btnFinish = modalEl.querySelector('[data-role="btn-finish"]') as HTMLButtonElement;

  // 3. 右上角「IAA 商业化调试台」
  const debugEl = document.createElement('aside');
  debugEl.className = 'iaa-debug-panel';
  debugEl.innerHTML = `
    <div class="iaa-debug-header" data-role="debug-header">
      <span class="iaa-debug-title">📊 IAA 商业化调试台</span>
      <button type="button" class="iaa-debug-toggle" data-role="debug-toggle">收起</button>
    </div>
    <div class="iaa-debug-body">
      <div class="iaa-row">
        <span>模拟宿主平台</span>
        <div class="iaa-seg">
          <button type="button" data-plat="wechat" class="active">微信 wx</button>
          <button type="button" data-plat="douyin">抖音 tt</button>
        </div>
      </div>
      <div class="iaa-row">
        <label for="iaa-fail-toggle">强制广告加载失败</label>
        <input id="iaa-fail-toggle" type="checkbox" />
      </div>
      <div class="iaa-card" data-role="cooldown-card"></div>
      <div class="iaa-card" data-role="stats-card"></div>
      <button type="button" class="iaa-reset-btn" data-role="btn-reset">一键重置本地存档</button>
    </div>
  `;
  document.body.appendChild(debugEl);

  const debugHeader = debugEl.querySelector('[data-role="debug-header"]') as HTMLElement;
  const debugToggle = debugEl.querySelector('[data-role="debug-toggle"]') as HTMLButtonElement;
  const platBtns = Array.from(debugEl.querySelectorAll('button[data-plat]')) as HTMLButtonElement[];
  const failCheckbox = debugEl.querySelector('#iaa-fail-toggle') as HTMLInputElement;
  const cooldownCard = debugEl.querySelector('[data-role="cooldown-card"]') as HTMLElement;
  const statsCard = debugEl.querySelector('[data-role="stats-card"]') as HTMLElement;
  const resetBtn = debugEl.querySelector('[data-role="btn-reset"]') as HTMLButtonElement;

  debugHeader.addEventListener('click', () => {
    debugEl.classList.toggle('collapsed');
    debugToggle.textContent = debugEl.classList.contains('collapsed') ? '展开' : '收起';
  });

  for (const btn of platBtns) {
    btn.addEventListener('click', () => {
      const target = btn.dataset.plat === 'douyin' ? 'douyin' : 'wechat';
      adManager.setSimulatedPlatform(target);
    });
  }

  failCheckbox.addEventListener('change', () => {
    adManager.setForceFail(failCheckbox.checked);
  });

  resetBtn.addEventListener('click', () => {
    hooks.onResetSave();
  });

  const refreshDebugPanel = () => {
    const snap = adManager.getDebugSnapshot();
    const isDouyin = snap.simulatedPlatform === 'douyin';

    for (const btn of platBtns) {
      btn.classList.toggle('active', btn.dataset.plat === snap.simulatedPlatform);
    }
    failCheckbox.checked = snap.forceFail;

    const badge = bannerEl.querySelector('.sim-banner-badge') as HTMLElement;
    badge.textContent = isDouyin ? '抖音Banner' : '微信Banner';

    cooldownCard.innerHTML = `
      <div class="iaa-row"><span>Banner 状态</span><span class="${snap.bannerVisible ? 'iaa-stat-good' : 'iaa-stat-warn'}">${snap.bannerVisible ? '安全区展示中' : '战斗隐藏中'}</span></div>
      <div class="iaa-row"><span>新手免插屏剩余</span><span class="iaa-stat-val">${snap.beginnerProtectionLeft} 局 (已玩 ${snap.totalRunsPlayed} 局)</span></div>
      <div class="iaa-row"><span>插屏 60s 冷却</span><span class="iaa-stat-warn">${snap.interstitialCooldownLeftSec} 秒</span></div>
      <div class="iaa-row"><span>激励后 30s 保护</span><span class="iaa-stat-warn">${snap.postRewardCooldownLeftSec} 秒</span></div>
      <div class="iaa-row"><span>最近频控状态</span><span>${snap.lastBlockReason}</span></div>
    `;

    statsCard.innerHTML = `
      <div class="iaa-row"><span>激励视频</span><span class="iaa-stat-good">完播 ${snap.stats.rewardedCompleted} / 请求 ${snap.stats.rewardedRequested}</span></div>
      <div class="iaa-row"><span>激励中断 / 失败</span><span>${snap.stats.rewardedAbandoned} / ${snap.stats.rewardedFailed}</span></div>
      <div class="iaa-row"><span>插屏展示 / 拦截</span><span class="iaa-stat-val">${snap.stats.interstitialShown} / ${snap.stats.interstitialBlocked}</span></div>
      <div class="iaa-row"><span>Banner 曝光次数</span><span>${snap.stats.bannerImpressions}</span></div>
      <div class="iaa-row"><span>综合 eCPM 预估</span><span class="iaa-stat-good">¥${snap.blendedEcpmCny.toFixed(2)}</span></div>
      <div class="iaa-row"><span>模拟累计收入</span><span class="iaa-stat-good">¥${snap.estimatedRevenueCny.toFixed(4)}</span></div>
    `;
  };

  adManager.subscribe(refreshDebugPanel);
  window.setInterval(refreshDebugPanel, 500);
  refreshDebugPanel();

  let activeTimer: number | null = null;

  const clearModalTimer = () => {
    if (activeTimer !== null) {
      window.clearInterval(activeTimer);
      activeTimer = null;
    }
  };

  return {
    getSimulatedPlatform: () => adManager.getSimulatedPlatform(),
    shouldForceFail: () => adManager.isForceFail(),
    showBanner: () => {
      bannerEl.classList.remove('hidden');
      refreshDebugPanel();
    },
    hideBanner: () => {
      bannerEl.classList.add('hidden');
      refreshDebugPanel();
    },
    showRewardedVideo: (scene: RewardedScene, rewardLabel: string): Promise<RewardedAdResult> => {
      if (adManager.isForceFail()) {
        return Promise.resolve({
          rewarded: false,
          reason: 'load_failed',
          scene,
          message: '暂无可用广告，请稍后再试',
        });
      }

      const isDouyin = adManager.getSimulatedPlatform() === 'douyin';
      clearModalTimer();
      modalEl.classList.remove('hidden');
      platformPill.textContent = isDouyin
        ? '抖音激励视频模拟器（支持激励再得）'
        : '微信激励视频模拟器';
      adTitle.textContent = SCENE_TITLES[scene] || '激励视频广告';
      adDesc.textContent = `奖励内容：${rewardLabel}。需完整倒计时 3 秒后才能触发 isEnded = true 发奖。`;
      btnClose.style.display = 'block';
      btnClose.textContent = '中途关闭（不发奖）';
      btnFinish.disabled = true;

      const totalMs = 3000;
      const startMs = performance.now();

      return new Promise((resolve) => {
        const finish = (rewarded: boolean) => {
          clearModalTimer();
          modalEl.classList.add('hidden');
          resolve({
            rewarded,
            reason: rewarded ? 'completed' : 'abandoned',
            scene,
            message: rewarded ? '奖励已发放' : '完整观看广告才能领取奖励',
          });
        };

        btnClose.onclick = () => finish(false);
        btnFinish.onclick = () => finish(true);

        const updateProgress = () => {
          const elapsed = performance.now() - startMs;
          const pct = Math.min(100, (elapsed / totalMs) * 100);
          const remain = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
          progressFill.style.width = `${pct.toFixed(1)}%`;
          if (elapsed >= totalMs) {
            countdownPill.textContent = '已满足完播条件';
            btnFinish.disabled = false;
            btnFinish.textContent = '完整看完领奖';
            clearModalTimer();
          } else {
            countdownPill.textContent = `${remain} 秒后可领奖`;
            btnFinish.textContent = `完整看完领奖 (${remain}s)`;
          }
        };

        updateProgress();
        activeTimer = window.setInterval(updateProgress, 80);
      });
    },
    showInterstitial: (sceneLabel: string): Promise<InterstitialAdResult> => {
      if (adManager.isForceFail()) {
        return Promise.resolve({ shown: false, reason: 'load_failed' });
      }

      const isDouyin = adManager.getSimulatedPlatform() === 'douyin';
      clearModalTimer();
      modalEl.classList.remove('hidden');
      platformPill.textContent = isDouyin ? '抖音局间插屏广告' : '微信局间插屏广告';
      countdownPill.textContent = '插屏频控已放行';
      adTitle.textContent = `局间插屏展示（${sceneLabel}）`;
      adDesc.textContent = '已满足新手前2局免弹、60秒冷却及激励后30秒保护规则。';
      progressFill.style.width = '100%';
      btnClose.style.display = 'none';
      btnFinish.disabled = false;
      btnFinish.textContent = '关闭插屏广告';

      return new Promise((resolve) => {
        btnFinish.onclick = () => {
          clearModalTimer();
          modalEl.classList.add('hidden');
          resolve({ shown: true, reason: 'shown' });
        };
      });
    },
  };
}
