/**
 * RFM segment → email template library.
 *
 * Each template exports: { key, name, subject, preheader, goal, cta, body(ctx) }
 * where `body(ctx)` is a function that returns Listmonk-compatible HTML using:
 *   ctx.brand       { name, shopUrl, fromEmail, logoUrl? }
 *   ctx.segment     { key, label, size }
 *   ctx.products    [{ title, handle, price, image, url }]   (3–4 enriched items)
 *   ctx.collection  { title, handle, url } | null
 *   ctx.couponCode  string | null
 *
 * The returned HTML uses Listmonk subscriber variables:
 *   {{ .Subscriber.Name }}
 *   {{ .Subscriber.Attribs.first_name }}     (set during CSV import)
 *   {{ .Subscriber.Attribs.lifetime_orders }}
 *   {{ .Subscriber.Attribs.lifetime_spent }}
 *
 * Listmonk runs Go templates before send; we emit raw {{ ... }} so they pass through.
 */

export const SEGMENT_META = {
  Champions:          { label: 'Champions',        goal: 'Reward loyalty, VIP feel',             cta: 'Unlock VIP picks' },
  Loyal:              { label: 'Loyal',            goal: 'Deepen relationship, cross-sell',      cta: 'See what\u2019s new' },
  'Potential Loyal':  { label: 'Potential Loyal',  goal: 'Nudge to repeat purchase',             cta: 'Complete your collection' },
  New:                { label: 'New',              goal: 'Onboard, first-week engagement',       cta: 'Discover the bestsellers' },
  'At Risk':          { label: 'At Risk',          goal: 'Re-engage before churn',               cta: 'Come back, here\u2019s 10% off' },
  "Can't Lose":       { label: "Can't Lose",       goal: 'High-LTV recovery with strong offer',  cta: 'We miss you — save 15%' },
  Dormant:            { label: 'Dormant',          goal: 'Reactivate long-inactive buyers',      cta: 'It\u2019s been a while' },
  Promising:          { label: 'Promising',        goal: 'Accelerate early repeat behavior',     cta: 'Round out your garden' },
};

/* ─── SHARED STYLE BLOCKS (inline — email clients strip <style>) ───── */

const shell = (innerHtml, { brand, preheader = '' }) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeAttr(brand?.name || '')}</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ec;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e293b;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f2ec;">${escapeText(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f2ec;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06);">
        <tr><td style="padding:26px 28px 10px;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;letter-spacing:0.4px;">${escapeText(brand?.name || 'Your shop')}</div>
        </td></tr>
        ${innerHtml}
        <tr><td style="padding:22px 28px 28px;border-top:1px solid #f1f5f9;color:#64748b;font-size:11px;line-height:1.6;">
          You\u2019re receiving this because you\u2019ve shopped with ${escapeText(brand?.name || 'us')}.
          <a href="{{ UnsubscribeURL }}" style="color:#94a3b8;">Unsubscribe</a> \u00b7
          <a href="{{ MessageURL }}" style="color:#94a3b8;">View in browser</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const heroBlock = ({ kicker, title, sub, ctaText, ctaUrl, accent = '#15803d' }) => `<tr><td style="padding:18px 28px 6px;">
  <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${accent};margin-bottom:10px;">${escapeText(kicker)}</div>
  <div style="font-size:28px;font-weight:800;line-height:1.15;color:#0f172a;margin-bottom:10px;">${escapeText(title)}</div>
  <div style="font-size:14px;line-height:1.6;color:#475569;margin-bottom:22px;">${sub}</div>
  <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:600;">${escapeText(ctaText)} &rarr;</a>
</td></tr>`;

const productGrid = (products, { accent = '#15803d' } = {}) => {
  if (!products?.length) return '';
  const rows = products.slice(0, 4).map(p => `
    <td width="50%" valign="top" style="padding:10px;">
      <a href="${escapeAttr(p.url)}" style="text-decoration:none;color:inherit;">
        ${p.image ? `<img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.title)}" width="260" style="display:block;width:100%;max-width:260px;border-radius:10px;background:#f1f5f9;" />` : `<div style="background:#f1f5f9;border-radius:10px;height:180px;"></div>`}
        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:10px;line-height:1.35;">${escapeText(p.title)}</div>
        <div style="font-size:12px;color:${accent};font-weight:600;margin-top:4px;">${p.price ? `\u20b9${Math.round(p.price).toLocaleString('en-IN')}` : 'Shop now'}</div>
      </a>
    </td>`);
  // pair into rows of 2
  const paired = [];
  for (let i = 0; i < rows.length; i += 2) {
    paired.push(`<tr>${rows[i] || ''}${rows[i + 1] || '<td width="50%"></td>'}</tr>`);
  }
  return `<tr><td style="padding:6px 18px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${paired.join('')}</table>
  </td></tr>`;
};

const couponBlock = (code, note) => {
  if (!code) return '';
  return `<tr><td style="padding:14px 28px;">
    <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px dashed #d97706;border-radius:12px;padding:18px;text-align:center;">
      <div style="font-size:11px;color:#92400e;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Your code</div>
      <div style="font-size:24px;font-weight:800;color:#78350f;letter-spacing:3px;margin:6px 0;">${escapeText(code)}</div>
      ${note ? `<div style="font-size:11px;color:#92400e;">${escapeText(note)}</div>` : ''}
    </div>
  </td></tr>`;
};

const dividerBlock = () => `<tr><td style="padding:0 28px;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>`;

