import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(__dirname, '../..');

const require = createRequire(resolve(ROOT_DIR, 'package.json'));
const ts = require('typescript');

function resolveTsFile(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')];
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  throw new Error(`无法解析模块路径: ${specifier} (from ${fromFile})`);
}

/**
 * 轻量零外部依赖 TS 模块加载器：复用项目 devDependencies 中的 typescript 在内存中转译执行
 */
export function loadTs(relPath, options = {}) {
  const { mocks = {}, viteTarget = 'wx' } = options;
  const localCache = new Map();

  function loadInternal(fullPath) {
    if (localCache.has(fullPath)) {
      return localCache.get(fullPath).exports;
    }

    let source = readFileSync(fullPath, 'utf8');
    source = source.replace(/import\.meta\.env\.VITE_TARGET/g, JSON.stringify(viteTarget));

    const transpiled = ts.transpileModule(source, {
      fileName: fullPath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText;

    const mod = { exports: {} };
    localCache.set(fullPath, mod);

    const customRequire = (specifier) => {
      if (Object.prototype.hasOwnProperty.call(mocks, specifier)) {
        return mocks[specifier];
      }
      for (const [key, value] of Object.entries(mocks)) {
        if (specifier.includes(key)) {
          return value;
        }
      }
      if (specifier.startsWith('.')) {
        return loadInternal(resolveTsFile(fullPath, specifier));
      }
      return require(specifier);
    };

    const fn = new Function('require', 'module', 'exports', transpiled);
    fn(customRequire, mod, mod.exports);
    return mod.exports;
  }

  return loadInternal(resolve(ROOT_DIR, relPath));
}
