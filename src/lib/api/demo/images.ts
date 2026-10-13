import type { Category } from '../../types';

/**
 * Procedurally drawn, clearly-labelled illustrative images for demo incidents.
 * They are not photographs and are watermarked "Illustrative demo image".
 */
export function demoImage(category: Category, variant: 'damaged' | 'repaired', seed = 1): string {
  const r = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 233280;
    return x - Math.floor(x);
  };
  const asphalt = variant === 'repaired' ? '#3a4150' : '#2b303a';
  const sky = '#1a2233';
  let scene = '';
  const crack = Array.from({ length: 6 }, (_, i) => `${200 + r(i) * 240},${250 + r(i + 7) * 120}`).join(' ');

  if (variant === 'repaired') {
    scene = `<rect x="150" y="240" width="340" height="120" rx="10" fill="#4a5262" stroke="#48E0A4" stroke-width="3" stroke-dasharray="10 8"/>
      <text x="320" y="306" font-size="22" fill="#48E0A4" text-anchor="middle" font-family="sans-serif" font-weight="700">SURFACE RESTORED</text>`;
  } else {
    switch (category) {
      case 'open_manhole':
      case 'drain_cover':
        scene = `<ellipse cx="320" cy="300" rx="110" ry="42" fill="#07090d"/><ellipse cx="320" cy="300" rx="110" ry="42" fill="none" stroke="#FF9D42" stroke-width="5"/>
          <rect x="430" y="250" width="70" height="16" rx="4" fill="#59606e" transform="rotate(18 465 258)"/>`;
        break;
      case 'electrical_wire':
        scene = `<rect x="110" y="40" width="14" height="300" fill="#59606e"/><path d="M124 70 C 260 120, 300 260, 360 330" stroke="#111" stroke-width="7" fill="none"/>
          <path d="M360 330 l12 -18 l-6 22 l14 -10" stroke="#FFE066" stroke-width="4" fill="none"/><circle cx="366" cy="328" r="22" fill="#FFE06633"/>`;
        break;
      case 'waterlogging':
        scene = `<rect x="0" y="250" width="640" height="150" fill="#1d3b57"/>${Array.from({ length: 7 }, (_, i) => `<path d="M${40 + i * 85} ${290 + (i % 2) * 30} q20 -10 40 0" stroke="#36D9FF88" stroke-width="3" fill="none"/>`).join('')}`;
        break;
      case 'fallen_tree':
        scene = `<rect x="120" y="270" width="420" height="34" rx="16" fill="#5a3b22" transform="rotate(-8 330 287)"/><circle cx="520" cy="240" r="70" fill="#1f5133"/><circle cx="470" cy="210" r="50" fill="#246b3f"/>`;
        break;
      case 'traffic_signal':
        scene = `<rect x="300" y="40" width="12" height="300" fill="#59606e" transform="rotate(14 306 340)"/><rect x="270" y="40" width="70" height="150" rx="12" fill="#151a22" transform="rotate(14 306 340)"/>
          <circle cx="${300}" cy="80" r="16" fill="#3a1d20" transform="rotate(14 306 340)"/><circle cx="300" cy="120" r="16" fill="#3a331d" transform="rotate(14 306 340)"/><circle cx="300" cy="160" r="16" fill="#1d3a2a" transform="rotate(14 306 340)"/>`;
        break;
      case 'broken_footpath':
        scene = `${Array.from({ length: 5 }, (_, i) => `<rect x="${90 + i * 95}" y="${260 + (i === 2 ? 18 : 0)}" width="88" height="60" rx="4" fill="#6b7280" transform="rotate(${i === 2 ? 12 : i === 3 ? -6 : 0} ${134 + i * 95} 290)"/>`).join('')}`;
        break;
      default:
        scene = `<polygon points="${crack}" fill="#121519" stroke="#FF9D42" stroke-width="3"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset=".55" stop-color="#232a38"/><stop offset=".56" stop-color="${asphalt}"/><stop offset="1" stop-color="#1b1f27"/></linearGradient></defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <rect x="0" y="380" width="640" height="4" fill="#ffffff10"/>
  <path d="M0 330 H640" stroke="#ffffff22" stroke-width="4" stroke-dasharray="40 30"/>
  ${scene}
  <rect x="14" y="14" width="236" height="30" rx="8" fill="#070B14cc"/>
  <text x="28" y="34" font-size="14" fill="#9AA8BD" font-family="sans-serif" font-weight="600">ILLUSTRATIVE DEMO IMAGE</text>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
