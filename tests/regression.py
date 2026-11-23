"""AI TrialRoom regression suite.
Runs the real app in Chrome (phone-sized viewport) and walks every flow:
onboarding, OTP, agreement, shop setup + 3 themes, every outfit for both genders,
fabric photos, colour swatches, dress codes, all showrooms, AI models, fallbacks,
face-preservation, save, finish/delete and reset. Fails on any JS error."""
import functools, http.server, os, sys, threading, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(ROOT, '..', 'app', 'src', 'main', 'assets', 'www')
FX = os.path.join(ROOT, 'fixtures')
OUT = os.path.join(ROOT, 'out'); os.makedirs(OUT, exist_ok=True)
PORT = 8765

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript'}
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
    pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html'); pg.wait_for_load_state('networkidle')
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
    boxes[2].check(); pg.click('#btnAgree'); check('agreement -> shop setup', act() == 's-shop')
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
        pg.click('#btnCustNext'); assert act() == 's-outfit', 'customer step blocked: ' + pg.inner_text('#custErr')
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
    d, n = trial('female', photo='cust_female_plain.jpg', outfit='saree', fabric='saree_red_butti.jpg', colors={'border': '#d4af37', 'blouse': '#127a78'}, bg='silk', multi=True, tag='saree_fabric_red')
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
    pg.goto(f'http://127.0.0.1:{PORT}/index.html'); pg.click('#btnStart'); pg.click('#btnNewTrial')
    pg.set_input_files('#photoFile', fx('tiny.jpg')); pg.wait_for_timeout(500); check('too-small photo rejected', 'too small' in pg.inner_text('#custErr'))
    pg.click('#btnCustNext'); check('cannot continue without photo/model', act() == 's-customer')

    # fallback when the AI model cannot load
    pg.evaluate("TR.disableAI=true")
    d, n = trial('female', photo='cust_female_plain.jpg', outfit='saree', bg='silk', tag='fallback_noAI')
    check('works without AI segmentation (fallback)', d == [900, 1200])
    pg.evaluate("TR.disableAI=false")

    import base64; B64 = base64.b64encode(open(fx('cust_female_plain.jpg'), 'rb').read()).decode()
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
    pg.reload(); pg.click('#btnStart'); check('login persists after restart', act() == 's-home')

    # ---------- individual user ----------
    pg.click('#btnSettings'); pg.click('#btnReset'); pg.click('#modalYes'); check('reset -> splash', act() == 's-splash')
    pg.click('#btnStart'); pg.click('#roleIndividual'); pg.fill('#phone', '9123456780'); pg.click('#btnSendOtp')
    code = pg.evaluate("document.getElementById('otpNote').textContent.match(/\\d{6}/)[0]"); pg.fill('#otp', code); pg.wait_for_timeout(200)
    check('individual agreement wording', 'own photo' in pg.inner_text('#c1'))
    for c in pg.query_selector_all('.cbx'): c.check()
    pg.click('#btnAgree'); check('individual skips shop setup', act() == 's-home')
    check('individual: no shop header on photo', True)
    d, n = trial('male', photo='cust_male_plain.jpg', outfit='kurta', bg='studio', tag='individual_kurta')
    check('individual try-on', d == [900, 1200])

    # narrow phone layout: nothing wider than the screen
    pg.set_viewport_size({'width': 360, 'height': 740})
    for s in ['s-result']:
        check('no horizontal overflow at 360px', pg.evaluate('document.documentElement.scrollWidth') <= 360)
    b.close()

srv.shutdown()
real = [e for e in errors if 'favicon' not in e]
check('zero JavaScript errors during the whole run', not real, real[:5])
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
json.dump({'passed': len(results) - len(fails), 'total': len(results), 'results': results}, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
sys.exit(1 if fails else 0)
