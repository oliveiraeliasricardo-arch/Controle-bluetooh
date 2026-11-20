package app.telalivre.tv;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHidDevice;
import android.bluetooth.BluetoothHidDeviceAppQosSettings;
import android.bluetooth.BluetoothHidDeviceAppSdpSettings;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "BluetoothHid",
    permissions = {
        @Permission(
            strings = {
                "android.permission.BLUETOOTH_CONNECT",
                "android.permission.BLUETOOTH_SCAN",
                "android.permission.BLUETOOTH_ADVERTISE"
            },
            alias = "bluetooth12"
        ),
        @Permission(
            strings = {
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION
            },
            alias = "bluetoothLegacy"
        )
    }
)
public class BluetoothHidPlugin extends Plugin {

    private static final byte REPORT_ID_KEYBOARD = 0x01;
    private static final byte REPORT_ID_CONSUMER = 0x02;
    private static final byte REPORT_ID_MOUSE = 0x03;

    // Composite HID Report Descriptor:
    // Report ID 1: Standard 8-byte Boot/NKRO Keyboard
    // Report ID 2: 16-bit Consumer Control (TV Remote: Power, Home, Back, Media, Volume, Channels)
    // Report ID 3: 4-byte Relative Mouse / Trackpad (Buttons, X, Y, Wheel)
    private static final byte[] HID_REPORT_DESCRIPTOR = new byte[] {
        // Keyboard (Report ID 1)
        (byte) 0x05, (byte) 0x01, // Usage Page (Generic Desktop)
        (byte) 0x09, (byte) 0x06, // Usage (Keyboard)
        (byte) 0xA1, (byte) 0x01, // Collection (Application)
        (byte) 0x85, REPORT_ID_KEYBOARD, // Report ID (1)
        (byte) 0x05, (byte) 0x07, // Usage Page (Keyboard/Keypad)
        (byte) 0x19, (byte) 0xE0, // Usage Minimum (224 - Left Ctrl)
        (byte) 0x29, (byte) 0xE7, // Usage Maximum (231 - Right GUI)
        (byte) 0x15, (byte) 0x00, // Logical Minimum (0)
        (byte) 0x25, (byte) 0x01, // Logical Maximum (1)
        (byte) 0x75, (byte) 0x01, // Report Size (1)
        (byte) 0x95, (byte) 0x08, // Report Count (8)
        (byte) 0x81, (byte) 0x02, // Input (Data, Variable, Absolute) - Modifier byte
        (byte) 0x95, (byte) 0x01, // Report Count (1)
        (byte) 0x75, (byte) 0x08, // Report Size (8)
        (byte) 0x81, (byte) 0x01, // Input (Constant) - Reserved byte
        (byte) 0x95, (byte) 0x06, // Report Count (6)
        (byte) 0x75, (byte) 0x08, // Report Size (8)
        (byte) 0x15, (byte) 0x00, // Logical Minimum (0)
        (byte) 0x25, (byte) 0x65, // Logical Maximum (101)
        (byte) 0x05, (byte) 0x07, // Usage Page (Keyboard/Keypad)
        (byte) 0x19, (byte) 0x00, // Usage Minimum (0)
        (byte) 0x29, (byte) 0x65, // Usage Maximum (101)
        (byte) 0x81, (byte) 0x00, // Input (Data, Array) - Keycodes
        (byte) 0xC0,              // End Collection

        // Consumer Control / TV Remote (Report ID 2)
        (byte) 0x05, (byte) 0x0C, // Usage Page (Consumer Devices)
        (byte) 0x09, (byte) 0x01, // Usage (Consumer Control)
        (byte) 0xA1, (byte) 0x01, // Collection (Application)
        (byte) 0x85, REPORT_ID_CONSUMER, // Report ID (2)
        (byte) 0x15, (byte) 0x00, // Logical Minimum (0)
        (byte) 0x26, (byte) 0xFF, (byte) 0x03, // Logical Maximum (0x03FF)
        (byte) 0x19, (byte) 0x00, // Usage Minimum (0)
        (byte) 0x2A, (byte) 0xFF, (byte) 0x03, // Usage Maximum (0x03FF)
        (byte) 0x75, (byte) 0x10, // Report Size (16)
        (byte) 0x95, (byte) 0x01, // Report Count (1)
        (byte) 0x81, (byte) 0x00, // Input (Data, Array)
        (byte) 0xC0,              // End Collection

        // Mouse / Trackpad (Report ID 3)
        (byte) 0x05, (byte) 0x01, // Usage Page (Generic Desktop)
        (byte) 0x09, (byte) 0x02, // Usage (Mouse)
        (byte) 0xA1, (byte) 0x01, // Collection (Application)
        (byte) 0x85, REPORT_ID_MOUSE, // Report ID (3)
        (byte) 0x09, (byte) 0x01, // Usage (Pointer)
        (byte) 0xA1, (byte) 0x00, // Collection (Physical)
        (byte) 0x05, (byte) 0x09, // Usage Page (Buttons)
        (byte) 0x19, (byte) 0x01, // Usage Minimum (Button 1)
        (byte) 0x29, (byte) 0x03, // Usage Maximum (Button 3)
        (byte) 0x15, (byte) 0x00, // Logical Minimum (0)
        (byte) 0x25, (byte) 0x01, // Logical Maximum (1)
        (byte) 0x95, (byte) 0x03, // Report Count (3)
        (byte) 0x75, (byte) 0x01, // Report Size (1)
        (byte) 0x81, (byte) 0x02, // Input (Data, Variable, Absolute)
        (byte) 0x95, (byte) 0x01, // Report Count (1)
        (byte) 0x75, (byte) 0x05, // Report Size (5)
        (byte) 0x81, (byte) 0x01, // Input (Constant) - Padding
        (byte) 0x05, (byte) 0x01, // Usage Page (Generic Desktop)
        (byte) 0x09, (byte) 0x30, // Usage (X)
        (byte) 0x09, (byte) 0x31, // Usage (Y)
        (byte) 0x09, (byte) 0x38, // Usage (Wheel)
        (byte) 0x15, (byte) 0x81, // Logical Minimum (-127)
        (byte) 0x25, (byte) 0x7F, // Logical Maximum (127)
        (byte) 0x75, (byte) 0x08, // Report Size (8)
        (byte) 0x95, (byte) 0x03, // Report Count (3)
        (byte) 0x81, (byte) 0x06, // Input (Data, Variable, Relative)
        (byte) 0xC0,              // End Collection (Physical)
        (byte) 0xC0               // End Collection (Application)
    };

