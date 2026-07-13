const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Debug: confirm API key is loaded (will appear in Render logs)
console.log('🔑 API key present?', !!process.env.ANTHROPIC_API_KEY);

// -----------------------------
// 🔐 QR-code gate
// -----------------------------
// 👉 Set this in your .env file (and in Render's Environment tab), e.g:
//    QR_PASSWORD=spmcreation2026
// This is the exact text that will be encoded into the printed QR code.
const QR_PASSWORD = process.env.QR_PASSWORD || 'CHANGE-ME-SET-QR_PASSWORD-IN-ENV';
if (QR_PASSWORD === 'CHANGE-ME-SET-QR_PASSWORD-IN-ENV') {
  console.warn('⚠️  QR_PASSWORD is not set in .env — using an insecure default. Set it before going live!');
}

// -----------------------------
// 💳 GLOBAL credit pool
// -----------------------------
// Credits are shared across EVERY customer / QR scan / session — it's one
// pool for the whole app, not per-person. This is what you sell to a client
// (e.g. "4000 review credits"), and it counts down no matter who is using it
// or how many different phones/QR scans are involved.
//
// 👉 CREDIT_LIMIT only sets the STARTING size of the pool the very first time
//    the server runs (when credits.json doesn't exist yet). After that, the
//    pool total lives in credits.json and CREDIT_LIMIT is ignored — use the
//    /api/admin/add-credits endpoint below to top it up.
const fs = require('fs');
const path = require('path');
const CREDIT_LIMIT = parseInt(process.env.CREDIT_LIMIT, 10) || 5;
const CREDITS_FILE = path.join(__dirname, 'credits.json');

// 👉 Set this in your .env to a long random string. Required to top up credits.
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE-ME-SET-ADMIN_KEY-IN-ENV';

function loadCreditPool() {
  try {
    const raw = fs.readFileSync(CREDITS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (typeof data.remaining === 'number') return data;
  } catch (e) { /* file doesn't exist yet — fall through to default */ }
  const initial = { remaining: CREDIT_LIMIT, totalIssued: CREDIT_LIMIT };
  saveCreditPool(initial);
  return initial;
}

function saveCreditPool(pool) {
  fs.writeFileSync(CREDITS_FILE, JSON.stringify(pool, null, 2));
}

let creditPool = loadCreditPool();
console.log(`💳 Credit pool loaded: ${creditPool.remaining} remaining of ${creditPool.totalIssued}`);

// Reserve one credit up front (before the paid Anthropic call), so two
// requests arriving at the same instant can't both slip through on the
// last credit. If the generation later fails, the credit is refunded.
function reserveCredit() {
  if (creditPool.remaining <= 0) return false;
  creditPool.remaining -= 1;
  saveCreditPool(creditPool);
  return true;
}

function refundCredit() {
  creditPool.remaining += 1;
  saveCreditPool(creditPool);
}

// (Credits are NOT stored here anymore — see the global credit pool above.)
// In-memory store of valid session tokens issued after a successful scan.
// token -> expiry timestamp (ms). Cleared automatically when the server restarts.
const activeTokens = new Map();
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// 👉 The shop owner's WhatsApp number (with country code, no "+" or spaces),
//    e.g. 919876543210 for an Indian number. Set WHATSAPP_NUMBER in your .env.
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '910000000000';

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  activeTokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function cleanExpiredTokens() {
  const now = Date.now();
  for (const [token, expiry] of activeTokens) {
    if (expiry < now) activeTokens.delete(token);
  }
}

// Middleware: protects routes so they only work for someone who has
// successfully scanned the QR code (i.e. holds a valid token).
function requireAuth(req, res, next) {
  cleanExpiredTokens();
  const token = req.headers['x-auth-token'];
  if (token && activeTokens.has(token)) {
    return next();
  }
  res.status(401).json({ error: 'Not authorized. Please scan the shop QR code to continue.' });
}

app.use(cors({
  origin: [
    // 👉 Replace with your actual deployed frontend URL (e.g. Vercel/Netlify link)
    'https://qr-lock-spm-c-front.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.static('public'));

const DATABASE = {
  business: {
    name: "Spm Creation",
    description: "A trendy women's and unisex clothing store in Vastral, Ahmedabad, offering ethnic wear, western wear, and jeans & trousers in multiple fits at affordable prices. Known for variety, style, and friendly, helpful staff.",
    location: "Vastral, Ahmedabad, Gujarat",

    // 👉 Fallback Google search used if googleReviewLink below is left blank.
    googleSearch: "Spm Creation Vastral Ahmedabad review",

    // 👉 IMPORTANT: Replace this with your real "Write a review" link.
    // Get it from Google Maps: search your shop -> Share -> "Write a review" -> copy link.
    // Leave blank ("") to fall back to the Google search above.
    googleReviewLink: "",

    // 👉 Replace with your real Instagram profile URL.
    instagramUrl: "https://www.instagram.com/spm_creation._?igsh=MXVjcmNjYmJxZmdpeQ==",

    categories: {
      "Ethnic / Traditional Wear": [
        "Cotton Cord Set",
        "Kurti Pant",
        "Denim Kurti",
        "Heavy Pair Dress",
        "Round Gher 3-Piece Set"
      ],
      "Western & Casual Wear": [
        "Midi Dress",
        "Off Shoulder T-Shirt",
        "Night Suit Pair",
        "Western Top",
        "Western One Piece",
        "Shorty Night Dress",
        "Track Pant"
      ],
      "Jeans & Trousers": [
        "Mom Fit Jeans",
        "Korean Fit Jeans",
        "Straight Formal Pant",
        "Straight Cargo Pant",
        "Boot Cut Pant",
        "Six Pocket Pant",
        "Narrow Pant"
      ],
      "Fit & Fabric Quality": [
        "stitching quality", "fabric feel", "fit and comfort", "true-to-size fitting", "finishing and detailing"
      ],
      "Staff & Service": [
        "Jayaben's help with sizing", "Rameshbhai's suggestions", "Kavitaben's styling tips", "Rashmikaben's friendly service", "trial room experience"
      ],
      "Value for Money": [
        "pricing", "affordability", "quality-price ratio", "festive offers", "combo deals"
      ],
      "Variety & Collection": [
        "range of designs", "new arrivals", "Instagram reel offers", "latest fashion trends", "colour options"
      ],
      "Recommend": [
        "the overall shopping experience", "the collection", "the value for money", "the friendly staff", "shopping again from here"
      ]
    }
  }
};

// 👉 The frontend calls this after scanning a QR code. If the scanned text
// matches QR_PASSWORD, we hand back a token the frontend must send with
// every other request (see requireAuth above).
app.post('/api/verify-qr', (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ success: false, error: 'No QR code data received.' });
  }
  if (code.trim() === QR_PASSWORD) {
    const token = issueToken();
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, error: 'That QR code is not valid for this shop.' });
});

app.get('/api/business', requireAuth, (req, res) => {
  // Don't leak the raw review link/instagram URL if you'd rather keep it server-side only.
  // Currently sent as-is so the frontend can build the publish buttons.
  res.json({
    ...DATABASE.business,
    ownerWhatsapp: WHATSAPP_NUMBER,
    creditLimit: creditPool.totalIssued,
    remainingCredits: creditPool.remaining
  });
});

// 👉 The frontend polls this to refresh the credit badge in real time,
// since the pool is shared across every customer using the app right now.
app.get('/api/credits', requireAuth, (req, res) => {
  res.json({ remainingCredits: creditPool.remaining, creditLimit: creditPool.totalIssued });
});

// 👉 Use this to top up the shared pool after a client buys more credits
// (e.g. "add 4000 credits"). Protect it with ADMIN_KEY — never expose this
// endpoint or key to customers.
//    curl -X POST https://your-server/api/admin/add-credits \
//      -H "Content-Type: application/json" -H "x-admin-key: YOUR_ADMIN_KEY" \
//      -d '{"amount": 4000}'
app.post('/api/admin/add-credits', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY || ADMIN_KEY === 'CHANGE-ME-SET-ADMIN_KEY-IN-ENV') {
    return res.status(401).json({ error: 'Unauthorized. Set ADMIN_KEY in your .env first.' });
  }
  const amount = parseInt(req.body?.amount, 10);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Provide a positive integer "amount" of credits to add.' });
  }
  creditPool.remaining += amount;
  creditPool.totalIssued += amount;
  saveCreditPool(creditPool);
  res.json({ success: true, remainingCredits: creditPool.remaining, totalIssued: creditPool.totalIssued });
});

