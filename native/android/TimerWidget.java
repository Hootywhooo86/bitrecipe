package com.bit128.bitrecipe;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Home-screen widget: live countdowns of the running cooking timers. */
public class TimerWidget extends AppWidgetProvider {
    private static final int[] ROWS = { R.id.bw_row1, R.id.bw_row2, R.id.bw_row3 };
    private static final int[] LABELS = { R.id.bw_label1, R.id.bw_label2, R.id.bw_label3 };
    private static final int[] CLOCKS = { R.id.bw_clock1, R.id.bw_clock2, R.id.bw_clock3 };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager wm, int[] ids) { draw(ctx, wm, ids); }

    static void draw(Context ctx, AppWidgetManager wm, int[] ids) {
        JSONArray all = TimerStore.prune(ctx, TimerStore.list(ctx));
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.bitrecipe_timer_widget);
        long now = System.currentTimeMillis();
        int shown = 0;
        for (int i = 0; i < all.length() && shown < ROWS.length; i++) {
            JSONObject o = all.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at");
            boolean done = o.optBoolean("done") || at <= now;
            v.setViewVisibility(ROWS[shown], View.VISIBLE);
            v.setTextViewText(LABELS[shown], (done ? "✓ " : "⏱ ") + o.optString("label", "Timer"));
            if (done) {
                v.setChronometer(CLOCKS[shown], SystemClock.elapsedRealtime(), "DONE!", false);
            } else {
                long base = SystemClock.elapsedRealtime() + (at - now);
                v.setChronometer(CLOCKS[shown], base, null, true);
                if (Build.VERSION.SDK_INT >= 24) v.setChronometerCountDown(CLOCKS[shown], true);
            }
            shown++;
        }
        for (int i = shown; i < ROWS.length; i++) v.setViewVisibility(ROWS[i], View.GONE);
        v.setViewVisibility(R.id.bw_empty, shown == 0 ? View.VISIBLE : View.GONE);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.bw_root, PendingIntent.getActivity(ctx, 0x31D, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        wm.updateAppWidget(ids, v);
    }
}
