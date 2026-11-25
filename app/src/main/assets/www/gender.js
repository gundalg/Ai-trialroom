/* AI TrialRoom — on-device gender check of the customer photo (face-api, MIT licence).
   Runs fully on the phone; the photo is never uploaded for this check. */
'use strict';
const GENDER = (() => {
  let ready = null;
  function load() {
    if (ready) return ready;
    ready = (async () => {
      if (typeof faceapi === 'undefined') return false;
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('fa');
        await faceapi.nets.ageGenderNet.loadFromUri('fa');
        return true;
      } catch (e) { console.warn('face model not loaded', e && e.message); ready = null; return false; }
    })();
    return ready;
  }
  function scaled(img, max) {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  }
  async function detect(c, size) {
    return faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: 0.4 })).withAgeAndGender();
  }
  // Returns {face:false} | {face:true, gender:'male'|'female', p, faces} | {skipped:true} | {error:true}
  async function check(img) {
    if (GENDER.disabled) return { skipped: true };
    if (!await load()) return { error: true };
    try {
      let c = scaled(img, 800), d = await detect(c, 416);
      if (!d.length) { c = scaled(img, 1400); d = await detect(c, 608); }          // small faces in full-length photos
      if (!d.length) {                                                             // try the top half (head area), enlarged
        const top = document.createElement('canvas'), h = Math.round(img.height * 0.5);
        const s = Math.min(1, 1200 / Math.max(img.width, h)); top.width = Math.round(img.width * s); top.height = Math.round(h * s);
        top.getContext('2d').drawImage(img, 0, 0, img.width, h, 0, 0, top.width, top.height); d = await detect(top, 608);
      }
      if (!d.length) return { face: false };
      const area = x => x.detection.box.width * x.detection.box.height;
      const main = d.slice().sort((a, b) => area(b) - area(a))[0];
      return { face: true, gender: main.gender, p: main.genderProbability, faces: d.length };
    } catch (e) { console.warn('gender check failed', e && e.message); return { error: true }; }
  }
  return { load, check, disabled: false };
})();
