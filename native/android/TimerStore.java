package com.bit128.bitrecipe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The running cooking timers, kept natively so they can be shown outside the
 * app: a live countdown notification for each one (in the notification shade
 * and on the lock screen) and the bitrecipe home-screen widget.
 */
public class TimerStore {
    private static final String PREFS = "bitrecipe_timers";
    public static final String RUNNING_CHANNEL = "bitrecipe_running_v1";
    /** Notification id of a timer's countdown (the ringing alarm uses the timer id). */
    public static int countdownId(int id) { return id ^ 0x5A5A5A5; }

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static JSONArray list(Context ctx) {
        try { return new JSONArray(prefs(ctx).getString("list", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private static void save(Context ctx, JSONArray a) { prefs(ctx).edit().putString("list", a.toString()).apply(); }

    public static void add(Context ctx, int id, long at, String label, String recipe) {
        JSONArray a = prune(ctx, without(list(ctx), id));
        try {
            JSONObject o = new JSONObject();
            o.put("id", id); o.put("at", at); o.put("label", label); o.put("recipe", recipe); o.put("done", false);
            a.put(o);
        } catch (Exception ignored) { }
        save(ctx, a);
        showCountdown(ctx, id, at, label, recipe);
        refreshWidgets(ctx);
    }

    public static void remove(Context ctx, int id) {
        save(ctx, without(list(ctx), id));
        nm(ctx).cancel(countdownId(id));
        refreshWidgets(ctx);
    }

    public static void markDone(Context ctx, int id) {
        JSONArray a = list(ctx);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && o.optInt("id") == id) try { o.put("done", true); } catch (Exception ignored) { }
        }
        save(ctx, a);
        nm(ctx).cancel(countdownId(id));
        refreshWidgets(ctx);
    }

    /** Timers cancelled from a notification, for the app to forget too. */
    public static void noteCancelled(Context ctx, int id) {
        String s = prefs(ctx).getString("cancelled", "");
        prefs(ctx).edit().putString("cancelled", s.isEmpty() ? String.valueOf(id) : s + "," + id).apply();
    }

    public static String takeCancelled(Context ctx) {
        String s = prefs(ctx).getString("cancelled", "");
        prefs(ctx).edit().remove("cancelled").apply();
        return s;
    }

    private static JSONArray without(JSONArray a, int id) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && o.optInt("id") != id) out.put(o); }
        return out;
    }

    /** Drop timers that finished more than 15 minutes ago. */
    public static JSONArray prune(Context ctx, JSONArray a) {
        JSONArray out = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && o.optLong("at") > now - 15 * 60 * 1000) out.put(o); }
        return out;
    }

    private static NotificationManager nm(Context ctx) { return (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE); }

    private static void ensureRunningChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26 || nm(ctx).getNotificationChannel(RUNNING_CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(RUNNING_CHANNEL, "Running timers", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("A live countdown for each cooking timer while it runs");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm(ctx).createNotificationChannel(ch);
    }

    /** A quiet, ongoing notification that counts down to the alarm. */
    static void showCountdown(Context ctx, int id, long at, String label, String recipe) {
        ensureRunningChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, countdownId(id), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent cancel = new Intent(ctx, TimerReceiver.class).setAction(TimerReceiver.ACTION_CANCEL).putExtra("id", id);
        PendingIntent cancelPi = PendingIntent.getBroadcast(ctx, countdownId(id) + 7, cancel, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, RUNNING_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bitrecipe)
            .setColor(0xFFFF5D5D)
            .setContentTitle("⏱ " + (label == null ? "Timer" : label))
            .setContentText((recipe == null ? "bitrecipe" : recipe) + " · rings at " + android.text.format.DateFormat.getTimeFormat(ctx).format(new java.util.Date(at)))
            .setWhen(at)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
            .addAction(0, "CANCEL TIMER", cancelPi);
        try { nm(ctx).notify(countdownId(id), b.build()); } catch (SecurityException ignored) { }
    }

    public static void refreshWidgets(Context ctx) {
        AppWidgetManager wm = AppWidgetManager.getInstance(ctx);
        int[] ids = wm.getAppWidgetIds(new ComponentName(ctx, TimerWidget.class));
        if (ids.length > 0) TimerWidget.draw(ctx, wm, ids);
    }
}
