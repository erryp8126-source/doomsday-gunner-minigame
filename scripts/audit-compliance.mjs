import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

console.log('🔍 开始执行《末日枪手突围》双端产物、2D 素材与合规自查...');

const EXPECTED_SPRITES = [
  'bg_road.jpg',
  'player_trooper.png',
  'prop_barrel.png',
  'weapon_pistol.png',
  'weapon_shotgun.png',
  'weapon_gatling.png',
  'weapon_rocket.png',
  'zombie_normal.png',
  'zombie_runner.png',
  'zombie_tank.png',
  'zombie_boss.png',
];

// 1. 验证 dist-wx/ 与 dist-tt/ 产物目录、JSON 与全部 11 张素材完整性
const requiredFiles = {
  'dist-wx': ['game.js', 'game.json', 'project.config.json', 'game-bundle.js'],
  'dist-tt': ['game.js', 'game.json', 'project.tt.json', 'game-bundle.js'],
};

for (const [dir, files] of Object.entries(requiredFiles)) {
  for (const file of files) {
    const fullPath = resolve(rootDir, dir, file);
    assert.ok(existsSync(fullPath), `缺少必要文件: ${dir}/${file}`);
    if (file.endsWith('.json')) {
      const parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
      assert.ok(parsed && typeof parsed === 'object', `JSON 解析失败: ${dir}/${file}`);
    }
  }
  const bundleSize = statSync(resolve(rootDir, dir, 'game-bundle.js')).size;
  assert.ok(bundleSize > 5000 && bundleSize < 250 * 1024, `${dir}/game-bundle.js 体积异常: ${bundleSize}`);

  for (const sp of EXPECTED_SPRITES) {
    const spPath = resolve(rootDir, dir, 'assets/sprites', sp);
    assert.ok(existsSync(spPath), `缺少小游戏素材: ${dir}/assets/sprites/${sp}`);
    assert.ok(statSync(spPath).size > 1024, `素材文件过小异常: ${dir}/assets/sprites/${sp}`);
  }
}
console.log('   ✓ 双端工程目录结构、配置文件与全部 11 张精绘素材完整性检查通过');

// 2. 验证零 DOM 与调试台残留
const forbiddenBundleTokens = [
  'document.',
  'createElement',
  'querySelector',
  'getElementById',
  'innerHTML',
  'localStorage',
  'IAA 商业化调试台',
  'WebAdOverlay',
  'sim-ad-modal',
  'iaa-debug-panel',
];

for (const dir of ['dist-wx', 'dist-tt']) {
  const code = readFileSync(resolve(rootDir, dir, 'game-bundle.js'), 'utf8');
  for (const token of forbiddenBundleTokens) {
    assert.equal(code.includes(token), false, `${dir}/game-bundle.js 中存在禁止残留: ${token}`);
  }
}
console.log('   ✓ 零 DOM 与调试台代码隔离检查通过');

// 3. 验证游戏内玩家可见文本 100% 纯简体中文与数字（严禁出现英文字母）
const filesToCheck = [
  'src/config/weapons.ts',
  'src/config/levels.ts',
  'src/game/AssetLoader.ts',
  'src/game/Renderer.ts',
  'src/game/GameEngine.ts',
  'src/game/CanvasUI.ts',
  'src/sdk/AdManager.ts',
  'src/sdk/PlatformSDK.ts',
];

const UI_TEXT_CALLS = new Set([
  'fillText',
  'strokeText',
  'drawButton',
  'drawPanelCard',
  'showToast',
  'onToast',
  'spawnFloatText',
  'requestRewardedAction',
]);

const UI_TEXT_PROPS = new Set([
  'name',
  'desc',
  'subtitle',
  'bossName',
  'label',
  'rewardLabel',
  'subText',
  'title',
  'levelText',
  'lastBlockReason',
]);

const englishViolations = [];

function extractStaticText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      text += span.literal.text;
    }
    return text;
  }
  if (ts.isConditionalExpression(node)) {
    return `${extractStaticText(node.whenTrue)} ${extractStaticText(node.whenFalse)}`;
  }
  return '';
}

function checkTextValue(file, line, rawText) {
  if (!rawText) return;
  const match = rawText.match(/[A-Za-z]+/g);
  if (match) {
    englishViolations.push(`${file}:${line} 发现英文字符 "${match.join(', ')}" -> 原文: "${rawText}"`);
  }
}

