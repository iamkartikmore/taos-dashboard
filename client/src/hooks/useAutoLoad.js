import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { pullAccount, fetchShopifyInventory, fetchShopifyOrders, fetchGoogleAds } from '../lib/api';
import { normalizeGoogleAdsResponse } from '../lib/googleAdsAnalytics';

const LS_AUTO_FETCH = 'taos_auto_fetch_at';
const COOLDOWN_MS   = 4 * 60 * 60 * 1000; // 4 hours

function lsGet(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export function useAutoLoad() {
  const [autoStatus, setAutoStatus] = useState('idle');
  const didRun = useRef(false);
  // track which brand IDs have had a pull kicked off (prevents duplicate fetches)
  const fetchedBrandIds = useRef(new Set());

  const {
    brands,
    activeBrandIds,
    brandData,
    setBrandMetaData,
    setBrandMetaStatus,
    setBrandInventory,
    setBrandOrders,
    setBrandGoogleAdsData,
    setBrandGoogleAdsStatus,
  } = useStore();

  /* ── Core pull function — reusable for initial load & brand-switch ──
     Serialized across brands and across accounts within a brand to keep
     server memory low on Render's 512MB free tier. */
  const pullBrands = useCallback(async (brandsToPull) => {
    const results = [];
    for (const brand of brandsToPull) {
      const { token, apiVersion: ver, accounts } = brand.meta || {};
      if (!token || !accounts?.length) { results.push(undefined); continue; }

      setBrandMetaStatus(brand.id, 'loading');

      const acctResults = [];
      for (const acc of accounts.filter(a => a.id && a.key)) {
        try {
          const r = await pullAccount({
            ver: ver || 'v21.0',
            token,
            accountKey: acc.key,
            accountId:  acc.id,
          });
          acctResults.push(r);
        } catch (err) {
          console.warn('[AutoLoad] account pull failed:', acc.key, err.message);
          acctResults.push(null);
        }
      }

      const valid = acctResults.filter(Boolean);
      if (!valid.length) {
        setBrandMetaStatus(brand.id, 'error', 'No accounts could be fetched');
        continue;
      }

      const merged = {
        campaigns:         valid.flatMap(r => r.campaigns),
        adsets:            valid.flatMap(r => r.adsets),
        ads:               valid.flatMap(r => r.ads),
        insightsToday:     valid.flatMap(r => r.insightsToday),
        insightsYesterday: valid.flatMap(r => r.insightsYesterday || []),
        insights3d:        valid.flatMap(r => r.insights3d || []),
        insights7d:        valid.flatMap(r => r.insights7d),
        insights14d:       valid.flatMap(r => r.insights14d),
        insights30d:       valid.flatMap(r => r.insights30d),
      };
      setBrandMetaData(brand.id, merged);

      // Shopify
      const { shop, clientId, clientSecret } = brand.shopify || {};
      if (shop && clientId && clientSecret) {
        try {
          const { map: inventoryMap, locations, skuToItemId, collections } =
            await fetchShopifyInventory(shop, clientId, clientSecret);
          setBrandInventory(brand.id, inventoryMap, locations, null, skuToItemId, collections);
        } catch (e) {
          console.warn('[AutoLoad] Shopify inventory failed:', e.message);
        }

        try {
          const now   = new Date();
          const since = new Date(now - 60 * 86400000).toISOString();
          const until = now.toISOString();
          const result = await fetchShopifyOrders(shop, clientId, clientSecret, since, until);
          setBrandOrders(brand.id, result.orders, '60d');
        } catch (e) {
          console.warn('[AutoLoad] Shopify orders failed:', e.message);
        }
      }

      // Google Ads
      const gAds = brand.googleAds || {};
      if (gAds.devToken && gAds.customerId && gAds.clientId && gAds.clientSecret && gAds.refreshToken) {
        setBrandGoogleAdsStatus(brand.id, 'loading');
        try {
          const raw        = await fetchGoogleAds(gAds, 'last_30d');
          const normalized = normalizeGoogleAdsResponse(raw);
          setBrandGoogleAdsData(brand.id, normalized);
        } catch (e) {
          console.warn('[AutoLoad] Google Ads failed:', e.message);
          setBrandGoogleAdsStatus(brand.id, 'error', e.message);
        }
      }
      results.push(true);
    }
    return results;
  }, [setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders, setBrandGoogleAdsData, setBrandGoogleAdsStatus]);

  /* ── Initial load (once, with 4-hour cooldown) ── */
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

    const lastFetch    = lsGet(LS_AUTO_FETCH, 0);
    const hasRecentData = activeBrands.every(b => {
      const d = brandData[b.id];
      return d?.metaStatus === 'success' && d?.insights7d?.length > 0;
    });

    if (hasRecentData && Date.now() - lastFetch < COOLDOWN_MS) {
      setAutoStatus('skipped');
      activeBrands.forEach(b => fetchedBrandIds.current.add(b.id));
      return;
    }

    setAutoStatus('loading');
    activeBrands.forEach(b => fetchedBrandIds.current.add(b.id));

    pullBrands(activeBrands)
      .then(() => {
        lsSet(LS_AUTO_FETCH, Date.now());
        setAutoStatus('done');
      })
      .catch(err => {
        console.error('[AutoLoad] fatal error:', err);
        setAutoStatus('idle');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Brand-switch fetch — if a newly-active brand has no data, pull it ── */
  useEffect(() => {
    const needsData = brands.filter(b => {
      if (!activeBrandIds.includes(b.id)) return false;
      if (fetchedBrandIds.current.has(b.id)) return false;   // already fetched this session
      if (!b.meta?.token) return false;
      if (!b.meta?.accounts?.some(a => a.id && a.key)) return false;
      const d = brandData[b.id];
      if (d?.metaStatus === 'success') return false;          // was pulled, just has no ads — don't loop
      return !d?.insights7d?.length;                          // no data loaded
    });

    if (!needsData.length) return;

    needsData.forEach(b => fetchedBrandIds.current.add(b.id));

    pullBrands(needsData).catch(err =>
      console.warn('[AutoLoad] brand-switch pull failed:', err.message)
    );
  }, [activeBrandIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return autoStatus;
}
