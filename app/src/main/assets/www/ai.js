/* AI TrialRoom — real AI draping with Google Gemini image models.
   The customer photo + garment photo go to Google; the result keeps the person's face and drapes the garment.
   Calls go through the native Android bridge (no CORS), or fetch() in a browser. */
'use strict';
const AI = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const QUALITY = {
    standard: { name: 'Standard', price: '≈ ₹3.5 per photo', models: ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-nano-banana-2.1'] },
    better: { name: 'Better', price: '≈ ₹6 per photo', models: ['gemini-3.1-flash-image', 'gemini-nano-banana-2.1', 'gemini-2.5-flash-image'] },
    best: { name: 'Best', price: '≈ ₹11 per photo', models: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'] }
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class AIError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

  /* ---------- transport ---------- */
  async function http(method, url, headers, body, timeoutMs = 150000) {
    if (window.AndroidBridge && AndroidBridge.httpStart) {
      const id = AndroidBridge.httpStart(method, url, JSON.stringify(headers || {}), body || '');
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs + 5000) {
        await sleep(400);
        const r = AndroidBridge.httpPoll(id);
        if (r) return JSON.parse(r);
      }
      return { status: 0, body: '', error: 'timeout' };
    }
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs);
    try { const res = await fetch(url, { method, headers, body: body || undefined, signal: ctl.signal }); return { status: res.status, body: await res.text() }; }
    catch (e) { return { status: 0, body: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) }; }
    finally { clearTimeout(to); }
  }

  /* ---------- response helpers ---------- */
  function findImage(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 12) return null;
    if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) { const r = findImage(o[i], depth + 1); if (r) return r; } return null; }
    const mt = o.mimeType || o.mime_type;
    if (typeof o.data === 'string' && o.data.length > 500 && (!mt || /^image\//.test(mt))) return { mime: mt || 'image/png', data: o.data };
    for (const k of Object.keys(o)) { const r = findImage(o[k], depth + 1); if (r) return r; }
    return null;
  }
  function findText(o, out = [], depth = 0) {
    if (!o || typeof o !== 'object' || depth > 12) return out;
    if (typeof o.text === 'string') out.push(o.text);
    for (const k of Object.keys(o)) if (typeof o[k] === 'object') findText(o[k], out, depth + 1);
    return out;
  }
  function parseJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function explain(res) {
    const j = parseJSON(res.body) || {}, err = j.error || {}, msg = (err.message || '') + ' ' + (err.status || '');
    if (res.status === 0) return new AIError(res.error === 'timeout' ? 'The AI took too long to answer. Please check the internet and try again.' : 'No internet connection. Please connect to the internet and try again.', 'net');
    if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(msg) || (res.status === 400 && /key/i.test(msg))) return new AIError('The Google AI key is not valid. Please check it in Settings.', 'key');
    if (res.status === 403) return new AIError('Google refused the request. Please make sure billing is turned on for your Google AI key.', 'billing');
    if (res.status === 429) return new AIError('The Google AI limit is reached. Turn on billing for your key or try again in a minute.', 'quota');
    if (res.status === 404) return new AIError('Model not available', 'model');
    if (res.status >= 500) return new AIError('Google AI is busy right now. Please try again in a minute.', 'server');
    return new AIError('The AI could not make this photo (' + (err.message || ('error ' + res.status)).slice(0, 140) + ').', 'other');
  }
  function blocked(j) {
    const pf = j && (j.promptFeedback || j.prompt_feedback);
    const fr = j && j.candidates && j.candidates[0] && (j.candidates[0].finishReason || j.candidates[0].finish_reason);
    if ((pf && (pf.blockReason || pf.block_reason)) || /SAFETY|PROHIBITED|IMAGE_SAFETY|BLOCK/i.test(fr || '')) return new AIError('Google AI declined this photo. Please try a different, clear photo of the person standing.', 'safety');
    return null;
  }

  /* ---------- the two Gemini API styles ---------- */
  async function viaGenerateContent(key, model, prompt, images, withConfig) {
    const parts = [{ text: prompt }].concat(images.map(im => ({ inline_data: { mime_type: im.mime, data: im.data } })));
    const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
    if (withConfig) body.generationConfig.imageConfig = { aspectRatio: '3:4' };
    return http('POST', `${BASE}/models/${model}:generateContent`, { 'Content-Type': 'application/json', 'x-goog-api-key': key }, JSON.stringify(body));
  }
  async function viaInteractions(key, model, prompt, images) {
    const input = [{ type: 'text', text: prompt }].concat(images.map(im => ({ type: 'image', mime_type: im.mime, data: im.data })));
    const body = { model, input, response_format: { type: 'image', aspect_ratio: '3:4', image_size: '1K' } };
    return http('POST', `${BASE}/interactions`, { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': '2026-05-20' }, JSON.stringify(body));
  }

  async function generate(key, quality, prompt, images, onStep) {
    if (!key) throw new AIError('Add your Google AI key in Settings to use real AI photos.', 'key');
    const models = (QUALITY[quality] || QUALITY.standard).models;
    let last = null;
    const tryRes = res => {
      if (res.status === 200) {
        const j = parseJSON(res.body); const b = blocked(j); if (b) throw b;
        const img = findImage(j); if (img) return img;
        const t = findText(j).join(' ').trim();
        last = new AIError('The AI did not return a photo' + (t ? ': ' + t.slice(0, 160) : '.') + ' Please try again.', 'empty');
        return null;
      }
      const e = explain(res); if (e.code !== 'model' && e.code !== 'other') throw e; last = e; return null;
    };
    for (const m of models) {
      onStep && onStep(m);
      let res = await viaGenerateContent(key, m, prompt, images, true);
      if (res.status === 400 && /imageConfig|image_config|aspect|Unknown name|Invalid JSON/i.test(res.body)) res = await viaGenerateContent(key, m, prompt, images, false);
      const img = tryRes(res); if (img) return Object.assign(img, { model: m });
    }
    for (const m of models) {
      onStep && onStep(m);
      const img = tryRes(await viaInteractions(key, m, prompt, images)); if (img) return Object.assign(img, { model: m });
    }
    throw (last && last.code !== 'model') ? last : new AIError('Google AI image models are not available for this key. Please check the key in Settings.', 'model');
  }

  async function testKey(key) {
    const res = await http('GET', `${BASE}/models?pageSize=50`, { 'x-goog-api-key': key }, '', 30000);
    if (res.status === 200) { const j = parseJSON(res.body) || {}; const names = (j.models || []).map(m => m.name || ''); return { ok: true, image: names.some(n => /image|banana/.test(n)) }; }
    const e = explain(res); return { ok: false, message: e.code === 'model' ? 'The key could not be checked.' : e.message };
  }

  /* ---------- prompts ---------- */
  const BG_TEXT = {
    silk: 'an elegant Indian silk saree showroom: wooden shelves of neatly folded colourful silk sarees, warm golden spotlights, polished floor',
    bridal: 'a luxurious bridal boutique lounge with arched mirrors, soft pink drapes, a crystal chandelier and warm light',
    tailor: 'a premium menswear tailoring studio with wood-panelled walls, racks of suits and warm spotlights',
    corporate: 'a modern corporate office lobby with glass windows, city view and a marble floor',
    studio: 'a clean professional photo studio with a soft light-grey backdrop and even lighting',
    original: null
  };
  function outfitText(o, c, hasFabric) {
    const fab = 'EXACTLY the garment shown in the second image (same colours, motifs, weave, border and pallu/patterns)';
    switch (o) {
      case 'saree': return `a traditional Indian saree draped in the classic Nivi style — neat front pleats tucked at the waist, the pallu falling over the left shoulder — ${hasFabric ? 'using ' + fab : `in ${c.body} silk with a ${c.border} zari border`}, worn with a fitted short-sleeve blouse in ${c.blouse}`;
      case 'lehenga': return `an Indian bridal lehenga: a flared ${hasFabric ? 'skirt made from ' + fab : c.skirt + ' embroidered skirt'}, a ${c.blouse} choli blouse and a ${c.dupatta} net dupatta draped over one shoulder`;
      case 'salwar': return `a salwar kameez: knee-length ${hasFabric ? 'kameez made from ' + fab : c.kameez + ' kameez'}, ${c.salwar} salwar trousers and a ${c.dupatta} dupatta over both shoulders`;
      case 'kurti': return `a ${hasFabric ? 'kurti made from ' + fab : c.kurti + ' cotton kurti'} reaching mid-thigh, with ${c.leggings} leggings`;
      case 'gown': return `an elegant floor-length party gown ${hasFabric ? 'made from ' + fab : 'in ' + c.gown}`;
      case 'officeF': return `women's office formal wear: a tailored ${c.blazer} blazer, a ${c.top} blouse and ${c.pant} trousers`;
      case 'suit': return `a well-fitted two-piece business suit ${hasFabric ? 'made from ' + fab : 'in ' + c.suit}, a ${c.shirt} formal shirt and a ${c.tie} silk tie, with polished black shoes`;
      case 'suit3': return `a three-piece suit ${hasFabric ? 'made from ' + fab : 'in ' + c.suit} with a ${c.vest} waistcoat, a ${c.shirt} formal shirt and a ${c.tie} tie`;
      case 'tux': return `a black-tie tuxedo in ${c.suit} with satin lapels, a ${c.shirt} dress shirt and a ${c.tie} bow tie`;
      case 'shirt': return `office wear: a ${hasFabric ? 'formal shirt made from ' + fab : c.shirt + ' formal shirt'} tucked into ${c.pant} formal trousers with a leather belt${c.tie && c.tie !== 'none' ? ' and a ' + c.tie + ' tie' : ', no tie'}`;
      case 'blazer': return `business casual: a ${hasFabric ? 'blazer made from ' + fab : c.blazer + ' blazer'}, a ${c.shirt} shirt with open collar and ${c.pant} chinos`;
      case 'sherwani': return `a royal Indian sherwani ${hasFabric ? 'made from ' + fab : 'in ' + c.sherwani} with ${c.trim} embroidery, worn with ${c.churidar} churidar trousers and mojari shoes`;
      case 'kurta': return `a ${hasFabric ? 'kurta made from ' + fab : c.kurta + ' kurta'} with ${c.pyjama} pyjama trousers`;
    }
    return 'the selected outfit';
  }
  function buildPrompt(opt) {
    // opt: {outfit, colorNames, hasFabric, bg, model:{gender, skin}|null, gender}
    const look = outfitText(opt.outfit, opt.colorNames, opt.hasFabric);
    const bg = BG_TEXT[opt.bg];
    const lines = [];
    if (opt.model) {
      const tone = ['fair', 'wheatish', 'dusky'][opt.model.skinIndex] || 'wheatish';
      lines.push(`Create a photorealistic full-length fashion catalogue photo of a graceful Indian ${opt.gender === 'male' ? 'male' : 'female'} model with ${tone} skin, standing naturally and facing the camera.`);
      lines.push(`The model is wearing ${look}.`);
      if (opt.hasFabric) lines.push('The first image is the garment reference. Use only the garment itself; ignore any mannequin, hands, hangers, tags, people, text or background in it.');
    } else {
      lines.push('You are an expert fashion photo editor for an Indian clothing showroom.');
      lines.push('The FIRST image is the real customer. ' + (opt.hasFabric ? 'The SECOND image shows the garment. It may be folded, on a mannequin, held by hands or photographed with a busy background: use only the garment fabric and design, and ignore mannequins, hands, hangers, price tags, other people, text, logos and background.' : ''));
      lines.push(`Dress the customer from the first image in ${look}.`);
      lines.push('Keep the customer\'s face, facial features, expression, skin tone, hairstyle, body shape, height and pose exactly the same — it must clearly be the same real person. Change only the clothing' + (bg ? ' and the background.' : '.'));
    }
    lines.push(bg ? `Background: ${bg}.` : 'Keep the original background exactly as it is.');
    lines.push('Photorealistic result with natural fabric drape, folds, shadows and lighting that match the scene. Show the full body from head to feet in a 3:4 portrait frame. Do not add any text, logos or watermarks.');
    return lines.join('\n');
  }

  return { QUALITY, generate, testKey, buildPrompt, AIError, _findImage: findImage };
})();
