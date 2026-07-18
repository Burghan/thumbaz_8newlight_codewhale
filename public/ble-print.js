// Bluetooth (BLE) thermal-printer support for the POS receipt.
//
// Sends the on-screen receipt straight to an ESC/POS BLE printer via Web
// Bluetooth, as an alternative to the browser's Print dialog (window.print()).
// Auto-discovers the printer's writable characteristic from a wide candidate
// list (the same net /ble-scan.html uses), so it works with most generic 58mm
// ESC/POS BLE boards without pre-configuring a UUID. The receipt is read from
// the modal DOM, so the printout always matches what's shown.
//
// Web Bluetooth constraints: Chrome/Edge on Android or desktop, served over
// HTTPS (or localhost). Classic-Bluetooth (SPP)-only printers can't be reached
// by any browser — and iOS/Safari has no Web Bluetooth at all; on those, the
// "Print Full Receipt" (browser print) button is the path.
(function () {
  'use strict';

  // Same candidate services as /ble-scan.html — Web Bluetooth only exposes
  // services named here, so the printer's must be in this list to connect.
  var CANDIDATE_SERVICES = [
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC/Microchip transparent UART (very common clone)
    '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style UART clone
    '000018f0-0000-1000-8000-00805f9b34fb', // cheap OEM ESC/POS BLE boards
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Nordic-style UART variant
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service (NUS)
    'generic_access', 'generic_attribute', 'device_information', 'battery_service'
  ];

  var COLS = 32;        // 58mm paper = 32 columns. Set to 48 for an 80mm printer.
  var CHUNK = 180;      // bytes per BLE write; cheap boards choke on large frames
  var CHUNK_DELAY = 24; // ms between chunks — some boards need the breathing room

  // Known printer profile — VSC-TM-58D Pro (58mm). Tried first for a fast,
  // deterministic connect; auto-discovery below is the fallback for others.
  var KNOWN = {
    service: '0000ffe0-0000-1000-8000-00805f9b34fb',
    write: '0000ffe1-0000-1000-8000-00805f9b34fb'
  };

  // ---- ESC/POS byte builder ----------------------------------------------
  function bytesOf(str) {
    var a = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      a.push(c < 256 ? c : 63); // non-latin -> '?', printers can't render it anyway
    }
    return a;
  }
  function Esc() { this.b = []; }
  Esc.prototype.raw = function () { for (var i = 0; i < arguments.length; i++) this.b.push(arguments[i]); return this; };
  Esc.prototype.init = function () { return this.raw(0x1B, 0x40); };
  Esc.prototype.align = function (n) { return this.raw(0x1B, 0x61, n); };   // 0 left, 1 center, 2 right
  Esc.prototype.bold = function (on) { return this.raw(0x1B, 0x45, on ? 1 : 0); };
  Esc.prototype.big = function (on) { return this.raw(0x1D, 0x21, on ? 0x11 : 0x00); }; // double W+H
  Esc.prototype.text = function (s) { this.b = this.b.concat(bytesOf(s)); return this; };
  Esc.prototype.ln = function (s) { return this.text(s || '').raw(0x0A); };
  Esc.prototype.feed = function (n) { for (var i = 0; i < (n || 1); i++) this.raw(0x0A); return this; };
  Esc.prototype.cut = function () { return this.raw(0x1D, 0x56, 0x42, 0x00); }; // partial cut (cutterless printers ignore it)
  Esc.prototype.bytes = function () { return new Uint8Array(this.b); };

  function repeat(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }
  function rule() { return repeat('-', COLS); }
  function center(s) {
    s = String(s);
    if (s.length >= COLS) return s.slice(0, COLS);
    return repeat(' ', Math.floor((COLS - s.length) / 2)) + s;
  }
  // "left ........ right" padded to COLS; left is truncated if it would collide.
  function row(left, right) {
    left = String(left); right = String(right);
    var space = COLS - right.length;
    if (left.length > space - 1) left = left.slice(0, Math.max(0, space - 1));
    var pad = Math.max(1, COLS - left.length - right.length);
    return left + repeat(' ', pad) + right;
  }

  // ---- read the on-screen receipt ----------------------------------------
  function visibleText(id) {
    var el = document.getElementById(id);
    if (!el || el.classList.contains('hidden') || el.style.display === 'none') return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function readItems() {
    var nodes = document.querySelectorAll('#receiptItems .receipt-item');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var qtyEl = el.children[0];
      var nameEl = el.querySelector('.name');
      var totalEl = el.children[el.children.length - 1];
      out.push({
        qty: qtyEl ? (qtyEl.textContent || '').trim() : '',
        name: nameEl ? (nameEl.textContent || '').replace(/\s+/g, ' ').trim() : '',
        total: totalEl ? (totalEl.textContent || '').trim() : ''
      });
    }
    return out;
  }
  function changeVisible() {
    var r = document.getElementById('receiptChangeLine');
    return !!(r && r.style.display !== 'none');
  }

  function buildReceiptBytes() {
    var store = visibleText('receiptLogoText') || '8 NewLight';
    var e = new Esc().init().align(1).bold(true).big(true).ln(store).big(false).bold(false);

    var ticket = visibleText('receiptTicket');
    if (ticket) e.ln(ticket);

    e.align(0);
    ['receiptTime', 'receiptCashier', 'receiptOrderType', 'receiptCustomer', 'receiptNote', 'receiptLoyalty']
      .forEach(function (id) { var t = visibleText(id); if (t) e.ln(t); });

    e.ln(rule());
    var items = readItems();
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      e.ln((it.qty ? it.qty + ' ' : '') + it.name);   // name line (wraps on the printer)
      e.ln(row('', it.total));                         // price right-aligned under it
    }
    e.ln(rule());

    var subtotal = visibleText('receiptSubtotal');
    var tax = visibleText('receiptTax');
    var total = visibleText('receiptTotal2') || visibleText('receiptTotal');
    if (subtotal) e.ln(row('Subtotal', subtotal));
    if (tax && tax !== 'Rp 0') e.ln(row('Tax', tax));
    e.bold(true).ln(row('TOTAL', total)).bold(false);
    if (changeVisible()) { var ch = visibleText('receiptChange'); if (ch) e.ln(row('Change', ch)); }

    e.feed(1).align(1).ln(visibleText('receiptFooterText') || 'Thank you!');
    e.feed(3).cut();
    return e.bytes();
  }

  // ---- connection + write ------------------------------------------------
  var conn = { device: null, char: null };

  async function connect() {
    if (conn.char && conn.device && conn.device.gatt && conn.device.gatt.connected) return conn.char;
    if (!navigator.bluetooth) {
      throw new Error('This browser can\'t do Bluetooth printing. Use Chrome or Edge on Android/desktop (over HTTPS). On iPhone/Safari, use "Print Full Receipt" instead.');
    }
    var device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES
    });
    var server = await device.gatt.connect();
    var writable = null;

    // 1. Try the known VSC-TM-58D Pro channel (ffe0 / ffe1) directly.
    try {
      var svc = await server.getPrimaryService(KNOWN.service);
      writable = await svc.getCharacteristic(KNOWN.write);
    } catch (_) { writable = null; }

    // 2. Fallback: scan every visible service for the first writable characteristic.
    if (!writable) {
      var services = await server.getPrimaryServices();
      for (var i = 0; i < services.length && !writable; i++) {
        var chars;
        try { chars = await services[i].getCharacteristics(); } catch (_) { continue; }
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
    var bytes = buildReceiptBytes();
    var char = await connect();
    await writeAll(char, bytes);
  }

  window.BlePrinter = { printReceipt: printReceipt, buildReceiptBytes: buildReceiptBytes };

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
