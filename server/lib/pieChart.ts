import sharp from 'sharp';

export interface PieDatum {
  label: string;
  value: number;
}

export const PIE_COLORS = [
  '#f43f5e', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#a3a3a3',
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const startOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${startOuter.x.toFixed(2)} ${startOuter.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${endOuter.x.toFixed(2)} ${endOuter.y.toFixed(2)}`,
    `L ${endInner.x.toFixed(2)} ${endInner.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${startInner.x.toFixed(2)} ${startInner.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Builds a donut-chart SVG (chart on the left, legend on the right) from category counts. */
export function buildPieChartSvg(dataIn: PieDatum[], title: string): string {
  const width = 720;
  const height = 380;
  const cx = 210;
  const cy = height / 2;
  const rOuter = 140;
  const rInner = 76;

  // Batasi 7 kategori teratas, sisanya digabung "Lainnya" (sama seperti UI dashboard).
  const sorted = [...dataIn].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 7);
  const sisa = sorted.slice(7).reduce((s, d) => s + d.value, 0);
  const data = sisa > 0 ? [...top, { label: 'Lainnya', value: sisa }] : top;

  const total = data.reduce((s, d) => s + d.value, 0);

  let slicesSvg = '';
  let legendSvg = '';

  if (total <= 0 || data.length === 0) {
    slicesSvg = `<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="#d9d9d9" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="#ffffff"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="#8592a0">Tidak ada data</text>`;
  } else if (data.length === 1) {
    // Sudut 0-360 penuh tidak bisa digambar sebagai satu arc (sweep 0), jadi dipecah jadi 2 setengah lingkaran.
    const color = PIE_COLORS[0];
    slicesSvg = `<path d="${donutSlicePath(cx, cy, rOuter, rInner, 0, 179.999)}" fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <path d="${donutSlicePath(cx, cy, rOuter, rInner, 180, 359.999)}" fill="${color}" stroke="#ffffff" stroke-width="2"/>`;
  } else {
    let angle = 0;
    data.forEach((d, i) => {
      const sweep = (d.value / total) * 360;
      const start = angle;
      const end = angle + sweep;
      slicesSvg += `<path d="${donutSlicePath(cx, cy, rOuter, rInner, start, end)}" fill="${PIE_COLORS[i % PIE_COLORS.length]}" stroke="#ffffff" stroke-width="2"/>`;
      angle = end;
    });
  }

  const legendX = 430;
  const legendYStart = 70;
  const rowH = 26;
  data.forEach((d, i) => {
    const pct = total > 0 ? (d.value / total) * 100 : 0;
    const y = legendYStart + i * rowH;
    legendSvg += `
      <rect x="${legendX}" y="${y - 11}" width="12" height="12" rx="2" fill="${PIE_COLORS[i % PIE_COLORS.length]}"/>
      <text x="${legendX + 20}" y="${y}" font-size="13" fill="#1f2937">${escapeXml(truncate(d.label, 34))}</text>
      <text x="${width - 30}" y="${y}" font-size="13" font-weight="bold" text-anchor="end" fill="#1f2937">${d.value} (${pct.toFixed(0)}%)</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
    <text x="20" y="30" font-size="16" font-weight="bold" fill="#111827">${escapeXml(title)}</text>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="20" font-weight="bold" fill="#111827">${total}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#8592a0">total</text>
    ${slicesSvg}
    ${legendSvg}
  </svg>`;
}

/** Rasterize the pie chart to a PNG buffer, ready for ExcelJS `workbook.addImage`. */
export async function pieChartPngBuffer(
  data: PieDatum[],
  title: string
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const svg = buildPieChartSvg(data, title);
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buffer, width: 720, height: 380 };
}
