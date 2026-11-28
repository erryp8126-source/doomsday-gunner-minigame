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

test('levels 主线已扩充至 15 关且时长 45~65 秒、难度平滑递增无指数爆炸', () => {
  const { LEVELS } = loadTs('src/config/levels.ts');
  assert.equal(LEVELS.length, 15);

  let prevHpMult = 0;
  let prevBossHp = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const lv = LEVELS[i];
    assert.equal(lv.id, i + 1);
    assert.ok(lv.duration >= 45 && lv.duration <= 65, `第 ${lv.id} 关时长应在 45~65 秒内`);
    assert.ok(lv.hpMult > prevHpMult, `第 ${lv.id} 关血量倍率应严格递增`);
    assert.ok(lv.bossHp > prevBossHp, `第 ${lv.id} 关 Boss 血量应严格递增`);
    assert.ok(lv.runnerRate + lv.tankRate <= 0.9, `第 ${lv.id} 关特殊怪比例应保留普通怪空间`);
    prevHpMult = lv.hpMult;
    prevBossHp = lv.bossHp;
  }

  assert.ok(LEVELS[14].hpMult <= 12, '第 15 关血量倍率应平滑可控，无指数爆炸');
  assert.ok(LEVELS[14].bossHp <= 32000, '第 15 关 Boss 血量应处于可攻克范围');
});

test('levels 穿插极速疾跑/铁壁重盾/黄金木桶三类主题关与主题元信息', () => {
  const { getLevelConfig, getLevelThemeMeta } = loadTs('src/config/levels.ts');

  for (const id of [4, 9, 13]) {
    const lv = getLevelConfig(id);
    assert.equal(lv.theme, 'speed', `第 ${id} 关应为极速疾跑主题`);
    assert.ok(lv.runnerRate >= 0.65, `第 ${id} 关疾跑丧尸占比应 >= 65%`);
  }

  for (const id of [6, 11, 14]) {
    const lv = getLevelConfig(id);
    assert.equal(lv.theme, 'shield', `第 ${id} 关应为铁壁重盾主题`);
    assert.ok(lv.tankRate >= 0.5, `第 ${id} 关重盾丧尸占比应 >= 50%`);
  }

  for (const id of [3, 8, 12]) {
    const lv = getLevelConfig(id);
    assert.equal(lv.theme, 'gold', `第 ${id} 关应为黄金木桶爽刷主题`);
  }

  assert.equal(getLevelThemeMeta('speed').label, '极速疾跑关');
  assert.equal(getLevelThemeMeta('shield').label, '铁壁重盾关');
  assert.equal(getLevelThemeMeta('gold').label, '黄金木桶爽刷关');
});

test('levels 主线里程碑定义与下一里程碑推算正确', () => {
  const { CAMPAIGN_MILESTONES, getMilestoneForLevel, getNextMilestone } = loadTs('src/config/levels.ts');
  assert.deepEqual(
    CAMPAIGN_MILESTONES.map((m) => m.clearLevel),
    [1, 5, 10, 15],
  );
  assert.equal(getMilestoneForLevel(5).rewardCoins, 500);
  assert.equal(getMilestoneForLevel(10).rewardCoins, 1000);
  assert.equal(getNextMilestone(1, []).clearLevel, 1);
  assert.equal(getNextMilestone(2, [1]).clearLevel, 5);
  assert.equal(getNextMilestone(6, [1, 5]).clearLevel, 10);
  assert.equal(getNextMilestone(15, [1, 5, 10]).clearLevel, 15);
  assert.equal(getNextMilestone(15, [1, 5, 10, 15]), null);
});
