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
  var CHUNK = 180;      // bytes per BLE write (this size transmitted fine on the VSC-TM-58D)
  var CHUNK_DELAY = 40; // ms between chunks — paced under the printer's speed so its buffer never overflows

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

    // Logo (scaled, centered), else the store name as text.
    if (logoImg && logoImg.width) {
      var lw = 150, lh = Math.round(logoImg.height * (lw / logoImg.width));
      ctx.drawImage(logoImg, (WIDTH - lw) / 2, y, lw, lh); y += lh + 6;
    } else {
      center(visibleText('receiptLogoText') || '8 NewLight', 'bold 26px sans-serif', 32);
    }

    var ticket = visibleText('receiptTicket');
    if (ticket) center(ticket, 'bold 18px sans-serif', 22);
    ['receiptTime', 'receiptCashier', 'receiptOrderType', 'receiptCustomer', 'receiptNote', 'receiptLoyalty']
      .forEach(function (id) { var t = visibleText(id); if (t) center(t, '16px sans-serif', 20); });

    y += 4; rule();

    var items = readItems();
    for (var i = 0; i < items.length; i++) {
      row((items[i].qty ? items[i].qty + '  ' : '') + items[i].name, items[i].total, '17px sans-serif', true);
      y += 23;
    }
    rule();

    var subtotal = visibleText('receiptSubtotal');
    var tax = visibleText('receiptTax');
    if (subtotal) { row('Subtotal', subtotal, '16px sans-serif', false); y += 22; }
    if (tax) { row('Tax', tax, '16px sans-serif', false); y += 22; }
    row('TOTAL', visibleText('receiptTotal2') || visibleText('receiptTotal'), '21px sans-serif', true); y += 30;
    if (changeVisible()) { var ch = visibleText('receiptChange'); if (ch) { row('Change', ch, '16px sans-serif', false); y += 22; } }

    y += 8;
    if (qrImg && qrImg.width) {
      var q = 110; ctx.drawImage(qrImg, (WIDTH - q) / 2, y, q, q); y += q + 6;
    }
    center(visibleText('receiptFooterText') || 'Thank you!', '16px sans-serif', 22);
    y += 20;

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

  // Find the writable characteristic on a connected GATT server (known ffe1
  // first, then scan). The chooser is NOT involved here.
  async function findWritable(server) {
    try {
      var svc = await server.getPrimaryService(KNOWN.service);
      var c = await svc.getCharacteristic(KNOWN.write);
      if (c) return c;
    } catch (_) { /* fall through to scan */ }
    var services = await server.getPrimaryServices();
    for (var i = 0; i < services.length; i++) {
      var chars;
      try { chars = await services[i].getCharacteristics(); } catch (e) { continue; }
      for (var j = 0; j < chars.length; j++) {
        var p = chars[j].properties;
        if (p.write || p.writeWithoutResponse) return chars[j];
      }
    }
    return null;
  }

  // --- saved-printer setup (pair once, print silently thereafter) ----------
  var STORE_ID = 'ble_printer_id', STORE_NAME = 'ble_printer_name';
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function savedPrinterName() { return lsGet(STORE_NAME); }

  // Pair/select the printer once (this is the ONLY place the chooser appears).
  // Saves it so every later print connects with no prompt.
  async function pairPrinter() {
    if (!navigator.bluetooth) throw new Error('Bluetooth needs Chrome or Edge on Android/desktop, served over HTTPS.');
    var device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES });
    lsSet(STORE_ID, device.id || '');
    lsSet(STORE_NAME, device.name || 'Bluetooth printer');
    conn.device = device;
    return { id: device.id || '', name: device.name || 'Bluetooth printer' };
  }

  function forgetPrinter() { lsDel(STORE_ID); lsDel(STORE_NAME); conn.device = null; conn.char = null; }

  // Resolve the saved printer WITHOUT a chooser: this session's device, or one
  // this origin was already granted (survives reloads) via getDevices().
  function isConfigured() { return !!(lsGet(STORE_ID) || lsGet(STORE_NAME)); }

  async function savedDevice() {
    if (conn.device) return conn.device;
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return null;
    if (!isConfigured()) return null;
    var id = lsGet(STORE_ID), name = lsGet(STORE_NAME);
    var devs;
    try { devs = await navigator.bluetooth.getDevices(); } catch (_) { return null; }
    if (!devs || !devs.length) return null;
    var m = null, i;
    for (i = 0; i < devs.length; i++) { if (id && devs[i].id === id) { m = devs[i]; break; } }
    if (!m) for (i = 0; i < devs.length; i++) { if (name && devs[i].name === name) { m = devs[i]; break; } }
    // id can come back empty / the name can differ slightly across pages — if a
    // printer was configured and the browser granted us some device(s), use the
    // first rather than falsely reporting "no printer".
    if (!m) m = devs[0];
    conn.device = m;
    return m;
  }

  // Clean (re)connect to a device + fresh writable characteristic. No chooser.
  // A stale handle from a prior connection makes writes silently vanish, so drop
  // any half-open link and re-open before each job.
  async function connectDevice(device) {
    var gatt = device.gatt;
    if (gatt.connected) { try { gatt.disconnect(); } catch (_) {} await new Promise(function (r) { setTimeout(r, 350); }); }
    var server = await gatt.connect();
    var writable = await findWritable(server);
    if (!writable) {
      throw new Error('Connected, but this printer exposes no writable channel — it looks like a Classic-Bluetooth (SPP) printer, which browsers can\'t print to. A BLE / "Bluetooth LE" printer is required.');
    }
    // A freshly-opened link isn't ready instantly — writing immediately mangles
    // or drops the first packets, which is why an un-primed print needed a second
    // tap. Settle, then PRIME with a wake/init byte, then settle again, so the
    // real print lands correctly on the first try.
    await new Promise(function (r) { setTimeout(r, 400); });
    try { await writeSlice(writable, new Uint8Array([0x1B, 0x40])); } catch (_) {} // ESC @ wake/init
    await new Promise(function (r) { setTimeout(r, 300); });
    conn.char = writable;
    return writable;
  }

  // Resolve the printer to use: saved/remembered device, or re-acquire it within
  // the current tap (chooser) if the browser couldn't hand it back silently.
  async function resolveDevice() {
    var device = await savedDevice();
    if (!device && navigator.bluetooth) {
      try {
        await pairPrinter();
        device = conn.device;
      } catch (e) {
        if (e && e.name === 'NotFoundError') throw new Error('No printer selected.');
        throw e;
      }
    }
    if (!device) throw new Error('Bluetooth printing needs Chrome or Edge over HTTPS. Otherwise use the "Print Full Receipt" button.');
    return device;
  }

  function writeSlice(char, slice) {
    // This printer (HM-10-style ffe1) only takes UNacknowledged writes —
    // writeValueWithResponse prints nothing on it. Flow control is done by pacing
    // (CHUNK_DELAY) instead, kept under the printer's physical print speed so its
    // buffer never overflows mid-raster.
    if (char.writeValueWithoutResponse) return char.writeValueWithoutResponse(slice);
    return char.writeValue(slice);
  }

  async function writeAll(char, bytes) {
    for (var i = 0; i < bytes.length; i += CHUNK) {
      var slice = bytes.slice(i, i + CHUNK);
      try {
        await writeSlice(char, slice);
      } catch (e) {
        await new Promise(function (r) { setTimeout(r, 150); }); // brief recovery, then retry once
        await writeSlice(char, slice);
      }
      await new Promise(function (r) { setTimeout(r, CHUNK_DELAY); });
    }
  }

  async function printReceipt() {
    var device = await resolveDevice();
    var rendered = await renderCanvas();
    var bytes = toEscPos(rendered.ctx, rendered.height);
    var char = await connectDevice(device);
    await writeAll(char, bytes);
  }

  // Small text test slip, for the setup screen's "Test print" button.
  async function testPrint() {
    var device = await resolveDevice();
    var char = await connectDevice(device);
    var e = [0x1B, 0x40, 0x1B, 0x61, 0x01]; // init + centre
    var line = function (s) { for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); e.push(c < 256 ? c : 63); } e.push(0x0A); };
    e.push(0x1D, 0x21, 0x11); line('8 NewLight'); e.push(0x1D, 0x21, 0x00);
    line('Bluetooth printer test');
    line('Connection OK');
    line(new Date().toLocaleString('id-ID'));
    e.push(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00);
    await writeAll(char, new Uint8Array(e));
  }

  window.BlePrinter = {
    printReceipt: printReceipt,
    testPrint: testPrint,
    pairPrinter: pairPrinter,
    forgetPrinter: forgetPrinter,
    savedDevice: savedDevice,
    savedPrinterName: savedPrinterName,
    supported: !!(navigator.bluetooth)
  };

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
