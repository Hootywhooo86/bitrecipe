package com.bit128.bitrecipe;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BitNativePlugin.class);
        super.onCreate(savedInstanceState);
        BitNativePlugin.handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        BitNativePlugin.handleIntent(intent);
    }
}
