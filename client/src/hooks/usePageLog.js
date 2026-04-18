import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const LS_TOKEN = 'taos_auth_token';

const PATH_LABELS = {
  '/': 'Overview', '/setup': 'Setup', '/decisions': 'Decision Queue',
  '/scale': 'Scale Board', '/fix': 'Fix Board', '/defend': 'Defend Board', '/kill': 'Kill Board',
  '/patterns': 'Pattern Analysis', '/scorecard': 'Scorecard', '/video': 'Video Insights',
  '/sku': 'SKU Intelligence', '/flat': 'Raw Flat Data', '/breakdowns': 'Breakdowns',
  '/creative-intel': 'Creative Intel', '/attribution': 'Attribution', '/momentum': 'Momentum',
  '/inactive': 'Inactive Ads', '/daily': 'Daily Briefing', '/analysis': 'Order Analysis',
  '/collection-spend': 'Collection Spend', '/aov': 'AOV Analysis',
  '/business-plan': 'Business Plan', '/shopify': 'Shopify Orders',
  '/shopify-insights': 'Shopify Analytics', '/shopify-ops': 'Shopify Ops',
  '/procurement': 'Procurement', '/ga': 'GA Analytics', '/admin': 'Admin',
};

export function usePageLog() {
  const location = useLocation();
  useEffect(() => {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) return;
    fetch('/api/admin/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: location.pathname, label: PATH_LABELS[location.pathname] || location.pathname }),
    }).catch(() => {});
  }, [location.pathname]);
}
