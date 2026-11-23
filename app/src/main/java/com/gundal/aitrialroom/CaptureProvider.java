package com.gundal.aitrialroom;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Private provider so the camera app can write a live photo into this app's cache. Not exported. */
public class CaptureProvider extends ContentProvider {
    static String authority(Context c) { return c.getPackageName() + ".captures"; }

    static Uri uriFor(Context c, String name) {
        return Uri.parse("content://" + authority(c) + "/" + name);
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("[A-Za-z0-9._-]+")) throw new FileNotFoundException("bad name");
        Context ctx = getContext();
        if (ctx == null) throw new FileNotFoundException("no context");
        return new File(new File(ctx.getCacheDir(), "captures"), name);
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        int m = mode != null && mode.contains("w")
                ? ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE
                : ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(f, m);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        try { File f = fileFor(uri); c.addRow(new Object[]{f.getName(), f.length()}); } catch (FileNotFoundException ignored) { }
        return c;
    }

    @Override public String getType(Uri uri) { return "image/jpeg"; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
