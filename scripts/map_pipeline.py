"""
地图生图后端管线：规范记录 → 控制图 PNG → 模板图 + 风格模板 合成 prompt 生成新地图。

读 src/data/map_nodes.json，用 Pillow 画两张 768×1376 白纸控制图（模板图）：
  - control_map_start_base.png     起点图模板
  - control_map_seamless_loop.png  纵向无缝图块模板

提示词 = 基本模板（布局蓝图：椭圆=关卡点停机坪槽位，留空给素材；线=关卡间路径）
       + 风格模板（背景设定 + 关卡点/连接/起始点身份）。

生成顺序（风格连锁）：
  ① start_base     --image 模板图                     → map_start_base_v3.png
  ② seamless_loop  --image 模板图 --style ①生成图      → 与第一张同一世界
                                                       → map_seamless_loop_v3.png

用法：
  python scripts/map_pipeline.py --no-generate   # 只出模板图（本地免费）
  python scripts/map_pipeline.py                 # 模板图 + 风格连锁全跑
  python scripts/map_pipeline.py --style-idx 2   # 用风格模板池第 3 个
  python scripts/map_pipeline.py --list-styles   # 列出风格模板池
"""

import argparse
import json
import os
import socket
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# 控制图基准画布（与代码 TILE_HEIGHT 比例一致）
CONTROL_W = 768
CONTROL_H = 1376
BG_COLOR = (255, 255, 255)          # 白纸底
ELLIPSE_COLOR = (20, 20, 25)        # 深色椭圆描边
ROUTE_COLOR = (30, 90, 170)         # 深蓝路线
LABEL_COLOR = (20, 20, 25)          # 深色序号
ENTRANCE_COLOR = (20, 20, 25)

# ============================================================
# 基本模板（2 个，每张模板图一个）：布局蓝图描述。
# 作用：让模型把椭圆当"关卡点停机坪槽位"画克制基底并留空，线当"关卡间路径"。
# ============================================================
BASIC_TEMPLATES = {
    "start_base": (
        "这是一张游戏地图的布局蓝图：白纸上绘制了几个深色椭圆、连接它们的细线，以及一个特别标注的 START 起始点。"
        "请严格按照这张蓝图的结构生成地图，理解并实现以下设定：每个深色椭圆是一个「关卡点底座槽位」——它就像飞船的停机坪，"
        "是为后续叠加具体关卡点素材（图标、雕塑、徽章等）而预留的空旷底座。因此，你要在每个椭圆位置画一个简单、克制、"
        "平整的基底平台，轮廓贴合椭圆，平台表面必须保持干净、空无一物，千万不要添加具体装饰物或多余细节，留出这块空白。"
        "特别注意：标记了 START 的第一个椭圆是「起点停机坪」，它在逻辑上是旅程的开始，你需要将它画得比普通关卡点底座"
        "更加气派、豪华、有仪式感（例如拥有更厚重的金属包边、额外的同心底座环、或特殊的底层基石结构），但它的平台表面"
        "依然要保持空旷干净以供后续放置起点素材。椭圆之间的连线代表关卡之间的连接路径——这是关卡间通行的抽象表达，"
        "不需要死板地画成水泥路或石子路，可以用任何符合场景逻辑的载体（例如浮空光带、能量导轨、水流通道、漂浮栈桥等）"
        "来表现这种连接感，只要保证关卡之间的行进逻辑自然清晰即可。整体的视觉风格、配色与材质，按后面的风格描述统一。"
    ),
    "seamless_loop": (
        "这是一张游戏地图的布局蓝图，且是一张「纵向无缝拼图块」，会被上下循环拼接以延伸更长的地图。"
        "白纸上绘制了几个深色椭圆和连接它们的细线。请严格按照蓝图构图：每个深色椭圆是一个「关卡点底座槽位」——它像停机坪，"
        "是预留给关卡点素材（图标、雕塑等）的空座，所以你要在每个椭圆位置画一个简单、克制、平整的基底平台，"
        "轮廓贴合椭圆，表面保持干净空旷，不要添加任何具体装饰，为后续关卡点素材留空。椭圆之间的连线是关卡间通行的路径，"
        "不需要画成具体的路，可以用任何符合逻辑的载体形式（如光带、能量桥、传送轨道等）来表达，只要行进的逻辑方向清晰。"
        "整张地图的风格、材质与配色按后面的风格描述统一。由于这是纵向无缝图块，画面顶部边缘和底部边缘（包括地貌、路径衔接、海面）"
        "必须完美契合，使图块上下连续堆叠拼接时毫无拼缝痕迹。"
    ),
}

