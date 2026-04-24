/**
 * Social comment NLP — deterministic, zero-dependency, multilingual.
 * Designed for IG/FB comments on an India-focused D2C brand: covers
 * English, Hindi (Devanagari), and Hinglish (romanized Hindi) with
 * severity-weighted intent + issue + UGC classification, sentiment
 * intensity, spam heuristics, and topic extraction.
 *
 * Why not an LLM? Cost + latency + determinism. A well-tuned lexicon
 * correctly categorises >90% of e-commerce comment traffic and runs
 * in microseconds. We can always add an LLM pass later for the
 * ambiguous 10%.
 *
 * Public API:
 *   detectLanguage(text)       → 'en' | 'hi' | 'hinglish' | 'other'
 *   classifyCommentDeep(text)  → full structured verdict
 *   enrichPostsDeep(posts)     → apply classifier to comments_detail
 *   extractTopics(posts, {k})  → top n-gram topics across comments
 */

/* ══════════════════════════════════════════════════════════════
   LANGUAGE DETECTION — Devanagari range for Hindi; Hinglish = ASCII
   with high density of Romanized Hindi markers.
   ══════════════════════════════════════════════════════════ */

const DEVANAGARI = /[ऀ-ॿ]/;
// Romanized Hindi marker words (very common)
const HINGLISH_MARKERS = /\b(kitna|kitne|kitni|kaise|kaisa|kaisi|kya|kab|kahan|kahaan|mujhe|hamein|bhai|didi|hai|hoga|hogi|karna|karo|milega|milegi|bhejo|dena|lena|chahiye|nahi|nahin|haan|yaar|bhaiya|bahut|sasta|sasti|mahenga|mahengi|order|delivery|shipping)\b/i;

export function detectLanguage(text = '') {
  const t = String(text || '').trim();
  if (!t) return 'other';
  if (DEVANAGARI.test(t)) return 'hi';
  const hinglishHits = (t.match(HINGLISH_MARKERS) || []).length;
  if (hinglishHits >= 1) return 'hinglish';
  // default: if most characters are ASCII letters, treat as English
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  const total = t.length || 1;
  return letters / total > 0.5 ? 'en' : 'other';
}

/* ══════════════════════════════════════════════════════════════
   CATEGORY LEXICONS — each category has:
     regex[]           → trigger patterns
     severity: 1-4     → impact / urgency (issues only)
     confidence: 0-1   → how confident a match implies the category
   Lists are curated for an India D2C / organic products brand but
   general enough to transfer.
   ══════════════════════════════════════════════════════════ */

