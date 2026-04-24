/**
 * Email flow engine — declarative definitions of the 12 always-on
 * behavioral flows every D2C brand should run, plus an orchestrator
 * that computes which subscribers are currently due each step.
 *
 * Listmonk has no native flow engine — it's a broadcast tool. We
 * simulate flows by:
 *   1. Defining each flow as a sequence of steps (delay + content)
 *   2. Computing per-subscriber flow state from Shopify events
 *   3. Pushing transactional sends via Listmonk's /tx endpoint
 *
 * This file is the definition + state-computation layer. The actual
 * send orchestrator runs as a server cron job (or manual trigger
 * from the EmailOps page) and uses these definitions to decide what
 * to send to whom today.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/* ══════════════════════════════════════════════════════════════
   THE 12 FLOWS — each with trigger, steps, expected revenue tier
   ══════════════════════════════════════════════════════════ */

export const FLOWS = [
  {
    id: 'welcome',
    name: 'Welcome Series',
    tier: 1,
    priority: 'critical',
    trigger: {
      type: 'first_order',
      condition: 'Customer placed their first Shopify order in last 24h',
    },
    description: 'Onboard new buyers to a second purchase in 14 days.',
    expectedRevenue: '22-30% of recipients convert',
    steps: [
      { id: 'welcome_1', delay: 10 * 60 * 1000, subject: 'Welcome to {{brand}} — enjoy 10% off your next order',
        template: 'welcome_1',
        goal: 'First touch + discount code',
        discount: { code: 'WELCOME10', pct: 10, expiryHours: 48 } },
      { id: 'welcome_2', delay: 2 * DAY_MS, subject: 'The story behind {{brand}}',
        template: 'welcome_2',
        goal: 'Brand story — build trust, no pitch' },
      { id: 'welcome_3', delay: 5 * DAY_MS, subject: 'Our 5 bestsellers you shouldn\'t miss',
        template: 'welcome_3',
        goal: 'Bestsellers by category affinity' },
      { id: 'welcome_4', delay: 9 * DAY_MS, subject: 'What customers say about us',
        template: 'welcome_4',
        goal: 'Social proof — reviews with photos' },
      { id: 'welcome_5', delay: 13 * DAY_MS, subject: 'Your 10% off expires tomorrow',
        template: 'welcome_5',
        goal: 'Urgency reminder before code expires' },
    ],
  },
  {
    id: 'abandoned_cart',
    name: 'Abandoned Cart',
    tier: 1,
    priority: 'critical',
    trigger: {
      type: 'checkout_abandoned',
      condition: 'Shopify abandoned_checkout record, not converted within 1 hour',
    },
    description: 'Recover 10-15% of abandoned carts — highest-ROI flow.',
    expectedRevenue: '10-15% of carts recovered; typically ₹200-800 per send',
    steps: [
      { id: 'cart_1', delay: 1 * HOUR_MS, subject: 'Did something go wrong?',
        template: 'cart_1',
        goal: 'Gentle nudge + cart image' },
      { id: 'cart_2', delay: 24 * HOUR_MS, subject: 'Still thinking? Here\'s what others say',
        template: 'cart_2',
        goal: 'Social proof on the abandoned product' },
      { id: 'cart_3', delay: 72 * HOUR_MS, subject: 'Last chance: 10% off if you finish in 24h',
        template: 'cart_3',
        discount: { code: 'CART10', pct: 10, expiryHours: 24 },
        goal: 'Final urgency + incentive' },
    ],
  },
  {
    id: 'browse_abandonment',
    name: 'Browse Abandonment',
    tier: 1,
    priority: 'high',
    trigger: {
      type: 'product_viewed_repeatedly',
      condition: 'Same product viewed 3+ times, no add-to-cart (via Clarity + Shopify)',
    },
    description: 'Capture viewers who didn\'t add to cart.',
    expectedRevenue: '3-5% conversion',
    steps: [
      { id: 'browse_1', delay: 4 * HOUR_MS, subject: 'You were eyeing this...',
        template: 'browse_1',
        goal: 'Product + 2 similar alternatives' },
    ],
  },
  {
    id: 'post_purchase',
    name: 'Post-Purchase',
    tier: 1,
    priority: 'critical',
    trigger: {
      type: 'order_placed',
      condition: 'Any Shopify order — fires on every purchase',
    },
    description: 'Onboard buyers, gather reviews, cross-sell at the right moment.',
    expectedRevenue: 'Lifts reviews 3-5×; cross-sell drives 8-12% repeat',
    steps: [
      { id: 'post_1', delay: 0,              subject: 'Your order is confirmed',
        template: 'post_1',
        goal: 'Transactional confirmation' },
      { id: 'post_2', delay: 9 * DAY_MS,     subject: 'How to care for your {{category}}',
        template: 'post_2',
        goal: 'Use/care guide' },
      { id: 'post_3', delay: 14 * DAY_MS,    subject: 'How was it? We\'d love a review',
        template: 'post_3',
        goal: 'Review request' },
      { id: 'post_4', delay: 21 * DAY_MS,    subject: 'You\'ll love these with your {{product}}',
        template: 'post_4',
        goal: 'Cross-sell based on category affinity' },
    ],
  },
  {
    id: 'winback',
    name: 'Win-Back',
    tier: 1,
    priority: 'high',
    trigger: {
      type: 'inactive_60_days',
      condition: 'No purchase in 60 days AND previously placed 1+ order',
    },
    description: 'Reactivate lapsed buyers with escalating discount ladder.',
    expectedRevenue: '8-12% reactivation rate',
    steps: [
      { id: 'winback_1', delay: 0,           subject: 'We miss you — here\'s 15% off',
        template: 'winback_1',
        discount: { code: 'COMEBACK15', pct: 15, expiryHours: 168 },
        goal: 'First win-back with discount' },
      { id: 'winback_2', delay: 8 * DAY_MS,  subject: 'What you\'ve been missing',
        template: 'winback_2',
        goal: 'New arrivals content — no discount' },
      { id: 'winback_3', delay: 15 * DAY_MS, subject: 'Final offer — 20% off',
        template: 'winback_3',
        discount: { code: 'LAST20', pct: 20, expiryHours: 72 },
        goal: 'Biggest discount — last attempt' },
    ],
  },
  {
    id: 'replenishment',
    name: 'Replenishment',
    tier: 2,
    priority: 'medium',
    trigger: {
      type: 'days_since_category_purchase',
      condition: 'Days since last consumable purchase = predicted cycle',
    },
    description: 'Prompt re-order on consumables (seeds, succulents, plants).',
    expectedRevenue: '15-25% repeat-order lift on consumables',
    applicableCategories: ['seeds', 'succulent', 'plants'],
    steps: [
      { id: 'replen_1', delay: 0, subject: 'Time to restock?',
        template: 'replen_1',
        goal: 'One-click reorder with last address pre-filled' },
    ],
  },
  {
    id: 'vip_loyalty',
    name: 'VIP Loyalty',
    tier: 2,
    priority: 'medium',
    trigger: {
      type: 'vip_monthly',
      condition: 'Top 20% by LTV — send on 1st of every month',
    },
    description: 'Early access + exclusive bundles for top customers.',
    expectedRevenue: 'VIPs respond at 3-5× general list',
    steps: [
      { id: 'vip_1', delay: 0, subject: 'VIP early access: {{campaign_name}}',
        template: 'vip_1',
        goal: 'Exclusive window before broadcast' },
    ],
  },
  {
    id: 'category_upsell',
    name: 'Category Upsell',
    tier: 2,
    priority: 'medium',
    trigger: {
      type: 'category_affinity_monthly',
      condition: 'Customer has 2+ purchases in category — send best-in-category monthly',
    },
    description: 'Deepen spend in customer\'s strongest category.',
    expectedRevenue: '6-9% conversion',
    steps: [
      { id: 'upsell_1', delay: 0, subject: 'New in {{category}}: hand-picked for you',
        template: 'upsell_1',
        goal: 'Category-specific new arrivals' },
    ],
  },
  {
    id: 'birthday',
    name: 'Birthday',
    tier: 2,
    priority: 'medium',
    trigger: {
      type: 'birthday_match',
      condition: 'Customer birthday = today (from customer profile custom field)',
    },
    description: 'Personal greeting + 20% gift code.',
    expectedRevenue: '25-35% code redemption — one of highest-open emails',
    steps: [
      { id: 'bday_1', delay: 0, subject: 'Happy birthday, {{firstName}} — 20% off',
        template: 'bday_1',
        discount: { code: 'BDAY20', pct: 20, expiryHours: 168 },
        goal: 'Birthday gift' },
    ],
  },
  {
    id: 'back_in_stock',
    name: 'Back in Stock',
    tier: 3,
    priority: 'medium',
    trigger: {
      type: 'restock_notification',
      condition: 'Product restocked + customer browsed/waitlisted it',
    },
    description: 'Notify interested customers instantly.',
    expectedRevenue: '15-30% conversion — strongest intent signal',
    steps: [
      { id: 'bis_1', delay: 0, subject: '{{product}} is back in stock',
        template: 'bis_1',
        goal: 'Immediate notify + urgency' },
    ],
  },
  {
    id: 'review_followup',
    name: 'Review Follow-Up',
    tier: 3,
    priority: 'low',
    trigger: {
      type: 'review_submitted',
      condition: 'Customer submitted a review on a Shopify product',
    },
    description: 'Branch by rating — referral to 5-star, recovery to 1-3-star.',
    expectedRevenue: 'Saves refunds + drives ~8% new customers via referral',
    steps: [
      { id: 'review_5star',    delay: 0, subject: 'Thank you! Share with a friend, both get 10% off',
        template: 'review_5star',   condition: 'rating >= 5',
        goal: 'Referral program trigger' },
      { id: 'review_low',      delay: 0, subject: 'We\'d like to make this right',
        template: 'review_low',      condition: 'rating <= 3',
        goal: 'Service recovery — real human reply' },
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset / Last-Call',
    tier: 3,
    priority: 'medium',
    trigger: {
      type: 'no_engagement_180d',
      condition: 'No open + no click + no purchase in 180 days',
    },
    description: 'Protect sender reputation by pruning dead weight.',
    expectedRevenue: 'Not revenue-positive directly — but protects deliverability for the whole program',
    steps: [
      { id: 'sunset_1', delay: 0, subject: 'Stay on our list? Click to confirm',
        template: 'sunset_1',
        goal: 'Require click — remove non-responders' },
    ],
  },
];

/* ══════════════════════════════════════════════════════════════
   STATE COMPUTATION — given a subscriber + their Shopify history
   + opt-in state, determine which flow+step is due TODAY.
   Returns an array of { flowId, stepId, subject, dueReason } rows
   the orchestrator can send.
   ══════════════════════════════════════════════════════════ */

const now = () => Date.now();

/* Has this subscriber/step already been sent? The orchestrator
   tracks this in LS (or server). We accept a sentMap { "email|stepId" → ts }
   and refuse to double-send within the flow. */
function alreadySent(sentMap, email, stepId) {
  return !!sentMap[`${email}|${stepId}`];
}

function stepDue(triggerTs, step) {
  return triggerTs + step.delay <= now();
}

/* Welcome series — trigger = first order ts */
function dueFromWelcome(sub, sentMap) {
  if (sub.orderCount !== 1 || !sub.firstOrderAt) return [];
  const triggerTs = new Date(sub.firstOrderAt).getTime();
  const flow = FLOWS.find(f => f.id === 'welcome');
  const out = [];
  for (const step of flow.steps) {
    if (alreadySent(sentMap, sub.email, step.id)) continue;
    if (!stepDue(triggerTs, step)) continue;
    out.push({ flowId: 'welcome', stepId: step.id, subject: step.subject, sub, step, dueReason: 'First-order welcome series' });
    break; // send one step per run, preserve sequence
  }
  return out;
}

/* Abandoned cart — trigger comes from abandoned_checkouts list */
export function dueFromAbandonedCart(cart, sentMap) {
  const triggerTs = cart.created_at ? new Date(cart.created_at).getTime() : 0;
  if (!triggerTs || !cart.email) return [];
  const flow = FLOWS.find(f => f.id === 'abandoned_cart');
  const out = [];
  for (const step of flow.steps) {
    if (alreadySent(sentMap, cart.email, step.id)) continue;
    if (!stepDue(triggerTs, step)) continue;
    out.push({ flowId: 'abandoned_cart', stepId: step.id, subject: step.subject, cart, step, dueReason: 'Abandoned checkout' });
    break;
  }
  return out;
}

/* Post-purchase — trigger = order.created_at, fires for each order independently */
function dueFromPostPurchase(sub, sentMap) {
  // Use last order as the trigger; each order can fire its own sequence,
  // but we keep it simple here — last order drives next educational steps
  if (!sub.lastOrderAt) return [];
  const triggerTs = new Date(sub.lastOrderAt).getTime();
  const flow = FLOWS.find(f => f.id === 'post_purchase');
  const out = [];
  for (const step of flow.steps) {
    // Skip the instant confirmation if the order is already old (Shopify sends those)
    if (step.id === 'post_1') continue;
    const key = `${sub.email}|${step.id}|${triggerTs}`; // per-order idempotency
    if (sentMap[key]) continue;
    if (!stepDue(triggerTs, step)) continue;
    out.push({ flowId: 'post_purchase', stepId: step.id, sentKey: key, subject: step.subject, sub, step, dueReason: 'Post-purchase' });
    break;
  }
  return out;
}

/* Win-back — 60 days since last order for existing customers */
function dueFromWinBack(sub, sentMap) {
  if (!sub.lastOrderAt || sub.orderCount < 1) return [];
  const daysSince = (now() - new Date(sub.lastOrderAt).getTime()) / DAY_MS;
  if (daysSince < 60 || daysSince > 90) return []; // window
  const flow = FLOWS.find(f => f.id === 'winback');
  // Use 60-day mark as synthetic trigger
  const triggerTs = new Date(sub.lastOrderAt).getTime() + 60 * DAY_MS;
  const out = [];
  for (const step of flow.steps) {
    if (alreadySent(sentMap, sub.email, step.id)) continue;
    if (!stepDue(triggerTs, step)) continue;
    out.push({ flowId: 'winback', stepId: step.id, subject: step.subject, sub, step, dueReason: 'Inactive 60d' });
    break;
  }
  return out;
}

/* Replenishment — for consumable categories, ~45 day cycle */
function dueFromReplenishment(sub, sentMap) {
  const consumableCats = ['seeds', 'plants', 'succulent'];
  if (!consumableCats.includes(sub.category.key)) return [];
  if (!sub.lastOrderAt) return [];
  const daysSince = (now() - new Date(sub.lastOrderAt).getTime()) / DAY_MS;
  if (daysSince < 40 || daysSince > 50) return []; // tight window
  const step = FLOWS.find(f => f.id === 'replenishment').steps[0];
  if (alreadySent(sentMap, sub.email, `replen_${new Date(sub.lastOrderAt).getTime()}`)) return [];
  return [{
    flowId: 'replenishment', stepId: 'replen_1', subject: step.subject,
    sentKey: `${sub.email}|replen_${new Date(sub.lastOrderAt).getTime()}`,
    sub, step, dueReason: `${Math.round(daysSince)}d since last consumable`,
  }];
}

/* Sunset — 180+ days inactive */
function dueFromSunset(sub, sentMap) {
  if (!sub.lastOrderAt) return [];
  const daysSince = (now() - new Date(sub.lastOrderAt).getTime()) / DAY_MS;
  const daysSinceOpen = sub.lastOpenAt ? (now() - new Date(sub.lastOpenAt).getTime()) / DAY_MS : Infinity;
  if (daysSince < 180 || daysSinceOpen < 90) return [];
  if (alreadySent(sentMap, sub.email, 'sunset_1')) return [];
  const step = FLOWS.find(f => f.id === 'sunset').steps[0];
  return [{ flowId: 'sunset', stepId: 'sunset_1', subject: step.subject, sub, step, dueReason: '180d dead' }];
}

/* Main orchestrator — computes everything due today across all flows */
export function computeDueSends({ subscribers = [], abandonedCarts = [], sentMap = {} } = {}) {
  const due = [];
  for (const sub of subscribers) {
    due.push(...dueFromWelcome(sub, sentMap));
    due.push(...dueFromPostPurchase(sub, sentMap));
    due.push(...dueFromWinBack(sub, sentMap));
    due.push(...dueFromReplenishment(sub, sentMap));
    due.push(...dueFromSunset(sub, sentMap));
  }
  for (const cart of abandonedCarts) {
    due.push(...dueFromAbandonedCart(cart, sentMap));
  }
  return due;
}

/* Projected volume — before sending, compute what WOULD go out
   across all flows for the given subscriber set.  Used for capacity
   planning + dry-run reviews. */
export function projectVolume(dueSends = []) {
  const byFlow = {};
  for (const d of dueSends) {
    byFlow[d.flowId] = (byFlow[d.flowId] || 0) + 1;
  }
  return {
    total: dueSends.length,
    byFlow: Object.entries(byFlow)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ flowId: k, name: FLOWS.find(f => f.id === k)?.name || k, count: v })),
  };
}

