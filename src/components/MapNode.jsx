import React, { useState } from 'react';

// —— 关卡点节点设计（约束：必须是椭圆样式）——
// 节点以椭圆为唯一基础形状（与打点工具的椭圆标注严格对应，中心坐标不漂移）。
// 按下顶面下沉、松开 overshoot 回弹（按下/起立），形状中心始终等于椭圆中心。

const THEMES = {
  mastered: {
    halo: 'rgba(251,191,36,0.30)',
    bodyTop: '#fcd34d',
    bodyBottom: '#b45309',
    ring: '#fbbf24',
    ringWidth: 1.5,
    core: '#451a03',
    coreStroke: '#fde68a',
    text: '#fffbeb',
    led: '#fbbf24',
    pillBorder: 'border-amber-500/50',
    pillDot: 'bg-amber-400',
  },
  passed: {
    halo: 'rgba(34,211,238,0.28)',
    bodyTop: '#22d3ee',
    bodyBottom: '#0e7490',
    ring: '#67e8f9',
    ringWidth: 1.5,
    core: '#083344',
    coreStroke: '#67e8f9',
    text: '#cffafe',
    led: '#22d3ee',
    pillBorder: 'border-cyan-500/50',
    pillDot: 'bg-cyan-400',
  },
  current: {
    halo: 'rgba(103,232,249,0.45)',
    bodyTop: '#67e8f9',
    bodyBottom: '#0891b2',
    ring: '#ffffff',
    ringWidth: 2,
    core: '#083344',
    coreStroke: '#ffffff',
    text: '#ecfeff',
    led: '#a5f3fc',
    pillBorder: 'border-cyan-300/70',
    pillDot: 'bg-cyan-300',
  },
  locked: {
    halo: 'rgba(100,116,139,0.18)',
    bodyTop: '#334155',
    bodyBottom: '#0f172a',
    ring: '#475569',
    ringWidth: 1.5,
    core: '#020617',
    coreStroke: '#475569',
    text: '#64748b',
    led: '#334155',
    pillBorder: 'border-slate-700/60',
    pillDot: 'bg-slate-600',
  },
  boss: {
    halo: 'rgba(244,63,94,0.38)',
    bodyTop: '#fb7185',
    bodyBottom: '#9f1239',
    ring: '#fda4af',
    ringWidth: 2,
    core: '#4c0519',
    coreStroke: '#fda4af',
    text: '#ffe4e6',
    led: '#fb7185',
    pillBorder: 'border-rose-500/60',
    pillDot: 'bg-rose-400',
  },
};

// 弹簧过冲曲线：松开时 transform 回弹（起立 bounce）
const SPRING = { transition: 'transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)' };
const FADE = { transition: 'opacity 0.22s ease' };

// 按下 / 起立：按住下沉，松开回弹。stopPropagation 避免触发地图拖动滚动。
function usePress() {
  const [pressed, setPressed] = useState(false);
  return {
    pressed,
    handlers: {
      onPointerDown: (e) => { e.stopPropagation(); setPressed(true); },
      onPointerUp: () => setPressed(false),
      onPointerLeave: () => setPressed(false),
      onPointerCancel: () => setPressed(false),
    },
  };
}

function renderContent(t, isLocked, isBoss, label, cx, cy, fs) {
  if (isLocked) {
    return (
      <g transform={`translate(${cx - 5}, ${cy - 5})`}>
        <rect x="1.5" y="4.5" width="7" height="5.5" rx="1.5" fill="none" stroke={t.text} strokeWidth="1.4" />
        <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" fill="none" stroke={t.text} strokeWidth="1.4" />
      </g>
    );
  }
  if (isBoss) {
    return (
      <g transform={`translate(${cx - 7}, ${cy - 6.5})`}>
        <path d="M1.5 10.5 V3.5 L5.2 7 L7 2.6 L8.8 7 L12.5 3.5 V10.5 Z" fill={t.text} opacity="0.95" />
        <rect x="5" y="11.2" width="4" height="1.3" rx="0.65" fill={t.text} opacity="0.8" />
      </g>
    );
  }
  return (
    <text
      x={cx}
      y={cy}
      dominantBaseline="central"
      textAnchor="middle"
      fill={t.text}
      fontSize={fs}
      fontWeight="900"
      fontFamily="monospace"
    >
      {label}
    </text>
  );
}