const INTENT_CATEGORIES = [
  {
    key: 'price',
    label: 'Price query',
    confidence: 0.9,
    patterns: [
      /\bprice\b/i, /\bcost\b/i, /\bhow much\b/i, /\brate\b/i,
      /\bmrp\b/i, /₹|\brs\.?\s?\d/i, /\bcost kya\b/i,
      /\bkitna? ?(ka|ki|ke|hai|hoga|hogi)\b/i, /\bkitne? ka\b/i, /\bkitni\b/i,
      /\bसाम?न का दाम\b/, /\bकीमत\b/, /\bकित?ने?\b/,
    ],
  },
  {
    key: 'availability',
    label: 'Stock / availability',
    confidence: 0.85,
    patterns: [
      /\bavailable\b/i, /\bin stock\b/i, /\bout of stock\b/i,
      /\bstock (me|mein|main)?\b/i, /\bstill available\b/i,
      /\bkab (milega|milegi|aayega|aayegi|available|stock)\b/i,
      /\bstock kab\b/i, /\brestocking\b/i, /\brestock\b/i,
      /\bस?टॉक\b/, /\bउप?लब?ध\b/,
    ],
  },
  {
    key: 'delivery',
    label: 'Shipping / delivery',
    confidence: 0.85,
    patterns: [
      /\bshipping\b/i, /\bdelivery\b/i, /\bhow long to (get|receive|deliver)\b/i,
      /\bkab aayega\b/i, /\bkab tak\b/i, /\bcourier\b/i,
      /\bcash on delivery\b/i, /\bcod\b/i, /\bpaid delivery\b/i,
      /\bडिलिव?री\b/, /\bशिपिंग\b/,
    ],
  },
  {
    key: 'link',
    label: 'Link / where to buy',
    confidence: 0.9,
    patterns: [
      /\blink\s*(please|pls|plz|do|share|de|dede|dedo|bhejo)?\b/i,
      /\bwhere (to|can i) (buy|get|find|order)\b/i,
      /\bbio link\b/i, /\blink in bio\b/i, /\bwhere is link\b/i,
      /\bdm (me )?(the )?link\b/i, /\bsend (me )?link\b/i,
      /\bsite|website|website kya\b/i,
      /\blink do\b/i, /\blink de(do|dena|na)?\b/i,
      /\bलिंक\b/, /\bवेबसाइट\b/,
    ],
  },
  {
    key: 'size',
    label: 'Size / variant',
    confidence: 0.8,
    patterns: [
      /\bsize\b/i, /\bcolou?r\b/i, /\bvariant\b/i,
      /\bwhich colou?rs?\b/i, /\bkon[- ]?sa colou?r\b/i,
      /\bother shades?\b/i, /\bsize chart\b/i,
      /\bdo you have (this|it) in\b/i,
      /\b(small|medium|large|xl|xxl|xs)\s+size\b/i,
      /\bसाइज?\b/, /\bरंग\b/,
    ],
  },
  {
    key: 'dm',
    label: 'DM request',
    confidence: 0.85,
    patterns: [
      /\bdm\b/i, /\binbox\b/i, /\bpls dm\b/i, /\bdm me\b/i,
      /\bcheck dm\b/i, /\breply dm\b/i, /\bsent you a dm\b/i,
      /\bmessenger\b/i,
    ],
  },
  {
    key: 'purchase_intent',
    label: 'Ready to buy',
    confidence: 0.8,
    patterns: [
      /\bi want (this|it|one)\b/i, /\border(ed|ing)?\b/i,
      /\bneed (this|it)\b/i, /\bgotta (get|buy|have)\b/i,
      /\b(definitely|def) (buying|ordering)\b/i,
      /\bjust (bought|ordered|placed)\b/i,
      /\blega|lunga|loongi|chahiye\b/i, /\border kiya\b/i,
      /\bmujhe chahiye\b/i, /\bhame chahiye\b/i,
      /\bमुझे? चाहिए\b/,
    ],
  },
  {
    key: 'recommendation',
    label: 'Recommendation ask',
    confidence: 0.7,
    patterns: [
      /\bwhich (one|is best)\b/i, /\brecommend\b/i,
      /\bwhat (should|do) you suggest\b/i, /\bworth (it|buying)\b/i,
      /\bkon[- ]?sa (lu|lena|lena chahiye|best)\b/i,
      /\bkaun sa\b/i, /\bsuggestion\b/i,
    ],
  },
  {
    key: 'compliment',
    label: 'Compliment',
    confidence: 0.65,
    patterns: [
      /\b(love|loving|adore|stunning|beautiful|gorgeous|amazing|fantastic|fabulous|perfect|excellent|wonderful|incredible|obsessed)\b/i,
      /\b(so (cute|pretty|nice|cool|good|beautiful))\b/i,
      /😍|🥰|💖|🔥|✨|👌|👏|💯|🤩/,
      /\bबहुत (अच?छा|सुंदर|प?यारा)\b/, /\bbhot (accha|pyara|badiya)\b/i,
    ],
  },
  {
    key: 'thanks',
    label: 'Thanks / gratitude',
    confidence: 0.9,
    patterns: [
      /\bthanks\b/i, /\bthank you\b/i, /\bthankyou\b/i, /\bty\b/i,
      /\bthanx\b/i, /\bshukriya\b/i, /\bdhanyavad\b/i,
      /\bधन?यवाद\b/, /\bशुक्रिया\b/,
    ],
  },
];