/* ══════════════════════════════════════════════════════════════
   WEEKLY BROADCAST CALENDAR — day × segment × campaign type
   Feeds the EmailOps calendar UI and cron scheduler.
   ══════════════════════════════════════════════════════════ */

export const WEEKLY_CALENDAR = [
  { day: 'Monday',    time: '09:30', label: 'Educational', segments: ['hot', 'warm'],
    kind: 'educational', description: 'Seasonal / how-to content. No discount. Primes engagement for the week.',
    expectedOpen: '32-38%', expectedClick: '4-6%' },
  { day: 'Tuesday',   time: '11:00', label: 'New Arrivals', segments: ['hot', 'warm'],
    kind: 'product', description: 'New launches + category-affinity segmentation.',
    expectedOpen: '28-34%', expectedClick: '5-8%' },
  { day: 'Wednesday', time: '16:00', label: 'Brand content', segments: ['hot'],
    kind: 'brand', description: 'Long-form value content. User-generated content. No CTA.',
    expectedOpen: '35-42%', expectedClick: '3-5%' },
  { day: 'Thursday',  time: '10:00', label: 'Conversion', segments: ['hot', 'warm'],
    kind: 'offer', description: 'Biggest offer email of the week. Time-boxed urgency.',
    expectedOpen: '30-36%', expectedClick: '6-10%' },
  { day: 'Thursday',  time: '18:00', label: 'Retarget non-openers', segments: ['hot_unopened'],
    kind: 'offer_retarget', description: 'Hit people who didn\'t open the 10 AM send.',
    expectedOpen: '18-22%', expectedClick: '4-6%' },
  { day: 'Friday',    time: '11:00', label: 'Gifting/weekend', segments: ['hot', 'warm'],
    kind: 'gifting', description: 'Gift bundles, weekend project kits.',
    expectedOpen: '26-32%', expectedClick: '4-7%' },
  { day: 'Saturday',  time: '10:00', label: 'Brand lifestyle', segments: ['hot'],
    kind: 'lifestyle', description: 'Narrative / founder content. Soft or no CTA.',
    expectedOpen: '30-36%', expectedClick: '2-4%' },
  { day: 'Sunday',    time: null,    label: 'REST',        segments: [],
    kind: 'rest', description: 'No broadcasts. Flows still run silently. Protects deliverability.',
    expectedOpen: '—', expectedClick: '—' },
];