# 风格继承：seamless_loop 带着第一张生成图时追加
STYLE_CARRYOVER = (
    " 参考第一张已生成的图的配色、光照与材质风格，让这张图与它是同一个世界的延续。"
)

# ============================================================
# 风格模板池（2n 个，可轮换）：背景设定 + 关卡点/连接/起始点身份。
# ============================================================
STYLE_POOL = [
    {
        "name": "underwater-castle",
        "label": "水下城堡",
        "background": "一座沉没在深海的幻想城堡：幽蓝到深青的海水渐变，漂浮着珊瑚礁、气泡与透进海面的光柱，海床隐约可见。",
        "level": "城堡中一座座独立的塔楼/殿厅石台，青苔珊瑚点缀但表面空旷。",
        "connection": "连接塔楼之间的发光水流通道或珊瑚石桥。",
        "start": "城堡正门的海底洞窟入口。",
    },
    {
        "name": "sea-islands",
        "label": "海上群岛",
        "background": "碧蓝海面上星罗棋布的群岛：明亮的海天交界，晨雾与远处小岛剪影，帆影点点。",
        "level": "每座小岛上的木质栈桥码头，简短克制。",
        "connection": "岛与岛之间的海上航线，用泛着微光的航迹线/船道表示。",
        "start": "主岛港湾的出发点。",
    },
    {
        "name": "space-frontier",
        "label": "星际探索",
        "background": "深邃太空中的前哨站群：暗蓝到墨黑的星海，散布星云、星环与远处星球。",
        "level": "一个个金属对接平台/空间站泊位，简洁的金属结构，像停机坪。",
        "connection": "飞船的航线光带或能量轨道。",
        "start": "出发港空间站。",
    },
    {
        "name": "sky-isles",
        "label": "天空浮岛",
        "background": "云海之上的浮空岛屿群：通透的晨空，厚积云层，金色与淡紫的天光。",
        "level": "每座浮岛中央的古老石台，苔痕斑驳但表面平整。",
        "connection": "岛屿之间悬挂的藤桥/风化的索桥或飞鸟航线。",
        "start": "最大的主岛上的登岛平台。",
    },
]

# 生图 CLI 脚本路径：优先读环境变量 IMAGEGEN_SCRIPT，否则回退到 PATH 上的 `imagegen` 命令。
DEFAULT_GEN_SCRIPT = os.environ.get(
    "IMAGEGEN_SCRIPT",
    "imagegen"
)

# 代理端口：优先读环境变量 PROXY_PORT_A/PROXY_PORT_B，否则用默认占位端口。
# 用法：export PROXY_PORT_A=7890 PROXY_PORT_B=7897
PROXY_PORTS = [
    int(os.environ.get("PROXY_PORT_A", "7890")),
    int(os.environ.get("PROXY_PORT_B", "7897")),
]

# 生成顺序：start_base 先出，seamless_loop 吃它的风格
MAP_ORDER = ["start_base", "seamless_loop"]


