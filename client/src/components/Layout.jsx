import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import BrandSelector from './BrandSelector';
import PageErrorBoundary from './PageErrorBoundary';
import PullProgressPanel from './PullProgressPanel';
import { Outlet, useLocation } from 'react-router-dom';
import { useAutoLoad } from '../hooks/useAutoLoad';
import { usePageLog } from '../hooks/usePageLog';
import { AlertTriangle, X } from 'lucide-react';

export default function Layout() {
  useAutoLoad();
  usePageLog();
  const { pathname } = useLocation();
  const [storageError, setStorageError] = useState(null);

  // Global storage-error listener — surfaces when LS quota fills up
  // and a critical save (brand config / manual labels) fails. Without
  // this users see their typed values vanish on reload with no clue.
  useEffect(() => {
    const handler = (e) => setStorageError(e.detail);
    window.addEventListener('taos-storage-error', handler);
    return () => window.removeEventListener('taos-storage-error', handler);
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto flex flex-col">
        <BrandSelector />
        <div className="flex-1 max-w-screen-2xl mx-auto w-full p-6">
          <PageErrorBoundary resetKey={pathname}>
            <Outlet />
          </PageErrorBoundary>
        </div>
      </main>
      <PullProgressPanel />

      {storageError && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-red-950 border border-red-700 rounded-xl shadow-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-[12px] text-red-100">
            <div className="font-bold mb-1">Couldn't save your changes</div>
            <div className="text-red-200/90 leading-relaxed">
              Browser storage is full. Your typed values aren't persisting. Click below to evict caches and try again — your config will be preserved.
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  // Best-effort: clear all evictable caches. Pulled data
                  // can be re-fetched; brand config + manual labels stay.
                  ['taos_social_posts_v1', 'taos_clarity_history_v1', 'taos_utm_snapshots_v1', 'taos_inventory_v2', 'taos_customers'].forEach(k => {
                    try { localStorage.removeItem(k); } catch (_) {}
                  });
                  setStorageError(null);
                  setTimeout(() => window.location.reload(), 200);
                }}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold"
              >
                Free space + reload
              </button>
              <button onClick={() => setStorageError(null)} className="px-2 py-1.5 text-[11px] text-red-300 hover:text-red-100">Dismiss</button>
            </div>
            <div className="text-[10px] text-red-300/70 mt-2 font-mono break-all">{storageError.key}: {storageError.error}</div>
          </div>
          <button onClick={() => setStorageError(null)} className="text-red-300 hover:text-red-100 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
