import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import MapAnnotator from './components/MapAnnotator.jsx'
import NodeGallery from './components/NodeGallery.jsx'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return hash;
}

function Router() {
  const hash = useHashRoute();

  if (hash.startsWith('#/nodes')) {
    return <NodeGallery />;
  }

  if (hash.startsWith('#/annotator')) {
    return (
      <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
          <span className="text-sm font-bold flex items-center gap-2">
            <span className="text-cyan-400">⌖</span> 关卡点打点工具 · MapAnnotator
          </span>
          <a
            href="#/"
            className="px-3 py-1 bg-cyan-500 text-slate-950 rounded font-bold text-xs hover:bg-cyan-400 transition-colors"
          >
            返回地图预览
          </a>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <MapAnnotator />
        </div>
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
