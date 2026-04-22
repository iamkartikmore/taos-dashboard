import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { pullAccount, fetchShopifyInventory, fetchShopifyOrders, fetchGoogleAds } from '../lib/api';
import { normalizeGoogleAdsResponse } from '../lib/googleAdsAnalytics';

/* Every time the app opens, pull Meta (and Shopify + Google Ads) for
   every active brand that has credentials configured. No global
   cooldown — the user's mental model is "open app → data appears."
   Per-session dedup prevents re-fetching the same brand on re-renders
   and brand-switch thrash, but ONLY after a successful pull so brands
   that failed / have bad creds get retried on next toggle. */

function hasMetaCreds(brand) {
  return !!(brand?.meta?.token && brand?.meta?.accounts?.some(a => a.id && a.key));
}

export function useAutoLoad() {
  const [autoStatus, setAutoStatus] = useState('idle');
  const didInitialRun     = useRef(false);           // initial-mount guard
  const inflightBrandIds  = useRef(new Set());       // currently pulling — prevent dup
  const successfulBrandIds = useRef(new Set());      // completed OK this session — don't re-pull on brand-switch

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

  /* ── Pull one brand end-to-end. Returns true if Meta succeeded. ── */
  const pullOneBrand = useCallback(async (brand) => {
    if (!hasMetaCreds(brand)) return false;

    setBrandMetaStatus(brand.id, 'loading');
    const { token, apiVersion: ver, accounts } = brand.meta;

    // Meta — serial across accounts to keep Render free-tier memory low
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
        console.warn('[AutoLoad] account pull failed:', brand.name, acc.key, err.message);
        acctResults.push(null);
      }
    }

    const valid = acctResults.filter(Boolean);
    if (!valid.length) {
      setBrandMetaStatus(brand.id, 'error', 'No accounts could be fetched');
      return false;
    }

    setBrandMetaData(brand.id, {
      campaigns:         valid.flatMap(r => r.campaigns),
      adsets:            valid.flatMap(r => r.adsets),
      ads:               valid.flatMap(r => r.ads),
      insightsToday:     valid.flatMap(r => r.insightsToday),
      insightsYesterday: valid.flatMap(r => r.insightsYesterday || []),
      insights3d:        valid.flatMap(r => r.insights3d || []),
      insights7d:        valid.flatMap(r => r.insights7d),
      insights14d:       valid.flatMap(r => r.insights14d),
      insights30d:       valid.flatMap(r => r.insights30d),
    });

    // Shopify (inventory + 60d orders) — don't block Meta success on this
    const { shop, clientId, clientSecret } = brand.shopify || {};
    if (shop && clientId && clientSecret) {
      try {
        const { map: inventoryMap, locations, skuToItemId, collections } =
          await fetchShopifyInventory(shop, clientId, clientSecret);
        setBrandInventory(brand.id, inventoryMap, locations, null, skuToItemId, collections);
      } catch (e) {
        console.warn('[AutoLoad] Shopify inventory failed:', brand.name, e.message);
      }

      try {
        const now   = new Date();
        const since = new Date(now - 60 * 86400000).toISOString();
        const until = now.toISOString();
        const result = await fetchShopifyOrders(shop, clientId, clientSecret, since, until);
        setBrandOrders(brand.id, result.orders, '60d');
      } catch (e) {
        console.warn('[AutoLoad] Shopify orders failed:', brand.name, e.message);
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
        console.warn('[AutoLoad] Google Ads failed:', brand.name, e.message);
        setBrandGoogleAdsStatus(brand.id, 'error', e.message);
      }
    }

    return true;
  }, [setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders, setBrandGoogleAdsData, setBrandGoogleAdsStatus]);

  /* ── Pull many brands serially, tracking inflight + success state.
     Failed brands stay OUT of successfulBrandIds so they get retried
     if the user toggles them off/on or reloads the page. ── */
  const pullBrands = useCallback(async (brandsToPull) => {
    for (const brand of brandsToPull) {
      if (inflightBrandIds.current.has(brand.id)) continue;
      inflightBrandIds.current.add(brand.id);
      try {
        const ok = await pullOneBrand(brand);
        if (ok) successfulBrandIds.current.add(brand.id);
      } finally {
        inflightBrandIds.current.delete(brand.id);
      }
    }
  }, [pullOneBrand]);

  /* ── Initial load: every page open, pull every active brand that has
     credentials. Never gated by a global cooldown. ── */
  useEffect(() => {
    if (didInitialRun.current) return;
    didInitialRun.current = true;

    const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));
    const toPull = activeBrands.filter(hasMetaCreds);

    if (!toPull.length) {
      setAutoStatus('skipped');
      return;
    }

    setAutoStatus('loading');
    pullBrands(toPull)
      .then(() => setAutoStatus('done'))
      .catch(err => {
        console.error('[AutoLoad] fatal error:', err);
        setAutoStatus('idle');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Brand-switch: pull newly-active brands that haven't succeeded
     yet this session. Now retries failed brands correctly. ── */
  useEffect(() => {
    const needsData = brands.filter(b => {
      if (!activeBrandIds.includes(b.id)) return false;
      if (successfulBrandIds.current.has(b.id)) return false;
      if (inflightBrandIds.current.has(b.id))   return false;
      if (!hasMetaCreds(b)) return false;
      const d = brandData[b.id];
      // Already has fresh insights — treat as success for dedup
      if (d?.metaStatus === 'success' && d?.insights7d?.length > 0) {
        successfulBrandIds.current.add(b.id);
        return false;
      }
      return true;
    });

    if (!needsData.length) return;
    pullBrands(needsData).catch(err =>
      console.warn('[AutoLoad] brand-switch pull failed:', err.message)
    );
  }, [activeBrandIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return autoStatus;
}
