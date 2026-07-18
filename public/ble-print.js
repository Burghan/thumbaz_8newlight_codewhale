// Bluetooth (BLE) thermal-printer support for the POS receipt.
//
// Prints the receipt to an ESC/POS BLE printer so the result matches the
// on-screen / browser-printed receipt: the receipt is drawn to a canvas (logo,
// items, totals, QR, footer) and sent as an ESC/POS RASTER bitmap. That keeps
// it portrait and crisp, with the logo and QR the plain-text approach can't do.
//
// Web Bluetooth constraints: Chrome/Edge on Android or desktop, over HTTPS (or
// localhost). Classic-Bluetooth (SPP)-only printers can't be reached; iOS/Safari
// has no Web Bluetooth — on those, use the browser "Print Full Receipt" button.
(function () {
  'use strict';

  var CANDIDATE_SERVICES = [
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    'generic_access', 'generic_attribute', 'device_information', 'battery_service'
  ];
  // Known VSC-TM-58D Pro (58mm) channel — tried first for a fast connect.
  var KNOWN = { service: '0000ffe0-0000-1000-8000-00805f9b34fb', write: '0000ffe1-0000-1000-8000-00805f9b34fb' };

  var WIDTH = 384;      // 58mm printer = 384 dots across
  var MARGIN = 14;
  var CHUNK = 180;      // bytes per BLE write
  var CHUNK_DELAY = 20; // ms between chunks

  // ---- read the on-screen receipt ----------------------------------------
  function visibleText(id) {
    var el = document.getElementById(id);
    if (!el || el.classList.contains('hidden') || el.style.display === 'none') return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function readItems() {
    var nodes = document.querySelectorAll('#receiptItems .receipt-item'), out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      out.push({
        qty: el.children[0] ? (el.children[0].textContent || '').trim() : '',
        name: el.querySelector('.name') ? (el.querySelector('.name').textContent || '').replace(/\s+/g, ' ').trim() : '',
        total: el.children[el.children.length - 1] ? (el.children[el.children.length - 1].textContent || '').trim() : ''
      });
    }
    return out;
  }
  function changeVisible() {
    var r = document.getElementById('receiptChangeLine');
    return !!(r && r.style.display !== 'none');
  }
  function loadImage(src) {
    return new Promise(function (res) {
      if (!src) { res(null); return; }
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); }; // skip a broken image rather than fail the print
      im.src = src;
    });
  }

  // ---- draw the receipt onto a canvas ------------------------------------
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  async function renderCanvas() {
    var logoImg = await loadImage((document.getElementById('receiptLogoImg') || {}).src);
    var qrImg = await loadImage((document.getElementById('receiptQr') || {}).src);

    var canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = 2400;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, WIDTH, canvas.height);
    ctx.fillStyle = '#000'; ctx.textBaseline = 'top';

    var y = 10;
    var center = function (text, font, lh) {
      ctx.font = font; ctx.textAlign = 'center';
      ctx.fillText(text, WIDTH / 2, y); y += lh;
    };
    var rule = function () {
      ctx.textAlign = 'left'; ctx.font = '18px monospace';
      ctx.fillText('--------------------------------', MARGIN, y); y += 22;
    };
    var row = function (left, right, font, bold) {
      ctx.font = (bold ? 'bold ' : '') + font;
      ctx.textAlign = 'right'; var rightW = ctx.measureText(right).width;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, left, WIDTH - MARGIN * 2 - rightW - 10), MARGIN, y);
      ctx.textAlign = 'right'; ctx.fillText(right, WIDTH - MARGIN, y);
    };

    // Logo (scaled to ~200px wide, centered), else the store name as text.
    if (logoImg && logoImg.width) {
      var lw = 200, lh = Math.round(logoImg.height * (lw / logoImg.width));
      ctx.drawImage(logoImg, (WIDTH - lw) / 2, y, lw, lh); y += lh + 8;
    } else {
      center(visibleText('receiptLogoText') || '8 NewLight', 'bold 34px sans-serif', 40);
    }

    var ticket = visibleText('receiptTicket');
    if (ticket) center(ticket, 'bold 22px sans-serif', 28);
    ['receiptTime', 'receiptCashier', 'receiptOrderType', 'receiptCustomer', 'receiptNote', 'receiptLoyalty']
      .forEach(function (id) { var t = visibleText(id); if (t) center(t, '20px sans-serif', 25); });

    y += 6; rule();

    var items = readItems();
    for (var i = 0; i < items.length; i++) {
      row((items[i].qty ? items[i].qty + '  ' : '') + items[i].name, items[i].total, '23px sans-serif', true);
      y += 30;
    }
    rule();

    var subtotal = visibleText('receiptSubtotal');
    var tax = visibleText('receiptTax');
    if (subtotal) { row('Subtotal', subtotal, '22px sans-serif', false); y += 28; }
    if (tax && tax !== 'Rp 0') { row('Tax', tax, '22px sans-serif', false); y += 28; }
    row('TOTAL', visibleText('receiptTotal2') || visibleText('receiptTotal'), '30px sans-serif', true); y += 40;
    if (changeVisible()) { var ch = visibleText('receiptChange'); if (ch) { row('Change', ch, '22px sans-serif', false); y += 30; } }

    y += 10;
    if (qrImg && qrImg.width) {
      var q = 180; ctx.drawImage(qrImg, (WIDTH - q) / 2, y, q, q); y += q + 8;
    }
    center(visibleText('receiptFooterText') || 'Thank you!', '20px sans-serif', 26);
    y += 24;

    return { ctx: ctx, height: Math.min(canvas.height, Math.ceil(y)) };
  }

  // ---- canvas -> ESC/POS raster (GS v 0), banded -------------------------
  function toEscPos(ctx, height) {
    var bytesPerRow = Math.ceil(WIDTH / 8); // 48 for 384
    var out = [0x1B, 0x40];                 // ESC @ (init)
    var BAND = 128;                         // rows per GS v 0 command
    for (var y0 = 0; y0 < height; y0 += BAND) {
      var bh = Math.min(BAND, height - y0);
      var data = ctx.getImageData(0, y0, WIDTH, bh).data;
      out.push(0x1D, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, bh & 0xff, (bh >> 8) & 0xff);
      for (var y = 0; y < bh; y++) {
        for (var bx = 0; bx < bytesPerRow; bx++) {
          var b = 0;
          for (var bit = 0; bit < 8; bit++) {
            var x = bx * 8 + bit;
            if (x < WIDTH) {
              var idx = (y * WIDTH + x) * 4;
              var lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
              if (lum < 140) b |= (0x80 >> bit); // dark pixel -> print
            }
          }
          out.push(b);
        }
      }
    }
    out.push(0x0A, 0x0A, 0x0A, 0x0A);       // feed
    out.push(0x1D, 0x56, 0x42, 0x00);       // partial cut (cutterless printers ignore)
    return new Uint8Array(out);
  }

  // ---- connection + write ------------------------------------------------
  var conn = { device: null, char: null };

  async function connect() {
    if (conn.char && conn.device && conn.device.gatt && conn.device.gatt.connected) return conn.char;
    if (!navigator.bluetooth) {
      throw new Error('This browser can\'t do Bluetooth printing. Use Chrome or Edge on Android/desktop (over HTTPS). On iPhone/Safari, use "Print Full Receipt" instead.');
    }
    var device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES });
    var server = await device.gatt.connect();
    var writable = null;
    try {
      var svc = await server.getPrimaryService(KNOWN.service);
      writable = await svc.getCharacteristic(KNOWN.write);
    } catch (_) { writable = null; }
    if (!writable) {
      var services = await server.getPrimaryServices();
      for (var i = 0; i < services.length && !writable; i++) {
        var chars;
        try { chars = await services[i].getCharacteristics(); } catch (e) { continue; }
        for (var j = 0; j < chars.length; j++) {
          var p = chars[j].properties;
          if (p.write || p.writeWithoutResponse) { writable = chars[j]; break; }
        }
      }
    }
    if (!writable) {
      throw new Error('Connected, but this printer exposes no writable channel — it looks like a Classic-Bluetooth (SPP) printer, which browsers can\'t print to. A BLE / "Bluetooth LE" printer is required.');
    }
    device.addEventListener('gattserverdisconnected', function () { conn.char = null; });
    conn.device = device; conn.char = writable;
    return writable;
  }

  async function writeAll(char, bytes) {
    var useNoResp = char.properties.writeWithoutResponse && char.writeValueWithoutResponse;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      var slice = bytes.slice(i, i + CHUNK);
      if (useNoResp) await char.writeValueWithoutResponse(slice);
      else await char.writeValue(slice);
      await new Promise(function (r) { setTimeout(r, CHUNK_DELAY); });
    }
  }

  async function printReceipt() {
    var rendered = await renderCanvas();
    var bytes = toEscPos(rendered.ctx, rendered.height);
    var char = await connect();
    await writeAll(char, bytes);
  }

  window.BlePrinter = { printReceipt: printReceipt, renderCanvas: renderCanvas };

  // ---- wire the receipt-modal button -------------------------------------
  document.addEventListener('click', async function (ev) {
    var btn = ev.target.closest && ev.target.closest('#btPrintReceipt');
    if (!btn) return;
    var original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      await printReceipt();
      btn.textContent = 'Printed ✓';
      setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 1500);
    } catch (e) {
      btn.disabled = false; btn.textContent = original;
      alert('Bluetooth print failed: ' + (e && e.message ? e.message : e));
    }
  });
})();