def find_mono_font(size):
    candidates = [
        r"C:\Windows\Fonts\consola.ttf",
        r"C:\Windows\Fonts\cour.ttf",
        r"C:\Windows\Fonts\lucon.ttf",
        "consola.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def detect_proxy():
    """遵循全局代理约定：优先 A 端口，B 端口兜底（可用环境变量配置）。"""
    for port in PROXY_PORTS:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return f"http://127.0.0.1:{port}"
        except OSError:
            continue
    return None


def draw_control_map(nodes, links=None, start_marker=None, routes=True, labels=True):
    """画 768×1376 白纸控制图（模板图），返回 PIL Image。"""
    img = Image.new("RGB", (CONTROL_W, CONTROL_H), BG_COLOR)
    d = ImageDraw.Draw(img)
    font = find_mono_font(26)
    start_font = find_mono_font(int(start_marker.get("size_px", 28)) if start_marker else 28)

    def px(x):
        return x / 100 * CONTROL_W

    def py(y):
        return y / 100 * CONTROL_H

    # 创建 ID 到节点的快速映射，方便连线和查找属性
    node_map = {n["id"]: n for n in nodes}
    sorted_nodes = sorted(nodes, key=lambda n: n["id"])

    # 路线连线
    if routes:
        if links and len(links) > 0:
            # 依照指定的有向/无向边连线
            for edge in links:
                if len(edge) == 2 and edge[0] in node_map and edge[1] in node_map:
                    n1, n2 = node_map[edge[0]], node_map[edge[1]]
                    d.line(
                        [(px(n1["x"]), py(n1["y"])), (px(n2["x"]), py(n2["y"]))],
                        fill=ROUTE_COLOR,
                        width=2,
                        joint="curve"
                    )
        elif len(sorted_nodes) >= 2:
            # 回退：按 ID 顺序连线
            pts = [(px(n["x"]), py(n["y"])) for n in sorted_nodes]
            d.line(pts, fill=ROUTE_COLOR, width=2, joint="curve")

    # 绘制 START 标识文字
    if start_marker and start_marker.get("text"):
        d.text(
            (px(start_marker["x"]), py(start_marker["y"])),
            start_marker["text"],
            font=start_font,
            fill=LABEL_COLOR,
            anchor="mm"
        )

    # 椭圆轮廓 + 序号
    for n in sorted_nodes:
        cxv, cyv = px(n["x"]), py(n["y"])
        rx, ry = n["w"] / 2, n["h"] / 2
        is_start = n.get("is_start", False)

        if is_start:
            # 起点平台：描边更粗（width=6），并且外侧加画一圈稍大的同心底座环来提示豪华底座
            d.ellipse((cxv - rx - 10, cyv - ry - 8, cxv + rx + 10, cyv + ry + 8), outline=ELLIPSE_COLOR, width=2)
            d.ellipse((cxv - rx, cyv - ry, cxv + rx, cyv + ry), outline=ELLIPSE_COLOR, width=6)
        else:
            d.ellipse((cxv - rx, cyv - ry, cxv + rx, cyv + ry), outline=ELLIPSE_COLOR, width=3)

        if labels:
            d.text((cxv, cyv), str(n["label"]), font=font, fill=LABEL_COLOR, anchor="mm")

    return img


def build_prompt(map_id, style_entry, prev_style_path):
    """合成 prompt = 基本模板 + 风格模板 (+ 风格继承)。"""
    basic = BASIC_TEMPLATES[map_id]
    style = (
        f"风格设定——背景：{style_entry['background']} "
        f"关卡点基底的身份：{style_entry['level']} "
        f"连接路径的身份：{style_entry['connection']} "
        f"起始点入口的身份：{style_entry['start']} "
        f"整体基调、配色与材质按此风格统一。"
    )
    prompt = basic + " " + style
    if map_id == "seamless_loop" and prev_style_path:
        prompt += STYLE_CARRYOVER
    return prompt


def run_img2img(control_path, out_path, prompt, size, proxy, style_paths=None):
    """调 imagegen CLI 图生图：--image 主模板图，--style 风格参考图（可多个）。"""
    cmd = [
        sys.executable,
        DEFAULT_GEN_SCRIPT,
        "--user", "user3",
        "--image", control_path,
    ]
    for s in (style_paths or []):
        cmd += ["--style", s]
    cmd += [size, out_path, prompt]

    print(f"  [img2img] 生成中...  (风格参考: {style_paths or '无'})")
    result = subprocess.run(cmd, env=dict(os.environ), capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in result.stdout.splitlines():
        print(f"    | {line}")
    if result.returncode != 0:
        print(f"    [x] 失败（exit {result.returncode}）")
        if result.stderr:
            print(result.stderr[-800:])
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="地图生图后端管线（基本模板 + 风格模板池）")
    parser.add_argument("--record", default=os.path.join(os.path.dirname(__file__), "..", "src", "data", "map_nodes.json"))
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "pipeline_output"))
    parser.add_argument("--style-idx", type=int, default=0, help="风格模板池下标（默认 0）")
    parser.add_argument("--list-styles", action="store_true", help="列出风格模板池后退出")
    parser.add_argument("--size", default="9:16", help="输出比例（默认 9:16 匹配 768×1376）")
    parser.add_argument("--no-generate", action="store_true", help="只出模板图，不调 API")
    args = parser.parse_args()

    if args.list_styles:
        for i, s in enumerate(STYLE_POOL):
            print(f"[{i}] {s['name']} ({s['label']})")
        return

    if not 0 <= args.style_idx < len(STYLE_POOL):
        print(f"[!] --style-idx 越界（共 {len(STYLE_POOL)} 套）：{args.style_idx}")
        sys.exit(1)
    style_entry = STYLE_POOL[args.style_idx]
    print(f"[*] 风格模板: [{args.style_idx}] {style_entry['name']} ({style_entry['label']})")

    record_path = os.path.abspath(args.record)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    with open(record_path, "r", encoding="utf-8") as f:
        record = json.load(f)

    proxy = detect_proxy() if not args.no_generate else None
    if not args.no_generate and not proxy:
        print("[!] 未探测到代理（可用 PROXY_PORT_A/PROXY_PORT_B 配置）。按约定需走代理，已跳过 img2img，只出模板图。")
        args.no_generate = True

    ok = True
    prev_style_path = None  # 上一张生成图 → 下一张的风格参考

    for map_id in MAP_ORDER:
        m = record["maps"].get(map_id)
        if not m:
            print(f"[!] 记录中缺少 map: {map_id}")
            ok = False
            continue

        control_path = os.path.join(out_dir, f"control_map_{map_id}.png")
        print(f"\n=== {m['label']} ({map_id}) ===")
        draw_control_map(
            m["nodes"],
            links=m.get("links"),
            start_marker=m.get("start_marker")
        ).save(control_path, "PNG")
        kb = os.path.getsize(control_path) / 1024
        print(f"  [模板图] {control_path}  ({CONTROL_W}x{CONTROL_H}, {kb:.0f} KB)")

        if args.no_generate:
            continue

        prompt = build_prompt(map_id, style_entry, prev_style_path)
        out_path = os.path.join(out_dir, f"map_{map_id}_v3.png")
        style_paths = [prev_style_path] if (map_id == "seamless_loop" and prev_style_path) else None
        print(f"  [img2img] 提示词片段: {prompt[:90]}...")

        if not run_img2img(control_path, out_path, prompt, args.size, proxy, style_paths=style_paths):
            ok = False
        elif os.path.exists(out_path):
            gkb = os.path.getsize(out_path) / 1024
            print(f"  [+] 生成成功: {out_path}  ({gkb:.0f} KB)")
            prev_style_path = out_path  # 供下一张做风格参考

    print("\n完成。" + ("" if ok else " 部分 img2img 失败，见上。"))
    print(f"输出目录: {out_dir}")


if __name__ == "__main__":
    main()
