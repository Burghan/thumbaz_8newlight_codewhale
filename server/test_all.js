const http = require('http');
const fs = require('fs');

const HOST = 'localhost'; const PORT = 3101;

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: HOST, port: PORT, path, method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(body); }
    if (cookie) opts.headers.Cookie = cookie;
    const r = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, body: d, cookie: setCookie ? setCookie[0].split(';')[0] : cookie });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function main() {
  console.log('🔍 8 NewLight Coffee — System Verification\n');
  let cookie = null, errors = [];

  // 1. Health check
  const health = await req('GET', '/health');
  console.log(health.status === 200 ? '✅' : '❌', 'Server health:', health.status);

  // 2. Login
  const login = await req('POST', '/api/auth/pin', JSON.stringify({name:'Burghan',pin:'0000'}));
  cookie = login.cookie;
  if (!cookie) { console.log('❌ Login failed'); return; }
  console.log('✅ Login:', JSON.parse(login.body).name);

  // 3. All API endpoints
  const apis = [
    ['GET','/api/products'],['GET','/api/ingredients'],['GET','/api/recipes/summary'],
    ['GET','/api/categories'],['GET','/api/ingredient-categories'],
    ['GET','/api/suppliers'],['GET','/api/purchases'],['GET','/api/expenses'],
    ['GET','/api/inventory/on-hand'],['GET','/api/inventory/thresholds'],['GET','/api/inventory/summary'],
    ['GET','/api/reports/recipe-costing'],['GET','/api/reports/monthly-summary'],
    ['GET','/api/reports/monthly?month=2026-07'],['GET','/api/reports/daily?month=2026-07'],
    ['GET','/api/transactions'],['GET','/api/auth/users'],
    ['GET','/api/attendance/today'],['GET','/api/attendance/history?month=2026-07'],
  ];
  for (const [method, path] of apis) {
    const r = await req(method, path, null, cookie);
    if (r.status !== 200) errors.push(`API ${path} → ${r.status}`);
  }
  console.log(errors.length ? `❌ ${errors.length} API errors:` : `✅ All ${apis.length} API endpoints OK`);
  if (errors.length) errors.forEach(e => console.log('  ', e));

  // 4. All HTML pages
  const pages = [
    'dashboard','pos','inventory','menu','receipe','ingredients','purchase',
    'expenses','supplier','system-report','import-center','clock','employees','payroll'
  ];
  let pageErrors = [];
  for (const p of pages) {
    const r = await req('GET', `/${p}.html`, null, cookie);
    if (r.status !== 200) pageErrors.push(`${p}.html → ${r.status}`);
    // Check sidebar consistency
    const hasSidebar = r.body.includes('class="sidebar"');
    const hasToggle = r.body.includes('menuToggle');
    const hasNavGroup = r.body.includes('nav-group');
    if (!hasSidebar) errors.push(`${p}.html: no sidebar`);
    if (!hasToggle) errors.push(`${p}.html: no menuToggle`);
    if (!hasNavGroup) errors.push(`${p}.html: no nav-group`);
  }
  console.log(pageErrors.length ? `❌ ${pageErrors.length} page errors:` : `✅ All ${pages.length} pages serve correctly`);

  // 5. Sidebar consistency
  const sidebarErrors = errors.filter(e => e.includes('sidebar') || e.includes('menuToggle') || e.includes('nav-group'));
  console.log(sidebarErrors.length ? `❌ ${sidebarErrors.length} sidebar issues:` : '✅ All pages have consistent sidebar (sidebar + toggle + nav-groups)');
  if (sidebarErrors.length) sidebarErrors.forEach(e => console.log('  ', e));

  // 6. Test data summary
  const r = await req('GET', '/api/reports/monthly-summary', null, cookie);
  const summary = JSON.parse(r.body);
  console.log('\n📊 Data Summary:');
  console.log(`  July Revenue: Rp ${summary.current.revenue.toLocaleString('id-ID')}`);
  console.log(`  July COGS: Rp ${(summary.current.cost||0).toLocaleString('id-ID')}`);
  console.log(`  July Orders: ${summary.current.order_count}`);

  console.log('\n✅ Verification complete.');
}

main().catch(e => console.error('Fatal:', e.message));
