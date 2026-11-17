package com.bit128.bitrecipe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;

/**
 * Rings a finished cooking timer like an alarm clock: it plays the phone's
 * alarm sound on the ALARM audio stream, which Do Not Disturb lets through
 * (Android allows alarms in DND by default), vibrates, and keeps going until
 * STOP is tapped or 10 minutes pass. The notification also shows full screen
 * on the lock screen, and its channel bypasses DND when bitrecipe has been
 * given "Do Not Disturb access" in Settings.
 */
public class TimerRingService extends Service {
    public static final String ACTION_RING = "com.bit128.bitrecipe.RING";
    public static final String ACTION_SILENCE = "com.bit128.bitrecipe.SILENCE";
    // A new channel id when DND access is granted: Android only honours
    // "bypass Do Not Disturb" if the app had access when the channel was made.
    static final String CH_PLAIN = "bitrecipe_ring_v2";
    static final String CH_DND = "bitrecipe_ring_dnd_v2";
    private static final int NOTIF_ID = 0x7B17;

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final StringBuilder labels = new StringBuilder();

    static String channel(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean dnd = Build.VERSION.SDK_INT >= 23 && nm.isNotificationPolicyAccessGranted();
        String id = dnd ? CH_DND : CH_PLAIN;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(id) == null) {
            NotificationChannel ch = new NotificationChannel(id, dnd ? "Timer alarms (through Do Not Disturb)" : "Timer alarms", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Rings when a cooking timer is done");
            ch.setSound(null, null); // the service plays the alarm sound itself
            ch.enableVibration(false);
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        return id;
    }

    /** Start ringing; returns false if Android wouldn't start the service. */
    public static boolean ring(Context ctx, int id, String label, String recipe) {
        Intent i = new Intent(ctx, TimerRingService.class).setAction(ACTION_RING)
            .putExtra("id", id).putExtra("label", label).putExtra("recipe", recipe);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
            return true;
        } catch (Exception e) {
            return false; // e.g. not allowed from the background: the receiver falls back to a plain alarm notification
        }
    }

    public static void silence(Context ctx) {
        try { ctx.startService(new Intent(ctx, TimerRingService.class).setAction(ACTION_SILENCE)); } catch (Exception ignored) { }
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTIF_ID);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_SILENCE.equals(intent.getAction())) { stopAll(); return START_NOT_STICKY; }
        String label = intent.getStringExtra("label");
        String recipe = intent.getStringExtra("recipe");
        if (labels.length() > 0) labels.append(" + ");
        labels.append(label == null ? "Timer" : label);

        Notification n = alarmNotification(this, labels.toString(), recipe);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIF_ID, n);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startSound();
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::stopAll, 10 * 60 * 1000); // give up after 10 minutes
        return START_NOT_STICKY;
    }

    static Notification alarmNotification(Context ctx, String label, String recipe) {
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, NOTIF_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(ctx, TimerReceiver.class).setAction(TimerReceiver.ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getBroadcast(ctx, NOTIF_ID + 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(ctx, channel(ctx))
            .setSmallIcon(R.drawable.ic_stat_bitrecipe)
            .setColor(0xFFFF5D5D)
            .setContentTitle("⏱ " + label + " is done!")
            .setContentText(recipe == null ? "bitrecipe" : recipe)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(openPi)
            .setFullScreenIntent(openPi, true)
            .setDeleteIntent(stopPi)
            .addAction(0, "STOP", stopPi)
            .build();
    }

    private void startSound() {
        if (player == null) {
            try {
                Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                player = new MediaPlayer();
                player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                player.setDataSource(this, uri);
                player.setLooping(true);
                player.prepare();
                player.start();
            } catch (Exception e) {
                player = null;
            }
        }
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            long[] pattern = { 0, 500, 300, 500, 300, 900 };
            if (vibrator != null) {
                if (Build.VERSION.SDK_INT >= 26) {
                    AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build();
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), aa);
                } else vibrator.vibrate(pattern, 0);
            }
        } catch (Exception ignored) { }
    }

    private void stopAll() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) { try { player.stop(); } catch (Exception ignored) { } player.release(); player = null; }
        if (vibrator != null) vibrator.cancel();
        labels.setLength(0);
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) { try { player.stop(); } catch (Exception ignored) { } player.release(); player = null; }
        if (vibrator != null) vibrator.cancel();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
