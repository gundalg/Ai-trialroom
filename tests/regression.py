"""AI TrialRoom regression suite.
Runs the real app in Chrome (phone-sized viewport) and walks every flow:
onboarding, OTP, agreement, shop setup + 3 themes, every outfit for both genders,
fabric photos, colour swatches, dress codes, all showrooms, AI models, fallbacks,
face-preservation, save, finish/delete and reset. Fails on any JS error."""
import functools, http.server, os, sys, threading, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
WWW = os.environ.get('WWW') or os.path.join(ROOT, '..', 'app', 'src', 'main', 'assets', 'www')
FX = os.path.join(ROOT, 'fixtures')
OUT = os.path.join(ROOT, 'out'); os.makedirs(OUT, exist_ok=True)
PORT = 8765

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript', '.bin': 'application/octet-stream'}
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Q, directory=WWW))
threading.Thread(target=srv.serve_forever, daemon=True).start()

results, errors = [], []
def check(name, cond, info=''):
    results.append((name, bool(cond), info)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info and not cond else ''), flush=True)

def fx(n): return os.path.join(FX, n)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('response', lambda r: errors.append(f'http {r.status}: {r.url}') if r.status >= 400 and 'generativelanguage.googleapis.com' not in r.url else None)
    pg.add_init_script("window.addEventListener('DOMContentLoaded',()=>{ try { GENDER.disabled = true; } catch (e) {} });")
    pg.goto(f'http://127.0.0.1:{PORT}/index.html'); pg.wait_for_load_state('networkidle')
    PW = 'Gundal@2026'
    def unlock(pw=PW):
        pg.wait_for_selector('#s-pin.active'); pg.fill('#pin1', pw); pg.click('#btnPin')
    def cust_next():
        pg.click('#btnCustNext')
        pg.wait_for_function("document.querySelector('.screen.active').id!=='s-customer' || (document.getElementById('custErr').textContent.length>0 && !document.getElementById('btnCustNext').disabled)", timeout=90000)
    CODE_FOR = {'suit': 'bizformal', 'suit3': 'boardroom', 'tux': 'blacktie', 'shirt': 'office', 'blazer': 'bizcasual', 'sherwani': 'ethnic', 'kurta': 'ethnic'}
    act = lambda: pg.evaluate("document.querySelector('.screen.active').id")
    shot = lambda n: pg.screenshot(path=os.path.join(OUT, n + '.png'), full_page=True)

    # ---------- onboarding: shop owner ----------
    shot('01_splash'); pg.click('#btnStart'); check('splash -> role', act() == 's-role')
    shot('02_role'); pg.click('#roleOwner'); check('role -> phone', act() == 's-phone')
    pg.fill('#phone', '12345'); pg.click('#btnSendOtp'); check('rejects short phone', 'valid' in pg.inner_text('#phoneErr'))
    pg.fill('#phone', '5123456789'); pg.click('#btnSendOtp'); check('rejects number starting with 5', 'valid' in pg.inner_text('#phoneErr'))
    pg.fill('#phone', '+91 98765 43210'); check('pasted +91 number cleaned', pg.input_value('#phone') == '9876543210')
    pg.fill('#phone', '09876543210'); check('leading 0 removed', pg.input_value('#phone') == '9876543210')
    pg.click('#btnSendOtp'); check('OTP box shown', pg.is_visible('#otpBox'))
    code = pg.evaluate("document.getElementById('otpNote').textContent.match(/\\d{6}/)[0]")
    wrong = '000000' if code != '000000' else '111111'
    pg.fill('#otp', wrong); pg.click('#btnVerify'); check('wrong OTP rejected', 'not correct' in pg.inner_text('#otpErr') and act() == 's-phone')
    check('resend disabled during countdown', pg.is_disabled('#btnResend'))
    shot('03_otp'); pg.fill('#otp', code); pg.wait_for_timeout(300); check('correct OTP -> agreement', act() == 's-consent')
    shot('04_agreement'); pg.click('#btnAgree'); check('agreement needs all ticks', 'tick all' in pg.inner_text('#consentErr'))
    boxes = pg.query_selector_all('.cbx'); boxes[0].check(); boxes[1].check(); pg.click('#btnAgree'); check('2 of 3 ticks still blocked', act() == 's-consent')
    boxes[2].check(); pg.click('#btnAgree'); check('agreement -> create app password', act() == 's-pin' and 'Create' in pg.inner_text('#pinTitle'))
    shot('04b_password')
    pg.fill('#pin1', 'abc'); pg.click('#btnPin'); check('password needs 4+ characters', '4 characters' in pg.inner_text('#pinErr'))
    pg.fill('#pin1', '1234'); pg.fill('#pin2', '1234'); pg.click('#btnPin'); check('too-easy password refused', 'easy to guess' in pg.inner_text('#pinErr'))
    pg.fill('#pin1', PW); pg.fill('#pin2', PW + 'x'); pg.click('#btnPin'); check('passwords must match', 'not the same' in pg.inner_text('#pinErr'))
    pg.fill('#pin2', PW); pg.click('#btnPin'); pg.wait_for_selector('#s-shop.active'); check('password saved -> shop setup', act() == 's-shop')
    st = pg.evaluate('ATR.state().pin'); check('only a salted hash is stored, never the password', st and PW not in json.dumps(pg.evaluate('ATR.state()')) and len(st['salt']) > 10 and st['iter'] >= 100000)
    pg.click('#btnShopSave'); check('shop name required', 'shop name' in pg.inner_text('#shopErr'))
    pg.fill('#shopName', 'Sri Lakshmi Silks'); pg.fill('#shopAddr', 'abc'); pg.click('#btnShopSave'); check('address required', 'address' in pg.inner_text('#shopErr'))
    pg.fill('#shopAddr', '12, Chickpet Main Road, Bengaluru 560053')
    pg.set_input_files('#logoFile', fx('not_image.txt')); pg.wait_for_timeout(300); check('non-image logo rejected', pg.is_hidden('#logoPrev'))
    pg.set_input_files('#logoFile', fx('shop_logo.png')); pg.wait_for_selector('#logoPrev:not(.hidden)'); check('logo uploaded', True)
    for t in ['peacock', 'rose', 'maroon']:
        pg.click(f'.theme-card[data-t={t}]'); check(f'theme {t} applied', pg.evaluate('document.body.dataset.theme') == t)
        shot(f'05_theme_{t}')
    pg.click('#btnShopSave'); pg.wait_for_timeout(300); check('shop saved -> home', act() == 's-home')
    check('home shows shop name', pg.inner_text('#homeTitle') == 'Sri Lakshmi Silks')
    check('Gundal "Developed by" footer', 'Developed by' in pg.inner_text('.brandfoot') and pg.evaluate("document.querySelector('.brandfoot img').naturalWidth") > 0)
    shot('06_home')

    # ---------- try-on helper ----------
    def trial(gender, photo=None, model=None, outfit=None, fabric=None, code=None, colors=None, bg=None, multi=False, tag=''):
        if act() == 's-result': pg.click('#btnEdit')
        if act() == 's-outfit': pg.click('#s-outfit [data-back]')
        if act() == 's-home': pg.click('#btnNewTrial')
        assert act() == 's-customer', act()
        pg.evaluate("ATR.temp().src=null")
        pg.click('#gMale' if gender == 'male' else '#gFemale')
        if photo:
            pg.set_input_files('#photoFile', fx(photo)); pg.wait_for_selector('#photoPrev:not(.hidden)', timeout=8000)
        if model is not None: pg.click(f'.model[data-i="{model}"]')
        cust_next(); assert act() == 's-outfit', 'customer step blocked: ' + pg.inner_text('#custErr')
        if gender == 'male' and not code and outfit: code = CODE_FOR[outfit]
        if code: pg.click(f'#codes .chip[data-c={code}]')
        if outfit: pg.click(f'#outfits .chip[data-o={outfit}]')
        if fabric: pg.set_input_files('#garFile', fx(fabric)); pg.wait_for_selector('#garPrev:not(.hidden)')
        pg.click('#btnOutfitNext')
        for part, col in (colors or {}).items():
            pg.click(f'.part[data-p={part}]'); pg.click(f'.sw[data-h="{col}"]')
        if multi != pg.is_checked('#multi'): pg.click('#multi')
        pg.click('#btnColorsNext')
        if bg: pg.click(f'.bgc[data-b={bg}]')
        pg.click('#btnGenerate')
        pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=60000)
        dims = pg.evaluate("(async()=>{const i=document.getElementById('resultImg');await i.decode();return [i.naturalWidth,i.naturalHeight]})()")
        n = pg.evaluate("ATR.temp().results.length")
        shot('look_' + tag)
        return dims, n

    female_outfits = ['saree', 'lehenga', 'salwar', 'kurti', 'gown', 'officeF']
    male_outfits = ['suit', 'suit3', 'tux', 'shirt', 'blazer', 'sherwani', 'kurta']
    fbgs = ['silk', 'bridal', 'studio', 'original', 'silk', 'bridal']
    mbgs = ['tailor', 'corporate', 'studio', 'original', 'tailor', 'corporate', 'studio']

    for i, o in enumerate(female_outfits):
        d, n = trial('female', photo='cust_female_plain.jpg', outfit=o, bg=fbgs[i], tag=f'F_{o}')
        check(f'female photo · {o} · {fbgs[i]}', d == [900, 1200], d)
    for i, o in enumerate(male_outfits):
        d, n = trial('male', photo='cust_male_plain.jpg', outfit=o, bg=mbgs[i], tag=f'M_{o}')
        check(f'male photo · {o} · {mbgs[i]}', d == [900, 1200], d)

    # sarees with fabric photos + colour swatches + 4-look comparison
    d, n = trial('female', photo='cust_female_plain.jpg', outfit='saree', fabric='saree_red_butti.jpg', colors={'blouse': '#127a78'}, bg='silk', multi=True, tag='saree_fabric_red')
    check('saree from fabric photo + 3 comparison looks', d == [900, 1200] and n == 4, (d, n))
    d, n = trial('female', photo='cust_female_plain.jpg', outfit='saree', fabric='saree_green_check.jpg', bg='bridal', tag='saree_fabric_green')
    check('saree green check fabric', d == [900, 1200])
    for col in ['#c8102e', '#0b6e8c', '#d6247a', '#f3d23b', '#141414', '#f8f8f6']:
        d, n = trial('female', photo='cust_female_plain.jpg', outfit='saree', colors={'body': col}, bg='silk', tag='saree_' + col[1:])
        check(f'saree colour {col}', d == [900, 1200])
    # suits & shirts with fabric and colour combinations
    d, n = trial('male', photo='cust_male_plain.jpg', outfit='suit', fabric='suit_navy_stripe.jpg', colors={'shirt': '#87c2e8', 'tie': '#6e0f2d'}, bg='tailor', multi=True, tag='suit_fabric')
    check('suit from fabric photo + comparisons', d == [900, 1200] and n == 4, (d, n))
    d, n = trial('male', photo='cust_male_plain.jpg', outfit='shirt', fabric='shirt_blue_check.jpg', colors={'pant': '#b29d6c', 'tie': 'none'}, bg='corporate', tag='shirt_fabric_notie')
    check('shirt fabric, khaki pant, no tie', d == [900, 1200])
    for sc, pc in [('#f8f8f6', '#141414'), ('#f2a3bd', '#1a2547'), ('#a8dcc4', '#7d8087')]:
        d, n = trial('male', photo='cust_male_plain.jpg', outfit='shirt', colors={'shirt': sc, 'pant': pc}, bg='studio', tag=f'shirt_{sc[1:]}_{pc[1:]}')
        check(f'shirt {sc} + pant {pc}', d == [900, 1200])
    # every official dress code
    for c in ['bizformal', 'bizcasual', 'office', 'boardroom', 'blacktie', 'ethnic']:
        d, n = trial('male', photo='cust_male_plain.jpg', code=c, bg='corporate', tag='code_' + c)
        check(f'dress code {c}', d == [900, 1200])
    # AI models (no customer photo) – 3 skin tones x 2 genders
    for g in ['female', 'male']:
        for m in range(3):
            d, n = trial(g, model=m, outfit='saree' if g == 'female' else 'suit', bg='silk' if g == 'female' else 'tailor', tag=f'model_{g}_{m}')
            check(f'AI model {g} #{m}', d == [900, 1200])
    # hard photos
    d, n = trial('male', photo='cust_male_busy.jpg', outfit='blazer', bg='tailor', tag='busy_bg')
    check('busy background photo', d == [900, 1200])
    d, n = trial('female', photo='cust_female_halfbody.jpg', outfit='kurti', bg='studio', tag='half_body')
    check('half-body photo', d == [900, 1200])
    pg.goto(f'http://127.0.0.1:{PORT}/index.html'); pg.click('#btnStart'); unlock(); pg.wait_for_selector('#s-home.active'); pg.click('#btnNewTrial')
    pg.set_input_files('#photoFile', fx('tiny.jpg')); pg.wait_for_timeout(500); check('too-small photo rejected', 'too small' in pg.inner_text('#custErr'))
    cust_next(); check('cannot continue without photo/model', act() == 's-customer')

    # fallback when the AI model cannot load
    pg.evaluate("TR.disableAI=true")
    d, n = trial('female', photo='cust_female_plain.jpg', outfit='saree', bg='silk', tag='fallback_noAI')
    check('works without AI segmentation (fallback)', d == [900, 1200])
    pg.evaluate("TR.disableAI=false")

    import base64; import base64 as _b64; B64 = base64.b64encode(open(fx('cust_female_plain.jpg'), 'rb').read()).decode()
    # face preservation: pixels above the neckline must equal the original photo
    diff = pg.evaluate("""(async()=>{
      const img=await new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/jpeg;base64,'+%s});
      const P=await TR.preparePerson({img});
      const st={outfit:'saree',colors:{body:'#c8102e',border:'#d4af37',blouse:'#d4af37'},bg:'original',photoPart:'body',theme:'maroon',shop:null,label:''};
      const out=TR.compose(P,st,{}).getContext('2d').getImageData(0,0,900,1200).data;
      const per=P.person.getContext('2d').getImageData(0,0,900,1200).data, m=P.mask.getContext('2d').getImageData(0,0,900,1200).data;
      let n=0,bad=0; const y1=Math.floor(P.g.neckY-20);
      for(let y=Math.max(160,Math.floor(P.g.top));y<y1;y++)for(let x=0;x<900;x++){const i=(y*900+x)*4; if(m[i+3]>250){n++; if(Math.abs(out[i]-per[i])+Math.abs(out[i+1]-per[i+1])+Math.abs(out[i+2]-per[i+2])>12)bad++;}}
      return {n,bad,method:P.method};})()""" % json.dumps(B64))
    check('original face pixels preserved', diff['n'] > 1000 and diff['bad'] / diff['n'] < 0.01, diff)
    print('   segmentation method used:', diff['method'])

    # result actions: neckline fit, save, finish (deletes photo)
    pg.fill('#neckAdj', '3'); pg.dispatch_event('#neckAdj', 'change'); pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=30000); check('neckline adjust re-renders', True)
    with pg.expect_download() as dl: pg.click('#btnSave')
    check('save produces jpg', dl.value.suggested_filename.endswith('.jpg'))
    pg.wait_for_function('(ATR.state().looks||[]).length>=1', timeout=10000); check('saved look in recent list', True)
    pg.click('#btnFinish'); pg.click('#modalYes'); pg.wait_for_timeout(300)
    check('finish deletes customer photo', pg.evaluate('ATR.temp().src===null && ATR.temp().P===null') and act() == 's-home')
    shot('07_home_with_looks')
    # android back-button behaviour
    pg.click('#btnSettings'); check('back from settings', pg.evaluate('ATR.back()') and act() == 's-home'); check('back at home exits app', pg.evaluate('ATR.back()') is False)
    # persistence after reload
    pg.reload(); pg.click('#btnStart'); check('app asks for password after restart', act() == 's-pin' and 'Enter your app password' in pg.inner_text('#pinTitle'))
    check('back button cannot skip the password screen', pg.evaluate('ATR.back()') is False and act() == 's-pin')
    pg.fill('#pin1', 'wrongpass'); pg.click('#btnPin'); pg.wait_for_function("document.getElementById('pinErr').textContent.length>0"); check('wrong password refused', '4 tries left' in pg.inner_text('#pinErr') and act() == 's-pin')
    for _ in range(4): pg.fill('#pin1', 'wrongpass'); pg.click('#btnPin'); pg.wait_for_timeout(400)
    check('5 wrong tries -> locked out with countdown', 'Too many wrong tries' in pg.inner_text('#pinErr') and pg.is_disabled('#btnPin'))
    shot('pw_lockout')
    pg.evaluate("ATR.state().pinLockUntil=0"); pg.evaluate("document.getElementById('btnPin').disabled=false")
    unlock(); pg.wait_for_selector('#s-home.active'); check('correct password -> home', act() == 's-home')
    pg.click('#btnNewTrial'); pg.evaluate('ATR_lockNow()'); check('auto-lock shows the password screen', act() == 's-pin')
    unlock(); pg.wait_for_selector('#s-customer.active'); check('after unlocking, returns to the same screen', act() == 's-customer')
    pg.evaluate('ATR.back()')
    pg.click('#btnSettings'); pg.click('#btnChangePin'); check('change password asks for the current one first', 'current password' in pg.inner_text('#pinTitle'))
    unlock(); pg.wait_for_selector('#pin2Box:not(.hidden)'); pg.fill('#pin1', 'Saree#4321'); pg.fill('#pin2', 'Saree#4321'); pg.click('#btnPin'); pg.wait_for_selector('#s-home.active')
    pg.reload(); pg.click('#btnStart'); unlock('Saree#4321'); pg.wait_for_selector('#s-home.active'); check('new password works', act() == 's-home')
    pg.reload(); pg.click('#btnStart'); pg.click('#btnForgot'); check('forgot password -> phone check', act() == 's-phone')
    pg.fill('#phone', '9000000001'); pg.click('#btnSendOtp'); check('reset needs the registered number', 'registered' in pg.inner_text('#phoneErr'))
    pg.fill('#phone', pg.evaluate('ATR.state().phone')); pg.click('#btnSendOtp')
    code = pg.evaluate("document.getElementById('otpNote').textContent.match(/\\d{6}/)[0]"); pg.fill('#otp', code)
    pg.wait_for_selector('#s-pin.active'); check('after phone check, set a new password', 'Create' in pg.inner_text('#pinTitle'))
    pg.fill('#pin1', PW); pg.fill('#pin2', PW); pg.click('#btnPin'); pg.wait_for_selector('#s-home.active'); check('password reset done', act() == 's-home')

    # ---------- individual user ----------
    pg.click('#btnSettings'); pg.click('#btnReset'); pg.click('#modalYes'); check('reset -> splash', act() == 's-splash')
    pg.click('#btnStart'); pg.click('#roleIndividual'); pg.fill('#phone', '9123456780'); pg.click('#btnSendOtp')
    code = pg.evaluate("document.getElementById('otpNote').textContent.match(/\\d{6}/)[0]"); pg.fill('#otp', code); pg.wait_for_timeout(200)
    check('individual agreement wording', 'own photo' in pg.inner_text('#c1'))
    for c in pg.query_selector_all('.cbx'): c.check()
    pg.click('#btnAgree'); pg.fill('#pin1', PW); pg.fill('#pin2', PW); pg.click('#btnPin'); pg.wait_for_selector('#s-home.active'); check('individual: password then home (no shop setup)', act() == 's-home')
    check('individual: no shop header on photo', True)
    d, n = trial('male', photo='cust_male_plain.jpg', outfit='kurta', bg='studio', tag='individual_kurta')
    check('individual try-on', d == [900, 1200])


    # ---------- Real AI draping (Google Gemini) with simulated API answers ----------
    import base64 as _b, re as _re
    AIIMG = _b.b64encode(open(fx('ai_result.jpg'), 'rb').read()).decode()
    calls = []
    mode = {'v': 'ok'}
    def gem(route):
        req = route.request; url = req.url; body = req.post_data or ''
        calls.append((req.method, url, body))
        hdr = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json'}
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers=hdr, body='')
        AQK = 'AQ.TestAuthKey_0123456789abcdefghijklmnopqrstuvwxyz'
        if req.headers.get('x-goog-api-key') == AQK:  # new auth keys: some accounts reject header auth
            return route.fulfill(status=401, headers=hdr, body=json.dumps({'error': {'message': 'Request had invalid authentication credentials.', 'status': 'UNAUTHENTICATED', 'details': [{'reason': 'ACCESS_TOKEN_TYPE_UNSUPPORTED'}]}}))
        if 'key=' + AQK.replace('.', '.') in url and 'x-goog-api-key' not in req.headers: pass
        elif req.headers.get('x-goog-api-key') != 'AIzaTESTKEY0123456789abcdefghijklmnopq':
            return route.fulfill(status=400, headers=hdr, body=json.dumps({'error': {'message': 'API key not valid. Please pass a valid API key.', 'status': 'INVALID_ARGUMENT'}}))
        if '/models?' in url: return route.fulfill(status=200, headers=hdr, body=json.dumps({'models': [{'name': 'models/gemini-2.5-flash-image'}]}))
        m = mode['v']
        if m == 'billing': return route.fulfill(status=403, headers=hdr, body=json.dumps({'error': {'message': 'Billing required', 'status': 'PERMISSION_DENIED'}}))
        if m == 'safety': return route.fulfill(status=200, headers=hdr, body=json.dumps({'promptFeedback': {'blockReason': 'SAFETY'}}))
        if m == 'fallback':
            if ':generateContent' in url: return route.fulfill(status=404, headers=hdr, body=json.dumps({'error': {'message': 'model not found', 'status': 'NOT_FOUND'}}))
            return route.fulfill(status=200, headers=hdr, body=json.dumps({'steps': [{'type': 'model_output', 'content': [{'type': 'image', 'mime_type': 'image/jpeg', 'data': AIIMG}]}]}))
        if m == 'second_model' and 'gemini-2.5-flash-image:' in url:
            return route.fulfill(status=404, headers=hdr, body=json.dumps({'error': {'message': 'not found', 'status': 'NOT_FOUND'}}))
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'candidates': [{'content': {'parts': [{'text': 'Here is the photo'}, {'inlineData': {'mimeType': 'image/jpeg', 'data': AIIMG}}]}, 'finishReason': 'STOP'}]}))
    pg.route('https://generativelanguage.googleapis.com/**', gem)

    def to_bg(gender, photo=None, model=None, outfit=None, fabric=None, cam=False):
        if act() == 's-result': pg.click('#btnEdit')
        if act() == 's-bg': pg.click('#s-bg [data-back]')
        if act() == 's-colors': pg.click('#s-colors [data-back]')
        if act() == 's-outfit': pg.click('#s-outfit [data-back]')
        if act() == 's-home': pg.click('#btnNewTrial')
        pg.evaluate("ATR.temp().src=null")
        pg.click('#gMale' if gender == 'male' else '#gFemale')
        if photo: pg.set_input_files('#photoCam' if cam else '#photoFile', fx(photo)); pg.wait_for_selector('#photoPrev:not(.hidden)')
        if model is not None: pg.click(f'.model[data-i="{model}"]')
        cust_next()
        if gender == 'male' and outfit: pg.click(f'#codes .chip[data-c={CODE_FOR[outfit]}]')
        if outfit: pg.click(f'#outfits .chip[data-o={outfit}]')
        if fabric: pg.set_input_files('#garCam' if cam else '#garFile', fx(fabric)); pg.wait_for_selector('#garPrev:not(.hidden)')
        pg.click('#btnOutfitNext'); pg.click('#btnColorsNext')

    def opens(sel):
        with pg.expect_file_chooser(timeout=5000) as fc: pg.click(sel)
        el = fc.value.element; return el.get_attribute('id'), el.get_attribute('capture')
    for _ in range(8):
        if act() == 's-home' or not pg.evaluate("ATR.back()"): break
    pg.click('#btnNewTrial'); pg.click('#gFemale')
    check('customer: "Choose from gallery" opens the gallery (no camera)', opens('#galBtn') == ('photoFile', None))
    check('customer: "Take live photo" opens the camera', opens('#camBtn') == ('photoCam', 'environment'))
    pg.set_input_files('#photoFile', fx('cust_female_plain.jpg')); pg.wait_for_selector('#photoPrev:not(.hidden)')
    check('after choosing, button says "Change photo"', 'Change photo' in pg.inner_text('#galBtn'))
    cust_next(); pg.click('#outfits .chip[data-o=saree]')
    check('saree: "Choose from gallery" opens the gallery', opens('#garGalBtn') == ('garFile', None))
    check('saree: "Take live photo" opens the camera', opens('#garCamBtn') == ('garCam', 'environment'))
    check('both buttons visible side by side', pg.is_visible('#garGalBtn') and pg.is_visible('#garCamBtn'))
    shot('pick_buttons_saree'); pg.click('#s-outfit [data-back]'); shot('pick_buttons_customer')
    check('live camera button asks for the camera', pg.get_attribute('#photoCam', 'capture') == 'environment' and pg.get_attribute('#garCam', 'capture') == 'environment')
    to_bg('female', photo='cust_female_plain.jpg', outfit='saree')
    check('without a key, Quick preview is the default', pg.evaluate("ATR.temp().mode") == 'quick')
    pg.click('#modeAI'); check('AI mode without key points to Settings', 'Google AI key' in pg.inner_text('#modeNote'))
    pg.click('#btnGenerate'); check('AI without key does not start', act() == 's-bg')
    pg.click('#goAiSetup'); check('opens Settings', act() == 's-settings')
    pg.fill('#aiKey', 'hello'); pg.click('#btnAiSave'); check('rejects text that is not a key', 'does not look like' in pg.inner_text('#aiErr'))
    pg.fill('#aiKey', 'AIzaWRONGKEY0123456789abcdefghijklmnopq'); pg.click('#btnAiSave'); pg.wait_for_function("document.getElementById('aiErr').textContent.length>0")
    check('wrong key reported by Google is refused', 'not valid' in pg.inner_text('#aiErr'))
    pg.fill('#aiKey', ' AIzaTESTKEY0123456789abcdefghijklmnopq '); pg.click('#btnAiSave'); pg.wait_for_function("ATR.state().aiKey")
    check('valid key saved and shown as ready', 'Ready' in pg.inner_text('#aiStatus') and pg.input_value('#aiKey') == '')
    pg.fill('#aiKey', 'AQ.TestAuthKey_0123456789abcdefghijklmnopqrstuvwxyz'); pg.click('#btnAiSave'); pg.wait_for_function("(ATR.state().aiKey||'').startsWith('AQ.')", timeout=15000)
    check('new-format AQ. key accepted (retries with ?key= after 401)', 'Ready' in pg.inner_text('#aiStatus') and any('key=AQ.' in c[1] for c in calls))
    pg.click('.chip[data-q=better]'); check('quality choice saved', pg.evaluate("ATR.state().aiQuality") == 'better'); pg.click('.chip[data-q=standard]')
    pg.click('#s-settings [data-back]'); check('back to showroom step', act() == 's-bg')
    pg.click('#modeAI'); shot('ai_01_mode')

    def run_ai(tag):
        calls.clear(); pg.click('#btnGenerate')
        pg.wait_for_function("!document.getElementById('resultWrap').classList.contains('hidden') || document.querySelector('.screen.active').id==='s-bg'", timeout=30000)
        ok = act() == 's-result'
        dims = pg.evaluate("(async()=>{const i=document.getElementById('resultImg');if(!i.src)return null;await i.decode();return [i.naturalWidth,i.naturalHeight]})()") if ok else None
        shot('ai_' + tag); return ok, dims

    ok, d = run_ai('saree_photo_colours')
    posts = [c for c in calls if c[0] == 'POST']
    b0 = json.loads(posts[0][2]) if posts else {}
    parts = b0.get('contents', [{}])[0].get('parts', [])
    prompt = parts[0].get('text', '') if parts else ''
    check('AI saree on customer photo -> branded 900x1200 result', ok and d == [900, 1200], d)
    check('request sends the customer photo', sum(1 for x in parts if 'inline_data' in x) == 1)
    check('prompt asks to keep the same face and drape a Nivi saree', 'same real person' in prompt and 'Nivi' in prompt and 'maroon silk' in prompt.lower())
    check('uses Gemini 2.5 Flash Image for Standard', 'gemini-2.5-flash-image:generateContent' in posts[0][1])
    check('AI photo works with the AQ. key', any('key=AQ.' in c[1] and ':generateContent' in c[1] for c in calls))
    check('"Try again" shown, neckline slider hidden for AI', pg.is_visible('#btnAgain') and not pg.is_visible('#neckAdj'))

    to_bg('female', photo='cust_female_plain.jpg', outfit='saree', fabric='saree_red_butti.jpg', cam=True)
    ok, d = run_ai('saree_live_photo_fabric')
    b0 = json.loads([c for c in calls if c[0] == 'POST'][0][2]); parts = b0['contents'][0]['parts']; prompt = parts[0]['text']
    check('live photo + saree photo -> AI result', ok and d == [900, 1200], d)
    check('sends both photos (customer + saree)', sum(1 for x in parts if 'inline_data' in x) == 2)
    check('prompt removes mannequin/hands/background from saree photo', 'mannequin' in prompt and 'hands' in prompt and 'EXACTLY the garment' in prompt)
    pg.click('#btnAgain'); pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=30000); check('Try again makes a new AI photo', len([c for c in calls if c[0] == 'POST']) >= 2)

    mode['v'] = 'second_model'; to_bg('male', photo='cust_male_plain.jpg', outfit='suit')
    ok, d = run_ai('suit_second_model'); check('falls back to next model if one is unavailable', ok and any('gemini-3.1-flash-image:generateContent' in c[1] for c in calls))
    mode['v'] = 'fallback'; to_bg('male', photo='cust_male_plain.jpg', outfit='sherwani')
    ok, d = run_ai('sherwani_new_api'); check('works with the newer Interactions API format', ok and d == [900, 1200] and any('/interactions' in c[1] for c in calls))
    mode['v'] = 'ok'; to_bg('female', model=1, outfit='lehenga')
    ok, d = run_ai('ai_model_lehenga'); b0 = json.loads([c for c in calls if c[0] == 'POST'][0][2])
    check('AI model (no customer photo) -> realistic model prompt', ok and 'photorealistic full-length fashion catalogue photo' in b0['contents'][0]['parts'][0]['text'])
    for m, word, tag in [('billing', 'billing', 'err_billing'), ('safety', 'declined', 'err_safety')]:
        mode['v'] = m; to_bg('female', photo='cust_female_plain.jpg', outfit='saree'); ok, d = run_ai(tag)
        check(f'clear message on {m} error, back on showroom step', (not ok) and act() == 's-bg' and word in pg.inner_text('#modeNote'))
    pg.click('#useQuick'); check('one tap to switch to Quick preview after an error', pg.evaluate("ATR.temp().mode") == 'quick')
    mode['v'] = 'ok'; pg.click('#btnGenerate'); pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=30000); check('Quick preview still works', pg.is_visible('#neckAdj'))
    pg.click('#btnSettings') if act() == 's-home' else None
    pg.evaluate("ATR.back()"); pg.evaluate("ATR.back()")


    # ---------- Saree photo: change colour, border stays the same ----------
    FAB = _b64.b64encode(open(fx('saree_red_butti.jpg'), 'rb').read()).decode()
    bt = pg.evaluate("""(async()=>{const i=await new Promise(r=>{const m=new Image();m.onload=()=>r(m);m.src='data:image/jpeg;base64,%s'});
       const t=TR.borderTile(i); if(!t) return null; const [r,g,b]=[1,3,5].map(k=>parseInt(t.avg.slice(k,k+2),16)); return {r,g,b,w:t.width,h:t.height};})()""" % FAB)
    check('finds the gold border in the saree photo', bt and bt['r'] > 180 and bt['g'] > 140 and bt['b'] < 130 and bt['w'] > bt['h'] * 4, bt)
    same = pg.evaluate("""(async()=>{const L=s=>new Promise(r=>{const m=new Image();m.onload=()=>r(m);m.src='data:image/jpeg;base64,'+s});
       const fab=await L('%s'), per=await L('%s'); const P=await TR.preparePerson({img:per});
       const tile=TR.photoTile(fab), border=TR.borderTile(fab), g=P.g, bodyH=g.footY-g.neckY;
       const mk=rc=>TR.compose(P,{outfit:'saree',colors:{body:'x',border:'#000000',blouse:'#d4af37'},fabric:rc?TR.recolorTile(tile,rc):tile,fabricAvg:rc||'#aa1428',photoPart:'body',borderTile:border,bg:'studio',theme:'maroon',shop:null,label:''},{}).getContext('2d');
       const a=mk(null), b=mk('#1a2547');
       const diff=(x0,y0,w,h)=>{const p=a.getImageData(x0,y0,w,h).data,q=b.getImageData(x0,y0,w,h).data;let d=0;for(let i=0;i<p.length;i+=4)d+=Math.abs(p[i]-q[i])+Math.abs(p[i+1]-q[i+1])+Math.abs(p[i+2]-q[i+2]);return d/(p.length/4)};
       const bot=g.footY+bodyH*0.01, bw=bodyH*0.055;
       return {border:diff(Math.round(g.cx-g.hipHalf*0.4),Math.round(bot-bw*0.75),Math.round(g.hipHalf*0.8),Math.max(2,Math.round(bw*0.4))),
               body:diff(Math.round(g.cx+g.hipHalf*0.62),Math.round(g.hipY+bodyH*0.12),Math.round(g.hipHalf*0.3),Math.round(bodyH*0.08))};})()""" % (FAB, B64))
    check('changing saree colour keeps the border identical', same['border'] < 12 and same['body'] > 60, same)

    pg.evaluate("ATR.state().aiKey=null"); pg.evaluate("ATR.temp().mode='quick'")
    if act() != 's-home': pg.evaluate("ATR.back()")
    to_bg('female', photo='cust_female_plain.jpg', outfit='saree', fabric='saree_red_butti.jpg')
    pg.click('#s-bg [data-back]')
    check('border shows as locked to the photo', 'same as photo' in pg.inner_text('.part[data-p=border]'))
    pg.click('.part[data-p=border]'); check('no colour squares for the locked border', pg.is_hidden('#swatches') and 'border stays exactly' in pg.inner_text('#colorHint'))
    pg.click('.part[data-p=body]'); check('saree colour offers "Original" plus colours', pg.is_visible('.sw[data-h=orig]'))
    pg.click('.sw[data-h="#1a2547"]'); check('saree recoloured, photo kept', pg.evaluate("ATR.temp().recolor") == '#1a2547' and pg.evaluate("!!ATR.temp().fabric"))
    shot('recolor_01_colours')
    if not pg.is_checked('#multi'): pg.click('#multi')
    pg.click('#btnColorsNext'); pg.click('.bgc[data-b=silk]'); pg.click('#modeQuick'); pg.click('#btnGenerate'); pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=60000)
    labels = pg.evaluate("ATR.temp().results.map(r=>r.label)")
    check('4 looks, all with the same border', len(labels) == 4 and all('same border' in l for l in labels) and 'Navy' in labels[0], labels)
    shot('recolor_02_result')
    pg.evaluate("ATR.state().aiKey='AQ.TestAuthKey_0123456789abcdefghijklmnopqrstuvwxyz'")
    pg.click('#btnEdit'); pg.click('#btnOutfitNext'); pg.click('#btnColorsNext'); pg.click('#modeAI')
    calls.clear(); mode['v'] = 'ok'; pg.click('#btnGenerate'); pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=30000)
    pr = json.loads([c for c in calls if c[0] == 'POST' and c[2]][0][2])['contents'][0]['parts'][0]['text']
    check('AI told: change only body colour to navy, keep border exactly', 'ONLY its main body colour changed to navy' in pr and 'border must match the saree photo exactly' in pr)
    check('AI result labelled "same border"', 'same border' in pg.evaluate("ATR.temp().results[0].label"))


    # ---------- Men: dress code first, then matching outfits ----------
    for _ in range(8):
        if act() == 's-home' or not pg.evaluate("ATR.back()"): break
    pg.click('#btnNewTrial'); pg.click('#gMale'); pg.click('.model[data-i="0"]'); pg.click('#btnCustNext')
    check('men: outfits hidden until a dress code is chosen', pg.evaluate("document.querySelectorAll('#outfits .chip').length") == 0 and pg.is_disabled('#btnOutfitNext') and 'First choose a dress code' in pg.inner_text('#outfitHint'))
    shot('dresscode_01_first')
    pg.click('#codes .chip[data-c=ethnic]')
    names = pg.evaluate("[...document.querySelectorAll('#outfits .chip')].map(c=>c.dataset.o)")
    check('Ethnic formal shows only sherwani and kurta', sorted(names) == ['kurta', 'sherwani'], names)
    pg.click('#codes .chip[data-c=blacktie]'); names = pg.evaluate("[...document.querySelectorAll('#outfits .chip')].map(c=>c.dataset.o)")
    check('Black tie shows tuxedo first (and suit)', names == ['tux', 'suit'], names)
    check('Next works once code + outfit chosen', not pg.is_disabled('#btnOutfitNext'))
    shot('dresscode_02_chosen')
    pg.click('#s-outfit [data-back]'); pg.click('#gFemale'); pg.click('.model[data-i="0"]'); pg.click('#btnCustNext')
    check('women: no dress-code step', pg.is_hidden('#codeBox') and pg.evaluate("document.querySelectorAll('#outfits .chip').length") == 6)
    pg.click('#s-outfit [data-back]')

    # ---------- Gender check with real photos (on-device face model) ----------
    from skimage import data as _skd
    from PIL import Image as _Im
    _Im.fromarray(_skd.astronaut()).save(os.path.join(OUT, 'real_woman.jpg'), quality=92)
    _Im.fromarray(_skd.camera()).convert('RGB').save(os.path.join(OUT, 'real_man.jpg'), quality=92)
    pg.evaluate("GENDER.disabled=false")
    def upload_real(name):
        pg.evaluate("ATR.temp().src=null")
        pg.set_input_files('#photoFile', os.path.join(OUT, name))
        pg.wait_for_function("ATR.temp().src && ATR.temp().src.img && !ATR.temp().src.checking && ATR.temp().src.check", timeout=90000)
        return pg.evaluate("ATR.temp().src.check")
    pg.click('#gFemale'); r = upload_real('real_man.jpg')
    check("man's photo detected as male", r.get('face') and r.get('gender') == 'male', r)
    check("man's photo blocked in Female section", pg.is_visible('#gBlock') and 'looks like a man' in pg.inner_text('#gBlock'))
    cust_next(); check('cannot continue with the wrong section', act() == 's-customer' and 'does not match' in pg.inner_text('#custErr'))
    shot('gender_01_blocked')
    pg.click('#gSwitch'); check('"Switch to Male" fixes it in one tap', pg.evaluate("ATR.temp().gender") == 'male' and pg.is_hidden('#gBlock') if pg.query_selector('#gBlock') else pg.evaluate("ATR.temp().gender") == 'male')
    cust_next(); check('man in Male section continues', act() == 's-outfit'); pg.click('#s-outfit [data-back]')
    r = upload_real('real_woman.jpg')
    check("woman's photo detected as female", r.get('face') and r.get('gender') == 'female', r)
    check("woman's photo blocked in Male section", pg.is_visible('#gBlock') and 'looks like a woman' in pg.inner_text('#gBlock'))
    pg.click('#gFemale'); check('switching to Female removes the block', pg.query_selector('#gBlock') is None)
    cust_next(); check('woman in Female section continues', act() == 's-outfit'); pg.click('#s-outfit [data-back]')
    pg.click('#gMale'); check('switching back to Male blocks again', pg.is_visible('#gBlock'))
    pg.evaluate("ATR.back()"); pg.click('#btnSettings'); pg.click('#optStrict'); check('owner can turn strict check off', pg.evaluate("ATR.state().genderStrict") is False)
    pg.evaluate("ATR.back()"); pg.click('#btnNewTrial'); check('with strict off, no block', pg.query_selector('#gBlock') is None)
    pg.evaluate("ATR.back()"); pg.click('#btnSettings'); pg.click('#optStrict'); pg.evaluate("ATR.back()")
    pg.evaluate("GENDER.disabled=true")


    # ---------- change colour right on the result screen ----------
    for _ in range(8):
        if act() == 's-home' or not pg.evaluate("ATR.back()"): break
    pg.click('#btnNewTrial'); pg.click('#gFemale'); pg.click('.model[data-i="1"]'); cust_next(); pg.click('#outfits .chip[data-o=saree]')
    pg.set_input_files('#garFile', fx('saree_red_butti.jpg')); pg.wait_for_selector('#garPrev:not(.hidden)')
    pg.click('#btnOutfitNext');
    if pg.is_checked('#multi'): pg.click('#multi')
    pg.click('#btnColorsNext'); pg.click('#modeQuick'); pg.click('#btnGenerate'); pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=60000)
    check('colour bar shown next to the look', pg.is_visible('#qcolors') and pg.evaluate("document.querySelectorAll('#qcSw button').length") >= 15)
    check('saree border not offered (stays as photo)', pg.query_selector('#qcParts button[data-p=border]') is None and 'border stays the same' in pg.inner_text('#qcNote'))
    before = pg.evaluate("document.getElementById('resultImg').src.length")
    src0 = pg.evaluate("document.getElementById('resultImg').src")
    pg.click('#qcSw button[data-h="#0b6e8c"]'); pg.wait_for_function("document.getElementById('resultImg').src !== %s" % json.dumps(src0), timeout=30000)
    check('tap a colour -> look changes instantly on the same screen', act() == 's-result' and 'Peacock' in pg.evaluate("ATR.temp().results[0].label") and pg.evaluate("ATR.temp().recolor") == '#0b6e8c')
    check('selected colour is marked', pg.get_attribute('#qcSw button[data-h="#0b6e8c"]', 'class') == 'on')
    shot('qc_female_saree')
    pg.click('#qcParts button[data-p=blouse]'); src1 = pg.evaluate("document.getElementById('resultImg').src")
    pg.click('#qcSw button[data-h="#d6247a"]'); pg.wait_for_function("document.getElementById('resultImg').src !== %s" % json.dumps(src1), timeout=30000)
    check('blouse colour changes too', pg.evaluate("ATR.temp().colors.blouse") == '#d6247a')
    pg.click('#qcSw button[data-h="#d6247a"]') if False else None
    for _ in range(8):
        if act() == 's-home' or not pg.evaluate("ATR.back()"): break
    pg.click('#btnNewTrial'); pg.click('#gMale'); pg.click('.model[data-i="0"]'); cust_next(); pg.click('#codes .chip[data-c=bizformal]'); pg.click('#btnOutfitNext'); pg.click('#btnColorsNext'); pg.click('#modeQuick'); pg.click('#btnGenerate'); pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=60000)
    parts = pg.evaluate("[...document.querySelectorAll('#qcParts button')].map(b=>b.dataset.p)")
    check('men: suit, shirt and tie colours offered', parts == ['suit', 'shirt', 'tie'], parts)
    check('men get suiting colours (navy, charcoal, black…)', all(pg.query_selector(f'#qcSw button[data-h="{c}"]') for c in ['#1a2547', '#36393f', '#141414']))
    src2 = pg.evaluate("document.getElementById('resultImg').src"); pg.click('#qcSw button[data-h="#36393f"]'); pg.wait_for_function("document.getElementById('resultImg').src !== %s" % json.dumps(src2), timeout=30000)
    check('men: suit colour changes instantly', pg.evaluate("ATR.temp().colors.suit") == '#36393f' and 'Charcoal' in pg.evaluate("ATR.temp().results[0].label"))
    pg.click('#qcParts button[data-p=shirt]'); check('shirt colours offered', pg.query_selector('#qcSw button[data-h="#87c2e8"]') is not None)
    shot('qc_male_suit')


    # ---------- Google Play edition: 1 month free, then ₹365/year (simulated Google Play) ----------
    ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ctx2.add_init_script("""window.__pay={state:'loading',price:'',trial:'',ready:false,message:''};
      window.AndroidBridge={billingRequired:()=>true,billingStatus:()=>JSON.stringify(window.__pay),
        billingBuy:()=>{window.__bought=(window.__bought||0)+1;},billingRefresh:()=>{window.__refreshed=(window.__refreshed||0)+1;}};
      window.addEventListener('DOMContentLoaded',()=>{ try { GENDER.disabled = true; } catch (e) {} });""")
    q = ctx2.new_page()
    q.on('pageerror', lambda e: errors.append('pageerror(play): ' + str(e)))
    q.goto(f'http://127.0.0.1:{PORT}/index.html'); q.wait_for_load_state('networkidle')
    qa = lambda: q.evaluate("document.querySelector('.screen.active').id")
    q.click('#btnStart'); q.click('#roleOwner'); q.fill('#phone', '9876500001'); q.click('#btnSendOtp')
    q.fill('#otp', q.evaluate("document.getElementById('otpNote').textContent.match(/\\d{6}/)[0]")); q.wait_for_timeout(200)
    for c in q.query_selector_all('.cbx'): c.check()
    q.click('#btnAgree'); q.fill('#pin1', PW); q.fill('#pin2', PW); q.click('#btnPin')
    q.wait_for_selector('#s-paywall.active'); check('Play edition: subscription screen after sign-up', qa() == 's-paywall')
    check('while connecting, says so', 'Connecting to Google Play' in q.inner_text('#payStatus'))
    q.evaluate("window.__pay={state:'none',price:'₹365.00',trial:'P1M',ready:true,message:''}"); q.wait_for_timeout(1200)
    check('offer shows "first month is free" and ₹1 a day', 'first month is free' in q.inner_text('#payTitle') and '₹1 a day' in q.inner_text('#payPrice') and '₹365.00' in q.inner_text('#payTerms'))
    check('clear cancellation terms shown', 'Cancel anytime' in q.inner_text('#payTerms') and 'pay nothing' in q.inner_text('#payTerms'))
    shot_q = lambda n: q.screenshot(path=os.path.join(OUT, n + '.png'), full_page=True)
    shot_q('pay_01_offer')
    check('back button cannot skip the subscription screen', q.evaluate('ATR.back()') is False and qa() == 's-paywall')
    q.click('#btnSubscribe'); check('"Start my free month" opens Google Play purchase', q.evaluate('window.__bought') == 1)
    q.evaluate("window.__pay={state:'pending',price:'₹365.00',trial:'P1M',ready:true,message:''}"); q.wait_for_timeout(1200)
    check('pending payment explained, button paused', 'being processed' in q.inner_text('#payStatus') and q.is_disabled('#btnSubscribe'))
    q.evaluate("window.__pay={state:'active',price:'₹365.00',trial:'P1M',ready:true,message:''}")
    q.wait_for_selector('#s-shop.active', timeout=5000); check('after subscribing -> shop setup continues', qa() == 's-shop')
    q.fill('#shopName', 'Gundal Silks'); q.fill('#shopAddr', 'Avenue Road, Bengaluru 560002'); q.click('#btnShopSave'); q.wait_for_selector('#s-home.active')
    q.click('#btnSettings'); check('Settings shows active subscription + manage link', 'Active' in q.inner_text('#subInfo') and '₹1 a day' in q.inner_text('#subInfo') and q.is_visible('#subManage'))
    href = q.get_attribute('#subManage', 'href'); check('manage link goes to Google Play subscriptions', 'play.google.com/store/account/subscriptions' in href and 'com.gundal.aitrialroom' in href)
    q.evaluate("ATR.back()")
    q.evaluate("window.__pay={state:'none',price:'₹365.00',trial:'',ready:true,message:''}")
    q.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
    q.wait_for_selector('#s-paywall.active', timeout=5000); check('expired/cancelled subscription -> back to subscription screen', qa() == 's-paywall')
    q.wait_for_timeout(1200)
    check('no second free month: offers ₹365/year instead', 'Subscribe for ₹365.00 a year' in q.inner_text('#btnSubscribe'))
    shot_q('pay_02_renew')
    q.click('#btnRestore'); check('"Restore" re-checks Google Play', q.evaluate('window.__refreshed') >= 1)
    q.evaluate("window.__pay={state:'unavailable',price:'',trial:'',ready:false,message:''}"); q.wait_for_timeout(1200)
    check('no Google Play on phone -> clear message, button off', 'install AI TrialRoom from the Google Play Store' in q.inner_text('#payStatus') and q.is_disabled('#btnSubscribe'))
    ctx2.close()
    check('test edition (direct install) never asks for a subscription', pg.evaluate("ATR.state().role") is not None and pg.query_selector('#s-paywall.active') is None)


    # ---------- Staff test version: TEST banner, watermark, reminder ----------
    check('normal version shows no TEST marking', pg.query_selector('#staffBanner') is None)
    ctx3 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ctx3.add_init_script("""window.AndroidBridge={billingRequired:()=>false,staffInfo:()=>JSON.stringify({test:true,expires:'2026-12-31',expiresAt:(window.__exp||Date.parse('2026-12-31T23:59:59+05:30'))})};
      window.addEventListener('DOMContentLoaded',()=>{ try { GENDER.disabled = true; } catch (e) {} });""")
    s3 = ctx3.new_page(); s3.on('pageerror', lambda e: errors.append('pageerror(staff): ' + str(e)))
    s3.goto(f'http://127.0.0.1:{PORT}/index.html'); s3.wait_for_load_state('networkidle')
    check('staff version: banner on screen', s3.is_visible('#staffBanner') and 'TEST VERSION' in s3.inner_text('#staffBanner') and '31 Dec 2026' in s3.inner_text('#staffBanner'))
    check('staff version: splash says TEST VERSION', 'TEST VERSION' in s3.inner_text('.splash'))
    s3.screenshot(path=os.path.join(OUT, 'staff_01_splash.png'))
    s3.click('#btnStart'); s3.click('#roleIndividual'); s3.fill('#phone', '9876500002'); s3.click('#btnSendOtp')
    s3.fill('#otp', s3.evaluate("document.getElementById('otpNote').textContent.match(/\\d{6}/)[0]")); s3.wait_for_timeout(200)
    for cb in s3.query_selector_all('.cbx'): cb.check()
    s3.click('#btnAgree'); s3.fill('#pin1', PW); s3.fill('#pin2', PW); s3.click('#btnPin'); s3.wait_for_selector('#s-home.active')
    check('staff version: no subscription screen', s3.evaluate("document.querySelector('.screen.active').id") == 's-home')
    s3.click('#btnNewTrial'); s3.click('#gFemale'); s3.click('.model[data-i="1"]'); s3.click('#btnCustNext'); s3.wait_for_selector('#s-outfit.active')
    s3.click('#btnOutfitNext'); s3.click('#btnColorsNext'); s3.click('#modeQuick'); s3.click('#btnGenerate'); s3.wait_for_selector('#resultWrap:not(.hidden)', timeout=60000)
    check('staff version: banner does not cover the buttons', s3.evaluate("(()=>{const b=document.getElementById('btnFinish').getBoundingClientRect(),s=document.getElementById('staffBanner').getBoundingClientRect();window.scrollTo(0,document.body.scrollHeight);const b2=document.getElementById('btnFinish').getBoundingClientRect();return b2.bottom<=s.top+1})()"))
    wm = s3.evaluate("""(async()=>{const P=await TR.preparePerson({model:{gender:'female',skin:TR.SKINS[0]}});
      const st={outfit:'saree',colors:{body:'#6e0f2d',border:'#d4af37',blouse:'#d4af37'},bg:'studio',photoPart:'body',theme:'maroon',shop:null,label:''};
      const a=TR.compose(P,st,{}).getContext('2d').getImageData(0,0,900,1200).data; TR.setStaff(false);
      const b=TR.compose(P,st,{}).getContext('2d').getImageData(0,0,900,1200).data; TR.setStaff(true);
      let d=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])>8)d++;return d/(a.length/4);})()""")
    check('staff version: every photo carries the TEST VERSION watermark', wm > 0.05, wm)
    s3.screenshot(path=os.path.join(OUT, 'staff_02_result.png'), full_page=True)
    ctx3.close()
    ctx4 = b.new_context(viewport={'width': 390, 'height': 844})
    ctx4.add_init_script("window.AndroidBridge={billingRequired:()=>false,staffInfo:()=>JSON.stringify({test:true,expires:'soon',expiresAt:Date.now()+3*86400000-3600000})};")
    s4 = ctx4.new_page(); s4.goto(f'http://127.0.0.1:{PORT}/index.html'); s4.wait_for_timeout(1500)
    check('staff version: reminder when 7 days or less remain', 'ends in 3 days' in s4.inner_text('#toast'))
    ctx4.close()

    # ---------- every screen size: small phone, phone, tablet, computer ----------
    for w, h, tag in [(320, 640, 'phone_small'), (390, 844, 'phone'), (800, 1280, 'tablet'), (1366, 768, 'computer'), (844, 390, 'phone_landscape')]:
        pg.set_viewport_size({'width': w, 'height': h})
        bad = []
        for scr in ['home', 'customer', 'settings']:
            for _ in range(8):
                if act() == 's-home' or not pg.evaluate("ATR.back()"): break
            if scr == 'customer': pg.click('#btnNewTrial')
            if scr == 'settings': pg.click('#btnSettings')
            pg.wait_for_timeout(150)
            if pg.evaluate('document.documentElement.scrollWidth') > w: bad.append(scr)
            if scr == 'customer': shot(f'size_{tag}_customer')
        check(f'no sideways scrolling at {w}x{h} ({tag})', not bad, bad)
    for _ in range(8):
        if act() == 's-home' or not pg.evaluate("ATR.back()"): break
    pg.set_viewport_size({'width': 1366, 'height': 768}); pg.click('#btnNewTrial'); pg.click('#gFemale'); pg.click('.model[data-i="1"]'); cust_next(); pg.click('#btnOutfitNext'); pg.click('#btnColorsNext'); pg.click('#modeQuick'); pg.click('#btnGenerate')
    pg.wait_for_selector('#resultWrap:not(.hidden)', timeout=60000); pg.wait_for_timeout(300); shot('size_computer_result')
    box = pg.evaluate("(()=>{const i=document.getElementById('resultImg').getBoundingClientRect(),b=document.getElementById('btnSave').getBoundingClientRect();return {img:[i.left,i.right,i.bottom],btn:[b.left,b.top]}})()")
    check('computer: result photo and buttons side by side', box['btn'][0] > box['img'][1] - 5 and box['img'][2] <= 768 + 400, box)
    pg.set_viewport_size({'width': 390, 'height': 844})
    b.close()

srv.shutdown()
real = [e for e in errors if 'favicon' not in e]
check('zero JavaScript errors during the whole run', not real, real[:5])
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
json.dump({'passed': len(results) - len(fails), 'total': len(results), 'results': results}, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
sys.exit(1 if fails else 0)