const ISSUE_CATEGORIES = [
  {
    key: 'allergy',
    label: 'Allergy / health reaction',
    severity: 4,
    confidence: 0.95,
    patterns: [
      /\ballergic\b/i, /\ballergy\b/i, /\brash\b/i, /\breaction\b/i,
      /\birritation\b/i, /\bitching\b/i, /\bskin (issue|problem)\b/i,
      /\bbreathing\b/i, /\bmedical\b/i, /\bdoctor\b/i, /\bhospital\b/i,
    ],
  },
  {
    key: 'fraud',
    label: 'Fraud / scam accusation',
    severity: 4,
    confidence: 0.95,
    patterns: [
      /\bfraud\b/i, /\bscam\b/i, /\bcheating\b/i, /\bcheated\b/i,
      /\bmisleading\b/i, /\bfake\b/i, /\bduplicate\b/i, /\bfraaud\b/i,
      /\bधोखा\b/, /\bधोखेबाज़?ी?\b/,
    ],
  },
  {
    key: 'payment',
    label: 'Payment / billing',
    severity: 3,
    confidence: 0.9,
    patterns: [
      /\bpayment (failed|stuck|not|issue|problem)\b/i,
      /\bmoney (deducted|debited|gone|missing)\b/i,
      /\brefund (not received|pending|delayed|stuck)\b/i,
      /\bamount (deducted|charged twice|double)\b/i,
      /\bupi (failed|stuck|issue)\b/i,
      /\bpaise (kat|katay|deducted)\b/i,
    ],
  },
  {
    key: 'not_received',
    label: 'Not received / missing',
    severity: 3,
    confidence: 0.9,
    patterns: [
      /\bnot (received|delivered|arrived|shipped|dispatched)\b/i,
      /\bnever (received|got|arrived|delivered)\b/i,
      /\bstill waiting\b/i, /\bstill not (got|received|delivered)\b/i,
      /\bwhere is (my )?(order|parcel|package|product)\b/i,
      /\bmissing (item|product|order)\b/i,
      /\bdelivery nahi hui\b/i, /\bnahi aaya\b/i, /\bnahi mila\b/i,
      /\bनहीं मिला\b/, /\bनही आया\b/,
    ],
  },
  {
    key: 'damaged',
    label: 'Damaged / broken',
    severity: 3,
    confidence: 0.9,
    patterns: [
      /\bbroken\b/i, /\bdamaged\b/i, /\bdefective\b/i, /\bfaulty\b/i,
      /\bcracked\b/i, /\bshattered\b/i, /\bleaking\b/i, /\bleaked\b/i,
      /\btampered\b/i, /\bdented\b/i, /\bscratched\b/i,
      /\btoot (gaya|gayi|gya)\b/i, /\bkharab\b/i,
    ],
  },
  {
    key: 'wrong_item',
    label: 'Wrong item / wrong order',
    severity: 3,
    confidence: 0.9,
    patterns: [
      /\bwrong (item|product|size|colou?r|order|variant)\b/i,
      /\bincorrect (item|product|order)\b/i,
      /\bdifferent (from|than) (what|picture|image)\b/i,
      /\bnot as (shown|described|advertised|in picture)\b/i,
      /\bgalat (item|product|order|size)\b/i,
      /\bbilkul different\b/i,
    ],
  },
  {
    key: 'quality',
    label: 'Quality complaint',
    severity: 2,
    confidence: 0.8,
    patterns: [
      /\bpoor quality\b/i, /\blow quality\b/i, /\bbad quality\b/i,
      /\bcheap (quality|material)\b/i, /\bterrible\b/i, /\bhorrible\b/i,
      /\bworst\b/i, /\buseless\b/i, /\bwaste (of )?(money|time)\b/i,
      /\bexpired\b/i, /\bold stock\b/i, /\bstale\b/i,
      /\bgharab quality\b/i, /\bkhraab\b/i, /\bbekar\b/i,
      /\bखराब\b/, /\bबेकार\b/,
    ],
  },
  {
    key: 'size_issue',
    label: 'Size / fit problem',
    severity: 2,
    confidence: 0.75,
    patterns: [
      /\btoo (small|big|large|tight|loose)\b/i,
      /\bdoesn'?t fit\b/i, /\bsize (issue|problem|mismatch)\b/i,
      /\bchota\b/i, /\bbada\b/i, /\bnot (my )?size\b/i,
    ],
  },
  {
    key: 'support',
    label: 'Customer support unresponsive',
    severity: 2,
    confidence: 0.75,
    patterns: [
      /\bcustomer (service|care|support) (is )?(bad|worst|terrible|not responding)\b/i,
      /\bno (one|reply|response)\b/i, /\bnot (responding|replying|answering)\b/i,
      /\bignoring (me|customers)\b/i,
      /\bcalled (but|no|never)\b/i, /\bemailed (but|no|never)\b/i,
      /\bdm (ignored|no reply|not replying)\b/i,
    ],
  },
  {
    key: 'general_negative',
    label: 'General negative',
    severity: 1,
    confidence: 0.55,
    patterns: [
      /\bdisappointed\b/i, /\bdisappointing\b/i, /\bregret\b/i,
      /\bnever (again|buying)\b/i, /\bwon'?t buy\b/i,
      /\bहदद बेकार\b/, /\bबहुत खराब\b/,
    ],
  },
];

