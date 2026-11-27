import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

function createMockCanvas(w, h) {
  const noop = () => {};
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    drawImage: noop,
  };
  return {
    width: w,
    height: h,
    getContext: () => ctx,
  };
}

test('AssetLoader 单图失败后延迟 300ms 自动重试 1 次并在重试成功时不记录 failedKeys', async () => {
  const origSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn, ms) => {
    scheduled.push({ fn, ms });
    return 1;
  };

  try {
    const { AssetLoader } = loadTs('src/game/AssetLoader.ts');
    const attempts = new Map();
    const fakeSdk = {
      createOffscreenCanvas: (w, h) => createMockCanvas(w, h),
      createImage: () => {
        const img = {
          width: 128,
          height: 128,
          naturalWidth: 128,
          naturalHeight: 128,
          onload: null,
          onerror: null,
          set src(val) {
            const count = (attempts.get(val) ?? 0) + 1;
            attempts.set(val, count);
            // 仅让 zombie_normal 首轮加载失败，其余正常成功
            if (val.includes('zombie_normal') && count === 1) {
              this.onerror?.();
            } else {
              this.onload?.();
            }
          },
        };
        return img;
      },
    };

    const loader = new AssetLoader(fakeSdk);
    let completed = false;
    loader.loadAll(() => {
      completed = true;
    });

    assert.equal(completed, false, '有素材待重试时不应提前触发完成回调');
    assert.equal(scheduled.length, 1, '应调度 1 次重试定时器');
    assert.equal(scheduled[0].ms, 300, '重试延迟必须为 300ms');

    scheduled[0].fn();
    assert.equal(completed, true, '重试完成后触发 onComplete');
    assert.equal(loader.isReady, true);
    assert.equal(loader.failedKeys.length, 0, '重试恢复成功时不进入 failedKeys');
    assert.ok(loader.sprites.zombie, 'zombie 精灵已就绪');
    assert.ok(loader.whiteSprites.zombie, 'zombie 受击白剪影已就绪');
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
});

test('AssetLoader 重试仍失败时生成离屏矢量占位图、白剪影与兜底街道并记录 failedKeys', () => {
  const origSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn, ms) => {
    scheduled.push({ fn, ms });
    return 1;
  };

  try {
    const { AssetLoader } = loadTs('src/game/AssetLoader.ts');
    const fakeSdk = {
      createOffscreenCanvas: (w, h) => createMockCanvas(w, h),
      createImage: () => ({
        width: 128,
        height: 128,
        naturalWidth: 128,
        naturalHeight: 128,
        onload: null,
        onerror: null,
        set src(_val) {
          this.onerror?.();
        },
      }),
    };

    const loader = new AssetLoader(fakeSdk);
    let completed = false;
    loader.loadAll(() => {
      completed = true;
    });

    assert.equal(scheduled.length, loader.totalCount);
    assert.equal(completed, false);
    for (const item of scheduled) {
      assert.equal(item.ms, 300);
      item.fn();
    }

    assert.equal(completed, true);
    assert.equal(loader.isReady, true);
    assert.equal(loader.failedKeys.length, loader.totalCount, '全部连续失败后 failedKeys 应完整记录缺失 key');

    for (const key of ['bg_road', 'player', 'zombie', 'zombie_runner', 'zombie_tank', 'boss', 'barrel', 'weapon_gatling']) {
      assert.ok(loader.sprites[key], `缺失素材 ${key} 必须具备离屏矢量占位图`);
    }
    for (const wKey of ['zombie', 'zombie_runner', 'zombie_tank', 'boss', 'barrel']) {
      assert.ok(loader.whiteSprites[wKey], `缺失受击对象 ${wKey} 必须具备对应白剪影`);
    }
    assert.ok(loader.cachedRoad, 'bg_road 兜底后仍应预烘焙无缝滚动街道画布');
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
});
