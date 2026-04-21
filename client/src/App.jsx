import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { useStore } from './store';
import { loadAllOrders } from './lib/orderStorage';
import { loadAllCustomers } from './lib/customerStorage';
import { shouldAutoPull, runDailyAutoPull } from './lib/autoPull';

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
const GoogleAds      = lazy(() => import('./pages/GoogleAds'));
const EmailCampaigns = lazy(() => import('./pages/EmailCampaigns'));
const EmailEngine    = lazy(() => import('./pages/EmailEngine'));
const Segments       = lazy(() => import('./pages/Segments'));
const Procurement    = lazy(() => import('./pages/Procurement'));
const CreativeIntel  = lazy(() => import('./pages/CreativeIntel'));
const Attribution    = lazy(() => import('./pages/Attribution'));
const Momentum       = lazy(() => import('./pages/Momentum'));
const InactiveAds    = lazy(() => import('./pages/InactiveAds'));
const DailyBriefing  = lazy(() => import('./pages/DailyBriefing'));
const OrderAnalysis      = lazy(() => import('./pages/OrderAnalysis'));
const CollectionSpend    = lazy(() => import('./pages/CollectionSpend'));
const AOVAnalysis        = lazy(() => import('./pages/AOVAnalysis'));
const BusinessPlan       = lazy(() => import('./pages/BusinessPlan'));
const StarProducts       = lazy(() => import('./pages/StarProducts'));
const BulkImport         = lazy(() => import('./pages/BulkImport'));
const CustomerBrain      = lazy(() => import('./pages/CustomerBrain'));
const SendPlanner        = lazy(() => import('./pages/SendPlanner'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function BootHydrateAndAutoPull() {
  const { hydrateOrders, hydrateCustomers, brands, setBrandOrders, setBrandOrdersStatus } = useStore();

  // 1) Hydrate persisted orders + customers from IndexedDB on first mount
  useEffect(() => {
    loadAllOrders().then(records => hydrateOrders(records)).catch(() => {});
    loadAllCustomers().then(records => hydrateCustomers(records)).catch(() => {});
  }, [hydrateOrders, hydrateCustomers]);

  // 2) Daily auto-pull at 7am IST (checked once on mount, then hourly while open)
  useEffect(() => {
    const check = () => {
      if (shouldAutoPull()) {
        runDailyAutoPull(useStore.getState().brands, setBrandOrders, setBrandOrdersStatus);
      }
    };
    // Wait 3s after mount so the app has time to render, then check
    const boot = setTimeout(check, 3000);
    const interval = setInterval(check, 60 * 60 * 1000); // hourly
    return () => { clearTimeout(boot); clearInterval(interval); };
  }, [setBrandOrders, setBrandOrdersStatus]);

  return null;
}

function PrefetchAllPages() {
  useEffect(() => {
    const t = setTimeout(() => {
      import('./pages/Setup');
      import('./pages/Overview');
      import('./pages/DecisionQueue');
      import('./pages/Boards');
      import('./pages/Patterns');
      import('./pages/Scorecard');
      import('./pages/FlatData');
      import('./pages/VideoInsights');
      import('./pages/SkuInsights');
      import('./pages/Breakdowns');
      import('./pages/ShopifyOrders');
      import('./pages/ShopifyInsights');
      import('./pages/ShopifyOps');
      import('./pages/GAInsights');
      import('./pages/GoogleAds');
      import('./pages/Procurement');
      import('./pages/CreativeIntel');
      import('./pages/Attribution');
      import('./pages/Momentum');
      import('./pages/InactiveAds');
      import('./pages/DailyBriefing');
      import('./pages/OrderAnalysis');
      import('./pages/CollectionSpend');
      import('./pages/AOVAnalysis');
      import('./pages/BusinessPlan');
      import('./pages/StarProducts');
      import('./pages/EmailCampaigns');
      import('./pages/EmailEngine');
      import('./pages/Segments');
      import('./pages/CustomerBrain');
      import('./pages/SendPlanner');
    }, 800);
    return () => clearTimeout(t);
  }, []);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <BootHydrateAndAutoPull />
      <PrefetchAllPages />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/"                 element={<Overview />} />
            <Route path="/setup"            element={<Setup />} />
            <Route path="/bulk-import"      element={<BulkImport />} />
            <Route path="/customer-brain"   element={<CustomerBrain />} />
            <Route path="/send-planner"     element={<SendPlanner />} />
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
            <Route path="/creative-intel"   element={<CreativeIntel />} />
            <Route path="/attribution"      element={<Attribution />} />
            <Route path="/momentum"         element={<Momentum />} />
            <Route path="/inactive"         element={<InactiveAds />} />
            <Route path="/daily"            element={<DailyBriefing />} />
            <Route path="/analysis"         element={<OrderAnalysis />} />
            <Route path="/collection-spend" element={<CollectionSpend />} />
            <Route path="/aov"              element={<AOVAnalysis />} />
            <Route path="/business-plan"    element={<BusinessPlan />} />
            <Route path="/star-products"    element={<StarProducts />} />
            <Route path="/shopify"          element={<ShopifyOrders />} />
            <Route path="/shopify-insights" element={<ShopifyInsights />} />
            <Route path="/shopify-ops"      element={<ShopifyOps />} />
            <Route path="/procurement"      element={<Procurement />} />
            <Route path="/ga"               element={<GAInsights />} />
            <Route path="/google-ads"       element={<GoogleAds />} />
            <Route path="/email-campaigns"  element={<EmailCampaigns />} />
            <Route path="/email-engine"     element={<EmailEngine />} />
            <Route path="/segments"         element={<Segments />} />
            <Route path="*"                 element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
