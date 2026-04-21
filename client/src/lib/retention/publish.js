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

  // Group picks: brand → opportunity → [picks]
  const grouped = {};
  for (const p of picks) {
    if (!p.brand_id) continue;
    (grouped[p.brand_id] ||= {})[p.opportunity] ||= [];
    grouped[p.brand_id][p.opportunity].push(p);
  }

  for (const [brandId, byOpp] of Object.entries(grouped)) {
    const brand = brands.find(b => b.id === brandId);
    if (!brand) { log(`⚠️  brand ${brandId} not found — skipped`); continue; }
    const creds = brand.listmonk || {};
    if (!creds.url || !creds.username || !creds.password || !creds.fromEmail) {
      log(`⚠️  ${brand.name}: Listmonk not configured — skipping ${Object.keys(byOpp).length} opportunity group(s)`);
      continue;
    }

    const opps = Object.keys(byOpp);
    const listPrefix = `TAOS — ${brand.name}`;
    log(`📧 ${brand.name}: ensuring ${opps.length} list(s) under "${listPrefix}"…`);

    let listMap = {};
    try {
      if (dryRun) {
        listMap = Object.fromEntries(opps.map(o => [o, -1]));
      } else {
        const r = await ensureListmonkLists(creds, opps, listPrefix);
        listMap = r.lists || {};
      }
    } catch (e) {
      log(`❌ ${brand.name}: ensure-lists failed — ${e.message}`);
      continue;
    }

    const { features, lookup } = ctx[brandId] || {};
    for (const [opp, list] of Object.entries(byOpp)) {
      const listId = listMap[opp];
      const tpl = templateFor(opp);
      const campaignName = `${brand.name} · ${tpl.label} · ${campaignTag}`;

      // 1) Import subscribers
      const subs = list.map(p => ({
        email: p.email,
        name:  (features?.[p.email]?.first_name || '') + ' ' + (features?.[p.email]?.last_name || ''),
        attribs: attribsForPick(p, features, lookup, campaignTag),
      }));

      log(`  → ${tpl.label}: ${subs.length} subscribers → list ${listId}`);
      if (!dryRun) {
        try {
          await importListmonkSubscribers(creds, listId, subs);
        } catch (e) {
          log(`  ❌ import failed — ${e.message}`);
          results.push({ brand: brand.name, opp, ok: false, error: e.message });
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
        tags:      ['taos', 'retention', opp.toLowerCase(), brand.id],
        ...(sendAt ? { sendAt } : {}),
        startNow,
      };

      if (dryRun) {
        log(`  ✓ [dry-run] would create campaign "${campaignName}"`);
        results.push({ brand: brand.name, opp, ok: true, dryRun: true, recipients: subs.length });
        continue;
      }

      try {
        const resp = startNow || sendAt
          ? await sendListmonkCampaign(creds, payload)
          : await createListmonkCampaignDraft(creds, payload);
        const c = resp.campaign;
        log(`  ✅ campaign #${c?.id} — status: ${c?.status || 'draft'}`);
        results.push({
          brand: brand.name, opp, ok: true,
          campaign_id: c?.id, status: c?.status,
          list_id: listId, recipients: subs.length,
        });
      } catch (e) {
        log(`  ❌ campaign create failed — ${e.message}`);
        results.push({ brand: brand.name, opp, ok: false, error: e.message });
      }
    }
  }

  return results;
}
