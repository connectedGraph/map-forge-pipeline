import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, Trash2, Copy, Check, Sliders, Settings, Link2, Plus, Play } from 'lucide-react';
import mapNodes from '../data/map_nodes.json';

const CONTROL_W = 768;
const CONTROL_H = 1376;

// Render current annotations onto a blank control map (白底 + 深色椭圆轮廓),
// matching the img2img "干净控制图 v1" spec.
function drawControlMap(ctx, width, height, nodes, links, startMarker, { routes, labels }) {
  const sx = width / CONTROL_W;
  const sy = height / CONTROL_H;
  const px = (x) => (x / 100) * CONTROL_W * sx;
  const py = (y) => (y / 100) * CONTROL_H * sy;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const sorted = [...nodes].sort((a, b) => a.id - b.id);

  // route path from designated links
  if (routes) {
    ctx.strokeStyle = 'rgba(30, 90, 170, 0.6)';
    ctx.lineWidth = Math.max(1.5, 2 * sx);
    if (links && links.length > 0) {
      for (const edge of links) {
        if (edge.length === 2 && nodeMap[edge[0]] && nodeMap[edge[1]]) {
          const n1 = nodeMap[edge[0]];
          const n2 = nodeMap[edge[1]];
          ctx.beginPath();
          ctx.moveTo(px(n1.x), py(n1.y));
          ctx.lineTo(px(n2.x), py(n2.y));
          ctx.stroke();
        }
      }
    } else if (sorted.length >= 2) {
      // Fallback path (node -> node by id order)
      ctx.beginPath();
      ctx.moveTo(px(sorted[0].x), py(sorted[0].y));
      for (let i = 1; i < sorted.length; i++) ctx.lineTo(px(sorted[i].x), py(sorted[i].y));
      ctx.stroke();
    }
  }

  // Draw START marker text
  if (startMarker && startMarker.text) {
    ctx.fillStyle = '#141419';
    ctx.font = `${Math.max(12, Math.round(startMarker.size_px * sy))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(startMarker.text, px(startMarker.x), py(startMarker.y));
  }

  // ellipse outlines + labels
  for (const n of sorted) {
    const cxv = px(n.x);
    const cyv = py(n.y);
    const rxv = (n.w / 2) * sx;
    const ryv = (n.h / 2) * sy;

    ctx.beginPath();
    ctx.ellipse(cxv, cyv, rxv, ryv, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#141419';

    if (n.is_start) {
      // Special start pedestal styling: draw thick stroke + outer ring
      ctx.lineWidth = Math.max(3, 5 * sx);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cxv, cyv, rxv + 10 * sx, ryv + 8 * sy, 0, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, 1.5 * sx);
      ctx.stroke();
    } else {
      ctx.lineWidth = Math.max(2, 2.5 * sx);
      ctx.stroke();
    }

    if (labels) {
      ctx.fillStyle = '#141419';
      ctx.font = `${Math.max(14, Math.round(26 * sy))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n.label), cxv, cyv);
    }
  }
}

