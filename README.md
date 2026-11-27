# 末日枪手突围（2D 精绘生产版）

纯单机竖屏打桶射击小游戏，集成 11 张 2D 精绘抠底素材、离屏白剪影受击闪白、连击暴击抛飞物理与完整 IAA 纯广告变现闭环，支持 **微信小游戏（`wx`）**、**抖音小游戏（`tt`）** 双端打包与本地浏览器调试预览。

## 玩法特色

- **2D 精绘视听体验**：无缝双图废土街道、16 人同心环小队编队与枪口火光、桶顶悬浮武器图标、普通/疾跑/重盾丧尸与熔岩尸王。
- **双核心玩法模式**：
  - **关卡突围（5 大递增关卡）**：`荒野街道` → `封锁立交` → `废墟街区` → `工业防线` → `终末禁区`。
  - **无尽尸潮模式**：无限递增波次与循环尸王挑战，支持最高波次与击杀纪录持久化。
- **IAA 5 大变现闭环**：开局满配体验、局内超级空投、战败满血复活清屏、结算 2 倍/3 倍金币永久养成、免氪金传说军械库，配合安全区 Banner 与硬性插屏频控。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动本地浏览器试玩（内置高仿真广告模拟器与右上角「IAA 商业化调试台」）
npm run dev

# 3. 类型检查与 H5 构建（输出 dist/ 与 dist/assets/sprites/）
npm run build

# 4. 一键输出微信 & 抖音双端工程目录（自动拷贝编译产物与 11 张精绘素材到 dist-wx/ 与 dist-tt/）
npm run build:minigame

# 5. 执行双端产物、零 DOM 残留、素材完整性与纯中文合规自查
npm run audit
```

## 上线替换真实流量主 ID 与 AppID 步骤

1. **替换广告位 ID**：打开 [src/config/adConfig.ts](src/config/adConfig.ts)，将 `AD_UNITS.wechat` 与 `AD_UNITS.douyin` 中包含 `replace-me` 的占位符分别替换为微信公众平台或抖音开放平台申请的真实 `adUnitId`。
2. **替换小游戏 AppID**：
   - 微信小游戏：修改 [minigame/wx/project.config.json](minigame/wx/project.config.json) 中的 `appid`（并同步更新 `src/config/adConfig.ts` 中的 `APP_IDS.wechat`）；
   - 抖音小游戏：修改 [minigame/tt/project.tt.json](minigame/tt/project.tt.json) 中的 `appid`（并同步更新 `src/config/adConfig.ts` 中的 `APP_IDS.douyin`）。
3. **重新打包导入真机工具**：执行 `npm run build:minigame`，使用微信开发者工具导入 `dist-wx/`、使用抖音开发者工具导入 `dist-tt/` 即可真机预览与提审。
