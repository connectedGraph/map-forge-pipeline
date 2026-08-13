# 🗺️ AI 游戏地图生成 + 校准工作流

> 版本：v1.0 · 2026-07-30  
> 项目：`app-gamify-new` · W1 浅海群岛关卡

---

## 一、总览：为什么需要这套工作流？

游戏地图由两层关键信息构成：

| 层级 | 内容 | 生成方式 |
|---|---|---|
| **背景图块** | 视觉风格（海洋、赛博、岛屿纹理） | AI 图生图 |
| **检查点节点** | 椭圆底座的绝对坐标（%x, %y） | 代码计算 + 手工标注 |

两者必须精确对齐。**关键矛盾**：AI 图生图会引入位置噪声，导致生成图中的"视觉地标"和代码坐标产生偏移，需要手动校准。

---

## 二、当前（v1）流程回顾

```
原始地图 PNG
    ↓  img2img
AI 生成风格化地图（有位置噪声）
    ↓
上线后发现节点偏移
    ↓
调参面板实时微调 offsetX / offsetY
    ↓
记录数值 → 硬编码进代码
```

**存在的问题：**
- 原始地图本身就是"有内容的图"，img2img 模型会主动解读画面并引入创作偏移
- 每次换新风格都要重新跑调参面板校准，效率低
- 无缝图块（seamless tile）和底座图各自偏移不同，校准成本翻倍

---

## 三、改进方案：基于"干净控制图"的生成流程

### 3.1 核心思路

> 不用有噪声的原始地图做参考，改用一张**空白背景 + 精确标注椭圆位置**的干净底图作为 img2img 参考。

类似 Stable Diffusion 的 ControlNet 控图逻辑：给模型一个"空间骨架"，让它只负责填充风格，不改变结构。

### 3.2 干净控制图规格

控制图需包含以下信息（建议工具：Figma / Photoshop / MapAnnotator）：

```
画布尺寸：768 × 1376 px（与代码 TILE_HEIGHT 比例一致）
背景：纯黑 (#0a0a14) 或深灰

标注内容：
  ① 每个检查点位置画椭圆轮廓（描边，不填充）
     - 椭圆尺寸：99 × 68 px（代码中的 w/h）
     - 中心位置：按节点 (x%, y%) 换算像素坐标
  ② 节点之间用细线连接（表示路线关系）
  ③ 底部入口：手动绘制"路线起点"箭头或通道
  ④ 可选：在椭圆旁标注节点序号（①②③...）
```

### 3.3 椭圆中心坐标换算

代码中的节点坐标是百分比，需换算为控制图像素坐标：

```
像素X = x% × 768
像素Y = y% × 1376

例：节点④ x=27.1, y=77.3
  → px: (208, 1063)
```

| 节点 | x% | y% | 像素坐标 (768×1376) |
|---|---|---|---|
| ① 浅海起点 | 74.1 | 58.9 | (569, 810) |
| ② 特征提取 | 27.0 | 39.5 | (207, 543) |
| ③ 数据离散 | 74.1 | 23.2 | (569, 319) |
| ④ 算法入门 | 27.1 | 77.3 | (208, 1063) |
| ⑤ 神经网络 | 74.1 | 58.9 | (569, 810) |
| ⑥ 决策树   | 27.3 | 39.4 | (210, 542) |
| ⑦ 章节BOSS | 74.1 | 23.0 | (569, 316) |

> ⚠️ 注意：代码目前有两套偏移值，最终坐标还需加上 offset
> - 底座图：`globalOffsetX=-0.4`, `globalOffsetY=1.2`
> - 无缝图块：`seamlessOffsetX=0.14`, `seamlessOffsetY=0.04`
> 控制图绘制时建议**不加 offset**，由代码统一处理

---

## 四、改进后（v2）完整流程

```
1. 用 MapAnnotator 确认/调整节点坐标（%x, %y）
        ↓
2. 导出坐标表 → 换算为像素坐标
        ↓
3. 在空白画布上绘制"控制图"
   - 椭圆轮廓 + 路线连线 + 底部入口
   - 无视觉噪声，纯结构信息
        ↓
4. 以"控制图"为 img2img 参考生成风格化地图
   python generate.py --user user2 \
     --image ./control_map_seamless.png \
     "1:1" ./output.png \
     "提示词（风格描述）"
        ↓
5. 上线预览，若有小偏移 → 开启调参面板微调
        ↓
6. 记录最终 offset → 硬编码 → 关闭调参面板
        ↓
7. 归档控制图（作为下次换风格的复用参考）
```