    private static final int MOD_LCTRL = 0x01;
    private static final int MOD_LSHIFT = 0x02;
    private static final int MOD_LALT = 0x04;
    private static final int MOD_RALT = 0x40;

    private final ExecutorService hidExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothHidDevice hidDevice;
    private BluetoothDevice connectedHostDevice;
    private boolean isHidAppRegistered = false;
    private boolean isProfileConnected = false;
    private boolean receiverRegistered = false;
    private String connectionStateStr = "disconnected";

    private static final Map<Character, int[]> US_CHAR_MAP = new HashMap<>();
    static {
        // Letters a-z (HID 0x04..0x1D)
        for (char c = 'a'; c <= 'z'; c++) {
            int code = 0x04 + (c - 'a');
            US_CHAR_MAP.put(c, new int[] { 0, code });
            US_CHAR_MAP.put(Character.toUpperCase(c), new int[] { MOD_LSHIFT, code });
        }
        // Numbers 1-9, 0
        US_CHAR_MAP.put('1', new int[] { 0, 0x1E });
        US_CHAR_MAP.put('!', new int[] { MOD_LSHIFT, 0x1E });
        US_CHAR_MAP.put('2', new int[] { 0, 0x1F });
        US_CHAR_MAP.put('@', new int[] { MOD_LSHIFT, 0x1F });
        US_CHAR_MAP.put('3', new int[] { 0, 0x20 });
        US_CHAR_MAP.put('#', new int[] { MOD_LSHIFT, 0x20 });
        US_CHAR_MAP.put('4', new int[] { 0, 0x21 });
        US_CHAR_MAP.put('$', new int[] { MOD_LSHIFT, 0x21 });
        US_CHAR_MAP.put('5', new int[] { 0, 0x22 });
        US_CHAR_MAP.put('%', new int[] { MOD_LSHIFT, 0x22 });
        US_CHAR_MAP.put('6', new int[] { 0, 0x23 });
        US_CHAR_MAP.put('^', new int[] { MOD_LSHIFT, 0x23 });
        US_CHAR_MAP.put('7', new int[] { 0, 0x24 });
        US_CHAR_MAP.put('&', new int[] { MOD_LSHIFT, 0x24 });
        US_CHAR_MAP.put('8', new int[] { 0, 0x25 });
        US_CHAR_MAP.put('*', new int[] { MOD_LSHIFT, 0x25 });
        US_CHAR_MAP.put('9', new int[] { 0, 0x26 });
        US_CHAR_MAP.put('(', new int[] { MOD_LSHIFT, 0x26 });
        US_CHAR_MAP.put('0', new int[] { 0, 0x27 });
        US_CHAR_MAP.put(')', new int[] { MOD_LSHIFT, 0x27 });

        // Whitespace and punctuation
        US_CHAR_MAP.put('\n', new int[] { 0, 0x28 });
        US_CHAR_MAP.put('\t', new int[] { 0, 0x2B });
        US_CHAR_MAP.put(' ', new int[] { 0, 0x2C });
        US_CHAR_MAP.put('-', new int[] { 0, 0x2D });
        US_CHAR_MAP.put('_', new int[] { MOD_LSHIFT, 0x2D });
        US_CHAR_MAP.put('=', new int[] { 0, 0x2E });
        US_CHAR_MAP.put('+', new int[] { MOD_LSHIFT, 0x2E });
        US_CHAR_MAP.put('[', new int[] { 0, 0x2F });
        US_CHAR_MAP.put('{', new int[] { MOD_LSHIFT, 0x2F });
        US_CHAR_MAP.put(']', new int[] { 0, 0x30 });
        US_CHAR_MAP.put('}', new int[] { MOD_LSHIFT, 0x30 });
        US_CHAR_MAP.put('\\', new int[] { 0, 0x31 });
        US_CHAR_MAP.put('|', new int[] { MOD_LSHIFT, 0x31 });
        US_CHAR_MAP.put(';', new int[] { 0, 0x33 });
        US_CHAR_MAP.put(':', new int[] { MOD_LSHIFT, 0x33 });
        US_CHAR_MAP.put('\'', new int[] { 0, 0x34 });
        US_CHAR_MAP.put('"', new int[] { MOD_LSHIFT, 0x34 });
        US_CHAR_MAP.put('`', new int[] { 0, 0x35 });
        US_CHAR_MAP.put('~', new int[] { MOD_LSHIFT, 0x35 });
        US_CHAR_MAP.put(',', new int[] { 0, 0x36 });
        US_CHAR_MAP.put('<', new int[] { MOD_LSHIFT, 0x36 });
        US_CHAR_MAP.put('.', new int[] { 0, 0x37 });
        US_CHAR_MAP.put('>', new int[] { MOD_LSHIFT, 0x37 });
        US_CHAR_MAP.put('/', new int[] { 0, 0x38 });
        US_CHAR_MAP.put('?', new int[] { MOD_LSHIFT, 0x38 });
    }

