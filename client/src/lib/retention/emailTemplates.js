/**
 * Per-opportunity email templates. Every field uses Listmonk's
 * `{{ .Attribs.xxx }}` merge syntax so a single campaign blasts
 * thousands of personalised messages off the subscriber attribs the
 * retention engine uploads.
 *
 * The subscriber CSV the planner publishes has these attributes:
 *   first_name, last_name, brand, opportunity, reason,
 *   primary_sku, sku_name, product_url, product_image, price,
 *   recommended_skus, recommended_names, recommended_urls,
 *   days_since_last, value_tier, lifecycle_stage, campaign_tag
 *
 * Every template is valid Listmonk HTML — drop in as-is. The body is
 * wrapped by Listmonk's site-wide template (header/footer/unsub) so we
 * only render the inner block.
 */

const BTN = (label, href) => `
  <p style="margin:28px 0;">
    <a href="${href}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;font-weight:600;text-decoration:none;">${label}</a>
  </p>`;

const PRODUCT_CARD = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="width:140px;padding:12px;vertical-align:top;">
        {{ if .Attribs.product_image }}<img src="{{ .Attribs.product_image }}" alt="{{ .Attribs.sku_name }}" width="120" style="border-radius:8px;display:block;" />{{ end }}
      </td>
      <td style="padding:14px 18px;vertical-align:top;">
        <div style="font-size:16px;font-weight:600;color:#111827;">{{ .Attribs.sku_name }}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px;">SKU · {{ .Attribs.primary_sku }}</div>
        {{ if .Attribs.price }}<div style="font-size:14px;color:#111827;margin-top:8px;">₹{{ .Attribs.price }}</div>{{ end }}
      </td>
    </tr>
  </table>`;

/**
 * Each entry: { subject, body, rationale }
 *   subject — can reference attribs (`{{ .Attribs.first_name }}` etc.)
 *   body    — HTML inner block
 *   rationale — one-line internal note shown in the UI
 */
export const OPP_TEMPLATES = {
  REPLENISH: {
    label: 'Replenish',
    subject: `{{ .Attribs.first_name | default "Hi" }}, time to restock {{ .Attribs.sku_name }}?`,
    rationale: 'Nudges buyers around their typical reorder window based on the SKU-level replenish clock.',
    body: `
<p>Hi {{ .Attribs.first_name | default "there" }},</p>
<p>It's been about {{ .Attribs.days_since_last }} days since your last order — your typical cadence suggests you'd be running low right now.</p>
${PRODUCT_CARD}
<p>One tap to reorder:</p>
${BTN('Reorder now', '{{ .Attribs.product_url }}')}
<p style="font-size:13px;color:#6b7280;margin-top:24px;">{{ .Attribs.reason }}</p>
`.trim(),
  },

  COMPLEMENT: {
    label: 'Complement',
    subject: `Goes great with your last order, {{ .Attribs.first_name | default "" }}`,
    rationale: 'Cross-sells an item frequently bought with what the customer already has.',
    body: `
<p>Hi {{ .Attribs.first_name | default "there" }},</p>
<p>Customers who bought what you bought recently tend to love this too:</p>
${PRODUCT_CARD}
${BTN('See it now', '{{ .Attribs.product_url }}')}
<p style="font-size:13px;color:#6b7280;margin-top:24px;">{{ .Attribs.reason }}</p>
`.trim(),
  },

  WINBACK: {
    label: 'Winback',
    subject: `We miss you, {{ .Attribs.first_name | default "there" }}`,
    rationale: 'Re-engages customers whose gap-since-last-order exceeds their usual cadence.',
    body: `
<p>Hi {{ .Attribs.first_name | default "there" }},</p>
<p>It's been {{ .Attribs.days_since_last }} days — longer than your usual rhythm. Here's something we think you'd like:</p>
${PRODUCT_CARD}
${BTN('Come back with 10% off', '{{ .Attribs.product_url }}')}
<p style="font-size:13px;color:#6b7280;margin-top:24px;">{{ .Attribs.reason }}</p>
`.trim(),
  },

  NEW_LAUNCH: {
    label: 'New Launch',
    subject: `{{ .Attribs.first_name | default "Heads up" }} — new arrival: {{ .Attribs.sku_name }}`,
    rationale: 'Announces fresh SKUs to the buyers most aligned with their category.',
    body: `
<p>Hi {{ .Attribs.first_name | default "there" }},</p>
<p>Just in — we thought of you first:</p>
${PRODUCT_CARD}
${BTN('See what\'s new', '{{ .Attribs.product_url }}')}
<p style="font-size:13px;color:#6b7280;margin-top:24px;">{{ .Attribs.reason }}</p>
`.trim(),
  },

  UPSELL: {
    label: 'Upsell',
    subject: `{{ .Attribs.first_name | default "" }}, you might like the upgraded version`,
    rationale: 'Shows a higher-value adjacent SKU to customers with strong AOV trajectory.',
    body: `
<p>Hi {{ .Attribs.first_name | default "there" }},</p>
<p>You've been buying in the same space for a while. Here's a step up we think fits:</p>
${PRODUCT_CARD}
${BTN('Take a look', '{{ .Attribs.product_url }}')}
<p style="font-size:13px;color:#6b7280;margin-top:24px;">{{ .Attribs.reason }}</p>
`.trim(),
  },

  VIP_PROTECT: {
    label: 'VIP Protect',
    subject: `{{ .Attribs.first_name | default "" }}, a little something just for you`,
    rationale: 'Thank-you drop to high-value customers who haven\'t been messaged in a while.',
    body: `
<p>Hi {{ .Attribs.first_name | default "there" }},</p>
<p>You've been one of our most loyal — we wanted to say thanks with early access to this:</p>
${PRODUCT_CARD}
${BTN('Claim your spot', '{{ .Attribs.product_url }}')}
<p style="font-size:13px;color:#6b7280;margin-top:24px;">{{ .Attribs.reason }}</p>
`.trim(),
  },
};

/** Public list for UI dropdowns. */
export const OPP_LIST = Object.keys(OPP_TEMPLATES);

export function templateFor(opp) {
  return OPP_TEMPLATES[opp] || OPP_TEMPLATES.REPLENISH;
}

/**
 * Render a preview by naive string-replace of common merge fields with
 * sample values. Listmonk will do the real templating server-side — this
 * is only used for the UI preview pane.
 */
export function renderPreview(body, sample = {}) {
  const s = {
    first_name: 'Kartik',
    last_name:  'More',
    sku_name:   'Organic Neem Powder 200g',
    primary_sku:'ORG-NP-200',
    product_url:'https://example.myshopify.com/products/organic-neem-powder',
    product_image:'',
    price: 349,
    reason: 'Typical reorder cadence 30d · last order 34d ago.',
    days_since_last: 34,
    value_tier: 'Core',
    ...sample,
  };
  let out = body;
  // Strip {{ if ... }} / {{ end }} blocks conservatively (preview only)
  out = out.replace(/\{\{\s*if\s+[^}]+\}\}/g, '');
  out = out.replace(/\{\{\s*end\s*\}\}/g, '');
  // Handle `| default "x"` fallbacks
  out = out.replace(/\{\{\s*\.Attribs\.([a-zA-Z_]+)\s*\|\s*default\s*"([^"]*)"\s*\}\}/g, (_, k, d) => {
    return (s[k] != null && s[k] !== '') ? s[k] : d;
  });
  out = out.replace(/\{\{\s*\.Attribs\.([a-zA-Z_]+)\s*\}\}/g, (_, k) => s[k] != null ? s[k] : '');
  return out;
}
