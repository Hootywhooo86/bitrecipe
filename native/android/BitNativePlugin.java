package com.bit128.bitrecipe;

import android.content.Intent;
import android.graphics.Color;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Small native helpers for bitrecipe:
 *  - receives links/text shared from TikTok, Instagram, Chrome etc. (share sheet)
 *  - keeps the screen awake while cook mode is open
 *  - colours the status and navigation bars to match the current theme
 */
@CapacitorPlugin(name = "BitNative")
public class BitNativePlugin extends Plugin {
    private static String pending = null;
    private static BitNativePlugin instance = null;

    @Override
    public void load() {
        instance = this;
    }

    public static void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.isEmpty()) return;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        pending = (subject != null && !text.contains(subject)) ? subject + "\n" + text : text;
        if (instance != null) instance.notifyListeners("shared", new JSObject());
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("text", pending);
        pending = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    @PluginMethod
    public void setBars(PluginCall call) {
        final String color = call.getString("color", "#0b0b16");
        final boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            int c;
            try { c = Color.parseColor(color); } catch (IllegalArgumentException e) { c = Color.BLACK; }
            w.setStatusBarColor(c);
            w.setNavigationBarColor(c);
            WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
            ic.setAppearanceLightStatusBars(light);
            ic.setAppearanceLightNavigationBars(light);
        });
        call.resolve();
    }
}
