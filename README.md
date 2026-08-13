# 🗺️ AI 地图生成流水线 · 关卡点打点工具

> 一条可落地的「AI 生图地图 + 关卡点精确对齐」流水线。AI 负责填视觉风格，人负责定结构坐标，两者靠「干净控制图」对齐。

本项目不是成品游戏，而是一套**地图构建方法论 + 工具**：

- `#/` —— 无缝拼图地图**预览端**（3 张纵向图块拼成卷轴 + 椭圆关卡点渲染 + 惯性滚动）
- `#/annotator` —— **关卡点打点工具**（人工标记/拖动/微调每个检查点的坐标与尺寸，导出 JSON）
- `MAP_GEN_WORKFLOW.md` —— v2 生成工作流的细节文档

---

## 一、核心理论：两层模型与对齐矛盾

游戏地图由两层**必须精确对齐**的信息构成：

| 层级 | 内容 | 生成方式 | 性质 |
|---|---|---|---|
| **背景图块** | 视觉风格（海洋、赛博、岛屿纹理） | AI 图生图 | 有位置噪声 |
| **检查点节点** | 椭圆底座的绝对坐标 `%x/%y` | 代码计算 + 人工标注 | 精确 |

**核心矛盾**：AI 图生图会主动"解读"画面并引入创作偏移，导致生成图里的视觉地标（平台、浮岛）与代码坐标对不上。节点一旦跑偏，整个关卡体验就崩。

所以流水线的关键不是"让 AI 更准"，而是**把结构信息从视觉信息里分离出来**：

1. 先用**人工打点**确定节点坐标（这是唯一需要人拍板的精确信息）；
2. 再把坐标画成一张**干净的"控制图"**（空白背景 + 椭圆轮廓 + 路线 + 入口，无任何视觉噪声）；
3. 最后用这张控制图当 img2img 的**参考骨架**，让 AI 只填风格、不移动结构。

> 类似 Stable Diffusion 的 ControlNet 思路：给模型一个空间骨架，约束它"只换皮不改骨"。

---

## 二、坐标系与拼图理论

### 2.1 基准画布

所有地图素材以 **768 × 1376 px** 为基准，与代码中的 `TILE_HEIGHT` 比例严格一致：

```js
// src/App.jsx
const TILE_HEIGHT = viewWidth * 1376 / 768;   // 一块图块的高度
const MAP_TOTAL_HEIGHT = TILE_HEIGHT * 3;     // 整张卷轴 = 3 块图块
```

### 2.2 三块纵向拼图

一张卷轴由 3 张纵向图块按从上到下顺序拼成（**无缝图块可以无限复用**）：

```
图块 3（顶部）  seamless tile  ← map_v7_seamless_digital_v2.png
图块 2（中部）  seamless tile  ← map_v7_seamless_digital_v2.png
图块 1（底部）  start base     ← map_start_base_digital_v2.png
```

拼接处用一条 `12px` 半透明青色发光条（`bg-cyan-400/20 blur-[5px]`）晕染，弱化两块的色差。

### 2.3 节点坐标换算

节点坐标是**百分比**（相对所在图块），渲染时换算为绝对像素：

```js
absoluteTop  = TILE_HEIGHT × 图块序号 + ((y + offsetY) / 100) × TILE_HEIGHT
absoluteLeft = x + offsetX   // 百分比
```

### 2.4 双偏移校准（offset）

不同图块各自带一套校准值，因为每张 AI 图被解读时的系统性偏移不同：

```js
const globalOffsetX  = -0.4;   // 底座图   map_start_base_digital_v2
const globalOffsetY  =  1.2;
const seamlessOffsetX =  0.14; // 无缝图块 map_v7_seamless_digital_v2
const seamlessOffsetY =  0.04;
```

换新风格底图时，先用预览端的调参跑一遍，找到让节点对准视觉地标的 offset，再硬编码。

---

## 三、生图流水线（控制图法）

```
① MapAnnotator 标注/确认节点坐标（%x, %y, w, h）
        ↓  导出坐标 JSON
② 换算为像素坐标：pxX = x% × 768, pxY = y% × 1376
        ↓
③ 在空白画布上画"控制图"
   - 椭圆轮廓（99×68，描边不填充）＋ 节点序号
   - 节点间细线（路线关系）
   - 底部"路线起点"入口
        ↓
④ 以控制图为 img2img 参考生成风格化地图
        ↓
⑤ 上线预览，若仍有小偏移 → 调 offset
        ↓
⑥ 记录 offset → 硬编码 → 归档控制图（下次换风格复用）
```

### 控制图规格

| 项 | 规格 |
|---|---|
| 画布 | 768 × 1376 px（与 TILE_HEIGHT 比例一致） |
| 背景 | 纯黑 `#0a0a14` 或深灰（无视觉噪声） |
| 椭圆 | 99 × 68 px 描边，中心 = 节点像素坐标 |
| 额外 | 路线连线、底部入口、可选节点序号 |

### img2img 提示词模板

```text
Transform this structural layout into a [风格描述] game map.
The white ellipses mark the exact positions of checkpoint platforms —
keep them at their exact positions.
The lines represent routes between platforms.
Redesign the environment: [环境描述].
2.5D isometric top-down perspective. Clean game art style. [色调描述].
```

**已验证（AI 赛博空间）**：

```text
Transform this structural layout into a digital AI cyberspace game map.
The white ellipses mark the exact positions of checkpoint platforms —
keep them at their exact positions.
Redesign: floating metallic server platforms with glowing teal-cyan circuits,
holographic neon rings, dark navy sea with glowing data grid lines,
electric blue and cyan neon colors.
2.5D isometric top-down. Clean game art.
```