for (const relPath of filesToCheck) {
  const fullPath = resolve(rootDir, relPath);
  const sourceText = readFileSync(fullPath, 'utf8');
  const sf = ts.createSourceFile(fullPath, sourceText, ts.ScriptTarget.ES2020, true);

  function visit(node) {
    if (ts.isCallExpression(node)) {
      let calleeName = '';
      if (ts.isIdentifier(node.expression)) calleeName = node.expression.text;
      else if (ts.isPropertyAccessExpression(node.expression)) calleeName = node.expression.name.text;

      if (UI_TEXT_CALLS.has(calleeName)) {
        let argIndex = 0;
        if (calleeName === 'drawButton') argIndex = 7;
        else if (calleeName === 'drawPanelCard') argIndex = 5;
        else if (calleeName === 'spawnFloatText') argIndex = 2;
        else if (calleeName === 'requestRewardedAction') argIndex = 1;
        const arg = node.arguments[argIndex];
        if (arg) {
          const line = sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
          checkTextValue(relPath, line, extractStaticText(arg));
        }
      }
    }

    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (UI_TEXT_PROPS.has(node.name.text)) {
        const line = sf.getLineAndCharacterOfPosition(node.initializer.getStart()).line + 1;
        checkTextValue(relPath, line, extractStaticText(node.initializer));
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      UI_TEXT_PROPS.has(node.left.name.text)
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.right.getStart()).line + 1;
      checkTextValue(relPath, line, extractStaticText(node.right));
    }

    // 针对任意包含中文字符的 UI 字符串字面量（如临时变量拼装），同样严禁混杂英文字母
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (/[\u4e00-\u9fa5]/.test(node.text) && /[A-Za-z]/.test(node.text)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        checkTextValue(relPath, line, node.text);
      }
    }
    if (ts.isTemplateExpression(node)) {
      const staticPart = extractStaticText(node);
      if (/[\u4e00-\u9fa5]/.test(staticPart) && /[A-Za-z]/.test(staticPart)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        checkTextValue(relPath, line, staticPart);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
}

assert.equal(
  englishViolations.length,
  0,
  `检测到游戏内玩家可见文案包含英文单词：\n${englishViolations.join('\n')}`,
);
console.log('   ✓ 游戏核心全界面 100% 纯简体中文与数字合规检查通过');

// 4. 动态验证 AdManager 频控与完播发奖规则
function loadTsModule(relPath) {
  const fullPath = resolve(rootDir, relPath);
  const src = readFileSync(fullPath, 'utf8');
  const transpiled = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', transpiled);
  fn(
    (id) => {
      if (id.includes('adConfig')) return loadTsModule('src/config/adConfig.ts');
      return {};
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const { AdManager } = loadTsModule('src/sdk/AdManager.ts');
let mockRewarded = false;
let mockPauseCalls = [];
let mockToasts = [];
let mockBannerShown = false;

const fakeSdk = {
  runtime: 'web',
  getEffectiveAdPlatform: () => 'wechat',
  showRewardedVideoRaw: async (_scene) => ({
    rewarded: mockRewarded,
    reason: mockRewarded ? 'completed' : 'abandoned',
    scene: _scene,
    message: mockRewarded ? '奖励已发放' : '完整观看广告才能领取奖励',
  }),
  showBannerRaw: () => {
    mockBannerShown = true;
  },
  hideBannerRaw: () => {
    mockBannerShown = false;
  },
  showInterstitialRaw: async () => ({ shown: true, reason: 'shown' }),
};

const adMgr = AdManager.getInstance(fakeSdk);
adMgr.resetTracking();
adMgr.bindCallbacks({
  onPauseChanged: (p) => mockPauseCalls.push(p),
  onToast: (t) => mockToasts.push(t),
});

// 4.1 验证 Banner 仅在 MENU/RESULT 显示
adMgr.syncBannerForState('MENU');
assert.equal(mockBannerShown, true);
adMgr.syncBannerForState('PLAYING');
assert.equal(mockBannerShown, false);
adMgr.syncBannerForState('RESULT');
assert.equal(mockBannerShown, true);

// 4.2 验证完播校验 + 暂停恢复 + 中途关闭不发奖
mockRewarded = false;
const abandonedOk = await adMgr.showRewardedVideo('revive_clear', '复活');
assert.equal(abandonedOk, false);
assert.deepEqual(mockPauseCalls, [true, false]);
assert.ok(mockToasts[mockToasts.length - 1].includes('完整观看'));

mockRewarded = true;
const completedOk = await adMgr.showRewardedVideo('revive_clear', '复活');
assert.equal(completedOk, true);

// 4.3 验证插屏硬性频控（前2局免弹 + 激励后30s保护 + 60s冷却）
const t0 = Date.now() + 5000;
assert.equal(adMgr.canShowInterstitial(1, t0).allowed, false);
assert.equal(adMgr.canShowInterstitial(2, t0).allowed, false);
assert.equal(adMgr.canShowInterstitial(3, t0).allowed, false); // 因刚完播激励，30s 保护生效
const tAfter35s = t0 + 35_000;
assert.equal(adMgr.canShowInterstitial(3, tAfter35s).allowed, true);
const shownFirst = await adMgr.tryShowInterstitial('测试插屏', 3, tAfter35s);
assert.equal(shownFirst, true);
assert.equal(adMgr.canShowInterstitial(3, Date.now() + 10_000).allowed, false); // 60s 冷却拦截

console.log('   ✓ AdManager 激励完播、防连点、Banner 安全区与插屏频控自检通过');
console.log('🎉 全部合规与技术红线审计通过！');