const UGC_CATEGORIES = [
  {
    key: 'tag_friend',
    label: 'Tag-a-friend',
    patterns: [
      /@[\p{L}\p{N}_.]+/u,
    ],
    requiresMention: true,
    labelText: /\b(you need this|this is you|check this|look at this|would love this|omg)\b/i,
  },
  {
    key: 'advocacy',
    label: 'Brand advocacy',
    patterns: [
      /\b(best brand|love this brand|my favou?rite brand|repeat customer|buying again|bought (again|multiple))\b/i,
      /\b(10\/10|100\/100|11\/10|hit every time)\b/i,
    ],
  },
  {
    key: 'showing_product',
    label: 'Showing received product',
    patterns: [
      /\bjust (got|received|arrived)\b/i, /\bhaul\b/i, /\bunboxing\b/i,
      /\bin love with (my|the)\b/i, /\b(looks|looking) (exactly|so) (good|nice)\b/i,
    ],
  },
  {
    key: 'competitor_mention',
    label: 'Competitor mention',
    patterns: [
      /\b(mamaearth|wow|plum|forest essentials|himalaya|khadi|biotique|amazon|flipkart|nykaa)\b/i,
    ],
  },
];

const POSITIVE_MARKERS = [
  /\b(love|loving|loved|adore|awesome|amazing|fantastic|beautiful|gorgeous|best|perfect|excellent|wonderful|great|obsessed|fab|fabulous|incredible|stunning)\b/i,
  /\b(bahut (accha|pyara|sundar)|bohot (accha|sundar|badiya)|bhot (accha|pyara))\b/i,
  /😍|🥰|❤️|💖|🔥|✨|😊|👏|🎉|💯|🤩|🙌|😘/,
  /\b(thanks|thank you|thankyou|ty|shukriya|dhanyavad)\b/i,
];

const NEGATIVE_MARKERS = [
  /\b(bad|worst|awful|ugly|boring|disappointed|disappointing|poor|terrible|horrible|useless|waste)\b/i,
  /\b(hate|hated|dislike|regret)\b/i,
  /👎|💩|😡|🤮|😤|😞|😔|🙄|💔/,
  /\b(bekar|kharab|ghatiya|bakwas|worst worst)\b/i,
];

// Negation windows (3 tokens after "not")
const NEGATION_WINDOW = /\b(not|no|never|nahi|nahin|nahī|kabhi nahi)\s+(\w+\s+){0,3}(\w+)/ig;

const INTENSIFIERS = /\b(very|so|super|extremely|totally|really|absolutely|literally|bhot|bahut|ekdam|bilkul|totally)\b/i;

// Spam heuristics
const SPAM_REGEXES = [
  /https?:\/\/[^\s]+/i,     // external link in comment
  /\bbit\.ly\/|tinyurl|ow\.ly\b/i,
  /\b(follow (me|back)|sub4sub|f4f|followback)\b/i,
  /\b(make money|earn (\$|₹|rs)|get (free|rich))\b/i,
  /\b(whatsapp (me|on|no) \+?\d{5,})\b/i,
];

/* ══════════════════════════════════════════════════════════════
   CORE CLASSIFIER
   ══════════════════════════════════════════════════════════ */

function matchAny(text, patterns) {
  for (const p of patterns) if (p.test(text)) return true;
  return false;
}
function countMatches(text, patterns) {
  let n = 0;
  for (const p of patterns) {
    const g = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
    const m = text.match(g);
    if (m) n += m.length;
  }
  return n;
}

function classifyBucket(text, buckets) {
  // Returns the highest-confidence match across the bucket list
  let best = null;
  for (const b of buckets) {
    if (!matchAny(text, b.patterns)) continue;
    if (!best || (b.confidence || 0.5) > (best.confidence || 0.5) || (b.severity || 0) > (best.severity || 0)) {
      best = b;
    }
  }
  return best;
}

