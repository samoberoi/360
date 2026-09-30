package app.com.radiantguard;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(RadiantBiometricsPlugin.class);
    registerPlugin(RadiantNativeAuthStorePlugin.class);
    registerPlugin(RadiantDeviceTelemetryPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