### 后端自动化（推荐）

坐标记录在 `src/data/map_nodes.json`（预览端/打点工具/后端共用一份）。`scripts/map_pipeline.py` 一键出控制图并跑图，全程无需浏览器：

```bash
python scripts/map_pipeline.py --no-generate       # 只出控制图（本地免费）
python scripts/map_pipeline.py                     # 控制图 + 风格连锁 img2img 全跑
python scripts/map_pipeline.py --prompt-idx 1      # 用提示词池第 2 套
python scripts/map_pipeline.py --list-prompts      # 列出提示词池
```

- **风格连锁**：`start_base` 先按模板生成 → `seamless_loop` 用「模板图 + 第一张生成图」生成，风格与第一张一致。
- **提示词池**：`scripts/map_pipeline.py` 顶部 `PROMPT_POOL` 是对象数组，每套含 `base` + `seamless_addendum`，用 `--prompt-idx` 轮换。
- 输出：`pipeline_output/control_map_*.png` + `pipeline_output/map_*_v3.png`
- 代理自动探测 <PROXY_PORT_A> → <PROXY_PORT_B>；seamless 图块自动追加"上下边须无缝拼接"约束
- img2img 走 `imagegen --user user3`（<GATEWAY_HOST> gemini chat/completions 图生图，参考图按布局生效）

### 手动兜底

`#/annotator` 打点工具里也能手动导出控制图 PNG（微调后用）。

### 生图命令

```bash
# 仅 user2 (Gemini 多模态) 支持控制图 → 图生图
python C:/Users/18086/Desktop/image-gen/generate.py \
  --user user2 \
  --image ./control_map_seamless.png \
  "9:16" ./output.png \
  "提示词"
```

---

## 四、工具与路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `#/` | 地图预览端 | 无缝拼图卷轴 + 关卡点 + 拖动/惯性滚动，顶部可实时切换节点样式、直达打点工具 |
| `#/annotator` | 关卡点打点工具 | 增删/拖动/改尺寸椭圆，统一规格；导出坐标 JSON + **控制图 PNG**（空白黑底 + 椭圆轮廓，直接喂 img2img） |
| `#/nodes` | 节点设计候选墙 | 4 种 SVG 变体 × 5 状态并排对比，按住体验「按下/起立」回弹 |

## 四·5、关卡点节点：SVG 参数化设计系统

关卡点是纯 SVG 渲染，不走图片生成（零素材、矢量缩放不糊、换风格只改代码）：

- **`src/components/MapNode.jsx`** —— 节点组件。4 个立体科幻变体（`pedestal` 全息踏板 / `capsule` 能量舱 / `hex` 六边形信标 / `orb` 能量球）× 5 状态配色（mastered 金 / passed 青 / current 亮青呼吸 / locked 灰 / boss 玫红虚线堡垒环）。
- **按下/起立机制** —— 按住节点顶面下沉（物理踏板），松开用 overshoot 曲线回弹，按下时光晕压暗。指针事件 `stopPropagation`，不干扰地图拖动。
- **`src/components/nodeDesign.js`** —— 变体注册表（新变体在此登记，地图工具栏与候选墙自动出现）。
- 形状中心恒等于椭圆中心，任何变体都不破坏 `%` 坐标对齐。

打点工具（`src/components/MapAnnotator.jsx`）底图即当前在用的 v2 赛博风地图（`map_start_base_digital_v2.png` / `map_v7_seamless_digital_v2.png`），**所见即所得**——标注位置就是 App 渲染位置。

### 运行

```bash
npm install
npm run dev      # 开发
npm run build    # 构建
npm run preview  # 预览构建产物
```

路由基于 hash，零依赖，`npm run build` 产物可直接扔任意静态服务器（含 file:// 场景）。

---

## 五、辅助脚本

- **`process_clouds.py`** — 云层 PNG 抠图脚本：黑点 keying（`black_point=65`）+ 四周 15–18% 边缘羽化，把黑底云层处理成带柔和过渡的透明贴图。原用于遮挡拼图接缝，现作为透明素材处理技法保留。

---

## 六、资产清单

### 当前使用（`public/assets/`）

| 文件 | 用途 |
|---|---|
| `map_v7_seamless_digital_v2.png` | 无缝图块（预览端顶部/中部 + 打点工具） |
| `map_start_base_digital_v2.png` | 底座图（预览端底部 + 打点工具） |
| `seam_clouds.png` / `seam_clouds_backup.png` | `process_clouds.py` 的工作图 / 备份 |
| `favicon.svg` | 站点图标 |

### 已清理（本次重构删除）

旧版底图与中间产物（`map_25d_isometric`、`map_v4/v5/v6_seamless`、`map_seamless_pure`、`map_w1_seamless`、`map_start_base.png`、`*.jpg` 等）以及演示壳相关组件/素材已物理删除。需要回溯历史版本时从以下渠道找回：`MAP_GEN_WORKFLOW.md` 中记录的生成参数、`image-gen` 工具目录、或旧构建产物。

---

## 目录结构

```
app-gamify-new/
├─ index.html                    # 入口，title 为流水线定位
├─ src/
│  ├─ main.jsx                   # hash 路由：#/ 预览，#/annotator 打点
│  ├─ App.jsx                    # 地图预览端（拼图 + 节点 + 惯性滚动）
│  ├─ index.css                  # Tailwind + 自定义滚动条
│  └─ components/
│     └─ MapAnnotator.jsx        # 关卡点打点工具
├─ public/assets/                # 当前使用的 v2 地图素材
├─ process_clouds.py             # 云层抠图脚本
└─ MAP_GEN_WORKFLOW.md           # v2 生成工作流细节
```
