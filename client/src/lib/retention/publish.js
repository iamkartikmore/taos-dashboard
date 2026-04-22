/**
 * Push a finished send plan into Listmonk as actual campaigns.
 *
 * Per brand → per opportunity flow:
 *   1) ensure a dedicated Listmonk list for {brand + opportunity}
 *   2) import that opportunity's subscribers (with retention attribs)
 *      into that list, overwriting on email
 *   3) create a campaign targeting that list with the opportunity's
 *      template (subject + HTML)
 *   4) optionally flip status → running or scheduled
 *
 * Each step surfaces progress via the onProgress callback so the UI
 * can render a live log. Errors on one brand/opp are caught and logged
 * without aborting the whole run — the caller sees a per-step summary.
 */

import {
  ensureListmonkLists,
  importListmonkSubscribers,
  sendListmonkCampaign,
  createListmonkCampaignDraft,
} from '../api';
import { templateFor } from './emailTemplates';
import { productFor } from './productLookup';

function attribsForPick(pick, features, lookup, campaignTag) {
  const f = features?.[pick.email] || {};
  const skus = pick.recommended_skus || [];
  const primary = skus[0] || '';
  const p = productFor(primary, lookup);
  return {
    first_name:       f.first_name || '',
    last_name:        f.last_name  || '',
    brand:            pick.brand || '',
    opportunity:      pick.opportunity,
    reason:           pick.reason || '',
    primary_sku:      primary,
    sku_name:         p.name,
    product_url:      p.url,
    product_image:    p.image || '',
    price:            p.price || 0,
    recommended_skus: skus.join('|'),
    recommended_names: skus.map(s => productFor(s, lookup).name).filter(Boolean).join('|'),
    recommended_urls:  skus.map(s => productFor(s, lookup).url ).filter(Boolean).join('|'),
    days_since_last:  f.days_since_last_order ?? '',
    value_tier:       f.value_tier || '',
    lifecycle_stage:  f.lifecycle_stage || '',
    score:            Number(pick.score?.toFixed(3) || 0),
    expected_rev:     Math.round(pick.expected_incremental_revenue || 0),
    campaign_tag:     campaignTag,
  };
}

/**
 * @param picks   plan.picks from planSends()
 * @param brands  full brand records (for per-brand Listmonk creds)
 * @param ctx     { [brandId]: { features, lookup } } built by SendPlanner
 * @param opts    { startNow, sendAt, dryRun, onProgress(msg), campaignTag }
 */
export async function publishPlanToListmonk(picks, brands, ctx, opts = {}) {
  const {
    startNow = false,            // draft-only by default; user flips to running in Listmonk
    sendAt = null,
    dryRun = false,
    onProgress = () => {},
    campaignTag = `plan_${new Date().toISOString().slice(0, 10)}`,
  } = opts;

  const log = msg => onProgress({ ts: Date.now(), msg });
  const results = [];

  // Group picks: brand → `${opp}::${variant}` → [picks]. Each (opp, variant)
  // combination becomes its own Listmonk list + campaign so Day-3 "nudge"
  // copy goes to a different list than Day-0 defaults. Listmonk is an
  // email-only dispatcher, so SMS picks are dropped here — they leave
  // through the SMS publisher (added separately).
  const grouped = {};
  for (const p of picks) {
    if (!p.brand_id) continue;
    if (p.channel && p.channel !== 'email') continue;
    const variant = p.variant || 'default';
    const groupKey = `${p.opportunity}::${variant}`;
    (grouped[p.brand_id] ||= {})[groupKey] ||= { opp: p.opportunity, variant, picks: [] };
    grouped[p.brand_id][groupKey].picks.push(p);
  }

  for (const [brandId, byOpp] of Object.entries(grouped)) {
    const brand = brands.find(b => b.id === brandId);
    if (!brand) { log(`⚠️  brand ${brandId} not found — skipped`); continue; }
    const creds = brand.listmonk || {};
    if (!creds.url || !creds.username || !creds.password || !creds.fromEmail) {
      log(`⚠️  ${brand.name}: Listmonk not configured — skipping ${Object.keys(byOpp).length} opportunity group(s)`);
      continue;
    }

    const groupKeys = Object.keys(byOpp);
    // Listmonk list name encodes opp + variant so Day-3 nudges are on a
    // distinct list from Day-0 defaults (needed if we ever run them
    // concurrently, e.g. last-call catches up with fresh Day-0 picks).
    const listLabelFor = (opp, variant) => variant && variant !== 'default'
      ? `${opp}__${variant}` : opp;
    const listPrefix = `TAOS — ${brand.name}`;
    log(`📧 ${brand.name}: ensuring ${groupKeys.length} list(s) under "${listPrefix}"…`);

    const listLabels = groupKeys.map(k => listLabelFor(byOpp[k].opp, byOpp[k].variant));
    let listMap = {};
    try {
      if (dryRun) {
        listMap = Object.fromEntries(listLabels.map(l => [l, -1]));
      } else {
        const r = await ensureListmonkLists(creds, listLabels, listPrefix);
        listMap = r.lists || {};
      }
    } catch (e) {
      log(`❌ ${brand.name}: ensure-lists failed — ${e.message}`);
      continue;
    }

    const { features, lookup } = ctx[brandId] || {};
    for (const [, group] of Object.entries(byOpp)) {
      const { opp, variant, picks: list } = group;
      const label = listLabelFor(opp, variant);
      const listId = listMap[label];
      const tpl = templateFor(opp, variant);
      const vtag = variant && variant !== 'default' ? ` · ${variant}` : '';
      const campaignName = `${brand.name} · ${tpl.label}${vtag} · ${campaignTag}`;

      // 1) Import subscribers
      const subs = list.map(p => ({
        email: p.email,
        name:  (features?.[p.email]?.first_name || '') + ' ' + (features?.[p.email]?.last_name || ''),
        attribs: attribsForPick(p, features, lookup, campaignTag),
      }));

      log(`  → ${tpl.label}${vtag}: ${subs.length} subscribers → list ${listId}`);
      if (!dryRun) {
        try {
          await importListmonkSubscribers(creds, listId, subs);
        } catch (e) {
          log(`  ❌ import failed — ${e.message}`);
          results.push({ brand: brand.name, opp, variant, ok: false, error: e.message });
          continue;
        }
      }

      // 2) Create campaign (draft or running)
      const payload = {
        name:      campaignName,
        subject:   tpl.subject,
        fromEmail: creds.fromEmail,
        listIds:   [listId],
        body:      tpl.body,
        contentType: 'html',
        tags:      ['taos', 'retention', opp.toLowerCase(), `v_${variant}`, brand.id],
        ...(sendAt ? { sendAt } : {}),
        startNow,
      };

      if (dryRun) {
        log(`  ✓ [dry-run] would create campaign "${campaignName}"`);
        results.push({ brand: brand.name, opp, variant, ok: true, dryRun: true, recipients: subs.length });
        continue;
      }

      try {
        const resp = startNow || sendAt
          ? await sendListmonkCampaign(creds, payload)
          : await createListmonkCampaignDraft(creds, payload);
        const c = resp.campaign;
        log(`  ✅ campaign #${c?.id} — status: ${c?.status || 'draft'}`);
        results.push({
          brand: brand.name, opp, variant, ok: true,
          campaign_id: c?.id, status: c?.status,
          list_id: listId, recipients: subs.length,
        });
      } catch (e) {
        log(`  ❌ campaign create failed — ${e.message}`);
        results.push({ brand: brand.name, opp, variant, ok: false, error: e.message });
      }
    }
  }

  return results;
}
