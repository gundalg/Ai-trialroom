# Keep the methods the web app calls through window.AndroidBridge
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
# Everything else is renamed and shrunk (makes reverse engineering harder)
-repackageclasses ''
-allowaccessmodification