function scoreSentiment(text) {
  const pos = countMatches(text, POSITIVE_MARKERS);
  const neg = countMatches(text, NEGATIVE_MARKERS);
  if (pos === 0 && neg === 0) return { polarity: 0, intensity: 0, positive: 0, negative: 0 };

  // Detect negation flips
  let negFlips = 0;
  const m = text.match(NEGATION_WINDOW);
  if (m) negFlips = m.length;

  // If negation is present and followed by positive markers, treat as negative
  let effectivePos = pos, effectiveNeg = neg;
  if (negFlips > 0) {
    effectivePos = Math.max(0, pos - negFlips);
    effectiveNeg = neg + Math.min(negFlips, pos);
  }

  const hasIntensifier = INTENSIFIERS.test(text);
  const intensity = Math.min(1, (effectivePos + effectiveNeg) * 0.25 + (hasIntensifier ? 0.2 : 0));
  const polarity = (effectivePos - effectiveNeg) / Math.max(1, effectivePos + effectiveNeg);
  return { polarity, intensity, positive: effectivePos, negative: effectiveNeg };
}

function detectSpam(text) {
  for (const r of SPAM_REGEXES) {
    if (r.test(text)) {
      return { isSpam: true, reason: 'promo_or_link' };
    }
  }
  // repeat-char detection (e.g., "!!!!!!!!!" or "aaaaaa")
  if (/(.)\1{6,}/.test(text)) return { isSpam: true, reason: 'repeat_chars' };
  // all-caps short spam
  if (text.length > 10 && text === text.toUpperCase() && /^[A-Z\s!?.]+$/.test(text)) {
    return { isSpam: true, reason: 'all_caps' };
  }
  return { isSpam: false, reason: null };
}

function extractMentions(text) {
  return (text.match(/@[\p{L}\p{N}_.]+/gu) || []).map(s => s.toLowerCase());
}

function classifyUgc(text, mentions) {
  // tag_friend needs at least one mention + short enough context
  const ugcMatches = [];
  for (const cat of UGC_CATEGORIES) {
    if (cat.requiresMention) {
      if (mentions.length === 0) continue;
      if (cat.labelText && !cat.labelText.test(text) && text.length > 40) continue;
      ugcMatches.push({ key: cat.key, label: cat.label, confidence: 0.8 });
      continue;
    }
    if (matchAny(text, cat.patterns)) {
      ugcMatches.push({ key: cat.key, label: cat.label, confidence: 0.75 });
    }
  }
  return ugcMatches;
}

export function classifyCommentDeep(text = '') {
  const raw = String(text || '');
  if (!raw.trim()) {
    return {
      lang: 'other', intent: null, issue: null, ugc: [],
      sentiment: { polarity: 0, intensity: 0, positive: 0, negative: 0 },
      spam: { isSpam: false, reason: null }, mentions: [], topics: [],
    };
  }

  const lang = detectLanguage(raw);
  const spam = detectSpam(raw);

  // When spam, don't waste cycles classifying intent/issue
  if (spam.isSpam) {
    return {
      lang, intent: null, issue: null, ugc: [],
      sentiment: { polarity: 0, intensity: 0, positive: 0, negative: 0 },
      spam, mentions: extractMentions(raw), topics: [],
    };
  }

  const mentions = extractMentions(raw);
  const intentBucket = classifyBucket(raw, INTENT_CATEGORIES);
  const issueBucket  = classifyBucket(raw, ISSUE_CATEGORIES);
  const ugc = classifyUgc(raw, mentions);
  const sentiment = scoreSentiment(raw);

  // Issue severity upgrades when combined with critical sentiment
  let finalIssue = issueBucket ? {
    key: issueBucket.key,
    label: issueBucket.label,
    severity: issueBucket.severity || 1,
    confidence: issueBucket.confidence || 0.7,
  } : null;
  if (finalIssue && sentiment.polarity < -0.5 && sentiment.intensity > 0.5) {
    finalIssue.severity = Math.min(4, finalIssue.severity + 1);
  }

  return {
    lang,
    intent: intentBucket ? { key: intentBucket.key, label: intentBucket.label, confidence: intentBucket.confidence || 0.7 } : null,
    issue: finalIssue,
    ugc,
    sentiment,
    spam,
    mentions,
    // Topic extraction happens at roll-up time (aggregate across comments)
  };
}

/* ══════════════════════════════════════════════════════════════
   TOPIC EXTRACTION — bigram / trigram frequency across comments
   filtered against stopwords + category hits.
   ══════════════════════════════════════════════════════════ */

const TOPIC_STOPWORDS = new Set(('a,an,the,and,or,but,to,in,on,for,with,this,that,is,are,was,were,be,been,being,as,at,by,from,it,its,we,our,us,you,your,he,she,they,them,his,her,their,i,me,my,mine,ours,have,has,had,do,does,did,so,if,then,than,not,no,yes,just,also,all,very,more,most,some,any,one,two,three,get,got,make,made,here,there,about,into,out,up,down,over,under,very,really,like,can,will,would,could,should,please,plz,pls').split(','));