const collectionCta = (collection, accent = '#15803d') => {
  if (!collection) return '';
  return `<tr><td style="padding:14px 28px 8px;text-align:center;">
    <a href="${escapeAttr(collection.url)}" style="color:${accent};text-decoration:underline;font-size:13px;font-weight:600;">Browse the full ${escapeText(collection.title)} collection &rarr;</a>
  </td></tr>`;
};

/* ─── UTILITIES ─────────────────────────────────────────────────── */

function escapeText(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeText(s).replace(/'/g, '&#39;'); }

const firstName = () => `{{ default "friend" .Subscriber.Attribs.first_name }}`;
const lifetimeOrders = () => `{{ default "" .Subscriber.Attribs.lifetime_orders }}`;

/* ─── TEMPLATES ─────────────────────────────────────────────────── */

export const TEMPLATES = [
  /* ───── CHAMPIONS ───── */
  {
    key: 'champions-vip',
    segment: 'Champions',
    name: 'Champions \u2014 VIP Picks',
    subject: 'Hi ${firstName}, your VIP picks are ready \ud83c\udf3f',
    preheader: 'Early access to what just landed \u2014 because you\u2019re one of our best.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: `VIP \u00b7 ${ctx.brand?.name || ''}`,
        title: `Hey ${firstName()}, you\u2019re in the top 5%.`,
        sub: `You\u2019ve shopped with us ${lifetimeOrders()} times \u2014 so you get first dibs on what\u2019s just arrived, plus a handpicked set we think you\u2019ll love.`,
        ctaText: 'See my VIP set',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
        accent: '#15803d',
      })}
      ${productGrid(ctx.products, { accent: '#15803d' })}
      ${collectionCta(ctx.collection)}
      ${couponBlock(ctx.couponCode, 'Thanks for being a top customer.')}
    `, { brand: ctx.brand, preheader: 'Early access + a little something on us.' }),
  },

  /* ───── LOYAL ───── */
  {
    key: 'loyal-newarrivals',
    segment: 'Loyal',
    name: 'Loyal \u2014 New Arrivals',
    subject: 'New for ${firstName}: fresh picks dropped this week',
    preheader: 'Stuff we think you\u2019ll actually want \u2014 based on what you\u2019ve loved before.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: 'Just landed',
        title: `${firstName()}, this one\u2019s for you.`,
        sub: 'Our curators pulled these four based on what you\u2019ve ordered before. Single-tap to explore.',
        ctaText: 'Browse new arrivals',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
      })}
      ${productGrid(ctx.products)}
      ${collectionCta(ctx.collection)}
    `, { brand: ctx.brand, preheader: 'Hand-picked for repeat buyers.' }),
  },

  /* ───── POTENTIAL LOYAL ───── */
  {
    key: 'potential-complete',
    segment: 'Potential Loyal',
    name: 'Potential Loyal \u2014 Complete Your Collection',
    subject: '${firstName}, round out what you started \ud83c\udf31',
    preheader: 'You\u2019re closer than you think \u2014 here\u2019s what fits with what you\u2019ve already got.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: 'You\u2019ll like these',
        title: `Complete the set, ${firstName()}.`,
        sub: `Based on your last order, these are the natural next picks. Pair anything below with what you already own \u2014 no guesswork.`,
        ctaText: 'See matching picks',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
        accent: '#0d9488',
      })}
      ${productGrid(ctx.products, { accent: '#0d9488' })}
      ${collectionCta(ctx.collection, '#0d9488')}
      ${couponBlock(ctx.couponCode, 'Valid on your next order.')}
    `, { brand: ctx.brand, preheader: 'Your collection, completed.' }),
  },

  /* ───── NEW ───── */
  {
    key: 'new-welcome',
    segment: 'New',
    name: 'New \u2014 Welcome + Bestsellers',
    subject: 'Welcome to ${brandName}, ${firstName} \ud83c\udf3f',
    preheader: 'Thanks for joining \u2014 here\u2019s what everyone\u2019s loving right now.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: 'Welcome',
        title: `Glad you\u2019re here, ${firstName()}.`,
        sub: `You just joined thousands of people growing better with ${escapeText(ctx.brand?.name || 'us')}. These are the four things most new customers start with \u2014 tap any to learn more.`,
        ctaText: 'Browse bestsellers',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
        accent: '#0369a1',
      })}
      ${productGrid(ctx.products, { accent: '#0369a1' })}
      ${dividerBlock()}
      <tr><td style="padding:18px 28px;font-size:13px;color:#475569;line-height:1.7;">
        <b style="color:#0f172a;">What makes us different:</b><br>
        \u00b7 Hand-picked by real growers, not algorithms.<br>
        \u00b7 Free shipping over \u20b9499 \u00b7 Dispatched within 24h.<br>
        \u00b7 Questions? Reply to this email \u2014 a human responds within a day.
      </td></tr>
      ${couponBlock(ctx.couponCode, 'Use on your next order.')}
    `, { brand: ctx.brand, preheader: 'Welcome \u2014 bestsellers + a little gift inside.' }),
  },

  /* ───── AT RISK ───── */
  {
    key: 'atrisk-comeback',
    segment: 'At Risk',
    name: 'At Risk \u2014 Come Back (soft discount)',
    subject: '${firstName}, we noticed you\u2019ve been quiet...',
    preheader: 'Here\u2019s a small something to bring you back.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: 'We miss you',
        title: `${firstName()}, it\u2019s not the same without you.`,
        sub: `It\u2019s been a while since your last order. We\u2019ve added a lot since \u2014 and because you\u2019ve ordered ${lifetimeOrders()} times before, here\u2019s 10% off to come back.`,
        ctaText: 'Reclaim my 10% off',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
        accent: '#d97706',
      })}
      ${couponBlock(ctx.couponCode, 'One-time use \u00b7 expires in 14 days.')}
      ${productGrid(ctx.products, { accent: '#d97706' })}
      ${collectionCta(ctx.collection, '#d97706')}
    `, { brand: ctx.brand, preheader: '10% off to bring you back.' }),
  },

  /* ───── CAN'T LOSE ───── */
  {
    key: 'cantlose-vip-recovery',
    segment: "Can't Lose",
    name: "Can\u2019t Lose \u2014 VIP Recovery (15% off)",
    subject: '${firstName}, let us make this right \ud83c\udf3f',
    preheader: 'You\u2019re one of our most valued customers \u2014 come back at 15% off.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: 'VIP \u00b7 private offer',
        title: `${firstName()}, this is personal.`,
        sub: `You spent a lot with us. Then it went quiet. If something went wrong, hit reply and we\u2019ll fix it. Meanwhile \u2014 here\u2019s 15% off on anything you want, no minimum.`,
        ctaText: 'Shop at 15% off',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
        accent: '#b91c1c',
      })}
      ${couponBlock(ctx.couponCode, 'No minimum \u00b7 private code \u00b7 7 days.')}
      ${productGrid(ctx.products, { accent: '#b91c1c' })}
    `, { brand: ctx.brand, preheader: 'Private 15% off \u2014 just for you.' }),
  },

  /* ───── DORMANT ───── */
  {
    key: 'dormant-reactivate',
    segment: 'Dormant',
    name: 'Dormant \u2014 Reactivation',
    subject: 'Been a while \u2014 here\u2019s what\u2019s changed',
    preheader: 'New products, new tools, same people. Come take a look.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: 'What you\u2019ve missed',
        title: `Hey ${firstName()} \u2014 a lot has changed.`,
        sub: 'Over the past few months we\u2019ve added dozens of new picks and quietly fixed a lot of things people asked for. This is the quick tour.',
        ctaText: 'See what\u2019s new',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
        accent: '#6366f1',
      })}
      ${productGrid(ctx.products, { accent: '#6366f1' })}
      ${couponBlock(ctx.couponCode, '20% off your comeback order.')}
    `, { brand: ctx.brand, preheader: 'New arrivals + a welcome-back gift.' }),
  },

  /* ───── PROMISING ───── */
  {
    key: 'promising-curate',
    segment: 'Promising',
    name: 'Promising \u2014 Curated For You',
    subject: '${firstName}, we curated this for you',
    preheader: 'A handful of picks based on what you\u2019ve already got.',
    body: ctx => shell(`
      ${heroBlock({
        kicker: 'Curated',
        title: `${firstName()}, these go with what you have.`,
        sub: `Four items our team thinks pair well with your last purchase. Nothing random \u2014 this is what we\u2019d recommend if you asked us in person.`,
        ctaText: 'Explore picks',
        ctaUrl: ctx.collection?.url || ctx.brand?.shopUrl,
        accent: '#7c3aed',
      })}
      ${productGrid(ctx.products, { accent: '#7c3aed' })}
      ${collectionCta(ctx.collection, '#7c3aed')}
    `, { brand: ctx.brand, preheader: 'Hand-curated next picks.' }),
  },
];

/* ─── GROUPING ──────────────────────────────────────────────────── */

export function templatesForSegment(segmentKey) {
  return TEMPLATES.filter(t => t.segment === segmentKey);
}

/**
 * Render the template to final HTML + resolve subject string.
 * Returns { name, subject, body } where `subject` has ${firstName}/${brandName} resolved
 * to Listmonk Go-template placeholders (so Listmonk's per-subscriber rendering works).
 */
export function renderTemplate(template, ctx) {
  const body = template.body(ctx);
  const subject = template.subject
    .replace(/\$\{firstName\}/g, `{{ default "friend" .Subscriber.Attribs.first_name }}`)
    .replace(/\$\{brandName\}/g, ctx.brand?.name || '');
  return {
    name:     template.name,
    subject,
    body,
    preheader: template.preheader,
  };
}
