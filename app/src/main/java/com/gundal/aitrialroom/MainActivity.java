package com.gundal.aitrialroom;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Debug;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.view.WindowManager;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import android.view.WindowInsets;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileReader;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * AI TrialRoom — native shell. The app UI and the on-device AI run from bundled assets,
 * served from a private https origin so WebAssembly and storage work offline.
 * Customer photos never leave the phone.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int REQ_FILE = 41, REQ_PERM = 42;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private BillingManager billing;
    private Uri cameraUri;
    private File cameraFile;
    private final Map<String, String> httpResults = new ConcurrentHashMap<>();
    private final AtomicInteger httpIds = new AtomicInteger(1);
    private final ExecutorService pool = Executors.newFixedThreadPool(2);

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Security: refuse to run under a debugger or hooking framework; block screenshots by default
        if (isTampered()) {
            Toast.makeText(this, "AI TrialRoom can't run on this device for security reasons.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        WebView.setWebContentsDebuggingEnabled(false);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        // Edge-to-edge on every Android version (Android 15+ enforces it): the maroon background shows behind
        // the status and navigation bars, and the app content is kept inside the safe area using window insets.
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT < 35) {
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
        }

        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#6e0f2d"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#fbf5ec"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                l = bars.left; t = bars.top; r = bars.right; b = Math.max(bars.bottom, ime.bottom);
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
            if (lp.leftMargin != l || lp.topMargin != t || lp.rightMargin != r || lp.bottomMargin != b) {
                lp.setMargins(l, t, r, b);
                web.setLayoutParams(lp);
            }
            return insets;
        });

        // Android 13+ back gesture (required behaviour when targeting Android 16)
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        // Google Play edition: subscription (1 month free, then yearly)
        if (BuildConfig.PLAY_EDITION) billing = new BillingManager(this);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                if (path.contains("..")) return notFound();
                try {
                    InputStream in = getAssets().open("www" + path);
                    WebResourceResponse r = new WebResourceResponse(mime(path), mime(path).startsWith("text") || path.endsWith(".js") ? "utf-8" : null, in);
                    Map<String, String> h = new HashMap<>();
                    h.put("Cache-Control", "no-cache");
                    h.put("Access-Control-Allow-Origin", "https://" + HOST);
                    r.setResponseHeaders(h);
                    return r;
                } catch (Exception e) {
                    return notFound();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                boolean wantCamera = p != null && p.isCaptureEnabled();
                Intent camera = wantCamera ? cameraIntent() : null;
                try {
                    if (camera != null) {
                        startActivityForResult(camera, REQ_FILE);          // "Take live photo" button
                    } else {
                        cameraFile = null; cameraUri = null;
                        startActivityForResult(galleryIntent(), REQ_FILE);  // "Choose from gallery" button
                    }
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "No photo app found", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("https://" + HOST + "/index.html");
    }

    /** Opens the phone's gallery / photo picker directly. */
    private Intent galleryIntent() {
        if (Build.VERSION.SDK_INT >= 33) {
            Intent pick = new Intent(MediaStore.ACTION_PICK_IMAGES);
            pick.setType("image/*");
            if (pick.resolveActivity(getPackageManager()) != null) return pick;
        }
        Intent g = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        g.setType("image/*");
        if (g.resolveActivity(getPackageManager()) != null) return g;
        Intent c = new Intent(Intent.ACTION_GET_CONTENT);
        c.addCategory(Intent.CATEGORY_OPENABLE);
        c.setType("image/*");
        return Intent.createChooser(c, "Choose photo");
    }

    /** Camera intent that writes the photo into the app's private cache (never the public gallery). */
    private Intent cameraIntent() {
        try {
            File dir = new File(getCacheDir(), "captures");
            if (!dir.exists() && !dir.mkdirs()) return null;
            cameraFile = new File(dir, "live-" + System.currentTimeMillis() + ".jpg");
            cameraUri = CaptureProvider.uriFor(this, cameraFile.getName());
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            i.setClipData(ClipData.newRawUri("photo", cameraUri));
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (i.resolveActivity(getPackageManager()) == null) return null;
            return i;
        } catch (Exception e) {
            return null;
        }
    }

    private void clearCaptures() {
        File dir = new File(getCacheDir(), "captures");
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) { if (!f.delete()) f.deleteOnExit(); }
    }

    /** Debugger attached to a release build, or a known hooking tool (Frida / Xposed) loaded into the app. */
    private boolean isTampered() {
        try {
            boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            if (!debuggable && (Debug.isDebuggerConnected() || Debug.waitingForDebugger())) return true;
        } catch (Exception ignored) { }
        try { Class.forName("de.robv.android.xposed.XposedBridge"); return true; } catch (Throwable ignored) { }
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/self/maps"))) {
            String line;
            while ((line = r.readLine()) != null) {
                String l = line.toLowerCase();
                if (l.contains("frida") || l.contains("gum-js-loop") || l.contains("xposed") || l.contains("substrate")) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    /* ---------- encrypted storage (Android Keystore, AES-256-GCM, key never leaves secure hardware) ---------- */
    private static final String KS_ALIAS = "aitrialroom.secure";

    private SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KS_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KS_ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KS_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    private String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] iv = c.getIV(), ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private String decrypt(String stored) throws Exception {
        String[] parts = stored.split(":");
        if (parts.length != 2) return "";
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private SharedPreferences securePrefs() { return getSharedPreferences("secure", MODE_PRIVATE); }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    private static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCallback != null) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null && data.getData() != null) out = new Uri[]{data.getData()};
            else if (res == RESULT_OK && cameraFile != null && cameraFile.exists() && cameraFile.length() > 0) out = new Uri[]{cameraUri};
            fileCallback.onReceiveValue(out);
            fileCallback = null;
        }
    }

    private void handleBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.ATR && ATR.back()) ? 'y' : 'n'", v -> {
            if (v == null || !v.contains("y")) finish();
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (billing != null) billing.refresh();   // picks up a subscription bought, renewed or cancelled meanwhile
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        if (billing != null) billing.end();
        if (isFinishing()) clearCaptures();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    /** HTTPS call to Google AI only, run off the UI thread. Result JSON: {status, body} or {status:0, error}. */
    private String doHttp(String method, String url, String headersJson, String body) {
        HttpURLConnection c = null;
        JSONObject r = new JSONObject();
        try {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol()) || !"generativelanguage.googleapis.com".equals(u.getHost())) {
                r.put("status", 0); r.put("error", "blocked host"); return r.toString();
            }
            c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(20000);
            c.setReadTimeout(150000);
            JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
            Iterator<String> keys = h.keys();
            while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, h.getString(k)); }
            if (body != null && !body.isEmpty() && !"GET".equals(method)) {
                c.setDoOutput(true);
                byte[] b = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(b.length);
                try (OutputStream os = c.getOutputStream()) { os.write(b); }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            if (in != null) { byte[] buf = new byte[65536]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); in.close(); }
            r.put("status", status);
            r.put("body", new String(bo.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            try { r.put("status", 0); r.put("error", e instanceof java.net.SocketTimeoutException ? "timeout" : String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        } finally {
            if (c != null) c.disconnect();
        }
        return r.toString();
    }

    /** Exposed to the web app as window.AndroidBridge */
    private class Bridge {
        @JavascriptInterface
        public boolean billingRequired() { return BuildConfig.PLAY_EDITION; }

        @JavascriptInterface
        public String billingStatus() {
            return billing == null ? "{\"state\":\"test\"}" : billing.statusJson();
        }

        @JavascriptInterface
        public void billingBuy() { if (billing != null) billing.buy(); }

        @JavascriptInterface
        public void billingRefresh() { if (billing != null) billing.refresh(); }

        @JavascriptInterface
        public String httpStart(final String method, final String url, final String headers, final String body) {
            final String id = "h" + httpIds.getAndIncrement();
            pool.execute(new Runnable() {
                @Override public void run() { httpResults.put(id, doHttp(method, url, headers, body)); }
            });
            return id;
        }

        @JavascriptInterface
        public String httpPoll(String id) {
            String r = httpResults.remove(id);
            return r == null ? "" : r;
        }

        @JavascriptInterface
        public void clearCaptures() { MainActivity.this.clearCaptures(); }

        @JavascriptInterface
        public String secureGet(String name) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_]{1,40}")) return "";
                String v = securePrefs().getString(name, null);
                return v == null ? "" : decrypt(v);
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public boolean secureSet(String name, String value) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_]{1,40}")) return false;
                if (value == null || value.isEmpty()) securePrefs().edit().remove(name).apply();
                else securePrefs().edit().putString(name, encrypt(value)).apply();
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void setSecure(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (on) getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
            });
        }

        @JavascriptInterface
        public String saveImage(String base64, String name) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (name == null || !name.matches("[A-Za-z0-9._-]{1,80}")) name = "AI-TrialRoom-" + System.currentTimeMillis() + ".jpg";
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = getContentResolver();
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                    cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AI TrialRoom");
                    cv.put(MediaStore.Images.Media.IS_PENDING, 1);
                    Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return "error";
                    try (OutputStream os = cr.openOutputStream(uri)) { if (os == null) return "error"; os.write(bytes); }
                    cv.clear();
                    cv.put(MediaStore.Images.Media.IS_PENDING, 0);
                    cr.update(uri, cv, null, null);
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM));
                        return "error";
                    }
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "AI TrialRoom");
                    if (!dir.exists() && !dir.mkdirs()) return "error";
                    File f = new File(dir, name);
                    try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(bytes); }
                    MediaScannerConnection.scanFile(MainActivity.this, new String[]{f.getAbsolutePath()}, new String[]{"image/jpeg"}, null);
                }
                return "ok";
            } catch (Exception e) {
                return "error";
            }
        }
    }
}