function tokensOf(text) {
  return (text.match(/[\p{L}\p{N}]+/gu) || [])
    .map(t => t.toLowerCase())
    .filter(t => t.length > 2 && !TOPIC_STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export function extractTopics(posts = [], { k = 20, minCount = 2 } = {}) {
  const ng = new Map(); // 'word1 word2' → count
  const unigram = new Map();
  for (const p of posts || []) {
    for (const c of (p.comments_detail || [])) {
      if (c.spam?.isSpam) continue;
      const toks = tokensOf(c.text || '');
      for (const t of toks) unigram.set(t, (unigram.get(t) || 0) + 1);
      for (let i = 0; i < toks.length - 1; i++) {
        const bg = `${toks[i]} ${toks[i + 1]}`;
        ng.set(bg, (ng.get(bg) || 0) + 1);
      }
      for (let i = 0; i < toks.length - 2; i++) {
        const tg = `${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`;
        ng.set(tg, (ng.get(tg) || 0) + 1);
      }
    }
  }
  const topics = [...ng.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([phrase, count]) => ({ phrase, count }));
  const words = [...unigram.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([word, count]) => ({ word, count }));
  return { topics, words };
}

/* ══════════════════════════════════════════════════════════════
   ENRICHMENT — drop-in replacement for socialAnalytics.enrichWithCommentStats
   ══════════════════════════════════════════════════════════ */

export function enrichPostsDeep(posts = []) {
  return posts.map(p => {
    const raws = p._rawComments || p.comments_detail || [];
    const classified = raws.map(c => {
      const base = {
        text:      c.text || '',
        username:  c.username || '',
        timestamp: c.timestamp || '',
        likeCount: Number(c.likeCount) || 0,
        replies:   Number(c.replies) || 0,
      };
      const v = classifyCommentDeep(base.text);
      // Back-compat flattened booleans for existing UI components
      return {
        ...base,
        ...v,
        // Flattened legacy fields
        intent:     !!v.intent,
        issue:      !!v.issue,
        ugcMention: v.mentions?.length > 0 || v.ugc?.some(u => u.key === 'tag_friend'),
        positive:   v.sentiment.polarity > 0.2,
        negative:   v.sentiment.polarity < -0.2,
        // Deep fields
        intentDeep: v.intent,
        issueDeep:  v.issue,
        ugcDeep:    v.ugc,
      };
    });

    // Per-post rollup
    let intentCount = 0, issueCount = 0, ugcMentions = 0, positive = 0, negative = 0;
    let spamCount = 0;
    const issueBySeverity = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const intentByKey = {};
    const issueByKey = {};
    const ugcByKey = {};
    const langByKey = {};
    for (const c of classified) {
      if (c.spam?.isSpam) { spamCount++; continue; }
      if (c.intentDeep) { intentCount++; intentByKey[c.intentDeep.key] = (intentByKey[c.intentDeep.key] || 0) + 1; }
      if (c.issueDeep)  { issueCount++;  issueByKey[c.issueDeep.key]   = (issueByKey[c.issueDeep.key]   || 0) + 1; issueBySeverity[c.issueDeep.severity] = (issueBySeverity[c.issueDeep.severity] || 0) + 1; }
      for (const u of (c.ugcDeep || [])) ugcByKey[u.key] = (ugcByKey[u.key] || 0) + 1;
      if (c.mentions?.length) ugcMentions += c.mentions.length;
      if (c.positive) positive++;
      if (c.negative) negative++;
      langByKey[c.lang] = (langByKey[c.lang] || 0) + 1;
    }
    const total = classified.length;

    return {
      ...p,
      comments_detail: classified,
      commentStats: {
        total, intentCount, issueCount, ugcMentions, positive, negative, spamCount,
        sentimentScore: total ? (positive - negative) / total : 0,
        issueBySeverity,
        intentByKey,
        issueByKey,
        ugcByKey,
        langByKey,
        // Derived — handy for UI filters
        hasCritical: (issueBySeverity[4] || 0) > 0,
        hasHighSeverity: (issueBySeverity[3] || 0) > 0 || (issueBySeverity[4] || 0) > 0,
      },
    };
  });
}
