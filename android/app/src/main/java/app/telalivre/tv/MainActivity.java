package app.telalivre.tv;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothHidPlugin.class);
        registerPlugin(TvCastPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
