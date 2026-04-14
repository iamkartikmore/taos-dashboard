import Sidebar from './Sidebar';
import BrandSelector from './BrandSelector';
import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto flex flex-col">
        <BrandSelector />
        <div className="flex-1 max-w-screen-2xl mx-auto w-full p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