/* Monthly seasonality themes tuned to India calendar */
export const MONTHLY_THEMES = [
  { month: 1,  key: 'jan',        theme: 'New-year / goal-setting',      angle: 'Plants for your new office' },
  { month: 2,  key: 'feb',        theme: "Valentine's + pre-spring",     angle: 'Couple kits, gifting bundles' },
  { month: 3,  key: 'mar',        theme: 'Holi',                         angle: 'Colourful products, bright bundles' },
  { month: 4,  key: 'apr',        theme: 'Summer prep + Ugadi',          angle: 'Heat-tolerant plants, indoor hobbies' },
  { month: 5,  key: 'may',        theme: 'Peak summer',                  angle: 'Indoor-only: 3D puzzles, diamond painting' },
  { month: 6,  key: 'jun',        theme: 'Early monsoon',                angle: 'Succulent & indoor plant care' },
  { month: 7,  key: 'jul',        theme: 'Monsoon + Rakhi prep',         angle: 'Indoor hobbies + sibling gifting' },
  { month: 8,  key: 'aug',        theme: 'Rakhi + independence',         angle: 'Gift packaging, premium bundles' },
  { month: 9,  key: 'sep',        theme: 'Ganesh + back-to-office',      angle: 'Productivity collections' },
  { month: 10, key: 'oct',        theme: 'Dussehra → Diwali prep',       angle: 'GIFTING — biggest revenue month' },
  { month: 11, key: 'nov',        theme: 'Diwali peak + BFCM',           angle: 'Flash sales, bundle drops' },
  { month: 12, key: 'dec',        theme: 'Christmas + year-end',         angle: 'Corporate gifting, gift cards' },
];

export function currentMonthTheme() {
  const m = new Date().getMonth() + 1;
  return MONTHLY_THEMES.find(t => t.month === m) || MONTHLY_THEMES[0];
}