---

## 五、提示词模板（面向"控制图"的 img2img）

由于控制图只有结构，提示词负责描述风格：

```
Transform this structural layout into a [风格描述] game map.
The white ellipses mark the exact positions of checkpoint platforms —
keep them at their exact positions.
The lines represent routes between platforms.
Redesign the environment: [环境描述].
2.5D isometric top-down perspective. Clean game art style. [色调描述].
```

**已验证风格（AI 赛博空间）：**

```
Transform this structural layout into a digital AI cyberspace game map.
The white ellipses mark the exact positions of checkpoint platforms —
keep them at their exact positions.
Redesign: floating metallic server platforms with glowing teal-cyan circuits,
holographic neon rings, dark navy sea with glowing data grid lines,
electric blue and cyan neon colors.
2.5D isometric top-down. Clean game art.
```

---

## 六、当前已落地的资产清单

| 文件 | 说明 | 状态 |
|---|---|---|
| `public/assets/map_start_base.png` | 原始底座底图 | ✅ 保留备份 |
| `public/assets/map_v6_seamless_25d.png` | 原始无缝图块 | ✅ 保留备份 |
| `public/assets/map_start_base_digital_v2.png` | AI 赛博风底座（user2 生成）| ✅ 当前使用 |
| `public/assets/map_v7_seamless_digital_v2.png` | AI 赛博风无缝图块（user2 生成）| ✅ 当前使用 |

**当前校准坐标（已硬编码）：**

```js
// src/App.jsx
const globalOffsetX  = -0.4;   // 底座图 StartBase
const globalOffsetY  =  1.2;
const seamlessOffsetX =  0.14;  // 无缝图块 Seamless
const seamlessOffsetY =  0.04;
```

---

## 七、下一步任务

- [x] 创建"控制图"工具（后端脚本 `scripts/map_pipeline.py`：规范记录 → 控制图 PNG；浏览器 `#/annotator` 也可手动导出兜底）
- [ ] 手动绘制底部路线入口，合入控制图
- [x] 以控制图为基础重新生成底座图 + 无缝图块（`python scripts/map_pipeline.py` 一键跑通，user1 lt4net gpt-image-2 + 图生图）
- [x] 整理成可复用的生成脚本，记录提示词版本（`scripts/map_pipeline.py`）

---

## 八、生图工具使用备注

```bash
# 图生图（user2 = Gemini 多模态，支持 --image）
python C:/Users/18086/Desktop/image-gen/generate.py \
  --user user2 \
  --image <参考图路径> \
  "1:1" <输出路径> \
  "<提示词>"

# 注意：user1 (gpt-image-2, openai_images) 不支持图生图 --image 参数
# 图生图依赖 user2；⚠️ 当前 user2 网关 (<GATEWAY_HOST>:8317) 无 Gemini 生图模型，
# 需先修正 image-gen/configs.json 的 model/endpoint（见第九节），否则 API 报 unknown provider。
```

---

## 九、后端自动化管线（`scripts/map_pipeline.py`）

从一份规范记录自动出控制图并跑图，全程无需浏览器：

```bash
# 只出控制图（本地免费）
python scripts/map_pipeline.py --no-generate
# 控制图 + img2img 全跑
python scripts/map_pipeline.py
```

- **规范记录**：`src/data/map_nodes.json`（坐标/offset/底图文件，前端预览端与打点工具共用同一份）。
- **控制图**：Pillow 画 768×1376 黑底 `#0a0a14` + 白色椭圆轮廓 + 序号 + 路线 + 底部入口，输出 `pipeline_output/control_map_*.png`。
- **img2img**：subprocess 调 `generate.py --user user2 --image <控制图> 9:16 <out> "<提示词>"`；seamless 图块自动追加"上下边须无缝拼接"约束。代理自动探测 <PROXY_PORT_A> → <PROXY_PORT_B>。
- **状态**：控制图 ✅；img2img 被 `image-gen/configs.json` user2 网关卡住——模型 `gemini-3.1-flash-image` 在该网关不存在（该网关仅 grok-imagine-image 可生图且需 images/generations 端点），修正配置后即可跑通。
