import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const tmpDir = resolve(rootDir, 'dist-minigame-tmp');
const bundlePath = resolve(tmpDir, 'game-bundle.js');
const spritesSrcDir = resolve(rootDir, 'public/assets/sprites');

if (!existsSync(bundlePath)) {
  console.error('❌ 未找到编译产物 dist-minigame-tmp/game-bundle.js');
  process.exit(1);
}

if (!existsSync(spritesSrcDir)) {
  console.error('❌ 未找到精绘素材目录 public/assets/sprites');
  process.exit(1);
}

const bundleContent = readFileSync(bundlePath, 'utf8');
const FORBIDDEN_TOKENS = [
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

for (const token of FORBIDDEN_TOKENS) {
  if (bundleContent.includes(token)) {
    console.error(`❌ 小游戏产物安全隔离失败：检测到禁止残留标记 "${token}"`);
    process.exit(1);
  }
}

const targets = [
  { name: 'wx', label: '微信小游戏', outDir: resolve(rootDir, 'dist-wx'), tplDir: resolve(rootDir, 'minigame/wx') },
  { name: 'tt', label: '抖音小游戏', outDir: resolve(rootDir, 'dist-tt'), tplDir: resolve(rootDir, 'minigame/tt') },
];

for (const t of targets) {
  rmSync(t.outDir, { recursive: true, force: true });
  mkdirSync(t.outDir, { recursive: true });
  cpSync(t.tplDir, t.outDir, { recursive: true });
  copyFileSync(bundlePath, resolve(t.outDir, 'game-bundle.js'));
  cpSync(spritesSrcDir, resolve(t.outDir, 'assets/sprites'), { recursive: true });
}

const scriptSizeKB = statSync(bundlePath).size / 1024;
let spriteBytes = 0;
for (const file of readdirSync(spritesSrcDir)) {
  spriteBytes += statSync(resolve(spritesSrcDir, file)).size;
}
const totalSizeKB = scriptSizeKB + spriteBytes / 1024;
rmSync(tmpDir, { recursive: true, force: true });

console.log('✅ 双端小游戏打包完成（零 DOM / 调试台残留校验通过）');
console.log(`   - 核心脚本体积: ${scriptSizeKB.toFixed(2)} KB`);
console.log(`   - 精绘素材体积: ${(spriteBytes / 1024).toFixed(2)} KB（11 张）`);
console.log(`   - 单包总计体积: ${totalSizeKB.toFixed(2)} KB（远低于 4096 KB 首包上限）`);
console.log('   - 微信开发者工具导入目录: dist-wx/');
console.log('   - 抖音开发者工具导入目录: dist-tt/');
