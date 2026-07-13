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

// In-memory store of valid session tokens issued after a successful scan.
// token -> expiry timestamp (ms). Cleared automatically when the server restarts.
const activeTokens = new Map();
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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
    'https://spm-creation-frontend.vercel.app',
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
  res.json(DATABASE.business);
});

app.post('/api/generate', requireAuth, async (req, res) => {
  const { selectedProducts } = req.body;

  if (!selectedProducts || selectedProducts.length === 0) {
    return res.status(400).json({ error: 'No products selected' });
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
    res.json({ review });

  } catch (err) {
    console.error('Anthropic error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Spm Creation review server running on port ${PORT}`);
});
