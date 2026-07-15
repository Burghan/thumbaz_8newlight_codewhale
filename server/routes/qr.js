const express = require('express');
const QRCode = require('qrcode');

const router = express.Router();

// GET /api/qr?text=...&format=png — used by the New POS receipt screen to
// render a scannable code. ?format=png streams a PNG (used directly as an
// <img src>); without it, returns { dataUrl } for embedding in the "Send
// receipt" email flow.
router.get('/', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Missing text' });
  const format = String(req.query.format || '').trim().toLowerCase();
  try {
    if (format === 'png') {
      const buffer = await QRCode.toBuffer(text, { width: 220, margin: 1 });
      res.type('png').send(buffer);
      return;
    }
    const dataUrl = await QRCode.toDataURL(text, { width: 220, margin: 1 });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

module.exports = router;
