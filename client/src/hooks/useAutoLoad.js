import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { pullAccount, fetchShopifyInventory, fetchShopifyOrders } from '../lib/api';

const LS_AUTO_FETCH = 'taos_auto_fetch_at';
const COOLDOWN_MS   = 4 * 60 * 60 * 1000; // 4 hours

function lsGet(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export function useAutoLoad() {
  const [autoStatus, setAutoStatus] = useState('idle'); // idle | loading | done | skipped
  const didRun = useRef(false);

  const {
    brands,
    activeBrandIds,
    brandData,
    enrichedRows,
    setBrandMetaData,
    setBrandMetaStatus,
    setBrandInventory,
    setBrandOrders,
  } = useStore();

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));
    const anyConfigured = activeBrands.some(b =>
      b.meta?.token && b.meta?.accounts?.some(a => a.id && a.key)
    );

    if (!anyConfigured) {
      setAutoStatus('skipped');
      return;
    }

    // Check cooldown — skip if data pulled within 4 hours
    const lastFetch = lsGet(LS_AUTO_FETCH, 0);
    const hasRecentData = activeBrands.every(b => {
      const d = brandData[b.id];
      return d?.metaStatus === 'success' && d?.insights7d?.length > 0;
    });

    if (hasRecentData && Date.now() - lastFetch < COOLDOWN_MS) {
      setAutoStatus('skipped');
      return;
    }

    // Run the pull
    setAutoStatus('loading');

    const pullAll = async () => {
      try {
        await Promise.all(activeBrands.map(async brand => {
          const { token, apiVersion: ver, accounts } = brand.meta || {};
          if (!token || !accounts?.length) return;

          setBrandMetaStatus(brand.id, 'loading');

          // Pull all accounts for this brand in parallel
          const results = await Promise.all(
            accounts.filter(a => a.id && a.key).map(acc =>
              pullAccount({
                ver: ver || 'v21.0',
                token,
                accountKey: acc.key,
                accountId:  acc.id,
              }).catch(err => {
                console.warn('[AutoLoad] account pull failed:', acc.key, err.message);
                return null;
              })
            )
          );

          // Merge results from all accounts for this brand
          const validResults = results.filter(Boolean);
          if (!validResults.length) {
            setBrandMetaStatus(brand.id, 'error', 'No accounts could be fetched');
            return;
          }

          const merged = {
            campaigns:     validResults.flatMap(r => r.campaigns),
            adsets:        validResults.flatMap(r => r.adsets),
            ads:           validResults.flatMap(r => r.ads),
            insightsToday: validResults.flatMap(r => r.insightsToday),
            insights7d:    validResults.flatMap(r => r.insights7d),
            insights14d:   validResults.flatMap(r => r.insights14d),
            insights30d:   validResults.flatMap(r => r.insights30d),
          };
          setBrandMetaData(brand.id, merged);

          // Pull Shopify inventory if configured
          const { shop, clientId, clientSecret } = brand.shopify || {};
          if (shop && clientId && clientSecret) {
            try {
              const { map: inventoryMap, locations, inventoryByLocation, skuToItemId, collections } =
                await fetchShopifyInventory(shop, clientId, clientSecret);
              setBrandInventory(brand.id, inventoryMap, locations, inventoryByLocation, skuToItemId, collections);
            } catch (e) {
              console.warn('[AutoLoad] Shopify inventory failed:', e.message);
            }

            // Pull last 60 days of orders (enough for any standard comparison window)
            try {
              const now    = new Date();
              const since  = new Date(now - 60 * 86400000).toISOString();
              const until  = now.toISOString();
              const result = await fetchShopifyOrders(shop, clientId, clientSecret, since, until);
              setBrandOrders(brand.id, result.orders, '60d');
            } catch (e) {
              console.warn('[AutoLoad] Shopify orders failed:', e.message);
            }
          }
        }));

        lsSet(LS_AUTO_FETCH, Date.now());
        setAutoStatus('done');
      } catch (err) {
        console.error('[AutoLoad] fatal error:', err);
        setAutoStatus('idle');
      }
    };

    pullAll();
  }, []); // only run once on mount

  return autoStatus;
}
