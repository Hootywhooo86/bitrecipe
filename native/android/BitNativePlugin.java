package com.bit128.bitrecipe;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Small native helpers for bitrecipe:
 *  - receives links/text shared from TikTok, Instagram, Chrome etc. (share sheet)
 *  - keeps the screen awake while cook mode is open
 *  - colours the status and navigation bars to match the current theme
 *  - cooking timers as real alarms: they ring even when the app is closed,
 *    the phone is asleep, or Do Not Disturb is on
 */
@CapacitorPlugin(
    name = "BitNative",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class BitNativePlugin extends Plugin {
    private static String pending = null;
    private static BitNativePlugin instance = null;

    @Override
    public void load() {
        instance = this;
        TimerReceiver.ensureChannel(getContext());
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

    // ---------- timer alerts ----------

    private boolean notificationsGranted() {
        if (Build.VERSION.SDK_INT < 33) {
            return ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled();
        }
        return getPermissionState("notifications") == PermissionState.GRANTED;
    }

    private boolean exactAlarmsAllowed() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return ((AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
    }

    private boolean dndAccess() {
        return ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).isNotificationPolicyAccessGranted();
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("notifications", notificationsGranted());
        r.put("exactAlarms", exactAlarmsAllowed());
        r.put("dnd", dndAccess());
        return r;
    }

    @PluginMethod
    public void alertStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsResult");
            return;
        }
        if (!notificationsGranted()) openAppNotificationSettings();
        call.resolve(status());
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        // Asked once and refused: Android won't show the prompt again, so open settings.
        if (!notificationsGranted() && !getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            openAppNotificationSettings();
        }
        call.resolve(status());
    }

    private void openAppNotificationSettings() {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    @PluginMethod
    public void openDndSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void scheduleTimer(PluginCall call) {
        Integer id = call.getInt("id");
        Long at = call.getLong("at");
        if (id == null || at == null) { call.reject("id and at are required"); return; }
        String label = call.getString("label", "Timer");
        String recipe = call.getString("recipe", "bitrecipe");
        Context ctx = getContext();
        TimerReceiver.ensureChannel(ctx);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent fire = TimerReceiver.fireIntent(ctx, id, label, recipe);
        if (exactAlarmsAllowed()) {
            PendingIntent show = PendingIntent.getActivity(ctx, id, new Intent(ctx, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), fire);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
        }
        JSObject r = status();
        r.put("exact", exactAlarmsAllowed());
        call.resolve(r);
    }

    @PluginMethod
    public void cancelTimer(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) { call.reject("id is required"); return; }
        Context ctx = getContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(TimerReceiver.fireIntent(ctx, id, "", ""));
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id);
        call.resolve();
    }
}
