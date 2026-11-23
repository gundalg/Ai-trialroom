/* AI TrialRoom app controller */
'use strict';
{
  const $ = id => document.getElementById(id);
  const KEY = 'atr.v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  let S = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { // storage full: drop oldest looks and retry
      if (S.looks && S.looks.length) { S.looks.splice(-3); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} } } };
  const T = { gender: 'female', src: null, srcKey: '', outfit: 'saree', code: null, colors: {}, fabric: null, fabricAvg: null, garImg: null, part: null, bg: 'silk', multi: false, results: [], P: null, PKey: '', neckAdj: 0 };
  const assets = { gundal: null, shopLogo: null };

  /* ---------- helpers ---------- */
  const toast = (m, ms = 2600) => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms); };
  const ask = (msg) => new Promise(res => { $('modalTxt').textContent = msg; $('modal').classList.remove('hidden'); $('modalYes').onclick = () => { $('modal').classList.add('hidden'); res(true); }; $('modalNo').onclick = () => { $('modal').classList.add('hidden'); res(false); }; });
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read this image')); i.src = src; });
  const readFile = f => new Promise((res, rej) => { if (!f) return rej(new Error('No file')); if (!/^image\//.test(f.type || 'image/')) return rej(new Error('Please choose an image file')); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read file')); r.readAsDataURL(f); });
  async function downscale(dataUrl, max, q = 0.9) { const i = await loadImg(dataUrl); const s = Math.min(1, max / Math.max(i.width, i.height)); const c = TR.mk(Math.round(i.width * s), Math.round(i.height * s)); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); return { canvas: c, url: c.toDataURL('image/jpeg', q) }; }
  const colorName = h => { if (h === 'none') return 'No tie'; const p = TR.PALETTE.find(x => x[1].toLowerCase() === String(h).toLowerCase()); return p ? p[0] : h; };
  const outfitDef = () => TR.OUTFITS[T.gender].find(o => o.id === T.outfit) || TR.OUTFITS[T.gender][0];

  /* ---------- navigation ---------- */
  const stack = [];
  function go(id, push = true) {
    const cur = document.querySelector('.screen.active');
    if (cur && push && cur.id !== 's-' + id) stack.push(cur.id.slice(2));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('s-' + id).classList.add('active'); window.scrollTo(0, 0);
    if (enter[id]) enter[id]();
  }
  function back() {
    if ($('modal') && !$('modal').classList.contains('hidden')) { $('modal').classList.add('hidden'); return true; }
    const cur = document.querySelector('.screen.active').id.slice(2);
    if (cur === 'home' || cur === 'splash' || !stack.length) return false;
    let prev = stack.pop(); if (prev === 'result') prev = stack.pop() || 'home';
    go(prev, false); return true;
  }
  window.ATR = { back, state: () => S, temp: () => T };
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { if (!back()) go('home', false); }));

  const enter = {};
  function applyTheme() { document.body.dataset.theme = S.theme || 'maroon'; }
  function routeAfterLogin() { stack.length = 0; if (S.role === 'owner' && !S.shop) go('shop', false); else go('home', false); }

  /* ---------- splash / role ---------- */
  $('btnStart').onclick = () => { if (S.verified && S.consentAt && S.role) routeAfterLogin(); else go('role'); };
  document.querySelectorAll('.choice').forEach(b => b.onclick = () => { S.role = b.dataset.role; save(); document.querySelectorAll('.choice').forEach(x => x.classList.toggle('on', x === b)); go('phone'); });

  /* ---------- phone + OTP (demo provider; replace sendOtp() with an SMS gateway) ---------- */
  let otp = null, otpAt = 0, tries = 0, resendTimer = null;
  enter.phone = () => { $('phone').value = S.phone || ''; $('otpBox').classList.add('hidden'); $('phoneErr').textContent = ''; };
  $('phone').addEventListener('input', e => { let d = e.target.value.replace(/\D/g, ''); if (d.length > 10 && /^(91|0)/.test(d)) d = d.replace(/^(91|0)/, ''); e.target.value = d.slice(0, 10); });
  $('otp').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if (e.target.value.length === 6) $('btnVerify').click(); });
  function sendOtp(num) {
    otp = String(Math.floor(100000 + Math.random() * 900000)); otpAt = Date.now(); tries = 0;
    if (window.AndroidBridge && AndroidBridge.sendOtp) { try { AndroidBridge.sendOtp(num, otp); } catch (e) {} }
    $('otpNote').textContent = `Demo mode: your code is ${otp}. (Live SMS is enabled once an SMS gateway is connected.)`;
  }
  function startResend() { let n = 30; const b = $('btnResend'); b.disabled = true; clearInterval(resendTimer); b.textContent = `Resend code in ${n}s`; resendTimer = setInterval(() => { n--; if (n <= 0) { clearInterval(resendTimer); b.disabled = false; b.textContent = 'Resend code'; } else b.textContent = `Resend code in ${n}s`; }, 1000); }
  $('btnSendOtp').onclick = () => {
    const v = $('phone').value.trim();
    if (!/^[6-9]\d{9}$/.test(v)) { $('phoneErr').textContent = 'Enter a valid 10-digit Indian mobile number.'; return; }
    $('phoneErr').textContent = ''; S.phone = v; save(); sendOtp(v);
    $('otpBox').classList.remove('hidden'); $('otp').value = ''; $('otpErr').textContent = ''; $('btnSendOtp').textContent = 'Change number or send again'; startResend(); $('otp').focus();
  };
  $('btnResend').onclick = () => { if ($('btnResend').disabled) return; sendOtp(S.phone); startResend(); toast('New code sent'); };
  $('btnVerify').onclick = () => {
    const v = $('otp').value;
    if (!otp) { $('otpErr').textContent = 'Please request a code first.'; return; }
    if (Date.now() - otpAt > 5 * 60 * 1000) { $('otpErr').textContent = 'This code expired. Tap Resend code.'; return; }
    if (++tries > 5) { $('otpErr').textContent = 'Too many attempts. Tap Resend code.'; otp = null; return; }
    if (v !== otp) { $('otpErr').textContent = 'That code is not correct. Please check and try again.'; return; }
    S.verified = true; S.verifiedAt = new Date().toISOString(); save(); otp = null; clearInterval(resendTimer);
    toast('Phone number verified ✓'); go('consent');
  };

  /* ---------- agreement ---------- */
  enter.consent = () => {
    const owner = S.role === 'owner';
    $('agreeText').innerHTML = owner
      ? `<p><b>For shop owners.</b> AI TrialRoom lets you show customers how outfits look on them.</p>
         <p>Customer photos are processed only on this phone. AI TrialRoom does not upload them to any server.</p>
         <p>You must take the customer's permission before taking or uploading their photo, use it only to show them outfits, and delete it when they leave. You must not share, post, sell, edit for any other purpose, or misuse a customer's photo in any way.</p>
         <p>Misuse of customer photos may be a criminal offence under Indian law, including the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023. You are responsible for photos you upload.</p>`
      : `<p><b>For individuals.</b> Upload only your own photo, or a photo of someone who has given you permission.</p>
         <p>Your photos are processed only on this phone. AI TrialRoom does not upload them to any server.</p>
         <p>Do not use AI TrialRoom to create images of other people without their consent, or to make fake, indecent or misleading images. Misuse may be an offence under Indian law.</p>`;
    $('c1').textContent = owner ? 'I will always take the customer\'s permission before using their photo.' : 'I will upload only my own photo or one I have permission to use.';
    $('c2').textContent = owner ? 'I will not share, post, sell or misuse any customer photo, and will delete it after the trial.' : 'I will not misuse anyone\'s photo or the images created.';
    $('c3').textContent = 'I have read and accept this agreement and the privacy terms.';
    document.querySelectorAll('.cbx').forEach(c => c.checked = false); $('consentErr').textContent = '';
  };
  $('btnAgree').onclick = () => {
    if (![...document.querySelectorAll('.cbx')].every(c => c.checked)) { $('consentErr').textContent = 'Please tick all three boxes to continue.'; return; }
    S.consentAt = new Date().toISOString(); S.consentRole = S.role; save(); routeAfterLogin();
  };

  /* ---------- shop setup ---------- */
  let pendingLogo = null;
  enter.shop = () => {
    const sh = S.shop || {}; $('shopName').value = sh.name || ''; $('shopAddr').value = sh.addr || ''; pendingLogo = sh.logo || null;
    $('logoPrev').src = pendingLogo || ''; $('logoPrev').classList.toggle('hidden', !pendingLogo); $('logoHint').classList.toggle('hidden', !!pendingLogo);
    markTheme(S.theme || 'maroon'); $('shopErr').textContent = '';
  };
  function markTheme(t) { S.theme = t; applyTheme(); document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('on', c.dataset.t === t)); }
  document.querySelectorAll('.theme-card').forEach(c => c.onclick = () => { markTheme(c.dataset.t); save(); });
  $('logoFile').onchange = async e => { try { const d = await readFile(e.target.files[0]); pendingLogo = (await downscale(d, 256, 0.92)).url; $('logoPrev').src = pendingLogo; $('logoPrev').classList.remove('hidden'); $('logoHint').classList.add('hidden'); } catch (err) { toast(err.message); } e.target.value = ''; };
  $('btnShopSave').onclick = async () => {
    const name = $('shopName').value.trim(), addr = $('shopAddr').value.trim();
    if (name.length < 2) { $('shopErr').textContent = 'Please enter your shop name.'; return; }
    if (addr.length < 8) { $('shopErr').textContent = 'Please enter your full shop address.'; return; }
    S.shop = { name, addr, logo: pendingLogo }; save(); await loadShopLogo(); stack.length = 0; go('home', false); toast('Shop saved');
  };
  async function loadShopLogo() { assets.shopLogo = null; if (S.shop && S.shop.logo) { try { assets.shopLogo = await loadImg(S.shop.logo); } catch (e) {} } }

  /* ---------- home ---------- */
  enter.home = () => {
    const owner = S.role === 'owner' && S.shop;
    $('homeTitle').textContent = owner ? S.shop.name : 'AI TrialRoom';
    $('homeLogo').classList.toggle('hidden', !(owner && S.shop.logo)); if (owner && S.shop.logo) $('homeLogo').src = S.shop.logo;
    $('homeG').classList.toggle('hidden', !!(owner && S.shop.logo));
    $('hello').textContent = owner ? 'Welcome back' : 'Welcome';
    const r = $('recent'), looks = S.looks || [];
    r.innerHTML = looks.length ? looks.map((l, i) => `<img src="${l}" alt="Saved look ${i + 1}" data-i="${i}">`).join('') : '<p class="empty">Your looks appear here after your first trial.</p>';
    r.querySelectorAll('img').forEach(im => im.onclick = () => { T.results = [{ url: looks[+im.dataset.i], label: 'Saved look' }]; showResults(0, true); go('result'); });
  };
  $('btnNewTrial').onclick = () => go('customer');
  $('btnSettings').onclick = () => go('settings');

  /* ---------- customer photo / AI model ---------- */
  enter.customer = () => { $('custTitle').textContent = S.role === 'owner' ? 'Customer photo' : 'Your photo'; setGender(T.gender, false); drawModels(); $('custErr').textContent = ''; };
  function setGender(g, reset = true) {
    if (reset && g !== T.gender) { T.outfit = TR.OUTFITS[g][0].id; T.code = null; T.colors = {}; T.fabric = null; T.garImg = null; T.bg = g === 'male' ? 'tailor' : 'silk'; if (T.src && T.src.model) { T.src = null; } }
    T.gender = g; $('gFemale').classList.toggle('on', g === 'female'); $('gMale').classList.toggle('on', g === 'male');
  }
  document.querySelectorAll('#genderSeg button').forEach(b => b.onclick = () => { setGender(b.dataset.g); drawModels(); });
  function drawModels() {
    const box = $('models'); box.innerHTML = TR.SKINS.map((s, i) => `<button class="model" data-i="${i}" aria-label="AI model ${i + 1}"><canvas width="180" height="300"></canvas></button>`).join('');
    box.querySelectorAll('.model').forEach(b => {
      const i = +b.dataset.i, c = b.querySelector('canvas'), x = c.getContext('2d');
      const big = TR.mk(TR.W, TR.H), bx = big.getContext('2d'); TR.drawBg(bx, 'studio', TR.W, TR.H); TR.drawModel(bx, TR.W, TR.H, T.gender, TR.SKINS[i]);
      x.drawImage(big, 0, 0, 180, 300);
      b.classList.toggle('on', !!(T.src && T.src.model && T.src.model.skin === TR.SKINS[i] && T.src.model.gender === T.gender));
      b.onclick = () => { T.src = { model: { gender: T.gender, skin: TR.SKINS[i] } }; T.srcKey = 'm' + T.gender + i; $('photoPrev').classList.add('hidden'); $('photoHint').classList.remove('hidden'); drawModels(); };
    });
  }
  const onPhoto = async e => {
    try { const d = await readFile(e.target.files[0]); const ds = await downscale(d, 1600, 0.92); const img = await loadImg(ds.url);
      if (img.width < 200 || img.height < 200) throw new Error('This photo is too small. Please use a clearer photo.');
      T.src = { img }; T.srcKey = 'p' + Date.now(); $('photoPrev').src = ds.url; $('photoPrev').classList.remove('hidden'); $('photoHint').classList.add('hidden'); drawModels(); $('custErr').textContent = '';
    } catch (err) { $('custErr').textContent = err.message; }
    e.target.value = '';
  };
  $('photoFile').onchange = onPhoto; $('photoCam').onchange = onPhoto;
  $('btnCustNext').onclick = () => { if (!T.src) { $('custErr').textContent = 'Upload a photo or choose an AI model.'; return; } go('outfit'); };

  /* ---------- outfit ---------- */
  enter.outfit = () => {
    const list = TR.OUTFITS[T.gender]; if (!list.find(o => o.id === T.outfit)) T.outfit = list[0].id;
    $('outfits').innerHTML = list.map(o => `<button class="chip ${o.id === T.outfit ? 'on' : ''}" data-o="${o.id}">${o.name}</button>`).join('');
    $('outfits').querySelectorAll('.chip').forEach(c => c.onclick = () => { if (T.outfit !== c.dataset.o) { T.outfit = c.dataset.o; T.code = null; T.colors = {}; T.fabric = null; T.garImg = null; } enter.outfit(); });
    $('codeBox').classList.toggle('hidden', T.gender !== 'male');
    $('codes').innerHTML = TR.CODES.map(c => `<button class="chip ${c.id === T.code ? 'on' : ''}" data-c="${c.id}">${c.name}</button>`).join('');
    $('codes').querySelectorAll('.chip').forEach(b => b.onclick = () => { const c = TR.CODES.find(x => x.id === b.dataset.c); T.code = c.id; T.outfit = c.outfit; T.colors = Object.assign({}, c.colors); T.fabric = null; T.garImg = null; enter.outfit(); });
    const od = outfitDef(); $('garmentBox').classList.toggle('hidden', !od.photo);
    if (od.photo) { $('garmentLbl').textContent = od.photo + ' (optional)'; $('garHint').innerHTML = `<b>Upload ${od.photo.toLowerCase()}</b><br>Its pattern is used on the look`; }
    $('garPrev').classList.toggle('hidden', !T.garImg); $('garHint').classList.toggle('hidden', !!T.garImg); $('garClear').classList.toggle('hidden', !T.garImg); if (T.garImg) $('garPrev').src = T.garImg.src;
  };
  const onGarment = async e => {
    try { const d = await readFile(e.target.files[0]); const ds = await downscale(d, 1200, 0.9); T.garImg = await loadImg(ds.url); T.fabric = TR.photoTile(T.garImg); T.fabricAvg = TR.avgColor(T.fabric); enter.outfit(); toast('Fabric added'); }
    catch (err) { toast(err.message); } e.target.value = '';
  };
  $('garFile').onchange = onGarment; $('garCam').onchange = onGarment;
  $('garClear').onclick = () => { T.garImg = null; T.fabric = null; enter.outfit(); };
  $('btnOutfitNext').onclick = () => go('colors');

  /* ---------- colours ---------- */
  function ensureColors() { for (const [k, , d] of outfitDef().parts) if (!T.colors[k]) T.colors[k] = d; }
  enter.colors = () => {
    ensureColors(); const parts = outfitDef().parts; if (!parts.find(p => p[0] === T.part)) T.part = parts[0][0];
    $('parts').innerHTML = parts.map(([k, n]) => { const fromPhoto = T.fabric && k === parts[0][0]; const c = T.colors[k]; return `<button class="part ${k === T.part ? 'on' : ''}" data-p="${k}"><i style="background:${fromPhoto ? `url(${T.garImg.src}) center/cover` : c === 'none' ? 'repeating-linear-gradient(45deg,#ddd 0 4px,#fff 4px 8px)' : c}"></i>${n}${fromPhoto ? ' (photo)' : ''}</button>`; }).join('');
    $('parts').querySelectorAll('.part').forEach(b => b.onclick = () => { T.part = b.dataset.p; enter.colors(); });
    const sw = TR.PALETTE.slice(); if (T.part === 'tie' && T.outfit === 'shirt') sw.unshift(['No tie', 'none']);
    $('swatches').innerHTML = sw.map(([n, h]) => `<button class="sw ${T.colors[T.part] === h ? 'on' : ''}" data-h="${h}" title="${n}" aria-label="${n}" style="background:${h === 'none' ? 'repeating-linear-gradient(45deg,#ddd 0 6px,#fff 6px 12px)' : h}"><span>${n}</span></button>`).join('');
    $('swatches').querySelectorAll('.sw').forEach(b => b.onclick = () => {
      if (T.fabric && T.part === parts[0][0]) { T.fabric = null; T.garImg = null; toast('Using colour instead of the photo'); }
      T.colors[T.part] = b.dataset.h; enter.colors();
    });
    $('multi').checked = T.multi;
  };
  $('multi').onchange = e => { T.multi = e.target.checked; };
  $('btnColorsNext').onclick = () => go('bg');

  /* ---------- background ---------- */
  const aiReady = () => !!(S.aiKey && S.aiKey.length > 20);
  function setMode(m) {
    T.mode = m; $('modeAI').classList.toggle('on', m === 'ai'); $('modeQuick').classList.toggle('on', m === 'quick');
    const q = AI.QUALITY[S.aiQuality || 'standard'];
    $('modeNote').innerHTML = m === 'ai'
      ? (aiReady() ? `Google Gemini drapes the outfit on the real photo (${q.name}, ${q.price}). Takes 10–40 seconds and needs internet.` : 'Real AI needs your Google AI key. <button class="link" id="goAiSetup">Set it up in Settings</button>')
      : 'Instant on-phone preview. Free and works offline, but less realistic.';
    const g = $('goAiSetup'); if (g) g.onclick = () => go('settings');
    $('btnGenerate').textContent = m === 'ai' ? 'Create real AI photo' : 'Create my look';
  }
  $('modeAI').onclick = () => setMode('ai'); $('modeQuick').onclick = () => setMode('quick');
  enter.bg = () => {
    if (!T.mode) T.mode = aiReady() ? 'ai' : 'quick';
    setMode(T.mode);
    const list = TR.BGS.slice().sort((a, b) => (b.g === T.gender) - (a.g === T.gender));
    if (!list.find(b => b.id === T.bg)) T.bg = list[0].id;
    $('bgs').innerHTML = list.map(b => `<button class="bgc ${b.id === T.bg ? 'on' : ''}" data-b="${b.id}"><canvas width="240" height="320"></canvas><b>${b.name}</b></button>`).join('');
    $('bgs').querySelectorAll('.bgc').forEach(el => {
      const c = el.querySelector('canvas'), x = c.getContext('2d');
      if (el.dataset.b === 'original') { if (T.src && T.src.img) { const i = T.src.img, s = Math.max(240 / i.width, 320 / i.height); x.drawImage(i, (240 - i.width * s) / 2, (320 - i.height * s) / 2, i.width * s, i.height * s); } else TR.drawBg(x, 'studio', 240, 320); }
      else TR.drawBg(x, el.dataset.b, 240, 320);
      el.onclick = () => { T.bg = el.dataset.b; enter.bg(); };
    });
  };

  /* ---------- generate ---------- */
  function labelFor(colors) {
    const od = outfitDef(), main = od.parts[0][0];
    const bits = od.parts.slice(0, 2).map(([k, n], i) => (i === 0 && T.fabric) ? 'your fabric' : (i === 0 ? colorName(colors[k]) : `${colorName(colors[k])} ${n.toLowerCase()}`));
    return `${od.name} · ${bits.join(' · ')}`;
  }
  function variants() {
    ensureColors(); const main = outfitDef().parts[0][0];
    const list = [Object.assign({}, T.colors)];
    if (T.multi) {
      const cur = T.colors[main], picks = ['#6e0f2d', '#1a2547', '#127a78', '#d6247a', '#36393f', '#d4af37', '#2948a8', '#c8102e', '#f4ecd8', '#0f4d32'].filter(c => c !== cur);
      for (let i = 0; i < 3; i++) list.push(Object.assign({}, T.colors, { [main]: picks[(i * 3 + (T.gender === 'male' ? 1 : 0)) % picks.length] }));
    }
    return list;
  }
  let busy = false;
  const b64 = (img, max) => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = TR.mk(Math.round(img.width * s), Math.round(img.height * s)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; };
  async function generateAI() {
    if (busy) return; busy = true;
    $('busy').classList.remove('hidden'); $('resultWrap').classList.add('hidden'); $('busyTxt').textContent = 'Sending photos to Google AI…';
    try {
      ensureColors(); const od = outfitDef(), names = {};
      for (const [k] of od.parts) names[k] = (T.colors[k] === 'none' ? 'no' : colorName(T.colors[k]).toLowerCase());
      const images = [];
      if (T.src.img) images.push({ mime: 'image/jpeg', data: b64(T.src.img, 1536) });
      if (T.garImg) images.push({ mime: 'image/jpeg', data: b64(T.garImg, 1280) });
      const model = T.src.model ? { skinIndex: TR.SKINS.indexOf(T.src.model.skin) } : null;
      const prompt = AI.buildPrompt({ outfit: T.outfit, colorNames: names, hasFabric: !!T.garImg, bg: T.bg, model, gender: T.gender });
      let n = 0; const tick = setInterval(() => { n++; $('busyTxt').textContent = ['Removing anything that is not the fabric…', 'Draping the outfit on the photo…', 'Matching light and folds…', 'Placing you in the showroom…', 'Almost ready…'][Math.min(4, Math.floor(n / 4))] + ` (${n * 2}s)`; }, 2000);
      let out; try { out = await AI.generate(S.aiKey, S.aiQuality || 'standard', prompt, images); } finally { clearInterval(tick); }
      const img = await loadImg(`data:${out.mime};base64,${out.data}`);
      const st = { theme: S.theme, shop: S.role === 'owner' ? S.shop : null, label: labelFor(T.colors).replace('your fabric', 'your saree') + ' · Real AI' };
      if (!T.garImg) st.label = st.label.replace(' · your saree', '');
      const c = TR.brandImage(img, st, assets);
      T.results = [{ url: c.toDataURL('image/jpeg', 0.92), label: st.label }]; T.lastAI = true;
      const mk = new Date().toISOString().slice(0, 7); if (!S.aiCount || S.aiCount.m !== mk) S.aiCount = { m: mk, n: 0 }; S.aiCount.n++; save();
      $('aiNote').textContent = '';
      showResults(0);
    } catch (err) {
      console.warn('AI', err && err.message); $('busy').classList.add('hidden');
      const msg = (err && err.message) || 'Something went wrong. Please try again.';
      back(); setTimeout(() => { $('modeNote').innerHTML = '<span class="err">' + msg.replace(/</g, '&lt;') + '</span>' + ((err && /key|billing|quota/.test(err.code)) ? ' <button class="link" id="goAiSetup2">Open Settings</button>' : '') + ' <button class="link" id="useQuick">Use quick preview</button>'; const g = $('goAiSetup2'); if (g) g.onclick = () => go('settings'); $('useQuick').onclick = () => setMode('quick'); }, 50);
      toast(msg, 5000);
    } finally { busy = false; }
  }
  async function generate() {
    if (T.mode === 'ai') return generateAI();
    if (busy) return; busy = true; T.lastAI = false;
    $('busy').classList.remove('hidden'); $('resultWrap').classList.add('hidden'); $('busyTxt').textContent = 'Finding the person in the photo…';
    try {
      await new Promise(r => setTimeout(r, 30));
      if (!T.P || T.PKey !== T.srcKey) { T.P = await TR.preparePerson(T.src); T.PKey = T.srcKey; }
      if (!T.P.g) throw new Error('We could not find a person in this photo. Please use a clear, full-length photo with a plain background.');
      $('busyTxt').textContent = 'Dressing you up…'; await new Promise(r => setTimeout(r, 30));
      const vs = variants(); const od = outfitDef();
      T.results = vs.map(colors => {
        const st = { outfit: T.outfit, colors: Object.assign({}, colors), fabric: (colors === vs[0]) ? T.fabric : null, fabricAvg: T.fabricAvg, photoPart: od.parts[0][0], bg: T.bg, neckAdj: T.neckAdj, theme: S.theme, shop: S.role === 'owner' ? S.shop : null };
        st.label = labelFor(colors).replace('your fabric', st.fabric ? 'your fabric' : colorName(colors[od.parts[0][0]]));
        const c = TR.compose(T.P, st, assets); return { url: c.toDataURL('image/jpeg', 0.9), label: st.label };
      });
      const notes = { ai: 'AI body detection on', colour: 'plain-background detection', none: 'body outline estimated — use a plain background for best results', model: 'AI model' };
      $('aiNote').textContent = '· ' + (notes[T.P.method] || '');
      if (T.P.method === 'none' && T.bg !== 'original') toast('Could not separate the person from the background, so the original background is kept.', 4000);
      showResults(0);
    } catch (err) { console.error(err); $('busy').classList.add('hidden'); toast(err.message || 'Something went wrong. Please try again.', 4500); back(); }
    finally { busy = false; }
  }
  function showResults(i, saved) {
    $('busy').classList.add('hidden'); $('resultWrap').classList.remove('hidden');
    $('resultImg').src = T.results[i].url; $('resultImg').dataset.i = i; $('saveNote').textContent = '';
    $('variants').innerHTML = T.results.length > 1 ? T.results.map((r, k) => `<img src="${r.url}" class="${k === i ? 'on' : ''}" data-k="${k}" alt="Look ${k + 1}">`).join('') : '';
    $('variants').querySelectorAll('img').forEach(im => im.onclick = () => showResults(+im.dataset.k, saved));
    $('neckAdj').parentElement.classList.toggle('hidden', !!saved || !!T.lastAI); $('btnAgain').classList.toggle('hidden', !!saved || !T.lastAI); $('btnEdit').classList.toggle('hidden', !!saved); $('btnFinish').classList.toggle('hidden', !!saved);
  }
  $('btnGenerate').onclick = () => {
    if (T.mode === 'ai' && !aiReady()) { toast('Add your Google AI key in Settings first, or choose Quick preview.'); return; }
    T.neckAdj = 0; $('neckAdj').value = 0; go('result'); generate(); };
  $('btnAgain').onclick = () => generate();
  $('neckAdj').onchange = e => { T.neckAdj = +e.target.value; generate(); };
  $('btnEdit').onclick = () => { stack.length = 0; stack.push('home', 'customer'); go('outfit', false); };
  $('btnSave').onclick = async () => {
    const i = +$('resultImg').dataset.i || 0, url = T.results[i].url, name = 'AI-TrialRoom-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jpg';
    let ok = false;
    if (window.AndroidBridge && AndroidBridge.saveImage) { try { ok = AndroidBridge.saveImage(url.split(',')[1], name) === 'ok'; } catch (e) { ok = false; } }
    else if (window.top !== window) { ok = 'web'; } // inside a web viewer: downloads are blocked, use long-press
    else { try { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); ok = true; } catch (e) { ok = 'web'; } }
    try { const th = await downscale(url, 360, 0.8); S.looks = [th.url].concat(S.looks || []).slice(0, 12); save(); } catch (e) {}
    $('saveNote').textContent = ok === 'web' ? 'Saved in Recent looks. To keep it on your phone: press and hold the photo, then choose "Save image" or take a screenshot.' : ok ? 'Saved to your gallery (Pictures/AI TrialRoom).' : 'Could not save. Please allow storage permission and try again.';
    toast(ok ? 'Saved ✓' : 'Save failed');
  };
  $('btnFinish').onclick = async () => {
    if (!await ask('Finish this trial? The customer photo will be removed from the app.')) return;
    T.src = null; T.srcKey = ''; T.P = null; T.PKey = ''; T.results = []; T.garImg = null; T.fabric = null; $('photoPrev').src = ''; $('photoPrev').classList.add('hidden'); $('photoHint').classList.remove('hidden'); $('resultImg').src = '';
    stack.length = 0; go('home', false); toast('Customer photo deleted');
  };

  /* ---------- settings ---------- */
  function renderAI() {
    const q = S.aiQuality || 'standard';
    $('aiQuality').innerHTML = Object.entries(AI.QUALITY).map(([k, v]) => `<button class="chip ${k === q ? 'on' : ''}" data-q="${k}">${v.name} · ${v.price}</button>`).join('');
    $('aiQuality').querySelectorAll('.chip').forEach(b => b.onclick = () => { S.aiQuality = b.dataset.q; save(); renderAI(); });
    const mk = new Date().toISOString().slice(0, 7), n = S.aiCount && S.aiCount.m === mk ? S.aiCount.n : 0;
    $('aiStatus').textContent = aiReady() ? `Ready ✓ · key ending …${S.aiKey.slice(-4)} · ${n} AI photo${n === 1 ? '' : 's'} this month` : 'Not set up yet. Real AI drapes the saree on the real photo.';
    $('aiKey').value = ''; $('btnAiRemove').classList.toggle('hidden', !aiReady());
  }
  $('btnAiSave').onclick = async () => {
    const k = $('aiKey').value.trim().replace(/\s+/g, '');
    $('aiErr').textContent = '';
    if (!k && aiReady()) { toast('Key already saved'); return; }
    if (!/^[A-Za-z0-9_\-]{30,60}$/.test(k)) { $('aiErr').textContent = 'That does not look like a Google AI key. It usually starts with AIza and is about 39 characters.'; return; }
    const b = $('btnAiSave'); b.disabled = true; b.textContent = 'Checking key…';
    try {
      const r = await AI.testKey(k);
      if (!r.ok) { $('aiErr').textContent = r.message; return; }
      S.aiKey = k; save(); T.mode = 'ai'; renderAI(); toast('Google AI key saved ✓');
    } finally { b.disabled = false; b.textContent = 'Save and check key'; }
  };
  $('btnAiRemove').onclick = async () => { if (await ask('Remove the Google AI key from this phone?')) { delete S.aiKey; save(); T.mode = 'quick'; renderAI(); } };
  enter.settings = () => { renderAI(); $('acctInfo').textContent = `${S.role === 'owner' ? 'Shop owner' : 'Individual'} · +91 ${S.phone || ''} · verified ${S.verifiedAt ? new Date(S.verifiedAt).toLocaleDateString() : ''}`; $('btnEditShop').classList.toggle('hidden', S.role !== 'owner'); };
  $('btnEditShop').onclick = () => go('shop');
  $('btnClearLooks').onclick = async () => { if (await ask('Delete all saved looks from this app?')) { S.looks = []; save(); toast('Looks deleted'); } };
  $('btnReset').onclick = async () => { if (await ask('Sign out and remove all app data from this phone?')) { try { localStorage.removeItem(KEY); } catch (e) {} S = {}; T.src = null; T.P = null; applyTheme(); stack.length = 0; go('splash', false); } };

  /* ---------- boot ---------- */
  applyTheme(); loadShopLogo();
  loadImg('gundal.png').then(i => assets.gundal = i).catch(() => {});
  window.addEventListener('error', e => console.error('ATR error', e.message));
}
