package com.bit128.bitrecipe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * Fires when a cooking timer ends. The notification is an ALARM: it uses the
 * alarm sound stream, keeps ringing until you tap Stop (or 10 minutes pass),
 * and is set to bypass Do Not Disturb. Android lets alarms through DND by
 * default; with "Do Not Disturb access" granted it also gets through when
 * alarms are muted in DND.
 */
public class TimerReceiver extends BroadcastReceiver {
    public static final String CHANNEL = "bitrecipe_timers_v1";
    public static final String ACTION_FIRE = "com.bit128.bitrecipe.TIMER_FIRE";
    public static final String ACTION_STOP = "com.bit128.bitrecipe.TIMER_STOP";

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Cooking timers", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Rings when a cooking timer is done, even on Do Not Disturb");
        Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (alarm == null) alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        ch.setSound(alarm, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 800 });
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    public static PendingIntent fireIntent(Context ctx, int id, String label, String recipe) {
        Intent i = new Intent(ctx, TimerReceiver.class).setAction(ACTION_FIRE);
        i.putExtra("id", id);
        i.putExtra("label", label);
        i.putExtra("recipe", recipe);
        return PendingIntent.getBroadcast(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        int id = intent.getIntExtra("id", 0);
        if (ACTION_STOP.equals(intent.getAction())) {
            nm.cancel(id);
            return;
        }
        ensureChannel(ctx);
        String label = intent.getStringExtra("label");
        String recipe = intent.getStringExtra("recipe");

        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(ctx, TimerReceiver.class).setAction(ACTION_STOP).putExtra("id", id);
        PendingIntent stopPi = PendingIntent.getBroadcast(ctx, id + 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bitrecipe)
            .setColor(0xFFFF5D5D)
            .setContentTitle("⏱ " + (label == null ? "Timer" : label) + " is done!")
            .setContentText(recipe == null ? "bitrecipe" : recipe)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), android.media.AudioManager.STREAM_ALARM)
            .setVibrate(new long[] { 0, 400, 200, 400, 200, 800 })
            .setContentIntent(openPi)
            .setDeleteIntent(stopPi)
            .setAutoCancel(true)
            .setTimeoutAfter(10 * 60 * 1000)
            .addAction(0, "STOP", stopPi);
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until stopped
        try {
            nm.notify(id, n);
        } catch (SecurityException e) {
            // notifications not allowed; nothing more we can do from here
        }
    }
}
