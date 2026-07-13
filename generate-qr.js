// Generates a printable QR code image encoding your QR_PASSWORD.
// Usage:
//   node scripts/generate-qr.js
// (Reads QR_PASSWORD from your .env file — make sure it's set there first.)
//
// Or pass the text directly:
//   node scripts/generate-qr.js "spmcreation2026"

require('dotenv').config();
const QRCode = require('qrcode');
const path = require('path');

const text = process.argv[2] || process.env.QR_PASSWORD;

if (!text) {
  console.error('❌ No password found. Set QR_PASSWORD in your .env file, or run: node scripts/generate-qr.js "yourpassword"');
  process.exit(1);
}

const outPath = path.join(__dirname, '..', 'shop-qr-code.png');

QRCode.toFile(outPath, text, { width: 800, margin: 2 }, (err) => {
  if (err) {
    console.error('❌ Failed to generate QR code:', err.message);
    process.exit(1);
  }
  console.log(`✅ QR code saved to: ${outPath}`);
  console.log(`   It encodes: "${text}"`);
  console.log('   Print it and keep it at the counter for customers to scan.');
});
