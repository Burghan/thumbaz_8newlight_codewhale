// Small helpers for reading messy Excel workbooks (formula cells, spacing, units).
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

// Load an ExcelJS workbook from an uploaded buffer, accepting BOTH modern .xlsx
// and legacy .xls (BIFF). ExcelJS only reads .xlsx, so .xls files (e.g. the POS
// transaction export) are first converted to an .xlsx buffer via SheetJS.
// Detection is by magic bytes: .xls is an OLE compound file (D0 CF 11 E0);
// .xlsx is a ZIP (PK\x03\x04).
async function loadWorkbookFromBuffer(buffer) {
  const isOle = buffer && buffer.length >= 4 &&
    buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  let xlsxBuffer = buffer;
  if (isOle) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(xlsxBuffer);
  return out;
}

// Resolve a cell to a plain value, unwrapping formula/date/richtext objects.
function cellValue(cell) {
  const v = cell && cell.value;
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return v;
}

// Normalize a name for matching: lowercase, collapse whitespace, trim.
function normName(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Normalize a unit to the canonical code used in the schema.
function normUnit(s) {
  const u = normName(s);
  const map = {
    gr: 'g', gram: 'g', g: 'g', grams: 'g',
    ml: 'ml', milliliter: 'ml',
    l: 'l', liter: 'l', litre: 'l',
    kg: 'kg', kilogram: 'kg',
    pcs: 'pcs', pc: 'pcs', piece: 'pcs', pack: 'pcs', botol: 'pcs'
  };
  return map[u] || u;
}

async function loadWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

// Read a sheet into array-of-objects using a header row (1-indexed).
function readSheet(ws, headerRow = 1) {
  const headers = [];
  ws.getRow(headerRow).eachCell((cell, col) => { headers[col] = String(cellValue(cell) || '').trim(); });
  const rows = [];
  for (let n = headerRow + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const obj = {};
    let any = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const val = cellValue(row.getCell(col));
      if (val != null && String(val).trim() !== '') any = true;
      obj[h] = val;
    });
    if (any) rows.push(obj);
  }
  return rows;
}

module.exports = { cellValue, normName, normUnit, loadWorkbook, loadWorkbookFromBuffer, readSheet };