function CtrlToggle({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-1 rounded-md border text-[10px] transition-all cursor-pointer ${
        active
          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

export default function MapAnnotator() {
  const mapsList = Object.entries(mapNodes.maps).map(([id, m]) => ({
    id,
    name: `${m.label} (${m.file})`,
    src: `/assets/${m.file}`,
  }));

  const [selectedMapId, setSelectedMapId] = useState('start_base');
  const activeMap = mapsList.find(m => m.id === selectedMapId);

  // Edit modes: 'nodes' (place/size nodes) | 'links' (draw edges node->node)
  const [editMode, setEditMode] = useState('nodes');

  // Node specifications state
  const [annotations, setAnnotations] = useState(() =>
    Object.fromEntries(
      Object.entries(mapNodes.maps).map(([id, m]) => [
        id,
        m.nodes.map(n => ({
          id: n.id,
          label: n.label,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          is_start: !!n.is_start,
          title: n.title || `节点 ${n.label}`,
          status: n.status || "locked",
          stars: n.stars || 0
        })),
      ])
    )
  );

  // Route connections state
  const [mapLinks, setMapLinks] = useState(() =>
    Object.fromEntries(
      Object.entries(mapNodes.maps).map(([id, m]) => [id, m.links || []])
    )
  );

  // Start indicator texts state
  const [startMarkers, setStartMarkers] = useState(() =>
    Object.fromEntries(
      Object.entries(mapNodes.maps).map(([id, m]) => [
        id,
        m.start_marker || { text: "START", x: 50, y: 80, size_px: 28 }
      ])
    )
  );

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [linkStartNodeId, setLinkStartNodeId] = useState(null); // Node selected to start edge in links mode
  const [copied, setCopied] = useState(false);
  const [savedStatus, setSavedStatus] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);

  // Active style template index for generation
  const [activeStyleIdx, setActiveStyleIdx] = useState(0);
  const [generationLogs, setGenerationLogs] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const logConsoleRef = useRef(null);

  // Resizing handle states: 'w' (width resize) | 'h' (height resize) | null
  const [activeResizeMode, setActiveResizeMode] = useState(null);
  const resizeStartValueRef = useRef(0);
  const resizeStartPointerPosRef = useRef(0);

  const mapContainerRef = useRef(null);
  const controlPreviewRef = useRef(null);

  // Global default sizing values for new nodes
  const [globalDefaultW, setGlobalDefaultW] = useState(99);
  const [globalDefaultH, setGlobalDefaultH] = useState(68);

  // Control map export options
  const [controlRoutes, setControlRoutes] = useState(true);
  const [controlLabels, setControlLabels] = useState(true);

  const currentNodes = useMemo(
    () => annotations[selectedMapId] || [],
    [annotations, selectedMapId]
  );

  const currentLinks = useMemo(
    () => mapLinks[selectedMapId] || [],
    [mapLinks, selectedMapId]
  );

  const currentStartMarker = useMemo(
    () => startMarkers[selectedMapId] || { text: "START", x: 50, y: 80, size_px: 28 },
    [startMarkers, selectedMapId]
  );

  const selectedNode = currentNodes.find(n => n.id === selectedNodeId);

  const handleMapChange = (mapId) => {
    setSelectedMapId(mapId);
    setSelectedNodeId(null);
    setLinkStartNodeId(null);
  };

  const handleMapClick = (e) => {
    if (editMode === 'links') {
      setLinkStartNodeId(null);
      return; // Link draws on node clicks, ignore background clicks
    }

    const clickedNode = e.target.closest('.annotator-node');
    if (clickedNode) return;

    const rect = mapContainerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const xPct = parseFloat(((clickX / rect.width) * 100).toFixed(1));
    const yPct = parseFloat(((clickY / rect.height) * 100).toFixed(1));

    const newId = currentNodes.length > 0 ? Math.max(...currentNodes.map(n => n.id)) + 1 : 1;
    const newNode = {
      id: newId,
      label: `${newId}`,
      x: xPct,
      y: yPct,
      w: Math.round(globalDefaultW),
      h: Math.round(globalDefaultH),
      is_start: false,
      title: `节点 ${newId}`,
      status: "locked",
      stars: 0
    };

    setAnnotations(prev => ({
      ...prev,
      [selectedMapId]: [...(prev[selectedMapId] || []), newNode]
    }));
    setSelectedNodeId(newId);
  };

  const handleNodePointerDown = (nodeId, e) => {
    if (e.target.closest('.resize-handle')) return;
    e.stopPropagation();
    e.preventDefault();

    if (editMode === 'links') {
      // Connect nodes logic
      if (linkStartNodeId === null) {
        setLinkStartNodeId(nodeId);
      } else if (linkStartNodeId === nodeId) {
        setLinkStartNodeId(null);
      } else {
        // Toggle link between linkStartNodeId -> nodeId
        const edge = [linkStartNodeId, nodeId];
        setMapLinks(prev => {
          const links = prev[selectedMapId] || [];
          const exists = links.some(l => (l[0] === edge[0] && l[1] === edge[1]));
          const updated = exists
            ? links.filter(l => !(l[0] === edge[0] && l[1] === edge[1]))
            : [...links, edge];
          return { ...prev, [selectedMapId]: updated };
        });
        setLinkStartNodeId(nodeId); // shift focus
      }
      return;
    }

    setActiveDragId(nodeId);
    setSelectedNodeId(nodeId);
    if (e.target.setPointerCapture) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  const handleNodePointerMove = (nodeId, e) => {
    if (activeDragId !== nodeId) return;
    e.stopPropagation();

    const rect = mapContainerRef.current.getBoundingClientRect();
    const dragX = e.clientX - rect.left;
    const dragY = e.clientY - rect.top;

    const xPct = Math.min(Math.max(parseFloat(((dragX / rect.width) * 100).toFixed(1)), 0), 100);
    const yPct = Math.min(Math.max(parseFloat(((dragY / rect.height) * 100).toFixed(1)), 0), 100);

    setAnnotations(prev => ({
      ...prev,
      [selectedMapId]: prev[selectedMapId].map(n =>
        n.id === nodeId ? { ...n, x: xPct, y: yPct } : n
      )
    }));
  };

  const handleNodePointerUp = (nodeId, e) => {
    e.stopPropagation();
    setActiveDragId(null);
    if (e.target.releasePointerCapture) {
      try {
        e.target.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  const handleResizePointerDown = (nodeId, mode, e) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedNodeId(nodeId);
    setActiveResizeMode(mode);

    const node = currentNodes.find(n => n.id === nodeId);
    if (!node) return;

    if (mode === 'w') {
      resizeStartValueRef.current = node.w;
      resizeStartPointerPosRef.current = e.clientX;
    } else if (mode === 'h') {
      resizeStartValueRef.current = node.h;
      resizeStartPointerPosRef.current = e.clientY;
    }

    if (e.target.setPointerCapture) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  const handleResizePointerMove = (nodeId, e) => {
    if (activeResizeMode === null) return;
    e.stopPropagation();

    if (activeResizeMode === 'w') {
      const deltaX = e.clientX - resizeStartPointerPosRef.current;
      const newWidth = Math.round(Math.min(Math.max(resizeStartValueRef.current + deltaX * 2, 20), 250));
      setAnnotations(prev => ({
        ...prev,
        [selectedMapId]: prev[selectedMapId].map(n =>
          n.id === nodeId ? { ...n, w: newWidth } : n
        )
      }));
    } else if (activeResizeMode === 'h') {
      const deltaY = e.clientY - resizeStartPointerPosRef.current;
      const newHeight = Math.round(Math.min(Math.max(resizeStartValueRef.current + deltaY * 2, 10), 150));
      setAnnotations(prev => ({
        ...prev,
        [selectedMapId]: prev[selectedMapId].map(n =>
          n.id === nodeId ? { ...n, h: newHeight } : n
        )
      }));
    }
  };

  const handleResizePointerUp = (nodeId, e) => {
    e.stopPropagation();
    setActiveResizeMode(null);
    if (e.target.releasePointerCapture) {
      try {
        e.target.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  const handleApplyToAll = () => {
    if (!selectedNode) return;
    const { w, h } = selectedNode;
    setAnnotations(prev => ({
      ...prev,
      [selectedMapId]: prev[selectedMapId].map(n => ({
        ...n,
        w: Math.round(w),
        h: Math.round(h)
      }))
    }));
  };

  const handleApplyGlobalDefaultsToAll = () => {
    setAnnotations(prev => ({
      ...prev,
      [selectedMapId]: prev[selectedMapId].map(n => ({
        ...n,
        w: Math.round(globalDefaultW),
        h: Math.round(globalDefaultH)
      }))
    }));
  };

  const handleDeleteNode = (nodeId) => {
    setAnnotations(prev => ({
      ...prev,
      [selectedMapId]: prev[selectedMapId].filter(n => n.id !== nodeId)
    }));
    // Clean up links referencing deleted node
    setMapLinks(prev => ({
      ...prev,
      [selectedMapId]: (prev[selectedMapId] || []).filter(l => l[0] !== nodeId && l[1] !== nodeId)
    }));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    setLinkStartNodeId(null);
  };

  const handleUpdateSelectedNode = (field, value) => {
    if (!selectedNodeId) return;
    setAnnotations(prev => ({
      ...prev,
      [selectedMapId]: prev[selectedMapId].map(n => {
        if (n.id !== selectedNodeId) return n;

        // Start is unique per map
        if (field === 'is_start' && value === true) {
          // Setting this to true means all other nodes in this map will have is_start: false
          setTimeout(() => {
            setAnnotations(curr => ({
              ...curr,
              [selectedMapId]: curr[selectedMapId].map(item =>
                item.id === selectedNodeId ? { ...item, is_start: true } : { ...item, is_start: false }
              )
            }));
          }, 0);
        }
        return { ...n, [field]: value };
      })
    }));
  };

  const handleUpdateStartMarker = (field, value) => {
    setStartMarkers(prev => ({
      ...prev,
      [selectedMapId]: {
        ...prev[selectedMapId],
        [field]: value
      }
    }));
  };

  // Compile full nodes JSON configuration structure
  const compiledFullConfig = useMemo(() => {
    const full = { ...mapNodes };
    Object.keys(full.maps).forEach(mid => {
      const orig = full.maps[mid];
      full.maps[mid] = {
        ...orig,
        start_marker: startMarkers[mid],
        links: mapLinks[mid] || [],
        nodes: annotations[mid] || []
      };
    });
    return full;
  }, [annotations, mapLinks, startMarkers]);

  const handleSaveToBackend = async () => {
    try {
      setSavedStatus('saving');
      const response = await fetch('/api/maps', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(compiledFullConfig)
      });
      if (response.ok) {
        setSavedStatus('success');
        setTimeout(() => setSavedStatus(''), 2000);
      } else {
        throw new Error('Server returned non-200');
      }
    } catch (err) {
      // Fallback: Copy to clipboard if backend not available
      const jsonStr = JSON.stringify(compiledFullConfig, null, 2);
      navigator.clipboard.writeText(jsonStr);
      setSavedStatus('fallback');
      setTimeout(() => setSavedStatus(''), 4000);
    }
  };

  const handleTriggerGeneration = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenerationLogs(`[*] 正在向后端发起生图请求, 请稍候...\n`);

    try {
      // First save the current data so map_pipeline.py reads the latest coordinates
      await handleSaveToBackend();

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ style_idx: activeStyleIdx })
      });

      if (!response.body) {
        throw new Error('No response stream available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        setGenerationLogs(prev => prev + text);
      }
    } catch (err) {
      setGenerationLogs(prev => prev + `\n[x] 运行失败: ${err.message}\n如果是在开发环境, 请先运行 npm run server 后端服务\n`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Scroll generation logs console to bottom automatically
  useEffect(() => {
    if (logConsoleRef.current) {
      logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
    }
  }, [generationLogs]);

  const handleCopyJSON = () => {
    const jsonStr = JSON.stringify(currentNodes, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Live preview of the control map (reuses drawControlMap so it's WYSIWYG)
  useEffect(() => {
    const c = controlPreviewRef.current;
    if (!c) return;
    drawControlMap(c.getContext('2d'), c.width, c.height, currentNodes, currentLinks, currentStartMarker, {
      routes: controlRoutes,
      labels: controlLabels,
    });
  }, [currentNodes, currentLinks, currentStartMarker, controlRoutes, controlLabels]);

  const handleExportControlMap = () => {
    const canvas = document.createElement('canvas');
    canvas.width = CONTROL_W;
    canvas.height = CONTROL_H;
    drawControlMap(canvas.getContext('2d'), CONTROL_W, CONTROL_H, currentNodes, currentLinks, currentStartMarker, {
      routes: controlRoutes,
      labels: controlLabels,
    });
    const link = document.createElement('a');
    link.download = `control_map_${selectedMapId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="flex-1 flex bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Left Sidebar Controller */}
      <aside className="w-80 border-r border-slate-800 bg-slate-900 p-4 flex flex-col justify-between overflow-y-auto flex-shrink-0 z-10">
        <div className="space-y-4">
          {/* Map Select */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">选择标注地图底图:</label>
            <div className="flex flex-col gap-2">
              {mapsList.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleMapChange(m.id)}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold border text-left transition-all ${
                    selectedMapId === m.id
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold shadow-md'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          {/* Edit Mode Selector */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">编辑器模式:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setEditMode('nodes'); setLinkStartNodeId(null); }}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                  editMode === 'nodes'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                🎛 节点与尺寸
              </button>
              <button
                onClick={() => { setEditMode('links'); setSelectedNodeId(null); }}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                  editMode === 'links'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                <Link2 size={13} className="inline mr-1" /> 连接线编辑
              </button>
            </div>
            {editMode === 'links' && (
              <p className="text-[9px] text-cyan-400 mt-1.5 leading-relaxed bg-cyan-950/20 border border-cyan-500/10 p-1.5 rounded-lg">
                提示：点击第一个节点，再点击第二个节点来绘制/取消有向连线。
              </p>
            )}
          </div>

          {/* Global Default Size */}
          {editMode === 'nodes' && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-2">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-1">
                <Sliders size={13} className="text-cyan-400" />
                全局默认椭圆规格
              </h3>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-400">默认宽度 W (px):</span>
                  <input
                    type="number"
                    value={globalDefaultW}
                    onChange={(e) => setGlobalDefaultW(Math.max(10, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
                  />
                </div>
                <div>
                  <span className="text-slate-400">默认高度 H (px):</span>
                  <input
                    type="number"
                    value={globalDefaultH}
                    onChange={(e) => setGlobalDefaultH(Math.max(10, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
                  />
                </div>
              </div>
              <button
                onClick={handleApplyGlobalDefaultsToAll}
                className="w-full py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg border border-slate-700"
              >
                🔄 将该规格覆盖至所有点位
              </button>
            </div>
          )}

          {/* Selected Node Specs */}
          {editMode === 'nodes' && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-1.5">
                <Settings size={13} className="text-cyan-400" />
                选中点属性微调
              </h3>

              {selectedNode ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">标记为起点平台:</span>
                    <input
                      type="checkbox"
                      checked={!!selectedNode.is_start}
                      onChange={(e) => handleUpdateSelectedNode('is_start', e.target.checked)}
                      className="w-4 h-4 cursor-pointer accent-cyan-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[9px] text-slate-400 mb-0.5">
                      <span>标签文本:</span>
                    </div>
                    <input
                      type="text"
                      value={selectedNode.label}
                      onChange={(e) => handleUpdateSelectedNode('label', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 font-mono"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[9px] text-slate-400 mb-0.5">
                      <span>关卡标题:</span>
                    </div>
                    <input
                      type="text"
                      value={selectedNode.title}
                      onChange={(e) => handleUpdateSelectedNode('title', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-slate-400">宽度 W (px):</span>
                      <input
                        type="number"
                        value={selectedNode.w}
                        onChange={(e) => handleUpdateSelectedNode('w', Math.max(10, parseInt(e.target.value) || 0))}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-slate-400">高度 H (px):</span>
                      <input
                        type="number"
                        value={selectedNode.h}
                        onChange={(e) => handleUpdateSelectedNode('h', Math.max(10, parseInt(e.target.value) || 0))}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleApplyToAll}
                    className="w-full py-1 text-[10px] bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-300 font-medium rounded-lg border border-cyan-500/20"
                  >
                    ⚡ 套用此长宽给其他所有点位
                  </button>
                </div>
              ) : (
                <p className="text-[9px] text-slate-500">点击右侧的椭圆即可在此输入数值或套用尺寸。</p>
              )}
            </div>
          )}

          {/* START Marker Positioning Specs */}
          {editMode === 'nodes' && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-2.5">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-1">
                <Play size={13} className="text-cyan-400" />
                START 文字定位 (仅起点图)
              </h3>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-400">横坐标 X (%):</span>
                  <input
                    type="number"
                    step="0.1"
                    value={currentStartMarker.x}
                    onChange={(e) => handleUpdateStartMarker('x', parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <span className="text-slate-400">纵坐标 Y (%):</span>
                  <input
                    type="number"
                    step="0.1"
                    value={currentStartMarker.y}
                    onChange={(e) => handleUpdateStartMarker('y', parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-400">文字大小 (px):</span>
                  <input
                    type="number"
                    value={currentStartMarker.size_px}
                    onChange={(e) => handleUpdateStartMarker('size_px', parseInt(e.target.value) || 12)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <span className="text-slate-400">标志文本:</span>
                  <input
                    type="text"
                    value={currentStartMarker.text}
                    onChange={(e) => handleUpdateStartMarker('text', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Coordinates list */}
          {editMode === 'nodes' && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 mb-1 flex items-center justify-between">
                <span>坐标与规格清单:</span>
                <span className="text-cyan-400 font-mono font-bold">{currentNodes.length} 个点</span>
              </h3>
              <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                {currentNodes.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-655 bg-slate-950/40 rounded-xl border border-slate-800/40">
                    暂无点位，在右侧点击添加
                  </div>
                ) : (
                  currentNodes.map((node) => (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`p-2 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition-all ${
                        selectedNodeId === node.id
                          ? 'bg-cyan-950/30 border-cyan-500/60 shadow shadow-cyan-500/20'
                          : 'bg-slate-950 border-slate-850 hover:border-slate-850'
                      }`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-4 h-4 rounded-full font-bold flex items-center justify-center text-[9px] ${
                            node.is_start ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-cyan-300'
                          }`}>
                            {node.label}
                          </span>
                          <span className="font-mono text-slate-350 text-[10px]">
                            X:{node.x}% Y:{node.y}%
                          </span>
                          {node.is_start && (
                            <span className="text-[7px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 rounded">START</span>
                          )}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono pl-5">
                          W:{Math.round(node.w)}px H:{Math.round(node.h)}px
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNode(node.id);
                        }}
                        className="p-1 text-slate-500 hover:text-rose-450 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Control Map Export */}
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-2">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-1">
              <Download size={13} className="text-cyan-400" />
              控制图导出 (img2img 用)
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              <CtrlToggle active={controlRoutes} onClick={() => setControlRoutes(v => !v)}>路线连线</CtrlToggle>
              <CtrlToggle active={controlLabels} onClick={() => setControlLabels(v => !v)}>序号标注</CtrlToggle>
            </div>
            <canvas
              ref={controlPreviewRef}
              width={192}
              height={344}
              className="w-full rounded-lg border border-slate-800 bg-white"
            />
            <button
              onClick={handleExportControlMap}
              className="w-full py-1.5 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-1"
            >
              <Download size={12} /> 导出控制图 PNG (768×1376)
            </button>
          </div>

          {/* Trigger AI Generate (Node Pipeline) */}
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-2.5">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-1.5">
              <Play size={13} className="text-cyan-400" />
              触发 AI 跑图 (Node)
            </h3>
            <div>
              <label className="text-[9px] text-slate-400 block mb-0.5">选择风格模板:</label>
              <select
                value={activeStyleIdx}
                onChange={(e) => setActiveStyleIdx(parseInt(e.target.value, 10))}
                disabled={isGenerating}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none disabled:opacity-50"
              >
                <option value="0">水下城堡 (underwater-castle)</option>
                <option value="1">海上群岛 (sea-islands)</option>
                <option value="2">星际探索 (space-frontier)</option>
                <option value="3">天空浮岛 (sky-isles)</option>
                <option value="4">沙岩峡谷 (desert-canyon)</option>
                <option value="5">冰封冻土 (frost-tundra)</option>
                <option value="6">炽热火山 (ember-volcano)</option>
                <option value="7">霓虹都市 (neon-city)</option>
              </select>
            </div>

            <button
              onClick={handleTriggerGeneration}
              disabled={isGenerating}
              className="w-full py-1.5 text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-1"
            >
              {isGenerating ? '正在跑图...' : '🚀 开始生成地图 (双图连锁)'}
            </button>

            {generationLogs && (
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[9px] text-slate-400">
                  <span>实时进度日志:</span>
                  <button onClick={() => setGenerationLogs('')} className="text-cyan-400 hover:underline">清空</button>
                </div>
                <pre
                  ref={logConsoleRef}
                  className="font-mono text-[9px] text-slate-300 bg-slate-900 border border-slate-850 p-2 rounded-lg max-h-[140px] overflow-y-auto whitespace-pre-wrap select-text scrollbar-thin"
                >
                  {generationLogs}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="pt-4 border-t border-slate-800 flex flex-col gap-2 shrink-0">
          <button
            onClick={handleSaveToBackend}
            className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5"
          >
            {savedStatus === 'saving' ? (
              <span>保存中...</span>
            ) : savedStatus === 'success' ? (
              <span className="flex items-center gap-1 text-emerald-300"><Check size={14} /> 成功保存至 map_nodes.json</span>
            ) : savedStatus === 'fallback' ? (
              <span className="text-[10px] text-yellow-300">保存失败，JSON 坐标已拷至剪贴板</span>
            ) : (
              <>💾 全量保存布局配置 (Node)</>
            )}
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="flex-1 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 text-xs font-bold transition-all"
            >
              清空
            </button>
            <button
              onClick={handleCopyJSON}
              className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all flex items-center justify-center gap-1"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '已复制' : '复制点 JSON'}
            </button>
          </div>
        </div>
      </aside>

      {/* Right Canvas Area: EXACT 768px x 1376px ORIGINAL RESOLUTION */}
      <main className="flex-1 p-6 bg-slate-950 flex items-center justify-center overflow-auto">
        <div
          ref={mapContainerRef}
          onClick={handleMapClick}
          className="relative border-2 border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden cursor-crosshair select-none bg-slate-900 flex-shrink-0"
          style={{ width: '768px', height: '1376px', minWidth: '768px', minHeight: '1376px' }}
        >
          <img
            src={activeMap.src}
            alt={activeMap.name}
            className="pointer-events-none flex-shrink-0"
            style={{ width: '768px', height: '1376px', minWidth: '768px', minHeight: '1376px', objectFit: 'fill' }}
          />

          {/* Render Route Links using SVG overlay */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
            style={{ width: '768px', height: '1376px' }}
          >
            {/* Draw Links path */}
            {currentLinks.map((edge, idx) => {
              const n1 = currentNodes.find(n => n.id === edge[0]);
              const n2 = currentNodes.find(n => n.id === edge[1]);
              if (!n1 || !n2) return null;

              const cx1 = (n1.x / 100) * 768;
              const cy1 = (n1.y / 100) * 1376;
              const cx2 = (n2.x / 100) * 768;
              const cy2 = (n2.y / 100) * 1376;

              return (
                <g key={idx}>
                  <line
                    x1={cx1}
                    y1={cy1}
                    x2={cx2}
                    y2={cy2}
                    stroke="#0ea5e9"
                    strokeWidth="3.5"
                    strokeDasharray="4 6"
                    opacity="0.8"
                  />
                  {/* Arrowhead marker */}
                  <polygon
                    points={`${cx2},${cy2} ${cx2 - 10},${cy2 - 4} ${cx2 - 8},${cy2} ${cx2 - 10},${cy2 + 4}`}
                    fill="#38bdf8"
                    transform={`rotate(${Math.atan2(cy2 - cy1, cx2 - cx1) * 180 / Math.PI} ${cx2} ${cy2})`}
                  />
                </g>
              );
            })}

            {/* Render START text visual overlay */}
            {currentStartMarker && currentStartMarker.text && (
              <text
                x={(currentStartMarker.x / 100) * 768}
                y={(currentStartMarker.y / 100) * 1376}
                fill="#38bdf8"
                fontSize={currentStartMarker.size_px}
                fontWeight="900"
                fontFamily="monospace"
                textAnchor="middle"
                opacity="0.85"
                className="animate-pulse"
              >
                {currentStartMarker.text}
              </text>
            )}
          </svg>

          {/* Mathematical Ellipse Renderings using SVG */}
          {currentNodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isLinkCandidate = editMode === 'links' && linkStartNodeId !== null && linkStartNodeId !== node.id;
            const isLinkStart = editMode === 'links' && linkStartNodeId === node.id;
            const wVal = Math.round(node.w);
            const hVal = Math.round(node.h);

            return (
              <div
                key={node.id}
                onPointerDown={(e) => handleNodePointerDown(node.id, e)}
                onPointerMove={(e) => handleNodePointerMove(node.id, e)}
                onPointerUp={(e) => handleNodePointerUp(node.id, e)}
                onPointerCancel={(e) => handleNodePointerUp(node.id, e)}
                className={`annotator-node absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-20 touch-none flex flex-col items-center transition-all ${
                  isLinkCandidate ? 'hover:scale-110' : ''
                }`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
              >
                {/* SVG container holding perfect ellipse */}
                <div className="relative" style={{ width: `${wVal}px`, height: `${hVal}px` }}>
                  <svg
                    width={wVal}
                    height={hVal}
                    className="overflow-visible"
                    style={{ width: `${wVal}px`, height: `${hVal}px` }}
                  >
                    {/* Double outline for start platform */}
                    {node.is_start && (
                      <ellipse
                        cx={wVal / 2}
                        cy={hVal / 2}
                        rx={(wVal + 16) / 2}
                        ry={(hVal + 12) / 2}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                    )}
                    <ellipse
                      cx={wVal / 2}
                      cy={hVal / 2}
                      rx={(wVal - 4) / 2}
                      ry={(hVal - 4) / 2}
                      fill={
                        isLinkStart
                          ? "rgba(14, 165, 233, 0.85)"
                          : isSelected
                          ? "rgba(180, 83, 9, 0.85)"
                          : node.is_start
                          ? "rgba(245, 158, 11, 0.85)"
                          : "rgba(15, 23, 42, 0.85)"
                      }
                      stroke={
                        isLinkStart
                          ? "#38bdf8"
                          : isSelected
                          ? "#fbbf24"
                          : node.is_start
                          ? "#f59e0b"
                          : "#22d3ee"
                      }
                      strokeWidth={node.is_start || isSelected || isLinkStart ? "3" : "2"}
                    />
                    <text
                      x="50%"
                      y="50%"
                      dominantBaseline="middle"
                      textAnchor="middle"
                      fill={isSelected ? "#fef08a" : node.is_start ? "#fef3c7" : "#e0f7fa"}
                      fontSize="11"
                      fontWeight="900"
                      fontFamily="monospace"
                    >
                      {node.label}
                    </text>
                  </svg>

                  {/* DIRECT DRAGGABLE RESIZE HANDLES (only in nodes edit mode) */}
                  {isSelected && editMode === 'nodes' && (
                    <>
                      {/* Width Resize Handle */}
                      <div
                        onPointerDown={(e) => handleResizePointerDown(node.id, 'w', e)}
                        onPointerMove={(e) => handleResizePointerMove(node.id, e)}
                        onPointerUp={(e) => handleResizePointerUp(node.id, e)}
                        onPointerCancel={(e) => handleResizePointerUp(node.id, e)}
                        className="resize-handle absolute w-3.5 h-3.5 bg-amber-400 hover:bg-amber-300 border-2 border-white rounded-full cursor-ew-resize z-30 shadow-lg touch-none"
                        style={{
                          right: '-7px',
                          top: '50%',
                          transform: 'translateY(-50%)'
                        }}
                      />

                      {/* Height Resize Handle */}
                      <div
                        onPointerDown={(e) => handleResizePointerDown(node.id, 'h', e)}
                        onPointerMove={(e) => handleResizePointerMove(node.id, e)}
                        onPointerUp={(e) => handleResizePointerUp(node.id, e)}
                        onPointerCancel={(e) => handleResizePointerUp(node.id, e)}
                        className="resize-handle absolute w-3.5 h-3.5 bg-amber-400 hover:bg-amber-300 border-2 border-white rounded-full cursor-ns-resize z-30 shadow-lg touch-none"
                        style={{
                          bottom: '-7px',
                          left: '50%',
                          transform: 'translateX(-50%)'
                        }}
                      />
                    </>
                  )}
                </div>

                {/* Size tooltip */}
                <span className="mt-1 bg-slate-950/95 border border-slate-800 text-[8px] font-mono px-1 rounded text-slate-400 pointer-events-none whitespace-nowrap shadow-md">
                  {wVal}x{hVal}px {node.is_start ? '(START)' : ''}
                </span>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
