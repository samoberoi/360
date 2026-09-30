package app.com.radiantguard;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "RadiantNativeAuthStore")
public class RadiantNativeAuthStorePlugin extends Plugin {
  private static final String STORE = "plus360_native_auth";
  private static final String PHONE = "phone";
  private static final String IV = "phone_iv";
  private static final String KEY_ALIAS = "plus360_phone_key";

  @PluginMethod
  public void getPhone(PluginCall call) {
    JSObject response = new JSObject();
    try {
      SharedPreferences prefs = prefs();
      String encrypted = prefs.getString(PHONE, null);
      String iv = prefs.getString(IV, null);
      if (encrypted == null || iv == null) {
        response.put("hasPhone", false);
        call.resolve(response);
        return;
      }
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
      String phone = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
      response.put("hasPhone", true);
      response.put("phone", phone);
      call.resolve(response);
    } catch (Exception error) {
      prefs().edit().clear().apply();
      response.put("hasPhone", false);
      call.resolve(response);
    }
  }

  @PluginMethod
  public void setPhone(PluginCall call) {
    String phone = call.getString("phone");
    if (phone == null || phone.trim().isEmpty()) {
      call.reject("Phone is required.");
      return;
    }
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key());
      String encrypted = Base64.encodeToString(cipher.doFinal(phone.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
      String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
      prefs().edit().putString(PHONE, encrypted).putString(IV, iv).apply();
      JSObject response = new JSObject();
      response.put("saved", true);
      call.resolve(response);
    } catch (Exception error) {
      call.reject("Could not securely save this device.", error);
    }
  }

  @PluginMethod
  public void clearPhone(PluginCall call) {
    prefs().edit().clear().apply();
    JSObject response = new JSObject();
    response.put("cleared", true);
    call.resolve(response);
  }

  private SharedPreferences prefs() {
    return getContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
  }

  private SecretKey key() throws Exception {
    KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
    keyStore.load(null);
    if (keyStore.containsAlias(KEY_ALIAS)) {
      return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
    }
    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    generator.init(new KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
    ).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
    return generator.generateKey();
  }
}