package com.jjjeroen.cascadesevens;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Capacitor 8 does not handle the system back button / back gesture
        // itself, so by default it simply closes the app and the game in
        // progress is lost (there is no save/resume yet). Ask first.
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Leave the game?")
                        .setMessage("The game in progress will be lost.")
                        .setNegativeButton("Keep playing", null)
                        .setPositiveButton("Leave", (dialog, which) -> finish())
                        .show();
                }
            }
        );
    }
}
