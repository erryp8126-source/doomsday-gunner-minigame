import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

test('levels 无尽模式 1~25 波倍率单调递增且杜绝指数爆炸', () => {
  const { getEndlessWaveScale, getEndlessWaveConfig } = loadTs('src/config/levels.ts');

  assert.equal(getEndlessWaveScale(1), 1);
  assert.equal(getEndlessWaveScale(6), 2.1);

  let prevScale = 0;
  for (let wave = 1; wave <= 25; wave++) {
    const scale = getEndlessWaveScale(wave);
    const cfg = getEndlessWaveConfig(wave);
    assert.equal(cfg.hpMult, scale);
    assert.ok(scale > prevScale, `第 ${wave} 波倍率(${scale})应严格高于上一波(${prevScale})`);
    prevScale = scale;
  }

  const wave15 = getEndlessWaveScale(15);
  assert.ok(wave15 >= 6 && wave15 <= 8, `第 15 波倍率应在 6~8 倍区间内（当前=${wave15}）`);
  assert.ok(wave15 <= 10, `第 15 波倍率绝不可超过 10 倍指数爆炸阈值（当前=${wave15}）`);

  const wave25 = getEndlessWaveScale(25);
  assert.ok(wave25 >= 14 && wave25 <= 18, `第 25 波倍率应在 14~18 倍区间内（当前=${wave25}）`);
});

test('levels 无尽 Boss 血量按层级平滑递增', () => {
  const { getEndlessBossHp, getEndlessWaveConfig } = loadTs('src/config/levels.ts');

  assert.equal(getEndlessBossHp(1), 2600);
  let prevBossHp = 0;
  for (let tier = 1; tier <= 15; tier++) {
    const hp = getEndlessBossHp(tier);
    assert.ok(hp > prevBossHp, `第 ${tier} 层 Boss 血量(${hp})应严格高于上一层(${prevBossHp})`);
    prevBossHp = hp;
  }

  assert.equal(getEndlessWaveConfig(2).bossHp, getEndlessBossHp(1));
  assert.equal(getEndlessWaveConfig(4).bossHp, getEndlessBossHp(2));
  assert.ok(getEndlessBossHp(10) < 35000, '高层无尽 Boss 血量应保持可攻克区间');
});
