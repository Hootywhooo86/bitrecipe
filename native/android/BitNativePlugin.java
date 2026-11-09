package com.bit128.bitrecipe;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Locale;
import android.os.Build;
import android.provider.Settings;
import android.view.Window;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
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
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
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

    // ---------- sharing, links, files ----------

    @PluginMethod
    public void shareText(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
        send.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "bitrecipe"));
        Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
        call.resolve();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("url is required"); return; }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open that link");
        }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/json"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "bitrecipe-backup.json"));
        startActivityForResult(call, i, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        try (OutputStream os = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
            os.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save: " + e.getMessage());
        }
    }

    // ---------- share a recipe card image ----------

    @PluginMethod
    public void shareImage(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) { call.reject("base64 is required"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            dir.mkdirs();
            File f = new File(dir, call.getString("name", "recipe.png").replaceAll("[^A-Za-z0-9._-]", "_"));
            try (FileOutputStream os = new FileOutputStream(f)) { os.write(Base64.decode(b64, Base64.DEFAULT)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, call.getString("title", "Share recipe"));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not share the image: " + e.getMessage());
        }
    }

    // ---------- hands-free: listen for "next", "back"... and read steps aloud ----------

    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingSpeech = null;
    private final Handler main = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void startVoice(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micResult");
            return;
        }
        beginVoice(call);
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) beginVoice(call);
        else call.reject("bitrecipe needs the microphone to hear “next”.");
    }

    private void beginVoice(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Voice control isn’t available on this phone.");
            return;
        }
        listening = true;
        main.post(this::listenOnce);
        call.resolve();
    }

    private void listenOnce() {
        if (!listening) return;
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float v) {}
                @Override public void onBufferReceived(byte[] bytes) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int t, Bundle b) {}
                @Override public void onPartialResults(Bundle b) { emit(b, true); }
                @Override public void onResults(Bundle b) { emit(b, false); again(); }
                @Override public void onError(int error) { again(); }
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        try { recognizer.startListening(i); } catch (Exception e) { again(); }
    }

    private void again() {
        if (listening) main.postDelayed(this::listenOnce, 300);
    }

    private void emit(Bundle b, boolean partial) {
        ArrayList<String> heard = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (heard == null || heard.isEmpty()) return;
        JSObject o = new JSObject();
        o.put("text", android.text.TextUtils.join(" | ", heard));
        o.put("partial", partial);
        notifyListeners("voice", o);
    }

    @PluginMethod
    public void stopVoice(PluginCall call) {
        listening = false;
        main.post(() -> {
            if (recognizer != null) { recognizer.destroy(); recognizer = null; }
        });
        call.resolve();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "");
        main.post(() -> {
            if (tts == null) {
                pendingSpeech = text;
                tts = new TextToSpeech(getContext(), status -> {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (ttsReady) {
                        tts.setLanguage(Locale.getDefault());
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String id) { notifyListeners("speaking", new JSObject().put("on", true)); }
                            @Override public void onDone(String id) { notifyListeners("speaking", new JSObject().put("on", false)); }
                            @Override public void onError(String id) { notifyListeners("speaking", new JSObject().put("on", false)); }
                        });
                        if (pendingSpeech != null) tts.speak(pendingSpeech, TextToSpeech.QUEUE_FLUSH, null, "bitrecipe");
                        pendingSpeech = null;
                    }
                });
            } else if (ttsReady) {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bitrecipe");
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        main.post(() -> { if (tts != null) tts.stop(); });
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        listening = false;
        if (recognizer != null) recognizer.destroy();
        if (tts != null) tts.shutdown();
    }
}
