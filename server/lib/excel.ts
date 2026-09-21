import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { pieChartPngBuffer, type PieDatum } from './pieChart.js';

export const FILL = {
  headerBlue: 'FF4472C4',
  headerYellow: 'FFFFFF00',
  success: 'FFC6EFCE',
  fail: 'FFFFC7CE',
  grey: 'FFD9D9D9',
};

export function styleHeaderRow(row: ExcelJS.Row, fill = FILL.headerBlue, fontColor = 'FFFFFFFF') {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.font = { bold: true, color: { argb: fontColor } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = thinBorder();
  });
}

export function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
  return { top: side, bottom: side, left: side, right: side };
}

export async function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, filename: string) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

export function rupiah(v: number): string {
  return 'Rp ' + Math.round(v || 0).toLocaleString('id-ID');
}

/**
 * Render a pie/donut chart as a PNG and embed it into a worksheet at the given
 * top-left cell (0-indexed row/col, same convention as ExcelJS `tl`).
 * ExcelJS has no native chart-object support, so we rasterize the chart with
 * `sharp` (SVG -> PNG) and drop it in as a picture — visually identical to a
 * pie chart when the sheet is opened, just not a live/editable Excel chart.
 */
export async function embedPieChart(
  workbook: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  data: PieDatum[],
  title: string,
  tl: { col: number; row: number }
): Promise<void> {
  const { buffer, width, height } = await pieChartPngBuffer(data, title);
  const imageId = workbook.addImage({ buffer: buffer as any, extension: 'png' });
  // Skala ke ukuran yang wajar di sheet (px), tetap menjaga rasio aslinya.
  const dispWidth = 480;
  const dispHeight = Math.round((height / width) * dispWidth);
  ws.addImage(imageId, {
    tl,
    ext: { width: dispWidth, height: dispHeight },
  } as any);
}