    private final BroadcastReceiver btBroadcastReceiver = new BroadcastReceiver() {
        @SuppressLint("MissingPermission")
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();

            if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                BluetoothDevice device = getDeviceExtra(intent);
                if (device != null && hasBluetoothConnectPermission()) {
                    JSObject payload = serializeDevice(device);
                    notifyListeners("btDeviceFound", payload);
                }
            } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                notifyListeners("btDiscoveryFinished", new JSObject());
            } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action)) {
                BluetoothDevice device = getDeviceExtra(intent);
                if (device != null && hasBluetoothConnectPermission()) {
                    int bondState = intent.getIntExtra(
                        BluetoothDevice.EXTRA_BOND_STATE,
                        BluetoothDevice.BOND_NONE
                    );
                    JSObject payload = serializeDevice(device);
                    payload.put("bondState", bondStateToString(bondState));
                    notifyListeners("btBondStateChanged", payload);
                }
            } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                JSObject payload = new JSObject();
                payload.put("enabled", state == BluetoothAdapter.STATE_ON);
                payload.put("state", state);
                notifyListeners("btAdapterStateChanged", payload);
                if (state == BluetoothAdapter.STATE_ON) {
                    ensureHidProfileInitialized();
                }
            }
        }
    };

    @SuppressWarnings("deprecation")
    private BluetoothDevice getDeviceExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
        }
        return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
    }

    @Override
    public void load() {
        super.load();
        BluetoothManager btManager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        bluetoothAdapter = btManager != null ? btManager.getAdapter() : BluetoothAdapter.getDefaultAdapter();
        registerBtReceivers();
        if (hasAllBtPermissions() && bluetoothAdapter != null && bluetoothAdapter.isEnabled()) {
            ensureHidProfileInitialized();
        }
    }

    @SuppressLint("MissingPermission")
    @Override
    protected void handleOnDestroy() {
        unregisterBtReceivers();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && hidDevice != null) {
            try {
                if (connectedHostDevice != null && hasBluetoothConnectPermission()) {
                    hidDevice.disconnect(connectedHostDevice);
                }
                if (isHidAppRegistered && hasBluetoothConnectPermission()) {
                    hidDevice.unregisterApp();
                }
                if (bluetoothAdapter != null) {
                    bluetoothAdapter.closeProfileProxy(BluetoothProfile.HID_DEVICE, hidDevice);
                }
            } catch (Exception ignored) {
            }
        }
        hidExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private void registerBtReceivers() {
        if (receiverRegistered) return;
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        ContextCompat.registerReceiver(
            getContext(),
            btBroadcastReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED
        );
        receiverRegistered = true;
    }

    private void unregisterBtReceivers() {
        if (!receiverRegistered) return;
        try {
            getContext().unregisterReceiver(btBroadcastReceiver);
        } catch (Exception ignored) {
        }
        receiverRegistered = false;
    }

    private String getRequiredPermissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth12" : "bluetoothLegacy";
    }

    private boolean hasBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(
            getContext(),
            Manifest.permission.BLUETOOTH
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasAllBtPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return (
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
            );
        }
        return (
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        );
    }

    @SuppressLint("MissingPermission")
    private JSObject buildStatusObject() {
        JSObject obj = new JSObject();
        boolean supported = bluetoothAdapter != null;
        boolean hidSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
        boolean hasPerms = hasAllBtPermissions();
        boolean enabled = supported && bluetoothAdapter.isEnabled();

        obj.put("supported", supported);
        obj.put("hidSupported", hidSupported);
        obj.put("androidSdk", Build.VERSION.SDK_INT);
        obj.put("hasPermissions", hasPerms);
        obj.put("enabled", enabled);
        obj.put("profileReady", isProfileConnected);
        obj.put("appRegistered", isHidAppRegistered);
        obj.put("connectionState", connectionStateStr);
        if (hasPerms && supported) {
            try {
                obj.put("adapterName", bluetoothAdapter.getName());
            } catch (Exception ignored) {
                obj.put("adapterName", "Android");
            }
        }
        if (connectedHostDevice != null && hasBluetoothConnectPermission()) {
            obj.put("connectedDevice", serializeDevice(connectedHostDevice));
        }
        return obj;
    }

    @PluginMethod
    public void getBluetoothStatus(PluginCall call) {
        if (hasAllBtPermissions() && bluetoothAdapter != null && bluetoothAdapter.isEnabled()) {
            ensureHidProfileInitialized();
        }
        call.resolve(buildStatusObject());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (hasAllBtPermissions()) {
            if (bluetoothAdapter != null && bluetoothAdapter.isEnabled()) {
                ensureHidProfileInitialized();
            }
            call.resolve(buildStatusObject());
            return;
        }
        requestPermissionForAlias(getRequiredPermissionAlias(), call, "onBtPermissionsResult");
    }

    @PermissionCallback
    private void onBtPermissionsResult(PluginCall call) {
        if (hasAllBtPermissions() && bluetoothAdapter != null && bluetoothAdapter.isEnabled()) {
            ensureHidProfileInitialized();
        }
        call.resolve(buildStatusObject());
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void enableBluetooth(PluginCall call) {
        if (bluetoothAdapter == null) {
            call.reject("Este aparelho não possui adaptador Bluetooth.");
            return;
        }
        if (!hasAllBtPermissions()) {
            requestPermissionForAlias(getRequiredPermissionAlias(), call, "onBtPermissionsForEnable");
            return;
        }
        if (bluetoothAdapter.isEnabled()) {
            ensureHidProfileInitialized();
            call.resolve(buildStatusObject());
            return;
        }
        Intent intent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
        startActivityForResult(call, intent, "onEnableBluetoothResult");
    }

    @PermissionCallback
    private void onBtPermissionsForEnable(PluginCall call) {
        if (!hasAllBtPermissions()) {
            call.reject("Permissão Bluetooth negada pelo usuário.");
            return;
        }
        enableBluetooth(call);
    }

    @ActivityCallback
    private void onEnableBluetoothResult(PluginCall call, ActivityResult result) {
        if (bluetoothAdapter != null && bluetoothAdapter.isEnabled()) {
            ensureHidProfileInitialized();
        }
        call.resolve(buildStatusObject());
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void makeDiscoverable(PluginCall call) {
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth indisponível.");
            return;
        }
        if (!hasAllBtPermissions()) {
            requestPermissionForAlias(getRequiredPermissionAlias(), call, "onBtPermissionsForDiscoverable");
            return;
        }
        ensureHidProfileInitialized();
        int duration = call.getInt("duration", 120);
        if (duration < 30) duration = 30;
        if (duration > 300) duration = 300;
        Intent intent = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
        intent.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, duration);
        startActivityForResult(call, intent, "onDiscoverableResult");
    }

    @PermissionCallback
    private void onBtPermissionsForDiscoverable(PluginCall call) {
        if (!hasAllBtPermissions()) {
            call.reject("Permissão Bluetooth necessária para ficar visível para a TV.");
            return;
        }
        makeDiscoverable(call);
    }

    @ActivityCallback
    private void onDiscoverableResult(PluginCall call, ActivityResult result) {
        JSObject obj = buildStatusObject();
        obj.put("discoverableGranted", result.getResultCode() != Activity.RESULT_CANCELED);
        obj.put("discoverableSeconds", Math.max(0, result.getResultCode()));
        call.resolve(obj);
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getPairedDevices(PluginCall call) {
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth indisponível.");
            return;
        }
        if (!hasAllBtPermissions()) {
            call.reject("Permissão Bluetooth necessária.");
            return;
        }
        ensureHidProfileInitialized();
        JSArray devices = new JSArray();
        Set<BluetoothDevice> bonded = bluetoothAdapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice device : bonded) {
                devices.put(serializeDevice(device));
            }
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth indisponível.");
            return;
        }
        if (!hasAllBtPermissions()) {
            call.reject("Permissão Bluetooth necessária.");
            return;
        }
        if (!bluetoothAdapter.isEnabled()) {
            call.reject("Ative o Bluetooth primeiro.");
            return;
        }
        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }
        boolean started = bluetoothAdapter.startDiscovery();
        JSObject result = new JSObject();
        result.put("started", started);
        call.resolve(result);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        if (bluetoothAdapter != null && hasAllBtPermissions() && bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void pairDevice(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Endereço Bluetooth inválido.");
            return;
        }
        if (bluetoothAdapter == null || !hasAllBtPermissions()) {
            call.reject("Permissão ou adaptador Bluetooth indisponível.");
            return;
        }
        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }
        BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
        if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
            JSObject res = new JSObject();
            res.put("initiated", true);
            res.put("alreadyBonded", true);
            call.resolve(res);
            return;
        }
        boolean initiated = device.createBond();
        JSObject res = new JSObject();
        res.put("initiated", initiated);
        res.put("alreadyBonded", false);
        call.resolve(res);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connectHidHost(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.reject("O modo Teclado Bluetooth HID requer Android 9 ou superior.");
            return;
        }
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Endereço Bluetooth da TV é obrigatório.");
            return;
        }
        if (bluetoothAdapter == null || !hasAllBtPermissions()) {
            call.reject("Permissão ou adaptador Bluetooth indisponível.");
            return;
        }
        if (!bluetoothAdapter.isEnabled()) {
            call.reject("Ligue o Bluetooth do aparelho antes de conectar.");
            return;
        }
        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }
        ensureHidProfileInitialized();
        if (hidDevice == null || !isHidAppRegistered) {
            call.reject("Perfil de Teclado Bluetooth HID ainda está inicializando. Tente novamente em 1 segundo.");
            return;
        }
        BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
        if (connectedHostDevice != null && !connectedHostDevice.getAddress().equals(address)) {
            hidDevice.disconnect(connectedHostDevice);
        }
        connectionStateStr = "connecting";
        boolean ok = hidDevice.connect(device);
        if (!ok) {
            connectionStateStr = "disconnected";
            call.reject("A TV não aceitou a conexão HID. Tente remover o pareamento na TV e parear novamente.");
            return;
        }
        JSObject res = new JSObject();
        res.put("requested", true);
        res.put("address", address);
        call.resolve(res);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void disconnectHidHost(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && hidDevice != null && hasBluetoothConnectPermission()) {
            String address = call.getString("address");
            BluetoothDevice target = connectedHostDevice;
            if (target == null && address != null && bluetoothAdapter != null) {
                target = bluetoothAdapter.getRemoteDevice(address);
            }
            if (target != null) {
                hidDevice.disconnect(target);
            }
        }
        connectedHostDevice = null;
        connectionStateStr = "disconnected";
        notifyConnectionChange("disconnected", null);
        call.resolve();
    }

    @PluginMethod
    public void sendHidKey(PluginCall call) {
        int keyCode = call.getInt("keyCode", 0);
        int modifiers = call.getInt("modifiers", 0);
        if (!isReadyToSend()) {
            call.reject("Nenhuma TV conectada via Bluetooth HID.");
            return;
        }
        hidExecutor.execute(() -> {
            boolean sent = sendKeyboardStroke((byte) modifiers, (byte) keyCode);
            mainHandler.post(() -> {
                if (sent) {
                    call.resolve();
                } else {
                    call.reject("Falha ao enviar tecla via Bluetooth.");
                }
            });
        });
    }

    @PluginMethod
    public void sendText(PluginCall call) {
        String text = call.getString("text", "");
        String layout = call.getString("layout", "us_intl");
        boolean pressEnter = Boolean.TRUE.equals(call.getBoolean("pressEnter", false));
        if (!isReadyToSend()) {
            call.reject("Nenhuma TV conectada via Bluetooth HID.");
            return;
        }
        if (text == null) text = "";
        final String payloadText = text;
        hidExecutor.execute(() -> {
            boolean ok = typeStringAsHid(payloadText, layout);
            if (ok && pressEnter) {
                sleepQuietly(18);
                ok = sendKeyboardStroke((byte) 0, (byte) 0x28);
            }
            final boolean finalOk = ok;
            mainHandler.post(() -> {
                if (finalOk) {
                    call.resolve();
                } else {
                    call.reject("Falha ao enviar texto para a TV.");
                }
            });
        });
    }

    @PluginMethod
    public void sendConsumerKey(PluginCall call) {
        int usage = call.getInt("usage", 0);
        if (!isReadyToSend()) {
            call.reject("Nenhuma TV conectada via Bluetooth HID.");
            return;
        }
        hidExecutor.execute(() -> {
            boolean sent = sendConsumerStroke(usage);
            mainHandler.post(() -> {
                if (sent) {
                    call.resolve();
                } else {
                    call.reject("Falha ao enviar comando de controle remoto.");
                }
            });
        });
    }

    @PluginMethod
    public void sendMouseMove(PluginCall call) {
        int dx = clampByteRange(call.getInt("dx", 0));
        int dy = clampByteRange(call.getInt("dy", 0));
        int wheel = clampByteRange(call.getInt("wheel", 0));
        int buttons = call.getInt("buttons", 0) & 0x07;
        if (!isReadyToSend()) {
            call.resolve();
            return;
        }
        hidExecutor.execute(() -> sendMouseReport((byte) buttons, (byte) dx, (byte) dy, (byte) wheel));
        call.resolve();
    }

    @PluginMethod
    public void sendMouseClick(PluginCall call) {
        String button = call.getString("button", "left");
        int mask = "right".equals(button) ? 0x02 : ("middle".equals(button) ? 0x04 : 0x01);
        if (!isReadyToSend()) {
            call.reject("Nenhuma TV conectada via Bluetooth HID.");
            return;
        }
        hidExecutor.execute(() -> {
            boolean ok = sendMouseReport((byte) mask, (byte) 0, (byte) 0, (byte) 0);
            sleepQuietly(18);
            sendMouseReport((byte) 0, (byte) 0, (byte) 0, (byte) 0);
            mainHandler.post(() -> {
                if (ok) {
                    call.resolve();
                } else {
                    call.reject("Falha ao enviar clique.");
                }
            });
        });
    }

    private boolean isReadyToSend() {
        return (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            hidDevice != null &&
            isHidAppRegistered &&
            connectedHostDevice != null &&
            hasBluetoothConnectPermission()
        );
    }

    private void ensureHidProfileInitialized() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled() || !hasAllBtPermissions()) return;
        if (hidDevice != null && isHidAppRegistered) return;
        initHidProfileApi28();
    }

    @RequiresApi(api = Build.VERSION_CODES.P)
    @SuppressLint("MissingPermission")
    private void initHidProfileApi28() {
        if (hidDevice != null) {
            registerHidAppApi28();
            return;
        }
        bluetoothAdapter.getProfileProxy(
            getContext(),
            new BluetoothProfile.ServiceListener() {
                @Override
                public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    if (profile == BluetoothProfile.HID_DEVICE) {
                        hidDevice = (BluetoothHidDevice) proxy;
                        isProfileConnected = true;
                        registerHidAppApi28();
                    }
                }

                @Override
                public void onServiceDisconnected(int profile) {
                    if (profile == BluetoothProfile.HID_DEVICE) {
                        hidDevice = null;
                        isProfileConnected = false;
                        isHidAppRegistered = false;
                        connectedHostDevice = null;
                        connectionStateStr = "disconnected";
                        notifyConnectionChange("disconnected", null);
                    }
                }
            },
            BluetoothProfile.HID_DEVICE
        );
    }

    @RequiresApi(api = Build.VERSION_CODES.P)
    @SuppressLint("MissingPermission")
    private void registerHidAppApi28() {
        if (hidDevice == null || isHidAppRegistered || !hasBluetoothConnectPermission()) return;
        BluetoothHidDeviceAppSdpSettings sdp = new BluetoothHidDeviceAppSdpSettings(
            "TeclaTV Keyboard",
            "Teclado Bluetooth e Controle para Smart TV",
            "TeclaTV",
            BluetoothHidDevice.SUBCLASS1_COMBO,
            HID_REPORT_DESCRIPTOR
        );
        BluetoothHidDeviceAppQosSettings inQos = new BluetoothHidDeviceAppQosSettings(
            BluetoothHidDeviceAppQosSettings.SERVICE_BEST_EFFORT,
            800,
            9,
            0,
            11250,
            BluetoothHidDeviceAppQosSettings.MAX
        );
        BluetoothHidDeviceAppQosSettings outQos = new BluetoothHidDeviceAppQosSettings(
            BluetoothHidDeviceAppQosSettings.SERVICE_BEST_EFFORT,
            800,
            9,
            0,
            11250,
            BluetoothHidDeviceAppQosSettings.MAX
        );

        hidDevice.registerApp(
            sdp,
            inQos,
            outQos,
            hidExecutor,
            new BluetoothHidDevice.Callback() {
                @Override
                public void onAppStatusChanged(BluetoothDevice pluggedDevice, boolean registered) {
                    isHidAppRegistered = registered;
                    if (registered && pluggedDevice != null) {
                        connectedHostDevice = pluggedDevice;
                        connectionStateStr = "connected";
                        notifyConnectionChange("connected", pluggedDevice);
                    }
                    mainHandler.post(() -> {
                        JSObject status = buildStatusObject();
                        notifyListeners("btProfileStatusChanged", status);
                    });
                }

                @Override
                public void onConnectionStateChanged(BluetoothDevice device, int state) {
                    if (state == BluetoothProfile.STATE_CONNECTED) {
                        connectedHostDevice = device;
                        connectionStateStr = "connected";
                        notifyConnectionChange("connected", device);
                    } else if (state == BluetoothProfile.STATE_CONNECTING) {
                        connectionStateStr = "connecting";
                        notifyConnectionChange("connecting", device);
                    } else if (state == BluetoothProfile.STATE_DISCONNECTING) {
                        connectionStateStr = "disconnecting";
                        notifyConnectionChange("disconnecting", device);
                    } else {
                        if (connectedHostDevice != null && device != null && connectedHostDevice.getAddress().equals(device.getAddress())) {
                            connectedHostDevice = null;
                        } else if (device == null) {
                            connectedHostDevice = null;
                        }
                        connectionStateStr = "disconnected";
                        notifyConnectionChange("disconnected", device);
                    }
                }

                @Override
                public void onGetReport(BluetoothDevice device, byte type, byte id, int bufferSize) {
                    if (hidDevice != null && hasBluetoothConnectPermission()) {
                        byte[] empty = id == REPORT_ID_KEYBOARD
                            ? new byte[8]
                            : (id == REPORT_ID_CONSUMER ? new byte[2] : new byte[4]);
                        hidDevice.replyReport(device, type, id, empty);
                    }
                }

                @Override
                public void onSetReport(BluetoothDevice device, byte type, byte id, byte[] data) {
                    if (hidDevice != null && hasBluetoothConnectPermission()) {
                        hidDevice.reportError(device, BluetoothHidDevice.ERROR_RSP_SUCCESS);
                    }
                }
            }
        );
    }

    private void notifyConnectionChange(String state, BluetoothDevice device) {
        mainHandler.post(() -> {
            JSObject payload = new JSObject();
            payload.put("state", state);
            if (device != null && hasBluetoothConnectPermission()) {
                payload.put("device", serializeDevice(device));
            }
            notifyListeners("btConnectionStateChanged", payload);
        });
    }

    @SuppressLint({"MissingPermission", "NewApi"})
    private boolean sendKeyboardStroke(byte modifiers, byte keyCode) {
        if (!isReadyToSend()) return false;
        byte[] down = new byte[] { modifiers, 0x00, keyCode, 0x00, 0x00, 0x00, 0x00, 0x00 };
        byte[] up = new byte[8];
        boolean sentDown = hidDevice.sendReport(connectedHostDevice, REPORT_ID_KEYBOARD, down);
        sleepQuietly(16);
        boolean sentUp = hidDevice.sendReport(connectedHostDevice, REPORT_ID_KEYBOARD, up);
        return sentDown && sentUp;
    }

    @SuppressLint({"MissingPermission", "NewApi"})
    private boolean sendConsumerStroke(int usage) {
        if (!isReadyToSend()) return false;
        byte lo = (byte) (usage & 0xFF);
        byte hi = (byte) ((usage >> 8) & 0xFF);
        boolean sentDown = hidDevice.sendReport(connectedHostDevice, REPORT_ID_CONSUMER, new byte[] { lo, hi });
        sleepQuietly(24);
        boolean sentUp = hidDevice.sendReport(connectedHostDevice, REPORT_ID_CONSUMER, new byte[] { 0x00, 0x00 });
        return sentDown && sentUp;
    }

    @SuppressLint({"MissingPermission", "NewApi"})
    private boolean sendMouseReport(byte buttons, byte dx, byte dy, byte wheel) {
        if (!isReadyToSend()) return false;
        return hidDevice.sendReport(
            connectedHostDevice,
            REPORT_ID_MOUSE,
            new byte[] { buttons, dx, dy, wheel }
        );
    }

    private boolean typeStringAsHid(String text, String layout) {
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '\r') continue;

            // Handle Portuguese accented characters via US-International dead keys or fallback ASCII
            String deadCombo = resolvePortugueseDeadKey(ch);
            if (deadCombo != null) {
                if ("abnt2".equals(layout)) {
                    // On ABNT2 layout, ç has its own physical key (0x33)
                    if (ch == 'ç') {
                        if (!sendKeyboardStroke((byte) 0, (byte) 0x33)) return false;
                        sleepQuietly(18);
                        continue;
                    } else if (ch == 'Ç') {
                        if (!sendKeyboardStroke((byte) MOD_LSHIFT, (byte) 0x33)) return false;
                        sleepQuietly(18);
                        continue;
                    }
                }
                char deadKey = deadCombo.charAt(0);
                char baseKey = deadCombo.charAt(1);
                int[] deadMapping = US_CHAR_MAP.get(deadKey);
                int[] baseMapping = US_CHAR_MAP.get(baseKey);
                if (deadMapping != null && baseMapping != null) {
                    if (!sendKeyboardStroke((byte) deadMapping[0], (byte) deadMapping[1])) return false;
                    sleepQuietly(16);
                    if (!sendKeyboardStroke((byte) baseMapping[0], (byte) baseMapping[1])) return false;
                    sleepQuietly(18);
                    continue;
                }
            }

            int[] mapping = US_CHAR_MAP.get(ch);
            if (mapping != null) {
                if (!sendKeyboardStroke((byte) mapping[0], (byte) mapping[1])) {
                    return false;
                }
                sleepQuietly(18);
            }
        }
        return true;
    }

    private static String resolvePortugueseDeadKey(char ch) {
        switch (ch) {
            case 'á': return "'a";
            case 'Á': return "'A";
            case 'é': return "'e";
            case 'É': return "'E";
            case 'í': return "'i";
            case 'Í': return "'I";
            case 'ó': return "'o";
            case 'Ó': return "'O";
            case 'ú': return "'u";
            case 'Ú': return "'U";
            case 'ç': return "'c";
            case 'Ç': return "'C";
            case 'à': return "`a";
            case 'À': return "`A";
            case 'â': return "^a";
            case 'Â': return "^A";
            case 'ê': return "^e";
            case 'Ê': return "^E";
            case 'ô': return "^o";
            case 'Ô': return "^O";
            case 'ã': return "~a";
            case 'Ã': return "~A";
            case 'õ': return "~o";
            case 'Õ': return "~O";
            default: return null;
        }
    }

    @SuppressLint("MissingPermission")
    private JSObject serializeDevice(BluetoothDevice device) {
        JSObject obj = new JSObject();
        String name = null;
        try {
            name = device.getName();
        } catch (Exception ignored) {
        }
        String address = device.getAddress();
        if (name == null || name.trim().isEmpty()) {
            name = "Dispositivo Bluetooth (" + address + ")";
        }
        int majorClass = -1;
        int deviceClass = -1;
        try {
            BluetoothClass btClass = device.getBluetoothClass();
            if (btClass != null) {
                majorClass = btClass.getMajorDeviceClass();
                deviceClass = btClass.getDeviceClass();
            }
        } catch (Exception ignored) {
        }

        boolean likelyTv = isLikelyTv(name, majorClass, deviceClass);
        obj.put("address", address);
        obj.put("name", name);
        obj.put("bondState", bondStateToString(device.getBondState()));
        obj.put("isTv", likelyTv);
        obj.put("majorClass", majorClass);
        obj.put("deviceClass", deviceClass);
        obj.put("connected", connectedHostDevice != null && address.equals(connectedHostDevice.getAddress()));
        return obj;
    }

    private static boolean isLikelyTv(String name, int majorClass, int deviceClass) {
        if (majorClass == BluetoothClass.Device.Major.AUDIO_VIDEO) {
            if (
                deviceClass == BluetoothClass.Device.AUDIO_VIDEO_VIDEO_DISPLAY_AND_LOUDSPEAKER ||
                deviceClass == BluetoothClass.Device.AUDIO_VIDEO_SET_TOP_BOX ||
                deviceClass == BluetoothClass.Device.AUDIO_VIDEO_VIDEO_MONITOR
            ) {
                return true;
            }
        }
        String lower = name.toLowerCase();
        return (
            lower.contains("tv") ||
            lower.contains("samsung") ||
            lower.contains("lg") ||
            lower.contains("webos") ||
            lower.contains("tizen") ||
            lower.contains("bravia") ||
            lower.contains("sony") ||
            lower.contains("tcl") ||
            lower.contains("philips") ||
            lower.contains("roku") ||
            lower.contains("fire") ||
            lower.contains("chromecast") ||
            lower.contains("mi box") ||
            lower.contains("shield") ||
            lower.contains("hisense") ||
            lower.contains("aoc") ||
            lower.contains("multilaser")
        );
    }

    private static String bondStateToString(int state) {
        switch (state) {
            case BluetoothDevice.BOND_BONDED:
                return "bonded";
            case BluetoothDevice.BOND_BONDING:
                return "bonding";
            default:
                return "none";
        }
    }

    private static int clampByteRange(int value) {
        return Math.max(-127, Math.min(127, value));
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
        }
    }
}
