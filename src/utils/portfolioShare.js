export const SHARE_COLORS = ['#36E4CC', '#17B7C5', '#7BF4DE', '#348DA6', '#A8F0E5', '#28717C', '#61B6C1', '#C7FFEE'];

/** Privacy boundary: accept allocation data, return only symbols and percentages. */
export function getShareAllocation(allocation, { includeZero = false } = {}) {
  const groups = new Map();
  for (const item of allocation) {
    const label = String(item.name ?? item.label ?? '').trim();
    const percent = Number(item.percent);
    if (!label || !Number.isFinite(percent) || percent < 0 || (!includeZero && percent === 0)) continue;
    groups.set(label, (groups.get(label) ?? 0) + percent);
  }
  const items = [...groups].map(([label, percent]) => ({ label, percent })).sort((a, b) => b.percent - a.percent);
  const total = items.reduce((sum, item) => sum + item.percent, 0);
  if (!total) return [];
  const portions = items.map((item, index) => {
    const exact = item.percent / total * 1000;
    return { label: item.label, units: Math.floor(exact), remainder: exact - Math.floor(exact), index };
  });
  const remaining = 1000 - portions.reduce((sum, item) => sum + item.units, 0);
  const byRemainder = [...portions].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i++) byRemainder[i % byRemainder.length].units++;
  return portions.map(({ label, units }) => ({ label, percent: units / 10 }));
}

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
export const sharePercent = (value) => `${value.toFixed(1).replace('.', ',')}%`;

/** Render from the privacy projection, never from portfolio records or page DOM. */
export function renderPortfolioShareSvg(allocation) {
  // Keep a tiny holding that rounded to 0.0 in the already sanitized projection.
  const items = getShareAllocation(allocation, { includeZero: true });
  const width = 1080;
  const height = Math.max(1350, 1000 + Math.ceil(items.length / 2) * 80);
  const circumference = 2 * Math.PI * 220;
  let offset = 0;
  const segments = items.map((item, index) => {
    const length = item.percent / 100 * circumference;
    const gap = items.length > 1 ? Math.min(8, length * 0.18) : 0;
    const segment = `<circle cx="540" cy="530" r="220" fill="none" stroke="${SHARE_COLORS[index % SHARE_COLORS.length]}" stroke-width="82" stroke-dasharray="${Math.max(0, length - gap)} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 540 530)"/>`;
    offset += length;
    return segment;
  }).join('');
  const legend = items.map((item, index) => {
    const x = index % 2 === 0 ? 80 : 560;
    const y = 858 + Math.floor(index / 2) * 80;
    const fontSize = item.label.length > 14 ? 19 : 25;
    return `<g><rect x="${x}" y="${y}" width="440" height="66" rx="16" fill="#123239" stroke="#255057"/><circle cx="${x + 28}" cy="${y + 33}" r="6" fill="${SHARE_COLORS[index % SHARE_COLORS.length]}"/><text x="${x + 49}" y="${y + 42}" font-size="${fontSize}" font-weight="600" fill="#E5FFF8">${escapeXml(item.label)}</text><text x="${x + 416}" y="${y + 42}" text-anchor="end" font-size="25" font-weight="600" fill="#7BF4DE">${sharePercent(item.percent)}</text></g>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Portföy dağılımım; hisse kodları ve yüzdeler">
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#07171D"/><stop offset="1" stop-color="#0C2931"/></linearGradient><radialGradient id="glow"><stop stop-color="#26D7BA" stop-opacity=".13"/><stop offset="1" stop-color="#26D7BA" stop-opacity="0"/></radialGradient><pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#6EE7CE" stroke-opacity=".035"/></pattern></defs>
<rect width="1080" height="${height}" fill="url(#bg)"/><rect width="1080" height="${height}" fill="url(#grid)"/><ellipse cx="540" cy="510" rx="510" ry="490" fill="url(#glow)"/>
<g font-family="Segoe UI,Arial,sans-serif"><path d="M80 94L95 72 110 85 130 58" fill="none" stroke="#36E4CC" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><text x="146" y="88" font-size="29" font-weight="700" fill="#E5FFF8">Portföy<tspan fill="#36E4CC">AI</tspan></text>
<text x="80" y="182" font-size="48" font-weight="700" fill="#E5FFF8">Portföy dağılımım</text><text x="82" y="228" font-size="22" letter-spacing="3" fill="#82AAA9">HİSSELERİM · YÜZDELİK PAYLAR</text>
<circle cx="540" cy="530" r="220" fill="none" stroke="#15373D" stroke-width="82"/>${segments}
<text x="540" y="529" text-anchor="middle" font-size="80" font-weight="600" fill="#E5FFF8">100<tspan font-size="38" fill="#36E4CC">%</tspan></text><text x="540" y="574" text-anchor="middle" font-size="21" letter-spacing="4" fill="#82AAA9">PORTFÖYÜM</text>
${legend}<path d="M80 ${height - 120}H1000" stroke="#255057"/><text x="80" y="${height - 70}" font-size="20" fill="#82AAA9">Her dilim, portföyümdeki bir pay.</text><circle cx="987" cy="${height - 77}" r="7" fill="#36E4CC"/>
</g></svg>`;
  return { svg, width, height };
}

export async function createPortfolioSharePng(allocation) {
  const { svg, width, height } = renderPortfolioShareSvg(allocation);
  const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Görsel yüklenemedi.'));
      image.src = sourceUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Görsel oluşturulamadı.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG oluşturulamadı.');
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