app.post('/api/generate', requireAuth, async (req, res) => {
  const { selectedProducts } = req.body;

  if (!selectedProducts || selectedProducts.length === 0) {
    return res.status(400).json({ error: 'No products selected' });
  }

  // 🔒 Global credit check — this pool is shared by every customer using
  // the app, not per-person. Reserve a credit now; refund it below if the
  // generation call fails.
  if (!reserveCredit()) {
    return res.status(403).json({
      error: 'NO_CREDITS',
      message: 'All review credits for this app have been used up.',
      remainingCredits: 0
    });
  }

  const biz = DATABASE.business;
  const productList = selectedProducts.join(', ');

  const focuses = [
    'fit and comfort',
    'fabric quality',
    'price and value for money',
    'staff behaviour and service',
    'variety and collection',
    'overall shopping experience'
  ];
  const randomFocus = focuses[Math.floor(Math.random() * focuses.length)];
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `You are a genuine Indian customer writing a review for a women's & unisex clothing store.

Input: You will receive the item(s) the customer bought or tried.

You are a helpful assistant that writes short, genuine reviews in Hinglish (Roman script) for a clothing shop.

Write a 2-3 sentence review based on the items the customer selected. The review should:
- Sound like a real person – casual, honest, and conversational.
- Mention at least one specific, tangible detail about the item(s) (e.g., fabric, fit, stitching, price, comfort, how it looked).
- Keep the tone positive but grounded – no exaggerations.
- **Avoid clichés** like "highly recommend", "amazing", "exceeded expectations", "must-buy".
- **Vary your opening sentence** and the structure of your sentences – don't repeat the same pattern across different reviews.
- **Focus on this aspect** in your review: "${randomFocus}".

Output: Return only the review text. No labels, no quotes, no bullet points, no extra commentary. Just the 2–3 sentences.`,
      messages: [{
        role: 'user',
        content: `Business: ${biz.name}
Description: ${biz.description}
Location: ${biz.location}

Customer selected these items: ${productList}

Write a 2-3 sentence positive review based on these selected items.`
      }]
    });

    const review = message.content.find(b => b.type === 'text')?.text?.trim() || '';
    res.json({ review, remainingCredits: creditPool.remaining });

  } catch (err) {
    console.error('Anthropic error:', err.message);
    refundCredit(); // generation failed — give the credit back to the pool
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Spm Creation review server running on port ${PORT}`);
});
