import React, { useState, useRef, useEffect } from 'react';
import { Map, Crosshair } from 'lucide-react';
import MapNode from './components/MapNode';
import mapNodes from './data/map_nodes.json';

// Background map sets — v2 = 当前线上赛博风, v3 = 后端流水线新生成
const BG_SETS = {
  v2: {
    label: 'v2 当前',
    seamless: '/assets/map_v7_seamless_digital_v2.png',
    base: '/assets/map_start_base_digital_v2.png',
  },
  v3: {
    label: 'v3 新生成',
    seamless: '/assets/map_v7_seamless_digital_v3.png',
    base: '/assets/map_start_base_digital_v3.png',
  },
};

export default function App() {
  const viewportRef = useRef(null);
  const [viewportSize, setViewportSize] = useState({ width: 380, height: 596 });
  const [bgVariant, setBgVariant] = useState('v2');

  // Pure scroll momentum offset
  const [mapOffsetY, setMapOffsetY] = useState(-1444);
  const isDraggingMapRef = useRef(false);
  const dragStartYRef = useRef(0);
  const initialOffsetRef = useRef(0);
  const recentPointsRef = useRef([]);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    if (!viewportRef.current) return;
    const updateSize = () => {
      if (viewportRef.current) {
        setViewportSize({
          width: viewportRef.current.clientWidth,
          height: viewportRef.current.clientHeight
        });
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(viewportRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  const viewWidth = viewportSize.width;
  const viewHeight = viewportSize.height;

  const TILE_HEIGHT = viewWidth * 1376 / 768;
  const MAP_TOTAL_HEIGHT = TILE_HEIGHT * 3;

  const minScroll = viewHeight - MAP_TOTAL_HEIGHT;
  const maxScroll = -84 * TILE_HEIGHT / 680;

  // Initialize offset once dimensions are measured
  useEffect(() => {
    setMapOffsetY(viewHeight - MAP_TOTAL_HEIGHT);
  }, [viewHeight, TILE_HEIGHT]);

  const { start_base, seamless_loop } = mapNodes.maps;

  const startBaseNodes = start_base.nodes.map(node => ({
    ...node,
    absoluteTop: TILE_HEIGHT * 2 + ((node.y + start_base.offset.y) / 100) * TILE_HEIGHT,
    absoluteLeft: node.x + start_base.offset.x
  }));

  const middleSeamlessNodes = seamless_loop.nodes.map(node => ({
    ...node,
    absoluteTop: TILE_HEIGHT + ((node.y + seamless_loop.offset.y) / 100) * TILE_HEIGHT,
    absoluteLeft: node.x + seamless_loop.offset.x
  }));

  const topSeamlessNodes = seamless_loop.nodes.map(node => ({
    ...node,
    id: node.id + 4,
    label: `${node.id + 4}`,
    title: node.id === 4 ? "⑪ 最终 BOSS" : `⑧ 进阶练习`,
    status: node.id === 4 ? "boss" : "locked",
    absoluteTop: ((node.y + seamless_loop.offset.y) / 100) * TILE_HEIGHT,
    absoluteLeft: node.x + seamless_loop.offset.x
  }));

  const allMapNodes = [...startBaseNodes, ...middleSeamlessNodes, ...topSeamlessNodes];
  const nodeMap = Object.fromEntries(allMapNodes.map(n => [n.id, n]));

  // Combine links across sections
  const allMapLinks = [];
  if (start_base.links) {
    allMapLinks.push(...start_base.links);
  }
  if (seamless_loop.links) {
    allMapLinks.push(...seamless_loop.links);
    allMapLinks.push(...seamless_loop.links.map(edge => [edge[0] + 4, edge[1] + 4]));
  }
  // Bridge sections
  if (nodeMap[3] && nodeMap[4]) {
    allMapLinks.push([3, 4]);
  }
  if (nodeMap[7] && nodeMap[8]) {
    allMapLinks.push([7, 8]);
  }

  // Calculate START marker pixel positions
  const startMarkerPixel = start_base.start_marker ? {
    text: start_base.start_marker.text,
    x: (start_base.start_marker.x / 100) * viewWidth,
    y: TILE_HEIGHT * 2 + ((start_base.start_marker.y) / 100) * TILE_HEIGHT,
    size_px: start_base.start_marker.size_px * (viewWidth / 768)
  } : null;

  const handleMapPointerDown = (e) => {
    isDraggingMapRef.current = true;
    dragStartYRef.current = e.clientY;
    initialOffsetRef.current = mapOffsetY;
    recentPointsRef.current = [{ y: e.clientY, time: Date.now() }];

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };

  const handleMapPointerMove = (e) => {
    if (!isDraggingMapRef.current) return;
    const deltaY = e.clientY - dragStartYRef.current;
    let targetOffset = initialOffsetRef.current + deltaY;

    if (targetOffset < minScroll) {
      targetOffset = minScroll;
    } else if (targetOffset > maxScroll) {
      targetOffset = maxScroll;
    }

    setMapOffsetY(targetOffset);

    const now = Date.now();
    recentPointsRef.current.push({ y: e.clientY, time: now });
    if (recentPointsRef.current.length > 5) {
      recentPointsRef.current.shift();
    }
  };

  const handleMapPointerUp = () => {
    isDraggingMapRef.current = false;

    const pts = recentPointsRef.current;
    if (pts.length < 2) {
      return;
    }

    const first = pts[0];
    const last = pts[pts.length - 1];
    const dt = last.time - first.time;
    if (dt <= 0) return;

    let velocity = (last.y - first.y) / dt;
    velocity = Math.min(Math.max(velocity, -2.5), 2.5);

    if (Math.abs(velocity) < 0.15) {
      return;
    }

    // Smooth inertia decay scroll
    let currentY = mapOffsetY;
    let friction = 0.95;
    let scaledVelocity = velocity * 16;

    const stepMomentum = () => {
      currentY += scaledVelocity;
      scaledVelocity *= friction;

      if (currentY < minScroll) {
        currentY = minScroll;
        scaledVelocity = 0;
      } else if (currentY > maxScroll) {
        currentY = maxScroll;
        scaledVelocity = 0;
      }

      setMapOffsetY(currentY);

      if (Math.abs(scaledVelocity) > 0.15) {
        animationFrameRef.current = requestAnimationFrame(stepMomentum);
      }
    };

    animationFrameRef.current = requestAnimationFrame(stepMomentum);
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top toolbar */}
      <div className="relative z-20 px-4 py-2.5 bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
          <Map size={14} className="text-cyan-400" /> W1 浅海群岛 · 无缝拼图预览
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {/* 背景图集切换 */}
          <div className="flex items-center gap-0.5 bg-slate-950/60 border border-slate-800 rounded-lg p-0.5">
            {Object.keys(BG_SETS).map((k) => (
              <button
                key={k}
                onClick={() => setBgVariant(k)}
                title={`背景图集：${BG_SETS[k].label}`}
                className={`px-2 py-1 rounded-md text-[10px] transition-all cursor-pointer ${
                  bgVariant === k ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {BG_SETS[k].label}
              </button>
            ))}
          </div>
          <span className="text-[9px] text-slate-400 font-mono bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">
            X:-0.4% Y:1.2%
          </span>
          <a
            href="#/annotator"
            className="px-3 py-1.5 bg-cyan-500 text-slate-950 rounded-lg font-bold text-[11px] hover:bg-cyan-400 transition-colors flex items-center gap-1"
          >
            <Crosshair size={12} /> 打开打点工具
          </a>
        </div>
      </div>

      {/* Map viewport (capped width keeps 768px base fidelity on large screens) */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden bg-slate-950 w-full max-w-[768px] mx-auto"
      >
        <div
          onPointerDown={handleMapPointerDown}
          onPointerMove={handleMapPointerMove}
          onPointerUp={handleMapPointerUp}
          onPointerCancel={handleMapPointerUp}
          className="w-full h-full relative cursor-grab active:cursor-grabbing touch-none select-none overflow-hidden"
        >
          {/* Scrollable canvas wrapper */}
          <div
            className="absolute left-0 w-full"
            style={{
              height: `${MAP_TOTAL_HEIGHT}px`,
              transform: `translateY(${mapOffsetY}px)`,
              transition: 'none',
            }}
          >
            {/* Top Map slice */}
            <div
              className="absolute top-0 left-0 w-full bg-fill"
              style={{
                height: `${TILE_HEIGHT}px`,
                backgroundImage: `url("${BG_SETS[bgVariant].seamless}")`,
                backgroundSize: '100% 100%'
              }}
            />
            {/* Middle Map slice */}
            <div
              className="absolute left-0 w-full bg-fill"
              style={{
                top: `${TILE_HEIGHT}px`,
                height: `${TILE_HEIGHT}px`,
                backgroundImage: `url("${BG_SETS[bgVariant].seamless}")`,
                backgroundSize: '100% 100%'
              }}
            />
            {/* Bottom Map slice */}
            <div
              className="absolute left-0 w-full bg-fill"
              style={{
                top: `${TILE_HEIGHT * 2}px`,
                height: `${TILE_HEIGHT}px`,
                backgroundImage: `url("${BG_SETS[bgVariant].base}")`,
                backgroundSize: '100% 100%'
              }}
            />

            {/* SVG Link lines + START overlay */}
            <svg
              className="absolute inset-0 w-full pointer-events-none z-0"
              style={{ height: `${MAP_TOTAL_HEIGHT}px` }}
            >
              {allMapLinks.map((edge, idx) => {
                const n1 = nodeMap[edge[0]];
                const n2 = nodeMap[edge[1]];
                if (!n1 || !n2) return null;

                const cx1 = (n1.absoluteLeft / 100) * viewWidth;
                const cy1 = n1.absoluteTop;
                const cx2 = (n2.absoluteLeft / 100) * viewWidth;
                const cy2 = n2.absoluteTop;

                return (
                  <line
                    key={idx}
                    x1={cx1}
                    y1={cy1}
                    x2={cx2}
                    y2={cy2}
                    stroke="rgba(14,165,233,0.55)"
                    strokeWidth="3"
                    strokeDasharray="4 6"
                  />
                );
              })}

              {startMarkerPixel && (
                <text
                  x={startMarkerPixel.x}
                  y={startMarkerPixel.y}
                  fill="#38bdf8"
                  fontSize={startMarkerPixel.size_px}
                  fontWeight="900"
                  fontFamily="monospace"
                  textAnchor="middle"
                  opacity="0.85"
                  className="animate-pulse"
                >
                  {startMarkerPixel.text}
                </text>
              )}
            </svg>

            {/* Glowing Ocean Current highlights to blend seam color differences */}
            <div
              className="absolute left-0 w-full h-[12px] bg-cyan-400/20 blur-[5px] pointer-events-none z-10"
              style={{ top: `${TILE_HEIGHT * 2 - 6}px` }}
            />
            <div
              className="absolute left-0 w-full h-[12px] bg-cyan-400/20 blur-[5px] pointer-events-none z-10"
              style={{ top: `${TILE_HEIGHT - 6}px` }}
            />

            {/* Nodes list */}
            {allMapNodes.map((node, index) => {
              const scaleFactor = viewWidth / 768;
              const nodeWidth = node.w * scaleFactor;
              const nodeHeight = node.h * scaleFactor;

              return (
                <div
                  key={index}
                  className="absolute pointer-events-auto transition-transform hover:scale-105 cursor-pointer z-10"
                  style={{
                    top: `${node.absoluteTop}px`,
                    left: `${node.absoluteLeft}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                >
                  <MapNode
                    uid={index}
                    label={node.label}
                    title={node.title}
                    status={node.status}
                    width={nodeWidth}
                    height={nodeHeight}
                    is_start={!!node.is_start}
                  />
                </div>
              );
            })}
          </div>

          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900/80 border border-cyan-500/40 text-[9px] text-cyan-300 font-bold shadow-lg z-25 tracking-wide">
            ↕ 自由滑动 (无吸附)
          </div>
        </div>
      </div>
    </div>
  );
}
