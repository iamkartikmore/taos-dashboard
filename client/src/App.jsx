import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Heavy pages — code-split so only the active page's JS is parsed
const Login           = lazy(() => import('./pages/Login'));
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
const Admin              = lazy(() => import('./pages/Admin'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function FullscreenSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// Require the user to be logged in; if not, send to /login preserving intended destination
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullscreenSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// Render children only if user can access moduleKey; otherwise show locked message
function ModuleGuard({ moduleKey, children }) {
  const { canAccess, user } = useAuth();
  // 'admin' key = only role:admin users
  const allowed = moduleKey === 'admin' ? user?.role === 'admin' : canAccess(moduleKey);
  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center">
        <div className="text-5xl select-none">🔒</div>
        <p className="text-base font-semibold text-slate-300">Access Restricted</p>
        <p className="text-sm text-slate-500 max-w-xs">
          You don't have permission to view this module. Ask an admin to grant access.
        </p>
      </div>
    );
  }
  return children;
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
      import('./pages/EmailCampaigns');
      import('./pages/EmailEngine');
      import('./pages/Segments');
    }, 800);
    return () => clearTimeout(t);
  }, []);
  return null;
}

// Helper: wrap a page component with a module access check
const M = (Component, key) => (
  <ModuleGuard moduleKey={key}>
    <Component />
  </ModuleGuard>
);

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PrefetchAllPages />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />

            {/* All other routes require auth */}
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route path="/"                 element={M(Overview,        'overview')} />
              <Route path="/setup"            element={M(Setup,           'setup')} />
              <Route path="/decisions"        element={M(DecisionQueue,   'decisions')} />
              <Route path="/scale"            element={M(Board,           'boards')} />
              <Route path="/fix"              element={M(Board,           'boards')} />
              <Route path="/defend"           element={M(Board,           'boards')} />
              <Route path="/kill"             element={M(Board,           'boards')} />
              <Route path="/patterns"         element={M(Patterns,        'patterns')} />
              <Route path="/scorecard"        element={M(Scorecard,       'scorecard')} />
              <Route path="/video"            element={M(VideoInsights,   'video')} />
              <Route path="/sku"              element={M(SkuInsights,     'sku')} />
              <Route path="/flat"             element={M(FlatData,        'flat')} />
              <Route path="/breakdowns"       element={M(Breakdowns,      'breakdowns')} />
              <Route path="/creative-intel"   element={M(CreativeIntel,   'creative-intel')} />
              <Route path="/attribution"      element={M(Attribution,     'attribution')} />
              <Route path="/momentum"         element={M(Momentum,        'momentum')} />
              <Route path="/inactive"         element={M(InactiveAds,     'inactive')} />
              <Route path="/daily"            element={M(DailyBriefing,   'daily')} />
              <Route path="/analysis"         element={M(OrderAnalysis,   'analysis')} />
              <Route path="/collection-spend" element={M(CollectionSpend, 'collection-spend')} />
              <Route path="/aov"              element={M(AOVAnalysis,     'aov')} />
              <Route path="/business-plan"    element={M(BusinessPlan,    'business-plan')} />
              <Route path="/shopify"          element={M(ShopifyOrders,   'shopify')} />
              <Route path="/shopify-insights" element={M(ShopifyInsights, 'shopify-insights')} />
              <Route path="/shopify-ops"      element={M(ShopifyOps,      'shopify-ops')} />
              <Route path="/procurement"      element={M(Procurement,     'procurement')} />
              <Route path="/ga"               element={M(GAInsights,      'ga')} />
              <Route path="/google-ads"       element={M(GoogleAds,       'google-ads')} />
              <Route path="/email-campaigns"  element={M(EmailCampaigns,  'email-campaigns')} />
              <Route path="/email-engine"     element={M(EmailEngine,     'email-engine')} />
              <Route path="/segments"         element={M(Segments,        'segments')} />
              <Route path="/admin"            element={<ModuleGuard moduleKey="admin"><Admin /></ModuleGuard>} />
              <Route path="*"                 element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
