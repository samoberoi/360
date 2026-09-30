package app.com.radiantguard;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "RadiantBiometrics")
public class RadiantBiometricsPlugin extends Plugin {
  private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

  @PluginMethod
  public void check(PluginCall call) {
    int result = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
    JSObject response = new JSObject();
    boolean available = result == BiometricManager.BIOMETRIC_SUCCESS;
    response.put("available", available);
    response.put("biometryAvailable", available);
    response.put("deviceSecure", result != BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE);
    response.put("biometryType", "biometric");
    response.put("label", "Biometric unlock");
    response.put("code", String.valueOf(result));
    response.put("reason", reasonFor(result));
    call.resolve(response);
  }

  @PluginMethod
  public void authenticate(PluginCall call) {
    String reason = call.getString("reason", "Confirm your identity");
    getActivity().runOnUiThread(() -> {
      Executor executor = ContextCompat.getMainExecutor(getContext());
      BiometricPrompt prompt = new BiometricPrompt(
        getActivity(),
        executor,
        new BiometricPrompt.AuthenticationCallback() {
          @Override
          public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
            super.onAuthenticationSucceeded(result);
            JSObject response = new JSObject();
            response.put("success", true);
            call.resolve(response);
          }

          @Override
          public void onAuthenticationError(int errorCode, CharSequence errString) {
            super.onAuthenticationError(errorCode, errString);
            JSObject response = new JSObject();
            response.put("success", false);
            call.resolve(response);
          }
        }
      );
      BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
        .setTitle("PLUS 360")
        .setSubtitle(reason)
        .setNegativeButtonText("Cancel")
        .setAllowedAuthenticators(AUTHENTICATORS)
        .build();
      prompt.authenticate(info);
    });
  }

  private String reasonFor(int result) {
    switch (result) {
      case BiometricManager.BIOMETRIC_SUCCESS:
        return "Biometrics are ready.";
      case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
        return "Set up fingerprint or face unlock in Android settings first.";
      case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
        return "This device has no biometric sensor.";
      case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
        return "The biometric sensor is temporarily unavailable.";
      default:
        return "Biometric authentication is unavailable.";
    }
  }
}