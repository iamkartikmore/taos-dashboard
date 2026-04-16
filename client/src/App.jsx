import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Setup from './pages/Setup';
import Overview from './pages/Overview';
import DecisionQueue from './pages/DecisionQueue';
import Board from './pages/Boards';
import Patterns from './pages/Patterns';
import Scorecard from './pages/Scorecard';
import FlatData from './pages/FlatData';
import VideoInsights from './pages/VideoInsights';
import SkuInsights from './pages/SkuInsights';
import Breakdowns from './pages/Breakdowns';
import ShopifyOrders from './pages/ShopifyOrders';
import ShopifyInsights from './pages/ShopifyInsights';
import ShopifyOps from './pages/ShopifyOps';
import GAInsights from './pages/GAInsights';
import Procurement from './pages/Procurement';
import CreativeIntel from './pages/CreativeIntel';
import Attribution from './pages/Attribution';
import Momentum from './pages/Momentum';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/"          element={<Overview />} />
          <Route path="/setup"     element={<Setup />} />
          <Route path="/decisions" element={<DecisionQueue />} />
          <Route path="/scale"     element={<Board />} />
          <Route path="/fix"       element={<Board />} />
          <Route path="/defend"    element={<Board />} />
          <Route path="/kill"      element={<Board />} />
          <Route path="/patterns"  element={<Patterns />} />
          <Route path="/scorecard" element={<Scorecard />} />
          <Route path="/video"     element={<VideoInsights />} />
          <Route path="/sku"       element={<SkuInsights />} />
          <Route path="/flat"       element={<FlatData />} />
          <Route path="/breakdowns" element={<Breakdowns />} />
          <Route path="/shopify"          element={<ShopifyOrders />} />
          <Route path="/shopify-insights" element={<ShopifyInsights />} />
          <Route path="/shopify-ops"      element={<ShopifyOps />} />
          <Route path="/ga"               element={<GAInsights />} />
          <Route path="/procurement"      element={<Procurement />} />
          <Route path="/creative-intel"   element={<CreativeIntel />} />
          <Route path="/attribution"      element={<Attribution />} />
          <Route path="/momentum"         element={<Momentum />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
