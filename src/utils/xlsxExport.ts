import { strToU8, zipSync } from 'fflate';
import type { LedgerMode, LedgerRow } from '../types/tax';
import { neutralizeSpreadsheetFormula } from './csvCodec';
import { formatAccounting, round2 } from './taxEngine';

function buildZip(entries: { name: string; content: string }[]): Blob {
  const zipInput: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    zipInput[entry.name] = strToU8(entry.content);
  }
  const zipped = zipSync(zipInput, { level: 6 });
  return new Blob([new Uint8Array(zipped)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function xmlEsc(str: string): string {
  return (str || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(idx0: number): string {
  let n = idx0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface CellSpec {
  col: number; // 0-indexed
  row: number; // 1-indexed
  value: string | number | null;
  style: number;
  formula?: string;
}

function renderCell(c: CellSpec): string {
  const ref = `${colLetter(c.col)}${c.row}`;
  if (c.formula) {
    const cached =
      typeof c.value === 'number' && Number.isFinite(c.value)
        ? `<v>${round2(c.value)}</v>`
        : '';
    return `<c r="${ref}" s="${c.style}"><f>${xmlEsc(c.formula)}</f>${cached}</c>`;
  }
  if (typeof c.value === 'number' && Number.isFinite(c.value)) {
    return `<c r="${ref}" s="${c.style}"><v>${round2(c.value)}</v></c>`;
  }
  const text = c.value === null ? '-' : String(c.value);
  return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t>${xmlEsc(text)}</t></is></c>`;
}

/**
 * Style indices in xl/styles.xml:
 * 0: default body text (left, thin border)
 * 1: header bold centered white bg, thin border (bottom align for merged cols)
 * 2: header bold centered white bg, thin border (center/middle align for top banner & subheaders)
 * 3: header bold centered YELLOW (#FFFF00) bg, thin border, bottom align (PARTICULAR & ACCOUNT TITLE)
 * 4: body number (#,##0.00), right align, thin border
 * 5: body dash "-" center/right align, thin border
 * 6: body centered text (date, month, category, yes/no), thin border
 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00);&quot;-&quot;"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="10"/><name val="Calibri"/><color rgb="FF000000"/></font>
    <font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF000000"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

function buildPurchasesSheetXml(rows: LedgerRow[]): string {
  const colWidths = [
    12, 13, 20, 28, 28, 17, 26, 22, 18, 16, 28, 22, 24, 18, 18, 16, 16, 14, 16, 13, 13, 13,
  ];
  const colsXml = `<cols>${colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')}</cols>`;

  const row1Cells: CellSpec[] = [];
  for (let c = 0; c < 22; c++) {
    let val: string = '';
    if (c === 0) val = 'PURCHASES';
    if (c === 19) val = 'WITHHOLDING TAX';
    row1Cells.push({ col: c, row: 1, value: val, style: 2 });
  }

  const colHeaders = [
    'DATE',
    'MONTH',
    'BRANCH/ TRADE NAME',
    'PAYEE/SUPPLIER',
    'CLASSIFICATION OF PAYEE/SUPPLIER (N/A, INDIVIDUAL OR CORP)',
    'TIN',
    'ADDRESS (BARANGAY / MUNICIPALITY)',
    'ADDRESS (CITY / DISTRICT)',
    'SUPPORTING DOCS',
    'REFERENCE NO.',
    'PARTICULAR',
    'ACCOUNT TITLE',
    'N/A, GOODS, SERVICES OR RENTAL',
    'WITHHOLDING AGENT (YES OR NO)',
    'NON-VAT/VAT EXEMPT',
    'GROSS OF VAT',
    'NET OF VAT',
    'VAT',
    'TOTAL',
  ];

  const row2Cells: CellSpec[] = [];
  for (let c = 0; c < 19; c++) {
    const isYellow = c === 10 || c === 11;
    row2Cells.push({ col: c, row: 2, value: colHeaders[c], style: isYellow ? 3 : 1 });
  }
  row2Cells.push({ col: 19, row: 2, value: 'GOODS', style: 2 });
  row2Cells.push({ col: 20, row: 2, value: 'SERVICES', style: 2 });
  row2Cells.push({ col: 21, row: 2, value: 'RENTAL', style: 2 });

  const row3Cells: CellSpec[] = [];
  for (let c = 0; c < 19; c++) {
    const isYellow = c === 10 || c === 11;
    row3Cells.push({ col: c, row: 3, value: '', style: isYellow ? 3 : 1 });
  }
  row3Cells.push({ col: 19, row: 3, value: '1%', style: 2 });
  row3Cells.push({ col: 20, row: 3, value: '2%', style: 2 });
  row3Cells.push({ col: 21, row: 3, value: '5%', style: 2 });

  const sheetRowsXml: string[] = [
    `<row r="1" ht="24" customHeight="1">${row1Cells.map(renderCell).join('')}</row>`,
    `<row r="2" ht="20" customHeight="1">${row2Cells.map(renderCell).join('')}</row>`,
    `<row r="3" ht="34" customHeight="1">${row3Cells.map(renderCell).join('')}</row>`,
  ];

  rows.forEach((r, idx) => {
    const rowNum = idx + 4;
    const nonVat = round2(r.nonVatExempt ?? 0);
    const gross = round2(r.grossOfVat ?? 0);
    const whtAgent = r.withholdingAgent ?? 'NO';

    const autoNet = gross > 0 ? round2(gross / 1.12) : 0;
    const autoVat = gross > 0 ? round2(gross - autoNet) : 0;
    const autoTotal = round2(nonVat + autoNet);
    const autoWtGoods = r.category === 'GOODS' && whtAgent === 'YES' ? round2(autoTotal * 0.01) : 0;
    const autoWtServices = r.category === 'SERVICES' && whtAgent === 'YES' ? round2(autoTotal * 0.02) : 0;
    const autoWtRental = r.category === 'RENTAL' && whtAgent === 'YES' ? round2(autoTotal * 0.05) : 0;

    const isManual = Boolean(r.manualOverride);

    const cells: CellSpec[] = [
      { col: 0, row: rowNum, value: r.date, style: 6 },
      { col: 1, row: rowNum, value: r.month, style: 6 },
      { col: 2, row: rowNum, value: r.branchTradeName, style: 0 },
      { col: 3, row: rowNum, value: r.payor, style: 0 },
      { col: 4, row: rowNum, value: r.payeeClassification ?? 'N/A', style: 6 },
      { col: 5, row: rowNum, value: r.tin, style: 6 },
      { col: 6, row: rowNum, value: r.address, style: 0 },
      { col: 7, row: rowNum, value: r.address2 ?? '', style: 0 },
      { col: 8, row: rowNum, value: r.supportingDocs ?? '', style: 6 },
      { col: 9, row: rowNum, value: r.referenceNo ?? '', style: 6 },
      { col: 10, row: rowNum, value: r.particular ?? '', style: 0 },
      { col: 11, row: rowNum, value: r.accountTitle ?? '', style: 0 },
      { col: 12, row: rowNum, value: r.category, style: 6 },
      { col: 13, row: rowNum, value: whtAgent, style: 6 },
      { col: 14, row: rowNum, value: nonVat, style: 4 },
      { col: 15, row: rowNum, value: gross, style: 4 },
      isManual
        ? { col: 16, row: rowNum, value: round2(r.netOfVat ?? 0), style: 4 }
        : { col: 16, row: rowNum, value: autoNet, formula: `P${rowNum}/1.12`, style: 4 },
      isManual
        ? { col: 17, row: rowNum, value: round2(r.vat ?? 0), style: 4 }
        : { col: 17, row: rowNum, value: autoVat, formula: `P${rowNum}-Q${rowNum}`, style: 4 },
      isManual
        ? { col: 18, row: rowNum, value: round2(r.total ?? 0), style: 4 }
        : { col: 18, row: rowNum, value: autoTotal, formula: `O${rowNum}+Q${rowNum}`, style: 4 },
      isManual
        ? { col: 19, row: rowNum, value: round2(r.wtGoods1 ?? 0), style: 4 }
        : {
            col: 19,
            row: rowNum,
            value: autoWtGoods,
            formula: `IF(AND(M${rowNum}="GOODS",N${rowNum}="YES"),S${rowNum}*1%,0)`,
            style: 4,
          },
      isManual
        ? { col: 20, row: rowNum, value: round2(r.wtServices2 ?? 0), style: 4 }
        : {
            col: 20,
            row: rowNum,
            value: autoWtServices,
            formula: `IF(AND(M${rowNum}="SERVICES",N${rowNum}="YES"),S${rowNum}*2%,0)`,
            style: 4,
          },
      isManual
        ? { col: 21, row: rowNum, value: round2(r.wtRental5 ?? 0), style: 4 }
        : {
            col: 21,
            row: rowNum,
            value: autoWtRental,
            formula: `IF(AND(M${rowNum}="RENTAL",N${rowNum}="YES"),S${rowNum}*5%,0)`,
            style: 4,
          },
    ];
    sheetRowsXml.push(`<row r="${rowNum}" ht="20" customHeight="1">${cells.map(renderCell).join('')}</row>`);
  });

  const merges: string[] = [
    '<mergeCell ref="A1:S1"/>',
    '<mergeCell ref="T1:V1"/>',
    ...Array.from({ length: 19 }, (_, c) => `<mergeCell ref="${colLetter(c)}2:${colLetter(c)}3"/>`),
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${colsXml}
  <sheetData>${sheetRowsXml.join('')}</sheetData>
  <mergeCells count="${merges.length}">${merges.join('')}</mergeCells>
</worksheet>`;
}

function buildSalesSheetXml(rows: LedgerRow[]): string {
  const colWidths = [12, 13, 20, 28, 17, 26, 22, 22, 16, 18, 16, 16, 14, 16, 12, 12, 12, 12, 16, 26];
  const colsXml = `<cols>${colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')}</cols>`;

  const row1Cells: CellSpec[] = [];
  for (let c = 0; c < 20; c++) {
    let val = '';
    if (c === 0) val = 'SALES';
    if (c === 14) val = 'WITHHOLDING TAX';
    if (c === 18) val = 'ACTUAL';
    if (c === 19) val = 'REMARKS';
    row1Cells.push({ col: c, row: 1, value: val, style: 2 });
  }

  const colHeaders = [
    'DATE',
    'MONTH',
    'BRANCH/ TRADE NAME',
    'PAYOR',
    'TIN',
    'ADDRESS (BARANGAY / MUNICIPALITY)',
    'ADDRESS (CITY / DISTRICT)',
    'GOODS, SERVICES OR RENTAL',
    'PRIVATE OR GOVT',
    'NON-VAT/VAT EXEMPT',
    'GROSS OF VAT',
    'NET OF VAT',
    'VAT',
    'TOTAL',
  ];

  const row2Cells: CellSpec[] = [];
  for (let c = 0; c < 14; c++) {
    row2Cells.push({ col: c, row: 2, value: colHeaders[c], style: 1 });
  }
  row2Cells.push({ col: 14, row: 2, value: 'GOODS', style: 2 });
  row2Cells.push({ col: 15, row: 2, value: 'SERVICES', style: 2 });
  row2Cells.push({ col: 16, row: 2, value: 'RENTAL', style: 2 });
  row2Cells.push({ col: 17, row: 2, value: 'VAT', style: 2 });
  row2Cells.push({ col: 18, row: 2, value: '', style: 1 });
  row2Cells.push({ col: 19, row: 2, value: '', style: 1 });

  const row3Cells: CellSpec[] = [];
  for (let c = 0; c < 14; c++) {
    row3Cells.push({ col: c, row: 3, value: '', style: 1 });
  }
  row3Cells.push({ col: 14, row: 3, value: '1%', style: 2 });
  row3Cells.push({ col: 15, row: 3, value: '2%', style: 2 });
  row3Cells.push({ col: 16, row: 3, value: '5%', style: 2 });
  row3Cells.push({ col: 17, row: 3, value: '5%', style: 2 });
  row3Cells.push({ col: 18, row: 3, value: '', style: 1 });
  row3Cells.push({ col: 19, row: 3, value: '', style: 1 });

  const sheetRowsXml: string[] = [
    `<row r="1" ht="24" customHeight="1">${row1Cells.map(renderCell).join('')}</row>`,
    `<row r="2" ht="20" customHeight="1">${row2Cells.map(renderCell).join('')}</row>`,
    `<row r="3" ht="30" customHeight="1">${row3Cells.map(renderCell).join('')}</row>`,
  ];

  rows.forEach((r, idx) => {
    const rowNum = idx + 4;
    const nonVat = round2(r.nonVatExempt ?? 0);
    const gross = round2(r.grossOfVat ?? 0);

    const autoNet = gross > 0 ? round2(gross / 1.12) : 0;
    const autoVat = gross > 0 ? round2(gross - autoNet) : 0;
    const autoTotal = round2(nonVat + autoNet);
    const autoWtGoods = r.category === 'GOODS' ? round2(autoTotal * 0.01) : 0;
    const autoWtServices = r.category === 'SERVICES' ? round2(autoTotal * 0.02) : 0;
    const autoWtRental = r.category === 'RENTAL' ? round2(autoTotal * 0.05) : 0;
    const autoWtVat5 = r.privateOrGovt === 'GOVT' && r.applyGovtVat5 ? round2(autoTotal * 0.05) : 0;

    const isManual = Boolean(r.manualOverride);

    const cells: CellSpec[] = [
      { col: 0, row: rowNum, value: r.date, style: 6 },
      { col: 1, row: rowNum, value: r.month, style: 6 },
      { col: 2, row: rowNum, value: r.branchTradeName, style: 0 },
      { col: 3, row: rowNum, value: r.payor, style: 0 },
      { col: 4, row: rowNum, value: r.tin, style: 6 },
      { col: 5, row: rowNum, value: r.address, style: 0 },
      { col: 6, row: rowNum, value: r.address2 ?? '', style: 0 },
      { col: 7, row: rowNum, value: r.category, style: 6 },
      { col: 8, row: rowNum, value: r.privateOrGovt, style: 6 },
      { col: 9, row: rowNum, value: nonVat, style: 4 },
      { col: 10, row: rowNum, value: gross, style: 4 },
      isManual
        ? { col: 11, row: rowNum, value: round2(r.netOfVat ?? 0), style: 4 }
        : { col: 11, row: rowNum, value: autoNet, formula: `K${rowNum}/1.12`, style: 4 },
      isManual
        ? { col: 12, row: rowNum, value: round2(r.vat ?? 0), style: 4 }
        : { col: 12, row: rowNum, value: autoVat, formula: `K${rowNum}-L${rowNum}`, style: 4 },
      isManual
        ? { col: 13, row: rowNum, value: round2(r.total ?? 0), style: 4 }
        : { col: 13, row: rowNum, value: autoTotal, formula: `J${rowNum}+L${rowNum}`, style: 4 },
      isManual
        ? { col: 14, row: rowNum, value: round2(r.wtGoods1 ?? 0), style: 4 }
        : {
            col: 14,
            row: rowNum,
            value: autoWtGoods,
            formula: `IF(H${rowNum}="GOODS",N${rowNum}*1%,0)`,
            style: 4,
          },
      isManual
        ? { col: 15, row: rowNum, value: round2(r.wtServices2 ?? 0), style: 4 }
        : {
            col: 15,
            row: rowNum,
            value: autoWtServices,
            formula: `IF(H${rowNum}="SERVICES",N${rowNum}*2%,0)`,
            style: 4,
          },
      isManual
        ? { col: 16, row: rowNum, value: round2(r.wtRental5 ?? 0), style: 4 }
        : {
            col: 16,
            row: rowNum,
            value: autoWtRental,
            formula: `IF(H${rowNum}="RENTAL",N${rowNum}*5%,0)`,
            style: 4,
          },
      isManual
        ? { col: 17, row: rowNum, value: round2(r.wtVat5 ?? 0), style: 4 }
        : r.privateOrGovt === 'GOVT' && !r.applyGovtVat5
        ? { col: 17, row: rowNum, value: 0, style: 4 }
        : {
            col: 17,
            row: rowNum,
            value: autoWtVat5,
            formula: `IF(I${rowNum}="GOVT",N${rowNum}*5%,0)`,
            style: 4,
          },
      { col: 18, row: rowNum, value: r.actual !== null && r.actual !== undefined ? round2(r.actual) : 0, style: 4 },
      { col: 19, row: rowNum, value: r.remarks, style: 0 },
    ];
    sheetRowsXml.push(`<row r="${rowNum}" ht="20" customHeight="1">${cells.map(renderCell).join('')}</row>`);
  });

  const merges: string[] = [
    '<mergeCell ref="A1:N1"/>',
    '<mergeCell ref="O1:R1"/>',
    '<mergeCell ref="S1:S3"/>',
    '<mergeCell ref="T1:T3"/>',
    ...Array.from({ length: 14 }, (_, c) => `<mergeCell ref="${colLetter(c)}2:${colLetter(c)}3"/>`),
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${colsXml}
  <sheetData>${sheetRowsXml.join('')}</sheetData>
  <mergeCells count="${merges.length}">${merges.join('')}</mergeCells>
</worksheet>`;
}

function buildXlsxWorkbookZip(sheets: { name: string; xml: string }[]): Blob {
  const sheetOverrides = sheets
    .map(
      (_, i) =>
        `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('\n');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetOverrides}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const sheetDefs = sheets
    .map(
      (s, i) =>
        `    <sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('\n');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${sheetDefs}
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

  const sheetRels = sheets
    .map(
      (_, i) =>
        `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('\n');

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetRels}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content: s.xml,
    })),
  ]);
}

export function buildFilingXlsxBlob(mode: LedgerMode, rows: LedgerRow[]): Blob {
  const sheetXml = mode === 'PURCHASES' ? buildPurchasesSheetXml(rows) : buildSalesSheetXml(rows);
  return buildXlsxWorkbookZip([{ name: mode, xml: sheetXml }]);
}

export function buildConsolidatedFilingXlsxBlob(
  salesRows: LedgerRow[],
  purchasesRows: LedgerRow[]
): Blob {
  return buildXlsxWorkbookZip([
    { name: 'SALES', xml: buildSalesSheetXml(salesRows) },
    { name: 'PURCHASES', xml: buildPurchasesSheetXml(purchasesRows) },
  ]);
}

export function downloadXlsxBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function htmlEsc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeSheetCell(s: string): string {
  return neutralizeSpreadsheetFormula(String(s ?? '').replace(/[\t\r\n]+/g, ' '));
}

/**
 * Generates HTML + TSV clipboard payloads so pasting directly into Google Sheets
 * preserves merged headers, borders, and exact #FFFF00 yellow highlights.
 */
export async function copyFilingTableForGoogleSheets(
  mode: LedgerMode,
  rows: LedgerRow[]
): Promise<void> {
  let html = '';
  let tsv = '';

  if (mode === 'PURCHASES') {
    const cols = [
      'DATE',
      'MONTH',
      'BRANCH/ TRADE NAME',
      'PAYEE/SUPPLIER',
      'CLASSIFICATION OF PAYEE/SUPPLIER (N/A, INDIVIDUAL OR CORP)',
      'TIN',
      'ADDRESS (BARANGAY / MUNICIPALITY)',
      'ADDRESS (CITY / DISTRICT)',
      'SUPPORTING DOCS',
      'REFERENCE NO.',
      'PARTICULAR',
      'ACCOUNT TITLE',
      'N/A, GOODS, SERVICES OR RENTAL',
      'WITHHOLDING AGENT (YES OR NO)',
      'NON-VAT/VAT EXEMPT',
      'GROSS OF VAT',
      'NET OF VAT',
      'VAT',
      'TOTAL',
    ];

    const h1 = `<tr><th colspan="19" style="border:1px solid #000;font-weight:bold;text-align:center;">PURCHASES</th><th colspan="3" style="border:1px solid #000;font-weight:bold;text-align:center;">WITHHOLDING TAX</th></tr>`;
    const h2 = `<tr>${cols
      .map((c, idx) => {
        const bg = idx === 10 || idx === 11 ? 'background-color:#FFFF00;' : '';
        return `<th rowspan="2" style="border:1px solid #000;font-weight:bold;text-align:center;vertical-align:bottom;${bg}">${htmlEsc(c)}</th>`;
      })
      .join('')}<th style="border:1px solid #000;font-weight:bold;text-align:center;">GOODS</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">SERVICES</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">RENTAL</th></tr>`;
    const h3 = `<tr><th style="border:1px solid #000;font-weight:bold;text-align:center;">1%</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">2%</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">5%</th></tr>`;

    const buildPurchaseRowCells = (r: LedgerRow) =>
      [
        r.date,
        r.month,
        r.branchTradeName,
        r.payor,
        r.payeeClassification ?? 'N/A',
        r.tin,
        r.address,
        r.address2 ?? '',
        r.supportingDocs ?? '',
        r.referenceNo ?? '',
        r.particular ?? '',
        r.accountTitle ?? '',
        r.category,
        r.withholdingAgent ?? 'NO',
        formatAccounting(r.nonVatExempt),
        formatAccounting(r.grossOfVat),
        formatAccounting(r.netOfVat),
        formatAccounting(r.vat),
        formatAccounting(r.total),
        formatAccounting(r.wtGoods1),
        formatAccounting(r.wtServices2),
        formatAccounting(r.wtRental5),
      ].map(safeSheetCell);

    const bodyHtml = rows
      .map((r) => {
        const vals = buildPurchaseRowCells(r);
        return `<tr>${vals
          .map((v, i) => `<td style="border:1px solid #000;text-align:${i >= 14 ? 'right' : 'left'};">${htmlEsc(v)}</td>`)
          .join('')}</tr>`;
      })
      .join('');

    html = `<table style="border-collapse:collapse;"><thead>${h1}${h2}${h3}</thead><tbody>${bodyHtml}</tbody></table>`;

    const tsv1 = ['PURCHASES', ...Array(18).fill(''), 'WITHHOLDING TAX', '', ''].join('\t');
    const tsv2 = [...cols, 'GOODS', 'SERVICES', 'RENTAL'].join('\t');
    const tsv3 = [...Array(19).fill(''), '1%', '2%', '5%'].join('\t');
    const tsvBody = rows.map((r) => buildPurchaseRowCells(r).join('\t'));
    tsv = [tsv1, tsv2, tsv3, ...tsvBody].join('\n');
  } else {
    const cols = [
      'DATE',
      'MONTH',
      'BRANCH/ TRADE NAME',
      'PAYOR',
      'TIN',
      'ADDRESS (BARANGAY / MUNICIPALITY)',
      'ADDRESS (CITY / DISTRICT)',
      'GOODS, SERVICES OR RENTAL',
      'PRIVATE OR GOVT',
      'NON-VAT/VAT EXEMPT',
      'GROSS OF VAT',
      'NET OF VAT',
      'VAT',
      'TOTAL',
    ];
    const h1 = `<tr><th colspan="14" style="border:1px solid #000;font-weight:bold;text-align:center;">SALES</th><th colspan="4" style="border:1px solid #000;font-weight:bold;text-align:center;">WITHHOLDING TAX</th><th rowspan="3" style="border:1px solid #000;font-weight:bold;text-align:center;">ACTUAL</th><th rowspan="3" style="border:1px solid #000;font-weight:bold;text-align:center;">REMARKS</th></tr>`;
    const h2 = `<tr>${cols
      .map((c) => `<th rowspan="2" style="border:1px solid #000;font-weight:bold;text-align:center;vertical-align:bottom;">${htmlEsc(c)}</th>`)
      .join('')}<th style="border:1px solid #000;font-weight:bold;text-align:center;">GOODS</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">SERVICES</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">RENTAL</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">VAT</th></tr>`;
    const h3 = `<tr><th style="border:1px solid #000;font-weight:bold;text-align:center;">1%</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">2%</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">5%</th><th style="border:1px solid #000;font-weight:bold;text-align:center;">5%</th></tr>`;

    const buildSalesRowCells = (r: LedgerRow) =>
      [
        r.date,
        r.month,
        r.branchTradeName,
        r.payor,
        r.tin,
        r.address,
        r.address2 ?? '',
        r.category,
        r.privateOrGovt,
        formatAccounting(r.nonVatExempt),
        formatAccounting(r.grossOfVat),
        formatAccounting(r.netOfVat),
        formatAccounting(r.vat),
        formatAccounting(r.total),
        formatAccounting(r.wtGoods1),
        formatAccounting(r.wtServices2),
        formatAccounting(r.wtRental5),
        formatAccounting(r.wtVat5),
        formatAccounting(r.actual),
        r.remarks,
      ].map(safeSheetCell);

    const bodyHtml = rows
      .map((r) => {
        const vals = buildSalesRowCells(r);
        return `<tr>${vals
          .map((v, i) => `<td style="border:1px solid #000;text-align:${i >= 9 && i <= 18 ? 'right' : 'left'};">${htmlEsc(v)}</td>`)
          .join('')}</tr>`;
      })
      .join('');

    html = `<table style="border-collapse:collapse;"><thead>${h1}${h2}${h3}</thead><tbody>${bodyHtml}</tbody></table>`;

    const tsv1 = ['SALES', ...Array(13).fill(''), 'WITHHOLDING TAX', '', '', '', 'ACTUAL', 'REMARKS'].join('\t');
    const tsv2 = [...cols, 'GOODS', 'SERVICES', 'RENTAL', 'VAT', '', ''].join('\t');
    const tsv3 = [...Array(14).fill(''), '1%', '2%', '5%', '5%', '', ''].join('\t');
    const tsvBody = rows.map((r) => buildSalesRowCells(r).join('\t'));
    tsv = [tsv1, tsv2, tsv3, ...tsvBody].join('\n');
  }

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([tsv], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
  } else {
    await navigator.clipboard.writeText(tsv);
  }
}
