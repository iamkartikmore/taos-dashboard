/**
 * Per-opportunity SMS copy. SMS is much tighter than email:
 *   - 160-char ceiling target (we treat 300 as the hard limit because
 *     operators will segment if needed, but pay-per-segment adds up).
 *   - No HTML, no images — a single short line + URL.
 *   - Brand prefix is prepended by the dispatcher, not baked into the body.
 *
 * Merge field syntax mirrors the email templates: `{{first_name}}`,
 * `{{sku_name}}`, `{{product_url}}`. The dispatcher does the interpolation
 * right before handing the payload off to the SMS provider — we leave the
 * placeholders in the body rather than trying to preformat here.
 */

export const SMS_TEMPLATES = {
  REPLENISH: {
    label: 'Replenish · SMS',
    default: "Hi {{first_name}}, running low on {{sku_name}}? One-tap reorder: {{product_url}}",
    nudge:     "{{first_name}}, saved your reorder of {{sku_name}} — {{product_url}}",
    last_call: "Last chance on {{sku_name}}, {{first_name}} — {{product_url}}",
  },
  COMPLEMENT: {
    label: 'Complement · SMS',
    default: "Hi {{first_name}}, this goes great with your last order: {{product_url}}",
  },
  WINBACK: {
    label: 'Winback · SMS',
    default: "Miss you, {{first_name}}! 10% off awaits: {{product_url}}",
    offer:     "{{first_name}}, 15% off your next order — no code needed: {{product_url}}",
    last_call: "Last nudge, {{first_name}} — 15% off is yours: {{product_url}}",
  },
  NEW_LAUNCH: {
    label: 'New Launch · SMS',
    default: "Hi {{first_name}}, new in: {{sku_name}}. Have a look → {{product_url}}",
  },
  UPSELL: {
    label: 'Upsell · SMS',
    default: "Hi {{first_name}}, the upgraded version is here: {{product_url}}",
  },
  VIP_PROTECT: {
    label: 'VIP Protect · SMS',
    default: "Hi {{first_name}}, a quick hello from us — reply if we can help with anything.",
    concierge: "{{first_name}}, checking in — anything you'd like us to source or stock? Just reply.",
  },
};

export function smsBodyFor(opp, variant = 'default') {
  const entry = SMS_TEMPLATES[opp] || SMS_TEMPLATES.REPLENISH;
  return entry[variant] || entry.default;
}

export function renderSmsPreview(body, sample = {}) {
  const s = {
    first_name:  'Kartik',
    sku_name:    'Organic Neem Powder 200g',
    product_url: 'https://example.com/p/neem',
    ...sample,
  };
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, k) => s[k] != null ? s[k] : '');
}
