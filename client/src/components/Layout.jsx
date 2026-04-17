import Sidebar from './Sidebar';
import BrandSelector from './BrandSelector';
import PageErrorBoundary from './PageErrorBoundary';
import { Outlet, useLocation } from 'react-router-dom';
import { useAutoLoad } from '../hooks/useAutoLoad';

export default function Layout() {
  useAutoLoad();
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto flex flex-col">
        <BrandSelector />
        <div className="flex-1 max-w-screen-2xl mx-auto w-full p-6">
          {/* resetKey=pathname auto-clears the boundary on every route change,
              so a crash on one tab never prevents another tab from rendering. */}
          <PageErrorBoundary resetKey={pathname}>
            <Outlet />
          </PageErrorBoundary>
        </div>
      </main>
    </div>
  );
}
