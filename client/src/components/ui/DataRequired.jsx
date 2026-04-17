/**
 * Consistent "data not loaded" empty states for pages.
 *
 * Usage:
 *   <NeedsMeta>  — wraps page content that needs Meta enrichedRows
 *   <NeedsShopify> — wraps content that needs Shopify orders/inventory
 *
 * Both auto-detect loading / error / no-config states and show appropriate UI.
 * Children are only rendered when the required data is present.
 */
import { Loader2, Database, ShoppingBag } from 'lucide-react';
import { useStore } from '../../store';

/* ─── shared empty-state card ──────────────────────────────────────── */
function EmptyCard({ icon: Icon, iconColor, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-6">
      <div className={`p-4 rounded-2xl ${iconColor}`}>
        <Icon size={32} className="mx-auto opacity-60" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-200 mb-1">{title}</p>
        <p className="text-xs text-slate-500 max-w-xs">{sub}</p>
      </div>
      {action}
    </div>
  );
}

/* ─── NeedsMeta ─────────────────────────────────────────────────────── */
export function NeedsMeta({ children }) {
  const { enrichedRows, fetchStatus, brands, activeBrandIds } = useStore();

  const hasConfig = (brands || [])
    .filter(b => (activeBrandIds || []).includes(b.id))
    .some(b => b.meta?.token && b.meta?.accounts?.some(a => a.id && a.key));

  if (fetchStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-slate-400">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Loading Meta data…</span>
      </div>
    );
  }

  if (!hasConfig) {
    return (
      <EmptyCard
        icon={Database}
        iconColor="bg-brand-500/10"
        title="Meta not configured"
        sub="Add your Meta token and ad account credentials in Study Manual, then pull data."
      />
    );
  }

  if (!enrichedRows?.length) {
    return (
      <EmptyCard
        icon={Database}
        iconColor="bg-slate-800"
        title="No Meta data loaded"
        sub="Open Study Manual and pull data for the active brand, or wait for the auto-load to complete."
      />
    );
  }

  return children;
}

/* ─── NeedsShopify ──────────────────────────────────────────────────── */
export function NeedsShopify({ children, checkOrders = true, checkInventory = false }) {
  const { shopifyOrders, inventoryMap, brands, activeBrandIds } = useStore();

  const hasConfig = (brands || [])
    .filter(b => (activeBrandIds || []).includes(b.id))
    .some(b => b.shopify?.shop && b.shopify?.clientId && b.shopify?.clientSecret);

  if (!hasConfig) {
    return (
      <EmptyCard
        icon={ShoppingBag}
        iconColor="bg-violet-500/10"
        title="Shopify not configured"
        sub="Add your Shopify store credentials in Study Manual to enable Shopify features."
      />
    );
  }

  if (checkOrders && !shopifyOrders?.length) {
    return (
      <EmptyCard
        icon={ShoppingBag}
        iconColor="bg-slate-800"
        title="No Shopify orders loaded"
        sub="Go to Shopify Orders and click Fetch to load orders, or wait for auto-load to complete."
      />
    );
  }

  if (checkInventory && !Object.keys(inventoryMap || {}).length) {
    return (
      <EmptyCard
        icon={ShoppingBag}
        iconColor="bg-slate-800"
        title="No Shopify inventory loaded"
        sub="Inventory loads automatically when you pull data. Check Study Manual if it's missing."
      />
    );
  }

  return children;
}
