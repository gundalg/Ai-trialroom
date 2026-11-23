/* AI TrialRoom rendering engine.
   On-device person segmentation (MediaPipe Selfie Segmentation, bundled offline),
   body-geometry estimation, garment synthesis, showroom backgrounds, branding.
   The customer's face/head pixels are always re-drawn from the original photo. */
'use strict';
const TR = (() => {
  const W = 900, H = 1200;

  /* ---------- colour helpers ---------- */
  const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const shade = (h, a) => { const [r, g, b] = hex2rgb(h); return a >= 0 ? rgb2hex(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a) : rgb2hex(r * (1 + a), g * (1 + a), b * (1 + a)); };
  const lum = h => { const [r, g, b] = hex2rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const alpha = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  /* ---------- palette (raw 1-inch swatches) ---------- */
  const PALETTE = [
    ['Black', '#141414'], ['Charcoal', '#36393f'], ['Grey', '#7d8087'], ['Silver', '#c4c7cc'], ['White', '#f8f8f6'], ['Ivory', '#f4ecd8'],
    ['Cream', '#eadcb8'], ['Beige', '#d8c3a0'], ['Khaki', '#b29d6c'], ['Brown', '#6b4428'], ['Maroon', '#6e0f2d'], ['Wine', '#5a1a32'],
    ['Red', '#c8102e'], ['Crimson', '#9e1b32'], ['Rani pink', '#d6247a'], ['Pink', '#f2a3bd'], ['Peach', '#f6b48f'], ['Orange', '#e8701a'],
    ['Mustard', '#d1a21c'], ['Gold', '#d4af37'], ['Yellow', '#f3d23b'], ['Parrot green', '#6fbf3a'], ['Green', '#1f8a4c'], ['Bottle green', '#0f4d32'],
    ['Mint', '#a8dcc4'], ['Teal', '#127a78'], ['Peacock blue', '#0b6e8c'], ['Sky blue', '#87c2e8'], ['Royal blue', '#2948a8'], ['Navy', '#1a2547'],
    ['Purple', '#5e2a84'], ['Lavender', '#b9a5dc']
  ];

  /* ---------- outfits ---------- */
  const OUTFITS = {
    female: [
      { id: 'saree', name: 'Saree', parts: [['body', 'Saree', '#6e0f2d'], ['border', 'Border', '#d4af37'], ['blouse', 'Blouse', '#d4af37']], photo: 'Saree photo' },
      { id: 'lehenga', name: 'Lehenga', parts: [['skirt', 'Lehenga', '#c8102e'], ['blouse', 'Choli', '#d4af37'], ['dupatta', 'Dupatta', '#f2a3bd']], photo: 'Lehenga fabric photo' },
      { id: 'salwar', name: 'Salwar kameez', parts: [['kameez', 'Kameez', '#127a78'], ['salwar', 'Salwar', '#f4ecd8'], ['dupatta', 'Dupatta', '#d4af37']], photo: 'Kameez fabric photo' },
      { id: 'kurti', name: 'Kurti & leggings', parts: [['kurti', 'Kurti', '#e8701a'], ['leggings', 'Leggings', '#f4ecd8']], photo: 'Kurti fabric photo' },
      { id: 'gown', name: 'Party gown', parts: [['gown', 'Gown', '#1a2547']], photo: 'Gown fabric photo' },
      { id: 'officeF', name: 'Office formal', parts: [['blazer', 'Blazer', '#1a2547'], ['top', 'Top', '#f8f8f6'], ['pant', 'Trousers', '#1a2547']], photo: null }
    ],
    male: [
      { id: 'suit', name: 'Two-piece suit', parts: [['suit', 'Suit', '#1a2547'], ['shirt', 'Shirt', '#f8f8f6'], ['tie', 'Tie', '#6e0f2d']], photo: 'Suit fabric photo' },
      { id: 'suit3', name: 'Three-piece suit', parts: [['suit', 'Suit', '#36393f'], ['vest', 'Waistcoat', '#36393f'], ['shirt', 'Shirt', '#87c2e8'], ['tie', 'Tie', '#1a2547']], photo: 'Suit fabric photo' },
      { id: 'tux', name: 'Tuxedo', parts: [['suit', 'Tuxedo', '#141414'], ['shirt', 'Shirt', '#f8f8f6'], ['tie', 'Bow tie', '#141414']], photo: null },
      { id: 'shirt', name: 'Formal shirt & trousers', parts: [['shirt', 'Shirt', '#87c2e8'], ['pant', 'Trousers', '#36393f'], ['tie', 'Tie', '#2948a8']], photo: 'Shirt fabric photo' },
      { id: 'blazer', name: 'Blazer & chinos', parts: [['blazer', 'Blazer', '#2948a8'], ['shirt', 'Shirt', '#f8f8f6'], ['pant', 'Chinos', '#d8c3a0']], photo: 'Blazer fabric photo' },
      { id: 'sherwani', name: 'Sherwani', parts: [['sherwani', 'Sherwani', '#f4ecd8'], ['churidar', 'Churidar', '#f4ecd8'], ['trim', 'Embroidery', '#d4af37']], photo: 'Sherwani fabric photo' },
      { id: 'kurta', name: 'Kurta pyjama', parts: [['kurta', 'Kurta', '#f4ecd8'], ['pyjama', 'Pyjama', '#f8f8f6']], photo: 'Kurta fabric photo' }
    ]
  };
  const CODES = [
    { id: 'bizformal', name: 'Business formal', outfit: 'suit', colors: { suit: '#1a2547', shirt: '#f8f8f6', tie: '#6e0f2d' } },
    { id: 'bizcasual', name: 'Business casual', outfit: 'blazer', colors: { blazer: '#2948a8', shirt: '#f8f8f6', pant: '#d8c3a0' } },
    { id: 'office', name: 'Office daily', outfit: 'shirt', colors: { shirt: '#87c2e8', pant: '#36393f', tie: 'none' } },
    { id: 'boardroom', name: 'Boardroom', outfit: 'suit3', colors: { suit: '#36393f', vest: '#36393f', shirt: '#f8f8f6', tie: '#1a2547' } },
    { id: 'blacktie', name: 'Black tie', outfit: 'tux', colors: { suit: '#141414', shirt: '#f8f8f6', tie: '#141414' } },
    { id: 'ethnic', name: 'Ethnic formal', outfit: 'sherwani', colors: { sherwani: '#f4ecd8', churidar: '#f4ecd8', trim: '#d4af37' } }
  ];
  const BGS = [
    { id: 'silk', name: 'Silk saree gallery', g: 'female' },
    { id: 'bridal', name: 'Bridal lounge', g: 'female' },
    { id: 'tailor', name: 'Tailor studio', g: 'male' },
    { id: 'corporate', name: 'Corporate lobby', g: 'male' },
    { id: 'studio', name: 'Studio light', g: 'any' },
    { id: 'original', name: 'Original photo', g: 'any' }
  ];

  /* ---------- showroom backgrounds ---------- */
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function spot(ctx, x, y, r, col) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  function floor(ctx, w, h, y0, c1, c2) { const g = ctx.createLinearGradient(0, y0, 0, h); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, y0, w, h - y0); }

  function drawBg(ctx, id, w, h) {
    const s = w / W; ctx.save();
    if (id === 'silk') {
      let g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a1424'); g.addColorStop(1, '#8a3a2a'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const cols = ['#c8102e', '#d4af37', '#127a78', '#d6247a', '#2948a8', '#e8701a', '#6e0f2d', '#1f8a4c', '#f2a3bd', '#5e2a84'];
      for (let side = 0; side < 2; side++) {
        const x0 = side ? w * 0.72 : w * 0.02, sw = w * 0.26;
        ctx.fillStyle = '#3b1a10'; ctx.fillRect(x0 - 6 * s, h * 0.06, sw + 12 * s, h * 0.66);
        for (let r = 0; r < 6; r++) {
          const y = h * 0.08 + r * h * 0.105; ctx.fillStyle = '#c79a4a'; ctx.fillRect(x0, y + h * 0.085, sw, 6 * s);
          for (let k = 0; k < 4; k++) for (let st = 0; st < 3; st++) {
            const c = cols[(r * 4 + k + st + side * 3) % cols.length];
            ctx.fillStyle = c; rr(ctx, x0 + k * sw / 4 + 3 * s, y + h * 0.06 - st * h * 0.022, sw / 4 - 6 * s, h * 0.022, 3 * s); ctx.fill();
            ctx.fillStyle = '#d4af37'; ctx.fillRect(x0 + k * sw / 4 + 3 * s, y + h * 0.06 - st * h * 0.022 + h * 0.016, sw / 4 - 6 * s, 2 * s);
          }
        }
      }
      ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 3 * s; ctx.strokeRect(w * 0.31, h * 0.04, w * 0.38, h * 0.7);
      floor(ctx, w, h, h * 0.74, '#6a3a22', '#2c160c');
      for (let i = 0; i < 6; i++) { ctx.strokeStyle = 'rgba(255,220,160,.08)'; ctx.beginPath(); ctx.moveTo(w * i / 5, h * 0.74); ctx.lineTo(w * (i / 5 - 0.5) * 1.6 + w / 2, h); ctx.stroke(); }
      for (const x of [0.2, 0.5, 0.8]) { ctx.fillStyle = '#d4af37'; ctx.beginPath(); ctx.arc(w * x, h * 0.025, 14 * s, 0, 7); ctx.fill(); spot(ctx, w * x, h * 0.03, 220 * s, 'rgba(255,236,190,.45)'); }
    } else if (id === 'bridal') {
      let g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f7e8dc'); g.addColorStop(1, '#e8cdb8'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (const x of [0.04, 0.68]) {
        ctx.fillStyle = '#d9b99b'; ctx.beginPath(); ctx.moveTo(w * x, h * 0.72); ctx.lineTo(w * x, h * 0.22); ctx.arc(w * (x + 0.14), h * 0.22, w * 0.14, Math.PI, 0); ctx.lineTo(w * (x + 0.28), h * 0.72); ctx.fill();
        const mg = ctx.createLinearGradient(w * x, 0, w * (x + 0.28), 0); mg.addColorStop(0, '#e9eef0'); mg.addColorStop(.5, '#ffffff'); mg.addColorStop(1, '#cfd8db');
        ctx.fillStyle = mg; ctx.beginPath(); ctx.moveTo(w * (x + 0.02), h * 0.71); ctx.lineTo(w * (x + 0.02), h * 0.23); ctx.arc(w * (x + 0.14), h * 0.23, w * 0.12, Math.PI, 0); ctx.lineTo(w * (x + 0.26), h * 0.71); ctx.fill();
        ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 5 * s; ctx.stroke();
      }
      for (let i = 0; i < 2; i++) { const x = i ? w * 0.9 : 0; const dg = ctx.createLinearGradient(x, 0, x + w * 0.1, 0); dg.addColorStop(0, '#9c2f52'); dg.addColorStop(.5, '#c74d72'); dg.addColorStop(1, '#8a2546'); ctx.fillStyle = dg; ctx.fillRect(x, 0, w * 0.1, h * 0.75); }
      ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2 * s; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.02); ctx.lineTo(w * (0.4 + i * 0.025), h * 0.1); ctx.stroke(); }
      for (let i = 0; i < 9; i++) { ctx.fillStyle = '#fff6da'; ctx.beginPath(); ctx.arc(w * (0.4 + i * 0.025), h * 0.105, 5 * s, 0, 7); ctx.fill(); }
      spot(ctx, w * 0.5, h * 0.1, 300 * s, 'rgba(255,240,210,.7)');
      floor(ctx, w, h, h * 0.72, '#efe3d6', '#c7ab93');
      ctx.fillStyle = 'rgba(156,47,82,.25)'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.93, w * 0.42, h * 0.06, 0, 0, 7); ctx.fill();
    } else if (id === 'tailor') {
      let g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#4a2c18'); g.addColorStop(.5, '#6e4426'); g.addColorStop(1, '#4a2c18'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 3 * s; for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(w * i / 8, 0); ctx.lineTo(w * i / 8, h * 0.72); ctx.stroke(); }
      ctx.fillStyle = '#b8935a'; ctx.fillRect(0, h * 0.12, w, 8 * s);
      const sc = ['#1a2547', '#36393f', '#141414', '#5a1a32', '#6b4428', '#2948a8', '#7d8087'];
      for (let i = 0; i < 7; i++) { const side = i < 3 ? w * (0.02 + i * 0.09) : w * (0.66 + (i - 3) * 0.085); if (i === 7) break;
        ctx.fillStyle = sc[i]; ctx.beginPath(); ctx.moveTo(side + w * 0.04, h * 0.14); ctx.lineTo(side, h * 0.19); ctx.lineTo(side + w * 0.005, h * 0.45); ctx.lineTo(side + w * 0.075, h * 0.45); ctx.lineTo(side + w * 0.08, h * 0.19); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.moveTo(side + w * 0.03, h * 0.15); ctx.lineTo(side + w * 0.05, h * 0.15); ctx.lineTo(side + w * 0.04, h * 0.25); ctx.fill(); }
      ctx.fillStyle = '#2a170b'; ctx.fillRect(w * 0.34, h * 0.2, w * 0.32, h * 0.52); ctx.strokeStyle = '#b8935a'; ctx.lineWidth = 6 * s; ctx.strokeRect(w * 0.34, h * 0.2, w * 0.32, h * 0.52);
      floor(ctx, w, h, h * 0.72, '#7a5a3a', '#2e1d10');
      for (let i = 0; i < 12; i++) { ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.moveTo(0, h * (0.74 + i * 0.022)); ctx.lineTo(w, h * (0.74 + i * 0.022)); ctx.stroke(); }
      for (const x of [0.25, 0.5, 0.75]) spot(ctx, w * x, h * 0.02, 260 * s, 'rgba(255,214,150,.35)');
    } else if (id === 'corporate') {
      let g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#b9d3e6'); g.addColorStop(.7, '#e7eef3'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(70,90,115,.35)'; const bld = [[.02, .32], [.1, .22], [.2, .36], [.3, .18], [.62, .26], [.72, .14], [.84, .3], [.92, .2]];
      for (const [x, t] of bld) ctx.fillRect(w * x, h * t, w * 0.08, h * (0.72 - t));
      ctx.strokeStyle = '#47515c'; ctx.lineWidth = 10 * s; for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(w * i / 4, 0); ctx.lineTo(w * i / 4, h * 0.72); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(0, h * 0.36); ctx.lineTo(w, h * 0.36); ctx.stroke();
      floor(ctx, w, h, h * 0.72, '#e9e6e1', '#a9a49c');
      ctx.strokeStyle = 'rgba(120,110,100,.25)'; ctx.lineWidth = 2 * s; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(w * i / 4, h * 0.72); ctx.lineTo(w * (i / 4 - 0.5) * 2 + w / 2, h); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, h * 0.72, w, h * 0.03);
    } else {
      const g = ctx.createRadialGradient(w / 2, h * 0.4, 50 * s, w / 2, h * 0.5, h * 0.8); g.addColorStop(0, '#f3ece4'); g.addColorStop(1, '#bfb1a3'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.95, w * 0.35, h * 0.035, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- AI model avatars (used when no customer photo) ---------- */
  const SKINS = ['#f1c9a5', '#c98e62', '#8d5a3b'];
  function drawModel(ctx, w, h, gender, skin) {
    // Returns geometry in canvas coords. Figure faces camera, arms slightly away from body.
    const s = h / 1200, cx = w / 2, f = gender === 'female';
    const top = 70 * s, headR = 62 * s, neckY = top + 2 * headR + 6 * s, shY = neckY + 34 * s;
    const sh = (f ? 118 : 138) * s, waist = (f ? 78 : 104) * s, hip = (f ? 112 : 108) * s;
    const waistY = top + 470 * s, hipY = top + 590 * s, kneeY = top + 820 * s, footY = top + 1070 * s;
    const sk = skin, skD = shade(skin, -0.18), inner = f ? '#e9dccb' : '#d9d4cc';
    ctx.save();
    // legs
    ctx.fillStyle = sk;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + d * 8 * s, hipY - 20 * s); ctx.lineTo(cx + d * (hip - 6 * s), hipY); ctx.quadraticCurveTo(cx + d * (hip - 20 * s), kneeY, cx + d * 52 * s, footY - 20 * s); ctx.lineTo(cx + d * 22 * s, footY - 20 * s); ctx.quadraticCurveTo(cx + d * 20 * s, kneeY, cx + d * 6 * s, hipY + 40 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a2a22'; ctx.beginPath(); ctx.ellipse(cx + d * 40 * s, footY - 10 * s, 30 * s, 14 * s, 0, 0, 7); ctx.fill(); ctx.fillStyle = sk; }
    // arms
    for (const d of [-1, 1]) { ctx.strokeStyle = sk; ctx.lineCap = 'round'; ctx.lineWidth = (f ? 40 : 50) * s; ctx.beginPath(); ctx.moveTo(cx + d * (sh - 22 * s), shY + 20 * s); ctx.quadraticCurveTo(cx + d * (sh + 22 * s), waistY - 60 * s, cx + d * (sh + 30 * s), hipY + 30 * s); ctx.stroke();
      ctx.fillStyle = skD; ctx.beginPath(); ctx.ellipse(cx + d * (sh + 30 * s), hipY + 58 * s, 22 * s, 32 * s, 0, 0, 7); ctx.fill(); }
    // torso (inner wear)
    ctx.fillStyle = inner; ctx.beginPath(); ctx.moveTo(cx - sh + 8 * s, shY); ctx.quadraticCurveTo(cx - sh - 6 * s, shY + 140 * s, cx - waist, waistY); ctx.quadraticCurveTo(cx - hip - 4 * s, hipY - 40 * s, cx - hip, hipY + 30 * s); ctx.lineTo(cx + hip, hipY + 30 * s); ctx.quadraticCurveTo(cx + hip + 4 * s, hipY - 40 * s, cx + waist, waistY); ctx.quadraticCurveTo(cx + sh + 6 * s, shY + 140 * s, cx + sh - 8 * s, shY); ctx.quadraticCurveTo(cx, shY - 26 * s, cx - sh + 8 * s, shY); ctx.fill();
    // neck
    ctx.fillStyle = skD; ctx.fillRect(cx - 24 * s, neckY - 24 * s, 48 * s, 50 * s);
    ctx.fillStyle = sk; ctx.beginPath(); ctx.ellipse(cx, shY - 4 * s, 50 * s, 16 * s, 0, Math.PI, 0); ctx.fill();
    // head
    ctx.fillStyle = sk; ctx.beginPath(); ctx.ellipse(cx, top + headR, headR * 0.86, headR, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#1e1410';
    if (f) { ctx.beginPath(); ctx.ellipse(cx, top + headR * 0.7, headR * 0.95, headR * 0.82, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx, top + 8 * s, headR * 0.5, headR * 0.35, 0, 0, 7); ctx.fill(); ctx.fillRect(cx - headR * 0.95, top + headR * 0.6, 18 * s, headR * 1.4); ctx.fillRect(cx + headR * 0.95 - 18 * s, top + headR * 0.6, 18 * s, headR * 1.4); }
    else { ctx.beginPath(); ctx.ellipse(cx, top + headR * 0.55, headR * 0.9, headR * 0.6, 0, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = '#2a1a14'; for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + d * 22 * s, top + headR * 1.02, 7 * s, 5 * s, 0, 0, 7); ctx.fill(); }
    ctx.strokeStyle = shade(sk, -0.35); ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(cx, top + headR * 1.3, 16 * s, 0.2, Math.PI - 0.2); ctx.stroke();
    if (f) { ctx.fillStyle = '#c8102e'; ctx.beginPath(); ctx.arc(cx, top + headR * 0.82, 4 * s, 0, 7); ctx.fill(); }
    ctx.restore();
    return { cx, top, neckY, shY, sh, waistY, hipY, kneeY, footY, bottom: footY, waistHalf: waist, hipHalf: hip, armOut: sh + 30 * s, model: true };
  }

  /* ---------- segmentation ---------- */
  let seg = null, segReady = null;
  function initSeg() {
    if (segReady) return segReady;
    segReady = new Promise(res => {
      try {
        if (typeof SelfieSegmentation === 'undefined') return res(false);
        seg = new SelfieSegmentation({ locateFile: f => 'mp/' + f });
        seg.setOptions({ modelSelection: 0, selfieMode: false });
        res(true);
      } catch (e) { console.warn('seg init', e); res(false); }
    });
    return segReady;
  }
  function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }

  async function segment(img) {
    // returns canvas (img size, max 640) with alpha = person confidence, or null
    if (TR.disableAI) return null;
    const ok = await initSeg(); if (!ok) return null;
    const sc = Math.min(1, 640 / Math.max(img.width, img.height));
    const c = mk(Math.round(img.width * sc), Math.round(img.height * sc)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    try {
      const mask = await withTimeout(new Promise((res, rej) => {
        seg.onResults(r => res(r.segmentationMask));
        seg.send({ image: c }).catch(rej);
      }), 20000);
      const out = mk(c.width, c.height), o = out.getContext('2d', { willReadFrequently: true });
      o.drawImage(mask, 0, 0, c.width, c.height);
      const d = o.getImageData(0, 0, c.width, c.height), p = d.data;
      let opaque = true; for (let i = 3; i < p.length; i += 4 * 97) if (p[i] < 250) { opaque = false; break; }
      let area = 0;
      for (let i = 0; i < p.length; i += 4) { const v = opaque ? p[i] : p[i + 3]; const a = v < 60 ? 0 : v > 190 ? 255 : (v - 60) * 255 / 130; p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = a; area += a > 128; }
      const frac = area / (c.width * c.height);
      if (frac < 0.03 || frac > 0.92) return null;
      o.putImageData(d, 0, 0); return out;
    } catch (e) { console.warn('segmentation failed', e && e.message); return null; }
  }

  function fallbackMask(img) {
    // Background-colour estimate from borders: works for plain shop walls / studio backdrops.
    const sc = Math.min(1, 400 / Math.max(img.width, img.height));
    const w = Math.max(8, Math.round(img.width * sc)), h = Math.max(8, Math.round(img.height * sc));
    const c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h), p = d.data; let r = 0, g = 0, b = 0, n = 0;
    const add = i => { r += p[i]; g += p[i + 1]; b += p[i + 2]; n++; };
    for (let i = 0; i < w; i++) { add(i * 4); add(((h - 1) * w + i) * 4); }
    for (let j = 0; j < h; j++) { add(j * w * 4); add((j * w + w - 1) * 4); }
    r /= n; g /= n; b /= n; let area = 0;
    for (let i = 0; i < p.length; i += 4) { const dd = Math.hypot(p[i] - r, p[i + 1] - g, p[i + 2] - b); const a = dd < 35 ? 0 : dd > 70 ? 255 : (dd - 35) * 255 / 35; p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = a; area += a > 128; }
    x.putImageData(d, 0, 0);
    const frac = area / (w * h);
    if (frac < 0.04 || frac > 0.9) { // cannot separate: assume centred full-height person
      x.clearRect(0, 0, w, h); x.fillStyle = '#fff'; x.beginPath(); x.ellipse(w / 2, h * 0.55, w * 0.28, h * 0.5, 0, 0, 7); x.fill(); x.beginPath(); x.ellipse(w / 2, h * 0.12, w * 0.12, h * 0.1, 0, 0, 7); x.fill();
      c.weak = true;
    }
    return c;
  }

  /* ---------- geometry from mask ---------- */
  function geometryFromMask(maskC) {
    const gw = 225, gh = 300, c = mk(gw, gh), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(maskC, 0, 0, gw, gh); const p = x.getImageData(0, 0, gw, gh).data;
    const on = (i, j) => p[(j * gw + i) * 4 + 3] > 128;
    let top = -1, bot = -1;
    for (let j = 0; j < gh; j++) { let any = false; for (let i = 0; i < gw; i++) if (on(i, j)) { any = true; break; } if (any) { if (top < 0) top = j; bot = j; } }
    if (top < 0) return null;
    const hgt = Math.max(10, bot - top);
    // head centre from top 12% rows
    let sx = 0, sn = 0; for (let j = top; j < top + hgt * 0.12; j++) for (let i = 0; i < gw; i++) if (on(i, j)) { sx += i; sn++; }
    let cx = sn ? sx / sn : gw / 2;
    const run = (j, c0) => { let c = Math.round(c0); if (!on(c, j)) { let k = 1; while (k < 30 && !on(c - k, j) && !on(c + k, j)) k++; c = on(c - k, j) ? c - k : c + k; if (!on(c, j)) return [c0, c0]; } let l = c, r = c; while (l > 0 && on(l - 1, j)) l--; while (r < gw - 1 && on(r + 1, j)) r++; return [l, r]; };
    // full-length check: how tall is the head relative to the image?
    let headW = 0; for (let j = top; j < top + hgt * 0.1; j++) { const [l, r] = run(j, cx); headW = Math.max(headW, r - l); }
    // neck = narrowest centre run between 6% and 35% of height, after head
    let neck = top + hgt * 0.14, minW = 1e9;
    const lo = Math.round(top + Math.max(headW * 0.8, hgt * 0.05)), hi = Math.round(top + Math.min(hgt * 0.35, headW * 2.2));
    for (let j = lo; j <= hi; j++) { const [l, r] = run(j, cx); if (r - l < minW && r - l > headW * 0.25) { minW = r - l; neck = j; } }
    const headH = Math.max(neck - top, 8);
    let sh = 0; for (let j = neck; j < Math.min(bot, neck + headH * 0.9); j++) { const [l, r] = run(j, cx); sh = Math.max(sh, (r - l) / 2); }
    sh = Math.max(Math.min(sh, headW * 1.9), headW * 0.95);
    const k = W / gw; // mask is drawn at W x H
    const g = { cx: cx * k, top: top * k, neckY: (neck + headH * 0.06) * k, sh: sh * k * 0.92, bottom: bot * k };
    const unit = headH * k * 1.08; // approx head+neck unit
    g.shY = g.neckY + unit * 0.22;
    g.waistY = g.top + unit * 3.05; g.hipY = g.top + unit * 3.85; g.kneeY = g.top + unit * 5.7; g.footY = Math.max(g.top + unit * 7.7, g.bottom);
    const halfAt = yy => { const j = Math.min(gh - 1, Math.max(0, Math.round(yy / k))); const [l, r] = run(j, cx); return (r - l) / 2 * k; };
    g.waistHalf = Math.min(Math.max(halfAt(g.waistY), g.sh * 0.62), g.sh * 0.95);
    g.hipHalf = Math.min(Math.max(halfAt(g.hipY), g.sh * 0.7), g.sh * 1.0);
    g.armOut = g.sh * 1.35;
    return g;
  }

  /* ---------- fabrics ---------- */
  function motifTile(col, acc, kind) {
    const t = mk(120, 120), x = t.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 120, 120);
    x.globalAlpha = 0.07; x.strokeStyle = lum(col) > 0.5 ? '#000' : '#fff'; for (let i = -120; i < 120; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 120, 120); x.stroke(); }
    x.globalAlpha = 1;
    if (kind === 'butti') { x.fillStyle = alpha(acc, 0.75); for (const [a, b] of [[30, 30], [90, 90]]) { x.beginPath(); x.ellipse(a, b, 6, 9, 0.6, 0, 7); x.fill(); x.beginPath(); x.arc(a + 6, b - 8, 3, 0, 7); x.fill(); } }
    if (kind === 'weave') { x.globalAlpha = 0.12; x.fillStyle = lum(col) > 0.5 ? '#000' : '#fff'; for (let i = 0; i < 120; i += 4) x.fillRect(0, i, 120, 1); x.globalAlpha = 1; }
    if (kind === 'pin') { x.globalAlpha = 0.22; x.fillStyle = lum(col) > 0.4 ? '#000' : '#fff'; for (let i = 0; i < 120; i += 15) x.fillRect(i, 0, 1.4, 120); x.globalAlpha = 1; }
    return t;
  }
  function photoTile(img) {
    // centre crop of the garment photo (avoids its background), 300px tile
    const sw = img.width * 0.5, shh = img.height * 0.5, t = mk(300, 300);
    t.getContext('2d').drawImage(img, img.width * 0.25, img.height * 0.25, sw, shh, 0, 0, 300, 300); return t;
  }
  function avgColor(c) { const x = mk(8, 8), y = x.getContext('2d', { willReadFrequently: true }); y.drawImage(c, 0, 0, 8, 8); const p = y.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0; for (let i = 0; i < p.length; i += 4) { r += p[i]; g += p[i + 1]; b += p[i + 2]; } return rgb2hex(r / 64, g / 64, b / 64); }

  /* ---------- garment drawing ---------- */
  function band(ctx, x1, y1, x2, y2, w, fill, border, bw) {
    const a = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1);
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(a);
    ctx.fillStyle = fill; ctx.fillRect(0, -w / 2, L, w);
    if (border) { zari(ctx, 0, -w / 2, L, bw, border); zari(ctx, 0, w / 2 - bw, L, bw, border); }
    ctx.restore();
  }
  function zari(ctx, x, y, w, h, col) {
    ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
    const gold = lum(col) > 0.55 ? shade(col, -0.35) : '#e6c45a';
    ctx.fillStyle = gold; ctx.fillRect(x, y + h * 0.12, w, Math.max(1.5, h * 0.06)); ctx.fillRect(x, y + h * 0.82, w, Math.max(1.5, h * 0.06));
    ctx.beginPath(); const step = Math.max(10, h * 0.7);
    for (let i = x; i < x + w; i += step) { ctx.moveTo(i, y + h * 0.75); ctx.lineTo(i + step / 2, y + h * 0.28); ctx.lineTo(i + step, y + h * 0.75); }
    ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  }
  function vGrad(ctx, x, y, w, h, a) { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.5, 'rgba(255,255,255,0.06)'); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }

  // Upper-body garment region (with sleeves to `cuffY`) – later clipped to body mask.
  function upperPath(ctx, g, endY, cuffY, neckDepth, torsoK) {
    const { cx, neckY, shY, sh } = g, nh = sh * 0.26, aw = g.armOut + sh * 0.5, tw = Math.max(g.hipHalf, g.waistHalf) * (torsoK || 1.12);
    ctx.beginPath();
    ctx.moveTo(cx - nh, neckY + 4); ctx.quadraticCurveTo(cx - sh * 0.7, shY - (shY - neckY) * 0.3, cx - sh * 1.05, shY);
    ctx.lineTo(cx - aw, shY + (cuffY - shY) * 0.1); ctx.lineTo(cx - aw, cuffY); ctx.lineTo(cx - tw, cuffY); ctx.lineTo(cx - tw, endY);
    ctx.lineTo(cx + tw, endY); ctx.lineTo(cx + tw, cuffY); ctx.lineTo(cx + aw, cuffY); ctx.lineTo(cx + aw, shY + (cuffY - shY) * 0.1);
    ctx.lineTo(cx + sh * 1.05, shY); ctx.quadraticCurveTo(cx + sh * 0.7, shY - (shY - neckY) * 0.3, cx + nh, neckY + 4);
    ctx.quadraticCurveTo(cx, neckY + neckDepth, cx - nh, neckY + 4); ctx.closePath();
  }
  function legsPath(ctx, g, y0, y1, k) {
    const { cx } = g, hw = g.hipHalf * (k || 1.06); ctx.beginPath(); ctx.moveTo(cx - hw, y0); ctx.lineTo(cx + hw, y0); ctx.lineTo(cx + hw * 0.9, y1); ctx.lineTo(cx - hw * 0.9, y1); ctx.closePath();
  }

  function fabricFill(ctx, part, st) {
    if (part === st.photoPart && st.fabric) return ctx.createPattern(st.fabric, 'repeat');
    const col = st.colors[part] || '#888';
    const kind = st.outfit === 'saree' && part === 'body' ? 'butti' : (part === 'suit' || part === 'pant' || part === 'blazer') ? 'pin' : 'weave';
    return ctx.createPattern(motifTile(col, st.colors.border || '#d4af37', kind), 'repeat');
  }
  const C = (st, p) => (p === st.photoPart && st.fabric) ? st.fabricAvg : (st.colors[p] || '#888');

  // Builds garment layers: `up` (clipped to body mask) and `free` (own silhouette, e.g. saree skirt)
  function drawGarment(st, g, maskC) {
    const up = mk(W, H), u = up.getContext('2d'), fr = mk(W, H), f = fr.getContext('2d');
    const { cx, neckY, shY, sh, waistY, hipY, kneeY, footY } = g;
    const bodyH = footY - neckY, o = st.outfit;
    const shirtCol = o === 'officeF' ? C(st, 'top') : C(st, 'shirt');

    const jacket = (part, lenY, lapel) => {
      upperPath(u, g, lenY, hipY - bodyH * 0.02, 0, 1.12); u.fillStyle = fabricFill(u, part, st); u.fill();
      // shirt V + tie
      const vB = waistY - bodyH * 0.03;
      u.fillStyle = shirtCol; u.beginPath(); u.moveTo(cx - sh * 0.3, neckY + 4); u.lineTo(cx + sh * 0.3, neckY + 4); u.lineTo(cx, vB); u.closePath(); u.fill();
      const jc = C(st, part);
      u.fillStyle = shade(jc, -0.25); for (const d of [-1, 1]) { u.beginPath(); u.moveTo(cx + d * sh * 0.32, neckY + 6); u.lineTo(cx + d * sh * (lapel ? 0.62 : 0.5), shY + bodyH * 0.09); u.lineTo(cx + d * sh * 0.08, vB); u.lineTo(cx + d * sh * 0.06, vB - 6); u.closePath(); u.fill(); }
      u.strokeStyle = shade(jc, -0.4); u.lineWidth = 2; u.beginPath(); u.moveTo(cx, vB); u.lineTo(cx, lenY); u.stroke();
      u.fillStyle = shade(jc, -0.45); for (let i = 0; i < 2; i++) { u.beginPath(); u.arc(cx + 4, vB + bodyH * 0.035 + i * bodyH * 0.05, Math.max(3, sh * 0.03), 0, 7); u.fill(); }
      u.fillStyle = shade(jc, -0.3); for (const d of [-1, 1]) u.fillRect(cx + d * sh * 0.55 - sh * 0.18, hipY - bodyH * 0.06, sh * 0.36, 3);
      u.fillStyle = '#f8f8f6'; u.beginPath(); u.moveTo(cx + sh * 0.5, shY + bodyH * 0.11); u.lineTo(cx + sh * 0.74, shY + bodyH * 0.11); u.lineTo(cx + sh * 0.62, shY + bodyH * 0.095); u.fill();
      // sleeve shading
      vGrad(u, cx - g.armOut - sh * 0.5, shY, sh * 0.8, hipY - shY, 0.18); vGrad(u, cx + g.armOut - sh * 0.3, shY, sh * 0.8, hipY - shY, 0.18);
      return vB;
    };
    const collar = (col) => { u.fillStyle = col; for (const d of [-1, 1]) { u.beginPath(); u.moveTo(cx, neckY + (shY - neckY) * 0.7); u.lineTo(cx + d * sh * 0.32, neckY - 2); u.lineTo(cx + d * sh * 0.36, neckY + (shY - neckY) * 0.9); u.closePath(); u.fill(); } };
    const tie = (vB) => {
      const t = st.colors.tie; if (!t || t === 'none') return;
      if (o === 'tux') { u.fillStyle = t; const y = neckY + (shY - neckY) * 0.75; u.beginPath(); u.moveTo(cx, y); u.lineTo(cx - sh * 0.22, y - sh * 0.1); u.lineTo(cx - sh * 0.22, y + sh * 0.1); u.closePath(); u.moveTo(cx, y); u.lineTo(cx + sh * 0.22, y - sh * 0.1); u.lineTo(cx + sh * 0.22, y + sh * 0.1); u.closePath(); u.fill(); return; }
      const y0 = neckY + (shY - neckY) * 0.6; u.fillStyle = t; u.beginPath(); u.moveTo(cx - sh * 0.07, y0); u.lineTo(cx + sh * 0.07, y0); u.lineTo(cx + sh * 0.05, y0 + sh * 0.12); u.lineTo(cx - sh * 0.05, y0 + sh * 0.12); u.fill();
      u.beginPath(); u.moveTo(cx - sh * 0.05, y0 + sh * 0.12); u.lineTo(cx + sh * 0.05, y0 + sh * 0.12); u.lineTo(cx + sh * 0.12, vB - 10); u.lineTo(cx, vB + 8); u.lineTo(cx - sh * 0.12, vB - 10); u.closePath(); u.fill();
      u.strokeStyle = shade(t, 0.25); u.lineWidth = 2; for (let i = 1; i < 6; i++) { const yy = y0 + (vB - y0) * i / 6; u.beginPath(); u.moveTo(cx - sh * 0.1, yy); u.lineTo(cx + sh * 0.1, yy + 8); u.stroke(); }
    };
    const trousers = (part, y0) => {
      legsPath(u, g, y0, footY + 20, 1.08); u.fillStyle = fabricFill(u, part, st); u.fill();
      const pc = C(st, part); u.strokeStyle = shade(pc, -0.3); u.lineWidth = 2; for (const d of [-1, 1]) { u.beginPath(); u.moveTo(cx + d * g.hipHalf * 0.5, y0 + 20); u.lineTo(cx + d * g.hipHalf * 0.45, footY); u.stroke(); }
      u.beginPath(); u.moveTo(cx, y0 + bodyH * 0.08); u.lineTo(cx, footY); u.stroke();
    };

    if (o === 'suit' || o === 'suit3' || o === 'tux' || o === 'blazer' || o === 'officeF') {
      const part = o === 'blazer' || o === 'officeF' ? 'blazer' : 'suit', pant = o === 'blazer' || o === 'officeF' ? 'pant' : 'suit';
      trousers(pant, hipY - bodyH * 0.06);
      const vB = jacket(part, hipY + bodyH * 0.05, o !== 'officeF');
      if (o === 'suit3') { const vc = C(st, 'vest'); u.fillStyle = vc; u.beginPath(); u.moveTo(cx - sh * 0.18, waistY - bodyH * 0.08); u.lineTo(cx + sh * 0.18, waistY - bodyH * 0.08); u.lineTo(cx + sh * 0.14, vB + 6); u.lineTo(cx - sh * 0.14, vB + 6); u.fill(); }
      if (o !== 'officeF') { collar(shirtCol); tie(vB); }
    } else if (o === 'shirt') {
      trousers('pant', hipY - bodyH * 0.07);
      upperPath(u, g, hipY - bodyH * 0.03, hipY - bodyH * 0.02, 0, 1.06); u.fillStyle = fabricFill(u, 'shirt', st); u.fill();
      const sc = C(st, 'shirt'); u.strokeStyle = shade(sc, -0.2); u.lineWidth = 2; u.beginPath(); u.moveTo(cx, neckY + 10); u.lineTo(cx, hipY - bodyH * 0.03); u.stroke();
      u.fillStyle = shade(sc, -0.3); for (let i = 0; i < 6; i++) { u.beginPath(); u.arc(cx + 5, shY + i * (hipY - shY) / 6.5, 3, 0, 7); u.fill(); }
      u.fillStyle = '#2b1d14'; u.fillRect(cx - g.hipHalf * 1.08, hipY - bodyH * 0.075, g.hipHalf * 2.16, bodyH * 0.018); u.fillStyle = '#c0c4c8'; u.fillRect(cx - 10, hipY - bodyH * 0.075, 20, bodyH * 0.018);
      collar(shade(sc, -0.08)); tie(waistY);
      vGrad(u, cx - g.armOut - sh * 0.5, shY, sh * 0.8, hipY - shY, 0.15); vGrad(u, cx + g.armOut - sh * 0.3, shY, sh * 0.8, hipY - shY, 0.15);
    } else if (o === 'sherwani' || o === 'kurta') {
      const coat = o === 'sherwani' ? 'sherwani' : 'kurta', low = o === 'sherwani' ? 'churidar' : 'pyjama';
      legsPath(u, g, hipY, footY + 20, o === 'kurta' ? 1.1 : 0.95); u.fillStyle = fabricFill(u, low, st); u.fill();
      const lc = C(st, low); u.strokeStyle = shade(lc, -0.12); u.lineWidth = 2; for (let y = footY - bodyH * 0.12; y < footY; y += 9) { u.beginPath(); u.moveTo(cx - g.hipHalf, y); u.lineTo(cx + g.hipHalf, y + 3); u.stroke(); }
      const len = kneeY + (o === 'sherwani' ? bodyH * 0.04 : 0);
      upperPath(u, g, len, hipY - bodyH * 0.01, 0, o === 'sherwani' ? 1.25 : 1.2);
      u.fillStyle = fabricFill(u, coat, st); u.fill();
      const cc = C(st, coat), trim = o === 'sherwani' ? C(st, 'trim') : shade(cc, -0.2);
      u.fillStyle = trim; u.fillRect(cx - sh * 0.3, neckY - 4, sh * 0.6, (shY - neckY) * 0.6);
      u.fillRect(cx - 4, neckY, 8, o === 'sherwani' ? len - neckY : bodyH * 0.18);
      for (let y = neckY + 18; y < (o === 'sherwani' ? len : neckY + bodyH * 0.18); y += bodyH * 0.04) { u.beginPath(); u.arc(cx, y, 5, 0, 7); u.fillStyle = o === 'sherwani' ? '#fff3c4' : shade(cc, -0.35); u.fill(); }
      if (o === 'sherwani') { const tw = g.hipHalf * 1.25; zari(u, cx - tw, len - bodyH * 0.03, tw * 2, bodyH * 0.03, trim); for (const d of [-1, 1]) zari(u, cx + d * (g.armOut + sh * 0.5) - (d > 0 ? sh * 0.9 : 0), hipY - bodyH * 0.05, sh * 0.9, bodyH * 0.025, trim); }
      vGrad(u, cx - g.hipHalf * 1.2, hipY, g.hipHalf * 2.4, len - hipY, 0.12);
    } else if (o === 'saree' || o === 'lehenga' || o === 'gown') {
      // lower drape (free silhouette – covers both legs)
      const top = waistY + bodyH * 0.015, wHalf = g.waistHalf * 1.12, hHalf = g.hipHalf * 1.15;
      const flare = o === 'saree' ? 1.12 : o === 'lehenga' ? 1.9 : 1.75, bot = footY + bodyH * 0.01;
      const part = o === 'saree' ? 'body' : o === 'lehenga' ? 'skirt' : 'gown';
      f.beginPath(); f.moveTo(cx - wHalf, top); f.quadraticCurveTo(cx - hHalf * 1.05, hipY, cx - hHalf, hipY + bodyH * 0.05);
      f.lineTo(cx - hHalf * flare, bot); f.quadraticCurveTo(cx, bot + bodyH * 0.02, cx + hHalf * flare, bot); f.lineTo(cx + hHalf, hipY + bodyH * 0.05); f.quadraticCurveTo(cx + hHalf * 1.05, hipY, cx + wHalf, top); f.closePath();
      f.fillStyle = fabricFill(f, part, st); f.fill();
      f.save(); f.clip();
      const bw = bodyH * (o === 'saree' ? 0.055 : 0.07), bc = o === 'gown' ? null : C(st, o === 'saree' ? 'border' : 'blouse');
      if (bc) zari(f, cx - hHalf * flare - 10, bot - bw, hHalf * flare * 2 + 20, bw + 10, bc);
      // pleats / gathers
      const n = o === 'saree' ? 7 : 14, px0 = o === 'saree' ? cx - hHalf * 0.55 : cx - hHalf * flare, pw = o === 'saree' ? hHalf * 0.9 : hHalf * flare * 2;
      for (let i = 0; i < n; i++) { const x = px0 + i * pw / n; const gr = f.createLinearGradient(x, 0, x + pw / n, 0); gr.addColorStop(0, 'rgba(0,0,0,.20)'); gr.addColorStop(.5, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.05)'); f.fillStyle = gr; f.fillRect(x, o === 'saree' ? hipY : top, pw / n, bot - top); }
      if (o === 'saree' && bc) for (let i = 0; i < n; i++) zari(f, px0 + i * pw / n, bot - bw, pw / n - 2, bw, shade(bc, i % 2 ? -0.08 : 0));
      f.restore();
      f.strokeStyle = 'rgba(0,0,0,.25)'; f.lineWidth = 3; f.beginPath(); f.moveTo(cx - wHalf, top); f.lineTo(cx + wHalf, top); f.stroke();
      // blouse / bodice
      const bl = o === 'gown' ? 'gown' : 'blouse', underBust = shY + (waistY - shY) * (o === 'gown' ? 1 : 0.52);
      upperPath(u, g, underBust + (o === 'gown' ? bodyH * 0.02 : 0), shY + bodyH * (o === 'gown' ? 0.04 : 0.085), (shY - neckY) * 1.6, 1.08);
      u.fillStyle = fabricFill(u, bl, st); u.fill();
      if (o !== 'gown') { const blc = C(st, bl); u.fillStyle = shade(blc, -0.25); for (const d of [-1, 1]) u.fillRect(cx + d * (g.armOut + sh * 0.5) - (d > 0 ? sh * 1.0 : 0), shY + bodyH * 0.075, sh * 1.0, bodyH * 0.012); }
      if (o !== 'gown') {
        // cover the midriff so the customer's own clothes never show: saree front drape / long choli
        const mw = g.waistHalf * 1.18, y0 = underBust - 6, y1 = top + 6;
        u.fillStyle = fabricFill(u, o === 'saree' ? 'body' : 'blouse', st); u.fillRect(cx - mw, y0, mw * 2, y1 - y0);
        if (o === 'lehenga') zari(u, cx - mw, y1 - bodyH * 0.025, mw * 2, bodyH * 0.025, '#d4af37');
        const sg = u.createLinearGradient(0, y0, 0, y1); sg.addColorStop(0, 'rgba(0,0,0,.18)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); u.fillStyle = sg; u.fillRect(cx - mw, y0, mw * 2, y1 - y0);
      }
      if (o === 'saree') {
        // pallu over the left shoulder (viewer's right), across chest to the opposite waist
        const pw2 = sh * 0.95, fill = fabricFill(u, 'body', st), bc2 = C(st, 'border');
        band(u, cx + sh * 0.72, shY - sh * 0.05, cx - g.waistHalf * 1.25, waistY + bodyH * 0.06, pw2, fill, bc2, pw2 * 0.2);
        band(u, cx + sh * 0.85, shY - sh * 0.02, cx + sh * 1.0, hipY + bodyH * 0.06, pw2 * 0.7, fill, bc2, pw2 * 0.16);
        u.fillStyle = 'rgba(0,0,0,.12)'; band(u, cx + sh * 0.72, shY + sh * 0.25, cx - g.waistHalf * 1.25, waistY + bodyH * 0.09, pw2 * 0.12, 'rgba(0,0,0,.12)');
      } else if (o === 'lehenga') {
        const dc = C(st, 'dupatta'); u.globalAlpha = 0.82;
        band(u, cx + sh * 0.78, shY - sh * 0.05, cx - g.waistHalf * 1.35, hipY + bodyH * 0.02, sh * 0.85, u.createPattern(motifTile(dc, '#d4af37', 'butti'), 'repeat'), '#d4af37', sh * 0.12);
        u.globalAlpha = 1;
      }
    } else if (o === 'salwar' || o === 'kurti') {
      const top = o === 'salwar' ? 'kameez' : 'kurti', low = o === 'salwar' ? 'salwar' : 'leggings';
      legsPath(u, g, hipY, footY + 20, o === 'salwar' ? 1.2 : 0.98); u.fillStyle = fabricFill(u, low, st); u.fill();
      if (o === 'salwar') { const lc = C(st, low); vGrad(u, cx - g.hipHalf * 1.2, kneeY, g.hipHalf * 2.4, footY - kneeY, 0.2); u.fillStyle = shade(lc, -0.15); u.fillRect(cx - g.hipHalf, footY - bodyH * 0.03, g.hipHalf * 2, bodyH * 0.02); }
      const len = o === 'salwar' ? kneeY + bodyH * 0.03 : hipY + (kneeY - hipY) * 0.55;
      upperPath(u, g, len, waistY + bodyH * 0.02, (shY - neckY) * 1.3, 1.22); u.fillStyle = fabricFill(u, top, st); u.fill();
      const tc = C(st, top); zari(u, cx - g.hipHalf * 1.3, len - bodyH * 0.025, g.hipHalf * 2.6, bodyH * 0.025, shade(tc, -0.25));
      u.fillStyle = shade(tc, -0.3); u.fillRect(cx - 3, neckY + (shY - neckY), 6, bodyH * 0.1);
      if (o === 'salwar') { const dc = C(st, 'dupatta'); u.globalAlpha = 0.88; for (const d of [-1, 1]) band(u, cx + d * sh * 0.75, shY - sh * 0.1, cx + d * sh * 0.95, hipY + bodyH * 0.1, sh * 0.45, dc, shade(dc, -0.25), sh * 0.06); u.fillStyle = dc; u.beginPath(); u.moveTo(cx - sh * 0.75, shY); u.quadraticCurveTo(cx, shY + bodyH * 0.07, cx + sh * 0.75, shY); u.lineTo(cx + sh * 0.6, shY - sh * 0.08); u.quadraticCurveTo(cx, shY + bodyH * 0.03, cx - sh * 0.6, shY - sh * 0.08); u.fill(); u.globalAlpha = 1; }
    }

    // clip upper layer to the body outline (never paints outside the person)
    u.globalCompositeOperation = 'destination-in'; u.drawImage(maskC, 0, 0); u.globalCompositeOperation = 'source-over';
    return [fr, up];
  }

  /* ---------- branding ---------- */
  function gLogo(ctx, x, y, r) {
    ctx.save(); ctx.fillStyle = '#6e0f2d'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#d4a017'; ctx.lineWidth = r * 0.1; ctx.stroke();
    ctx.lineWidth = r * 0.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(x, y, r * 0.46, -0.6, Math.PI * 1.5 + 0.9, true); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + r * 0.44, y + r * 0.12); ctx.lineTo(x + r * 0.05, y + r * 0.12); ctx.stroke(); ctx.restore();
  }
  function wrapText(ctx, t, x, y, maxW, lh, maxLines) {
    const words = String(t).split(/\s+/); let line = '', n = 0;
    for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y + n * lh); line = w; if (++n >= maxLines) return; } else line = test; }
    if (line) ctx.fillText(line, x, y + n * lh);
  }
  function brand(ctx, st, assets) {
    const theme = { maroon: ['#6e0f2d', '#d4a017'], peacock: ['#0b4a40', '#e0b44c'], rose: ['#9c2f52', '#f3e3d3'] }[st.theme || 'maroon'];
    if (st.shop) {
      ctx.save(); const g = ctx.createLinearGradient(0, 0, 0, 150); g.addColorStop(0, alpha(theme[0], 0.92)); g.addColorStop(1, alpha(theme[0], 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 150);
      let x = 28;
      if (assets.shopLogo) { ctx.save(); ctx.beginPath(); ctx.arc(70, 66, 44, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip(); const L = assets.shopLogo, s = Math.max(88 / L.width, 88 / L.height); ctx.drawImage(L, 70 - L.width * s / 2, 66 - L.height * s / 2, L.width * s, L.height * s); ctx.restore(); ctx.strokeStyle = theme[1]; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(70, 66, 44, 0, 7); ctx.stroke(); x = 130; }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 36px Georgia, serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(st.shop.name || '', x, 60, W - x - 24);
      ctx.font = '20px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.92)'; wrapText(ctx, st.shop.addr || '', x, 90, W - x - 30, 24, 2);
      ctx.restore();
    }
    // bottom ribbon: AI TrialRoom + "Developed by" Gundal logo
    ctx.save(); ctx.fillStyle = 'rgba(20,10,8,.78)'; ctx.fillRect(0, H - 74, W, 74);
    ctx.fillStyle = theme[1]; ctx.fillRect(0, H - 74, W, 3);
    gLogo(ctx, 44, H - 37, 22);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Georgia, serif'; ctx.fillText('AI TrialRoom', 76, H - 42);
    ctx.font = '16px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(st.label || '', 76, H - 18, 420);
    ctx.textAlign = 'right'; ctx.font = '15px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('Developed by', W - 70, H - 44); ctx.font = 'bold 16px system-ui, sans-serif'; ctx.fillText('Gundal Business Pvt Ltd', W - 70, H - 22);
    if (assets.gundal) { ctx.save(); rr(ctx, W - 60, H - 62, 48, 48, 9); ctx.clip(); ctx.drawImage(assets.gundal, W - 60, H - 62, 48, 48); ctx.restore(); }
    ctx.restore();
  }

  /* ---------- prepare the person once per photo ---------- */
  async function preparePerson(src) {
    // src: {img} for photos, or {model:{gender,skin}}
    const person = mk(W, H), pm = mk(W, H);
    if (src.model) {
      const g = drawModel(person.getContext('2d'), W, H, src.model.gender, src.model.skin);
      pm.getContext('2d').drawImage(person, 0, 0);
      return { person, mask: pm, g, cut: true, method: 'model' };
    }
    const img = src.img; let m = await segment(img), method = 'ai';
    if (!m) { m = fallbackMask(img); method = m.weak ? 'none' : 'colour'; }
    // fit the photo into W x H (contain), same transform for mask
    const s = Math.min(W / img.width, (H - 74) / img.height), dw = img.width * s, dh = img.height * s, dx = (W - dw) / 2, dy = (H - 74 - dh);
    const pc = person.getContext('2d'); pc.drawImage(img, dx, dy, dw, dh);
    const mc = pm.getContext('2d'); mc.filter = 'blur(2px)'; mc.drawImage(m, dx, dy, dw, dh); mc.filter = 'none';
    const g = geometryFromMask(pm);
    if (!g) return { person, mask: pm, g: null, cut: false, method, fit: [dx, dy, dw, dh], img };
    return { person, mask: pm, g, cut: method !== 'none', method, fit: [dx, dy, dw, dh], img };
  }

  /* ---------- final composite ---------- */
  function compose(P, st, assets) {
    const out = mk(W, H), o = out.getContext('2d');
    const g = Object.assign({}, P.g); const adj = (st.neckAdj || 0) * (g.footY - g.top) * 0.01; g.neckY += adj; g.shY += adj;
    const useBg = st.bg !== 'original' && P.cut;
    // 1. background
    if (useBg) drawBg(o, st.bg, W, H);
    else if (P.img) { o.filter = 'blur(18px) brightness(.8)'; o.drawImage(P.img, -40, -40, W + 80, H + 80); o.filter = 'none'; o.drawImage(P.img, ...P.fit); }
    else drawBg(o, 'studio', W, H);
    // 2. person cut-out with soft floor shadow
    const cut = mk(W, H), c = cut.getContext('2d'); c.drawImage(P.person, 0, 0); c.globalCompositeOperation = 'destination-in'; c.drawImage(P.mask, 0, 0);
    if (useBg) { o.fillStyle = 'rgba(0,0,0,.28)'; o.beginPath(); o.ellipse(g.cx, Math.min(g.footY, H - 80), g.sh * 1.4, 18, 0, 0, 7); o.fill(); o.drawImage(cut, 0, 0); }
    else if (!P.img) o.drawImage(cut, 0, 0);
    // 3. garment layers + lighting from the original photo (folds, shadows)
    const layers = drawGarment(st, g, P.mask);
    const gar = mk(W, H), gc = gar.getContext('2d'); for (const L of layers) gc.drawImage(L, 0, 0);
    const shadeL = mk(W, H), sc = shadeL.getContext('2d'); sc.filter = 'grayscale(1) contrast(1.15)'; sc.drawImage(cut, 0, 0); sc.filter = 'none';
    sc.globalCompositeOperation = 'destination-in'; sc.drawImage(layers[1], 0, 0);
    o.drawImage(gar, 0, 0);
    o.save(); o.globalCompositeOperation = 'soft-light'; o.globalAlpha = P.method === 'model' ? 0.25 : 0.6; o.drawImage(shadeL, 0, 0); o.restore();
    // 4. protect the original face/head: re-draw original pixels above the neckline
    const head = mk(W, H), hc = head.getContext('2d'); hc.drawImage(cut, 0, 0); hc.globalCompositeOperation = 'destination-in';
    const hg = hc.createLinearGradient(0, g.neckY - 14, 0, g.neckY + 2); hg.addColorStop(0, '#000'); hg.addColorStop(1, 'rgba(0,0,0,0)'); hc.fillStyle = hg; hc.fillRect(0, 0, W, g.neckY + 2);
    hc.clearRect(0, g.neckY + 2, W, H);
    o.drawImage(head, 0, 0);
    // 5. branding
    brand(o, st, assets);
    return out;
  }

  function brandImage(img, st, assets) {
    const out = mk(W, H), o = out.getContext('2d');
    const s = Math.max(W / img.width, H / img.height), dw = img.width * s, dh = img.height * s;
    o.fillStyle = '#111'; o.fillRect(0, 0, W, H);
    o.drawImage(img, (W - dw) / 2, Math.min(0, (H - dh) * 0.35), dw, dh);
    brand(o, st, assets); return out;
  }

  return { brandImage, W, H, PALETTE, OUTFITS, CODES, BGS, SKINS, drawBg, drawModel, preparePerson, compose, photoTile, avgColor, mk, disableAI: false, _geometryFromMask: geometryFromMask };
})();