/* 全息踏板（椭圆底座）：挤出式踏板 —— 侧壁 + 渐变顶面 + 玻璃高光 + 扫描线 + LED */
function PedestalVariant({ t, w, h, cx, cy, rx, ry, gradId, content, pressed, pulseClass, is_start }) {
  const wall = h * 0.075;
  const faceStyle = {
    ...SPRING,
    transform: `translateY(${pressed ? wall * 1.6 : 0}px) scale(${pressed ? 0.97 : 1})`,
    transformBox: 'fill-box',
    transformOrigin: 'center',
  };
  return (
    <g>
      {/* 投影底座（椭圆，悬浮深度） */}
      <ellipse cx={cx} cy={cy + h * 0.11} rx={rx * 1.12} ry={ry * 1.18} fill="rgba(2,6,23,0.55)" />
      {/* 光晕（椭圆，current 呼吸） */}
      <ellipse className={pulseClass} cx={cx} cy={cy} rx={rx * 1.14} ry={ry * 1.18} fill={t.halo} opacity={pressed ? 0.4 : 1} style={FADE} />
      {/* 起点特有的额外外侧同心轨饰圈 */}
      {is_start && (
        <ellipse cx={cx} cy={cy} rx={rx * 1.25} ry={ry * 1.25} fill="none" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="3 4" opacity="0.8" />
      )}
      {/* 挤出侧壁（椭圆） */}
      <ellipse cx={cx} cy={cy + wall} rx={rx * 0.96} ry={ry * 0.9} fill={t.core} />
      {/* 顶面（椭圆，按下时沉入） */}
      <g style={faceStyle}>
        <ellipse cx={cx} cy={cy} rx={rx * 0.9} ry={ry * 0.84} fill={`url(#${gradId})`} />
        {/* 起点描边加粗，金边高亮 */}
        <ellipse cx={cx} cy={cy} rx={rx * 0.9} ry={ry * 0.84} fill="none" stroke={is_start ? "#f59e0b" : t.ring} strokeWidth={is_start ? 2.5 : 1.2} opacity={0.9} />
        <ellipse cx={cx} cy={cy - h * 0.14} rx={rx * 0.62} ry={ry * 0.34} fill="rgba(255,255,255,0.22)" />
        <line x1={cx - rx * 0.68} x2={cx + rx * 0.68} y1={cy + ry * 0.24} y2={cy + ry * 0.24} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <ellipse cx={cx} cy={cy} rx={rx * 0.56} ry={ry * 0.56} fill={t.core} stroke={is_start ? "#f59e0b" : t.coreStroke} strokeWidth={is_start ? 1.8 : 1.3} />
        {content}
        <circle cx={cx + rx * 0.76} cy={cy - ry * 0.68} r={Math.max(1.6, w * 0.018)} fill={is_start ? "#fbbf24" : t.led} />
      </g>
    </g>
  );
}

// 字号
const FS_RATIO = 0.34;

export default function MapNode({
  uid,
  label,
  title,
  status = 'locked',
  width,
  height,
  is_start = false,
}) {
  const t = THEMES[status] || THEMES.locked;
  const w = width;
  const h = height;
  const cx = w / 2;
  const cy = h / 2;
  const rx = (w - 2) / 2;
  const ry = (h - 2) / 2;
  const gradId = `nbody-${uid}`;
  const isCurrent = status === 'current';
  const isBoss = status === 'boss';
  const isLocked = status === 'locked';
  const fs = Math.round(h * FS_RATIO);
  const { pressed, handlers } = usePress();
  const pulseClass = isCurrent ? 'animate-pulse' : '';
  const content = renderContent(t, isLocked, isBoss, label, cx, cy, fs);

  return (
    <div className="flex flex-col items-center cursor-pointer" {...handlers}>
      <div className="relative flex-shrink-0" style={{ width: w, height: h, overflow: 'visible' }}>
        <svg
          width={w}
          height={h}
          className="overflow-visible"
          style={{ width: w, height: h }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={t.bodyTop} />
              <stop offset="100%" stopColor={t.bodyBottom} />
            </linearGradient>
          </defs>
          <PedestalVariant
            t={t}
            w={w}
            h={h}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            gradId={gradId}
            content={content}
            pressed={pressed}
            pulseClass={pulseClass}
            is_start={is_start}
          />
        </svg>
      </div>

      {/* title pill */}
      <div
        className={`mt-1.5 whitespace-nowrap px-1.5 py-0.5 rounded-full bg-slate-900/90 border text-[8px] font-medium text-slate-200 shadow-md flex items-center gap-1 ${t.pillBorder}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${t.pillDot}`} />
        {title}
      </div>
    </div>
  );
}
