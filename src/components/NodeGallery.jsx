import React from 'react';
import { ArrowLeft, MousePointerClick } from 'lucide-react';
import MapNode from './MapNode';

const STATUSES = [
  { id: 'mastered', name: '已精通' },
  { id: 'passed', name: '已通过' },
  { id: 'current', name: '当前' },
  { id: 'locked', name: '锁定' },
  { id: 'boss', name: 'BOSS' },
];

export default function NodeGallery() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
        <span className="text-sm font-bold flex items-center gap-2">
          <span className="text-cyan-400">◇</span> 关卡点节点 · 椭圆样式 × 5 状态
        </span>
        <a
          href="#/"
          className="px-3 py-1 bg-slate-800 text-slate-200 rounded-lg font-bold text-xs hover:bg-slate-700 transition-colors flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 返回地图预览
        </a>
      </div>

      <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800/60 text-[11px] text-slate-400 flex items-center gap-2">
        <MousePointerClick size={13} className="text-cyan-400" />
        在任意节点上按住 = 「按下」下沉，松开 = 「起立」回弹。节点约束为椭圆样式。
      </div>

      <div className="flex-1 p-4 flex flex-wrap gap-6 justify-center items-start">
        {STATUSES.map((s) => (
          <div key={s.id} className="flex flex-col items-center gap-2">
            <MapNode
              uid={`node-${s.id}`}
              label={s.id === 'boss' || s.id === 'locked' ? '' : '5'}
              title={s.name}
              status={s.id}
              width={112}
              height={78}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
