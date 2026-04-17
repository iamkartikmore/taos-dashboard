import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';

// Heavy pages — code-split so only the active page's JS is parsed
const Setup          = lazy(() => import('./pages/Setup'));
const Overview       = lazy(() => import('./pages/Overview'));
const DecisionQueue  = lazy(() => import('./pages/DecisionQueue'));
const Board          = lazy(() => import('./pages/Boards'));
const Patterns       = lazy(() => import('./pages/Patterns'));
const Scorecard      = lazy(() => import('./pages/Scorecard'));
const FlatData       = lazy(() => import('./pages/FlatData'));
const VideoInsights  = lazy(() => import('./pages/VideoInsights'));
const SkuInsights    = lazy(() => import('./pages/SkuInsights'));
const Breakdowns     = lazy(() => import('./pages/Breakdowns'));
const ShopifyOrders  = lazy(() => import('./pages/ShopifyOrders'));
const ShopifyInsights= lazy(() => import('./pages/ShopifyInsights'));
const ShopifyOps     = lazy(() => import('./pages/ShopifyOps'));
const GAInsights     = lazy(() => import('./pages/GAInsights'));
const Procurement    = lazy(() => import('./pages/Procurement'));
const CreativeIntel  = lazy(() => import('./pages/CreativeIntel'));
const Attribution    = lazy(() => import('./pages/Attribution'));
const Momentum       = lazy(() => import('./pages/Momentum'));
const InactiveAds    = lazy(() => import('./pages/InactiveAds'));
const DailyBriefing  = lazy(() => import('./pages/DailyBriefing'));
const OrderAnalysis      = lazy(() => import('./pages/OrderAnalysis'));
const CollectionSpend    = lazy(() => import('./pages/CollectionSpend'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/"                 element={<Overview />} />
            <Route path="/setup"            element={<Setup />} />
            <Route path="/decisions"        element={<DecisionQueue />} />
            <Route path="/scale"            element={<Board />} />
            <Route path="/fix"              element={<Board />} />
            <Route path="/defend"           element={<Board />} />
            <Route path="/kill"             element={<Board />} />
            <Route path="/patterns"         element={<Patterns />} />
            <Route path="/scorecard"        element={<Scorecard />} />
            <Route path="/video"            element={<VideoInsights />} />
            <Route path="/sku"              element={<SkuInsights />} />
            <Route path="/flat"             element={<FlatData />} />
            <Route path="/breakdowns"       element={<Breakdowns />} />
            <Route path="/shopify"          element={<ShopifyOrders />} />
            <Route path="/shopify-insights" element={<ShopifyInsights />} />
            <Route path="/shopify-ops"      element={<ShopifyOps />} />
            <Route path="/ga"               element={<GAInsights />} />
            <Route path="/procurement"      element={<Procurement />} />
            <Route path="/creative-intel"   element={<CreativeIntel />} />
            <Route path="/attribution"      element={<Attribution />} />
            <Route path="/momentum"         element={<Momentum />} />
            <Route path="/inactive"         element={<InactiveAds />} />
            <Route path="/daily"            element={<DailyBriefing />} />
            <Route path="/analysis"           element={<OrderAnalysis />} />
            <Route path="/collection-spend" element={<CollectionSpend />} />
            <Route path="*"                 element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
