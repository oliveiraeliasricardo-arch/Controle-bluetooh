package app.telalivre.tv;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.MediaRouteButton;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaRouter;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.net.wifi.p2p.WifiP2pDevice;
import android.net.wifi.p2p.WifiP2pDeviceList;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
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
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(
    name = "TvCast",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location"),
        @Permission(strings = { "android.permission.NEARBY_WIFI_DEVICES" }, alias = "nearby"),
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera"),
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "audio")
    }
)
public class TvCastPlugin extends Plugin {

    private static final String SSDP_ADDR = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final String[] SSDP_TARGETS = {
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "urn:schemas-upnp-org:service:AVTransport:1",
        "urn:dial-multiscreen-org:service:dial:1",
        "urn:samsung.com:device:RemoteControlReceiver:1",
        "ssdp:all"
    };
    private static final String[] MDNS_TYPES = {
        "_googlecast._tcp.",
        "_airplay._tcp.",
        "_samsung-tv._tcp."
    };
    private static final String[] DLNA_DESC_PATHS = {
        ":9197/dmr",
        ":7676/smp_15_",
        ":7676/smp_2_",
        ":52235/dmr/SamsungMRDesc.xml",
        ":52323/dmr.xml",
        ":1908/",
        ":1400/xml/device_description.xml",
        ":49152/description.xml",
        ":49153/description.xml"
    };

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, JSObject> discoveredMap = new ConcurrentHashMap<>();
    private final Map<String, MediaRouter.RouteInfo> routeCache = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<OutputStream> tsClients = new CopyOnWriteArrayList<>();

    private WifiP2pManager wifiP2pManager;
    private WifiP2pManager.Channel wifiP2pChannel;

    // Active TV target state
    private volatile String connectedSource = null;
    private volatile String connectedDeviceId = null;
    private volatile String connectedTvName = null;
    private volatile String connectedManufacturer = null;
    private volatile String connectedTvIp = null;
    private volatile String connectedAvTransportUrl = null;

    // Active screen capture & streaming state
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private volatile MediaCodec h264Codec;
    private Surface codecInputSurface;
    private TsMuxer tsMuxer;
    private volatile byte[] spsPpsBytes = null;
    private final AtomicBoolean firstTsKeyframeReady = new AtomicBoolean(false);
    private HandlerThread captureThread;
    private Handler captureHandler;
    private ServerSocket httpStreamServer;
    private volatile boolean streamingActive = false;
    private volatile boolean tvPullingStream = false;
    private volatile byte[] latestJpegFrame = null;
    private volatile long lastFrameNotifyAt = 0L;
    private volatile int captureWidth = 720;
    private volatile int captureHeight = 1280;
    private volatile String requestedTargetMode = "auto";

    @Override
    public void load() {
        super.load();
        try {
            wifiP2pManager = (WifiP2pManager) getContext().getSystemService(Context.WIFI_P2P_SERVICE);
            if (wifiP2pManager != null) {
                wifiP2pChannel = wifiP2pManager.initialize(getContext(), Looper.getMainLooper(), null);
            }
        } catch (Exception ignored) {
            wifiP2pManager = null;
            wifiP2pChannel = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopCaptureInternal(false);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void scanTvs(PluginCall call) {
        String alias = Build.VERSION.SDK_INT >= 33 ? "nearby" : "location";
        if (!hasRequiredWifiDiscoveryPermission()) {
            requestPermissionForAlias(alias, call, "onWifiPermissionResult");
            return;
        }
        runFullDiscovery(call);
    }

    @PermissionCallback
    private void onWifiPermissionResult(PluginCall call) {
        runFullDiscovery(call);
    }

    private boolean hasRequiredWifiDiscoveryPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(getContext(), "android.permission.NEARBY_WIFI_DEVICES")
                == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void runFullDiscovery(PluginCall call) {
        executor.execute(() -> {
            long startMs = System.currentTimeMillis();
            discoveredMap.clear();
            routeCache.clear();

            WifiManager.MulticastLock multicastLock = null;
            try {
                WifiManager wm = (WifiManager) getContext().getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    multicastLock = wm.createMulticastLock("TelaLivreDiscoveryLock");
                    multicastLock.setReferenceCounted(false);
                    multicastLock.acquire();
                }
            } catch (Exception ignored) {
                multicastLock = null;
            }

            final AtomicInteger p2pCount = new AtomicInteger(0);
            final AtomicInteger routerCount = new AtomicInteger(0);

            String localIp = getLocalWifiIpv4();
            CountDownLatch latch = new CountDownLatch(2);

            executor.execute(() -> {
                try { scanMediaRouterRoutes(routerCount); } catch (Exception ignored) {} finally { latch.countDown(); }
            });
            executor.execute(() -> {
                try { scanWifiDirectPeers(p2pCount); } catch (Exception ignored) {} finally { latch.countDown(); }
            });

            try {
                latch.await(3200, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
            } finally {
                if (multicastLock != null && multicastLock.isHeld()) {
                    try { multicastLock.release(); } catch (Exception ignored) {}
                }
            }

            // Only hide raw wifi_direct if a native MediaRouter wireless display route already exists for the same TV
            List<String> keysToRemove = new ArrayList<>();
            for (Map.Entry<String, JSObject> entry : discoveredMap.entrySet()) {
                JSObject dev = entry.getValue();
                if (!"wifi_direct".equals(dev.getString("source", ""))) continue;
                String p2pName = normalizeTvName(dev.getString("name", ""));
                if (p2pName.isEmpty()) continue;

                for (JSObject other : discoveredMap.values()) {
                    if (!"media_router".equals(other.getString("source", ""))) continue;
                    String otherName = normalizeTvName(other.getString("name", ""));
                    if (!otherName.isEmpty() && (otherName.contains(p2pName) || p2pName.contains(otherName))) {
                        keysToRemove.add(entry.getKey());
                        break;
                    }
                }
            }
            for (String k : keysToRemove) {
                discoveredMap.remove(k);
            }

            JSArray devicesArray = new JSArray();
            for (JSObject dev : discoveredMap.values()) {
                devicesArray.put(dev);
            }

            JSObject res = new JSObject();
            res.put("scannedAt", System.currentTimeMillis());
            res.put("durationMs", System.currentTimeMillis() - startMs);
            res.put("localIp", localIp);
            res.put("ssdpResponses", 0);
            res.put("mdnsResponses", 0);
            res.put("wifiP2pCount", p2pCount.get());
            res.put("mediaRouterCount", routerCount.get());
            res.put("devices", devicesArray);
            call.resolve(res);
        });
    }

    private String normalizeTvName(String raw) {
        if (raw == null) return "";
        return raw.toLowerCase(Locale.ROOT)
            .replaceAll("\\([^)]*\\)", "")
            .replaceAll("\\[[^]]*\\]", "")
            .replaceAll("[^a-z0-9]", "");
    }

    private void putDiscoveredDevice(JSObject dev) {
        String ip = dev.getString("ip", "");
        String source = dev.getString("source", "");
        String key = (ip != null && !ip.isEmpty()) ? ("lan:" + ip) : dev.getString("id", "");
        if (key == null || key.isEmpty()) return;

        JSObject existing = discoveredMap.get(key);
        if (existing != null) {
            String existingAv = existing.getString("avTransportUrl", "");
            String newAv = dev.getString("avTransportUrl", "");
            // Preserve AVTransport URL and prefer SSDP/DLNA metadata & real friendly name
            if ((newAv == null || newAv.isEmpty()) && existingAv != null && !existingAv.isEmpty()) {
                dev.put("avTransportUrl", existingAv);
                if (!"ssdp_dlna".equals(source) && "ssdp_dlna".equals(existing.getString("source", ""))) {
                    dev.put("source", "ssdp_dlna");
                }
                String existingName = existing.getString("name", "");
                String newName = dev.getString("name", "");
                if (existingName != null && !existingName.isEmpty() && (newName == null || newName.contains("("))) {
                    dev.put("name", existingName);
                }
            }
        }
        discoveredMap.put(key, dev);
    }

    private void scanMediaRouterRoutes(AtomicInteger counter) {
        final MediaRouter[] routerHolder = new MediaRouter[1];
        final MediaRouter.SimpleCallback[] cbHolder = new MediaRouter.SimpleCallback[1];

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                MediaRouter router = (MediaRouter) getContext().getSystemService(Context.MEDIA_ROUTER_SERVICE);
                if (router != null) {
                    routerHolder[0] = router;
                    cbHolder[0] = new MediaRouter.SimpleCallback() {};
                    router.addCallback(
                        MediaRouter.ROUTE_TYPE_LIVE_VIDEO,
                        cbHolder[0],
                        MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN
                    );
                }
            } catch (Exception ignored) {}
        });

        try { Thread.sleep(1800); } catch (InterruptedException ignored) {}

        CountDownLatch uiLatch = new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                MediaRouter router = routerHolder[0];
                if (router != null) {
                    MediaRouter.RouteInfo defaultRoute = router.getDefaultRoute();
                    int count = router.getRouteCount();
                    for (int i = 0; i < count; i++) {
                        MediaRouter.RouteInfo route = router.getRouteAt(i);
                        if (route == null || route.equals(defaultRoute) || !route.isEnabled()) {
                            continue;
                        }
                        if ((route.getSupportedTypes() & MediaRouter.ROUTE_TYPE_LIVE_VIDEO) != 0) {
                            CharSequence rawName = route.getName(getContext());
                            String name = rawName != null ? rawName.toString().trim() : "Smart TV Sem Fio";
                            if (name.isEmpty()) continue;

                            String id = "mr:" + name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "_");
                            routeCache.put(id, route);

                            JSObject dev = new JSObject();
                            dev.put("id", id);
                            dev.put("name", name);
                            dev.put("manufacturer", inferManufacturer(name));
                            dev.put("model", "Tela Sem Fio (Miracast / Cast)");
                            dev.put("source", "media_router");
                            JSArray protocols = new JSArray();
                            protocols.put("Miracast / Tela Sem Fio");
                            dev.put("protocols", protocols);
                            dev.put("online", true);
                            dev.put("lastSeenAt", System.currentTimeMillis());

                            discoveredMap.put(id, dev);
                            counter.incrementAndGet();
                        }
                    }
                    if (cbHolder[0] != null) {
                        router.removeCallback(cbHolder[0]);
                    }
                }
            } catch (Exception ignored) {
            } finally {
                uiLatch.countDown();
            }
        });
        try { uiLatch.await(800, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) {}
    }

    @SuppressLint("MissingPermission")
    private void scanWifiDirectPeers(AtomicInteger counter) {
        if (wifiP2pManager == null || wifiP2pChannel == null || !hasRequiredWifiDiscoveryPermission()) {
            return;
        }

        CountDownLatch peerLatch = new CountDownLatch(1);
        final AtomicBoolean completed = new AtomicBoolean(false);
        final Context appCtx = getContext().getApplicationContext();

        final Runnable requestNow = () -> {
            try {
                wifiP2pManager.requestPeers(wifiP2pChannel, (WifiP2pDeviceList peers) -> {
                    if (peers != null && !peers.getDeviceList().isEmpty()) {
                        for (WifiP2pDevice peer : peers.getDeviceList()) {
                            if (peer == null || peer.deviceAddress == null) continue;
                            String name = peer.deviceName != null && !peer.deviceName.trim().isEmpty()
                                ? peer.deviceName.trim()
                                : "TV Wi-Fi Direct";
                            String id = "p2p:" + peer.deviceAddress;
                            if (!discoveredMap.containsKey(id)) {
                                JSObject dev = new JSObject();
                                dev.put("id", id);
                                dev.put("name", name);
                                dev.put("manufacturer", inferManufacturer(name));
                                dev.put("model", "Miracast Wi-Fi Direct");
                                dev.put("source", "wifi_direct");
                                dev.put("deviceAddress", peer.deviceAddress);
                                JSArray protocols = new JSArray();
                                protocols.put("Wi-Fi Direct");
                                dev.put("protocols", protocols);
                                dev.put("online", true);
                                dev.put("lastSeenAt", System.currentTimeMillis());

                                discoveredMap.put(id, dev);
                                counter.incrementAndGet();
                            }
                        }
                        if (completed.compareAndSet(false, true)) {
                            peerLatch.countDown();
                        }
                    }
                });
            } catch (Exception ignored) {}
        };

        BroadcastReceiver p2pReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION.equals(intent.getAction())) {
                    requestNow.run();
                }
            }
        };

        try {
            IntentFilter filter = new IntentFilter(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION);
            if (Build.VERSION.SDK_INT >= 33) {
                appCtx.registerReceiver(p2pReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                appCtx.registerReceiver(p2pReceiver, filter);
            }

            wifiP2pManager.discoverPeers(wifiP2pChannel, new WifiP2pManager.ActionListener() {
                @Override
                public void onSuccess() {
                    requestNow.run();
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        requestNow.run();
                        if (completed.compareAndSet(false, true)) {
                            peerLatch.countDown();
                        }
                    }, 1800);
                }

                @Override
                public void onFailure(int reason) {
                    requestNow.run();
                    if (completed.compareAndSet(false, true)) {
                        peerLatch.countDown();
                    }
                }
            });
            peerLatch.await(2400, TimeUnit.MILLISECONDS);
        } catch (Exception ignored) {
        } finally {
            try { appCtx.unregisterReceiver(p2pReceiver); } catch (Exception ignored) {}
        }
    }

    private void scanSsdpDevices(AtomicInteger counter) {
        MulticastSocket socket = null;
        List<Future<?>> fetchFutures = new ArrayList<>();
        try {
            socket = new MulticastSocket();
            NetworkInterface wifiIf = getWifiNetworkInterface();
            if (wifiIf != null) {
                try { socket.setNetworkInterface(wifiIf); } catch (Exception ignored) {}
            }
            socket.setSoTimeout(350);

            InetAddress group = InetAddress.getByName(SSDP_ADDR);
            for (int burst = 0; burst < 2; burst++) {
                for (String st : SSDP_TARGETS) {
                    String msg = "M-SEARCH * HTTP/1.1\r\n"
                        + "HOST: 239.255.255.250:1900\r\n"
                        + "MAN: \"ssdp:discover\"\r\n"
                        + "MX: 1\r\n"
                        + "ST: " + st + "\r\n\r\n";
                    byte[] data = msg.getBytes(StandardCharsets.UTF_8);
                    DatagramPacket packet = new DatagramPacket(data, data.length, group, SSDP_PORT);
                    socket.send(packet);
                }
                if (burst == 0) {
                    try { Thread.sleep(250); } catch (InterruptedException ignored) {}
                }
            }

            long deadline = System.currentTimeMillis() + 2200;
            byte[] buf = new byte[4096];
            List<String> seenLocations = new ArrayList<>();

            while (System.currentTimeMillis() < deadline) {
                try {
                    DatagramPacket resp = new DatagramPacket(buf, buf.length);
                    socket.receive(resp);
                    counter.incrementAndGet();

                    String raw = new String(resp.getData(), 0, resp.getLength(), StandardCharsets.UTF_8);
                    String location = extractHeader(raw, "location");
                    String serverHeader = extractHeader(raw, "server");
                    String senderIp = resp.getAddress() != null ? resp.getAddress().getHostAddress() : null;
                    if (senderIp == null) continue;

                    String dedupeKey = location != null ? location : senderIp;
                    if (seenLocations.contains(dedupeKey)) continue;
                    seenLocations.add(dedupeKey);

                    fetchFutures.add(executor.submit(() -> {
                        JSObject dev = fetchSsdpDescription(senderIp, location, serverHeader);
                        if (dev != null) {
                            putDiscoveredDevice(dev);
                        }
                    }));
                } catch (Exception timeoutOrErr) {
                    if (!(timeoutOrErr instanceof java.net.SocketTimeoutException)) {
                        break;
                    }
                }
            }

            for (Future<?> f : fetchFutures) {
                try { f.get(1800, TimeUnit.MILLISECONDS); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            if (socket != null) {
                try { socket.close(); } catch (Exception ignored) {}
            }
        }
    }

    private JSObject fetchSsdpDescription(String ip, String locationUrl, String serverHeader) {
        String friendlyName = null;
        String manufacturer = null;
        String modelName = null;
        String avTransportUrl = null;
        boolean looksLikeTvOrRenderer = false;

        if (locationUrl != null && locationUrl.startsWith("http")) {
            String xml = httpGetText(locationUrl, 1800);
            if (xml != null) {
                friendlyName = extractXmlTag(xml, "friendlyName");
                manufacturer = extractXmlTag(xml, "manufacturer");
                modelName = extractXmlTag(xml, "modelName");
                avTransportUrl = extractAvTransportControlUrl(xml, locationUrl);

                String lower = xml.toLowerCase(Locale.ROOT);
                looksLikeTvOrRenderer = avTransportUrl != null
                    || lower.contains("mediarenderer")
                    || lower.contains("dial")
                    || lower.contains("tv")
                    || lower.contains("samsung")
                    || lower.contains("lg")
                    || lower.contains("sony")
                    || lower.contains("bravia")
                    || lower.contains("roku")
                    || lower.contains("philips")
                    || lower.contains("tcl");
            }
        }

        if (avTransportUrl == null && looksLikeTvOrRenderer) {
            avTransportUrl = findDlnaEndpointForIp(ip);
        }

        if (!looksLikeTvOrRenderer && serverHeader != null) {
            String sLower = serverHeader.toLowerCase(Locale.ROOT);
            looksLikeTvOrRenderer = sLower.contains("tv")
                || sLower.contains("samsung")
                || sLower.contains("webos")
                || sLower.contains("tizen")
                || sLower.contains("bravia")
                || sLower.contains("dlna");
        }

        if (!looksLikeTvOrRenderer) return null;

        String inferred = inferManufacturer(
            (manufacturer != null ? manufacturer : "") + " "
                + (friendlyName != null ? friendlyName : "") + " "
                + (serverHeader != null ? serverHeader : "")
        );

        JSObject dev = new JSObject();
        dev.put("id", "ssdp:" + ip);
        dev.put("name", friendlyName != null && !friendlyName.isEmpty() ? friendlyName : inferred + " Smart TV (" + ip + ")");
        dev.put("manufacturer", inferred);
        dev.put("model", modelName != null && !modelName.isEmpty() ? modelName : "Smart TV DLNA");
        dev.put("source", "ssdp_dlna");
        dev.put("ip", ip);
        if (avTransportUrl != null) {
            dev.put("avTransportUrl", avTransportUrl);
        }
        if (locationUrl != null) {
            dev.put("locationUrl", locationUrl);
        }
        JSArray protocols = new JSArray();
        protocols.put(avTransportUrl != null ? "DLNA / UPnP" : "Wi-Fi Smart TV");
        dev.put("protocols", protocols);
        dev.put("online", true);
        dev.put("lastSeenAt", System.currentTimeMillis());
        return dev;
    }

    @SuppressWarnings("deprecation")
    private void scanMdnsServices(AtomicInteger counter) {
        NsdManager nsdManager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsdManager == null) return;

        List<NsdManager.DiscoveryListener> listeners = new ArrayList<>();
        for (String serviceType : MDNS_TYPES) {
            NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
                @Override public void onStartDiscoveryFailed(String st, int err) {}
                @Override public void onStopDiscoveryFailed(String st, int err) {}
                @Override public void onDiscoveryStarted(String regType) {}
                @Override public void onDiscoveryStopped(String st) {}

                @Override
                public void onServiceFound(NsdServiceInfo service) {
                    counter.incrementAndGet();
                    try {
                        nsdManager.resolveService(service, new NsdManager.ResolveListener() {
                            @Override public void onResolveFailed(NsdServiceInfo s, int err) {}

                            @Override
                            public void onServiceResolved(NsdServiceInfo resolved) {
                                InetAddress host = resolved.getHost();
                                String ip = host != null ? host.getHostAddress() : null;
                                if (ip == null) return;

                                String name = resolved.getServiceName() != null
                                    ? resolved.getServiceName().trim()
                                    : "Smart TV Cast";
                                String proto = serviceType.contains("airplay")
                                    ? "AirPlay"
                                    : serviceType.contains("samsung")
                                        ? "Samsung Wi-Fi"
                                        : "Google Cast (mDNS)";

                                JSObject dev = new JSObject();
                                dev.put("id", "mdns:" + ip);
                                dev.put("name", name);
                                dev.put("manufacturer", inferManufacturer(name + " " + serviceType));
                                dev.put("model", "Smart TV na Rede Wi-Fi");
                                dev.put("source", "mdns_cast");
                                dev.put("ip", ip);
                                String avUrl = findDlnaEndpointForIp(ip);
                                if (avUrl != null) {
                                    dev.put("avTransportUrl", avUrl);
                                }
                                JSArray protocols = new JSArray();
                                protocols.put(avUrl != null ? "DLNA + " + proto : proto);
                                dev.put("protocols", protocols);
                                dev.put("online", true);
                                dev.put("lastSeenAt", System.currentTimeMillis());
                                putDiscoveredDevice(dev);
                            }
                        });
                    } catch (Exception ignored) {}
                }

                @Override public void onServiceLost(NsdServiceInfo service) {}
            };

            try {
                nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener);
                listeners.add(listener);
            } catch (Exception ignored) {}
        }

        try { Thread.sleep(1600); } catch (InterruptedException ignored) {}

        for (NsdManager.DiscoveryListener listener : listeners) {
            try { nsdManager.stopServiceDiscovery(listener); } catch (Exception ignored) {}
        }
    }

    private void scanLocalSubnetSmartTvs(String localIp) {
        String[] parts = localIp.split("\\.");
        if (parts.length != 4) return;
        String prefix = parts[0] + "." + parts[1] + "." + parts[2] + ".";

        ExecutorService pool = Executors.newFixedThreadPool(32);
        CountDownLatch subnetLatch = new CountDownLatch(254);

        for (int host = 1; host <= 254; host++) {
            final String targetIp = prefix + host;
            if (targetIp.equals(localIp)) {
                subnetLatch.countDown();
                continue;
            }
            pool.execute(() -> {
                try {
                    if (discoveredMap.containsKey("lan:" + targetIp)) {
                        return;
                    }
                    JSObject found = probeTvIpInternal(targetIp, 260);
                    if (found != null) {
                        putDiscoveredDevice(found);
                    }
                } catch (Exception ignored) {
                } finally {
                    subnetLatch.countDown();
                }
            });
        }

        try {
            subnetLatch.await(2100, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
        } finally {
            pool.shutdownNow();
        }
    }

    private JSObject probeTvIpInternal(String ip, int timeoutMs) {
        String dlnaAvUrl = null;

        // 1. Samsung Smart TV (:8001/api/v2/)
        if (isTcpPortOpen(ip, 8001, timeoutMs)) {
            String json = httpGetText("http://" + ip + ":8001/api/v2/", 900);
            String name = extractJsonString(json, "name");
            String model = extractJsonString(json, "modelName");
            dlnaAvUrl = findDlnaEndpointForIp(ip);
            return buildIpTvObject(
                ip,
                name != null ? name : "Samsung Smart TV (" + ip + ")",
                "Samsung",
                model != null ? model : "Samsung Tizen TV",
                dlnaAvUrl != null ? "DLNA + Samsung Wi-Fi" : "Samsung Wi-Fi",
                dlnaAvUrl
            );
        }

        // 2. Roku TV (:8060)
        if (isTcpPortOpen(ip, 8060, timeoutMs)) {
            String xml = httpGetText("http://" + ip + ":8060/query/device-info", 900);
            String name = extractXmlTag(xml, "user-device-name");
            if (name == null) name = extractXmlTag(xml, "friendly-device-name");
            String model = extractXmlTag(xml, "model-name");
            dlnaAvUrl = findDlnaEndpointForIp(ip);
            return buildIpTvObject(
                ip,
                name != null ? name : "Roku TV (" + ip + ")",
                "Roku",
                model != null ? model : "Roku / TCL Smart TV",
                dlnaAvUrl != null ? "DLNA + Roku" : "Roku ECP",
                dlnaAvUrl
            );
        }

        // 3. LG webOS TV (:3000 / :3001)
        if (isTcpPortOpen(ip, 3000, timeoutMs) || isTcpPortOpen(ip, 3001, timeoutMs)) {
            dlnaAvUrl = findDlnaEndpointForIp(ip);
            return buildIpTvObject(
                ip,
                "LG webOS TV (" + ip + ")",
                "LG",
                "LG Smart TV webOS",
                dlnaAvUrl != null ? "DLNA + LG webOS" : "LG webOS",
                dlnaAvUrl
            );
        }

        // 4. Sony Bravia (:80 /sony/system)
        if (isTcpPortOpen(ip, 80, timeoutMs)) {
            String bravia = httpPostJson(
                "http://" + ip + "/sony/system",
                "{\"method\":\"getSystemInformation\",\"id\":1,\"params\":[],\"version\":\"1.0\"}",
                700
            );
            if (bravia != null && bravia.contains("BRAVIA")) {
                String model = extractJsonString(bravia, "model");
                dlnaAvUrl = findDlnaEndpointForIp(ip);
                return buildIpTvObject(
                    ip,
                    "Sony BRAVIA (" + ip + ")",
                    "Sony",
                    model != null ? model : "Sony BRAVIA",
                    dlnaAvUrl != null ? "DLNA + Sony Bravia" : "Sony Bravia IP",
                    dlnaAvUrl
                );
            }
        }

        // 5. Direct DLNA DMR ports (:9197 / :7676 / :49152) even when SSDP multicast was filtered
        if (isTcpPortOpen(ip, 9197, timeoutMs) || isTcpPortOpen(ip, 7676, timeoutMs)) {
            dlnaAvUrl = findDlnaEndpointForIp(ip);
            if (dlnaAvUrl != null) {
                return buildIpTvObject(
                    ip,
                    "Smart TV DLNA (" + ip + ")",
                    "Outra TV",
                    "Receptor DLNA Wi-Fi",
                    "DLNA / UPnP",
                    dlnaAvUrl
                );
            }
        }

        return null;
    }

    private String findDlnaEndpointForIp(String ip) {
        for (String suffix : DLNA_DESC_PATHS) {
            String descUrl = "http://" + ip + suffix;
            String xml = httpGetText(descUrl, 450);
            if (xml != null && xml.contains("AVTransport")) {
                String avUrl = extractAvTransportControlUrl(xml, descUrl);
                if (avUrl != null) {
                    return avUrl;
                }
            }
        }
        return null;
    }

    private JSObject buildIpTvObject(
        String ip,
        String name,
        String manufacturer,
        String model,
        String protocol,
        String avTransportUrl
    ) {
        JSObject dev = new JSObject();
        dev.put("id", "ip:" + ip);
        dev.put("name", name);
        dev.put("manufacturer", manufacturer);
        dev.put("model", model);
        dev.put("source", avTransportUrl != null ? "ssdp_dlna" : "ip_probe");
        dev.put("ip", ip);
        if (avTransportUrl != null) {
            dev.put("avTransportUrl", avTransportUrl);
        }
        JSArray protocols = new JSArray();
        protocols.put(protocol);
        dev.put("protocols", protocols);
        dev.put("online", true);
        dev.put("lastSeenAt", System.currentTimeMillis());
        return dev;
    }

    @PluginMethod
    public void probeTvIp(PluginCall call) {
        String ip = call.getString("ip", "").trim();
        if (!ip.matches("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)[0-9.]+$")) {
            call.reject("Informe um IP local válido da rede Wi-Fi (ex.: 192.168.1.50).");
            return;
        }
        executor.execute(() -> {
            JSObject found = probeTvIpInternal(ip, 1200);
            if (found == null) {
                call.reject("Nenhuma Smart TV respondeu no IP " + ip + ".");
                return;
            }
            putDiscoveredDevice(found);
            JSObject res = new JSObject();
            res.put("device", found);
            call.resolve(res);
        });
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connectTv(PluginCall call) {
        final String rawId = call.getString("id", "");
        final String rawSource = call.getString("source", "");
        final String rawName = call.getString("name", "Smart TV");
        final String rawManufacturer = call.getString("manufacturer", "Smart TV");
        final String rawIp = call.getString("ip", "");
        final String rawAvTransportUrl = call.getString("avTransportUrl", "");

        if ("media_router".equals(rawSource)) {
            MediaRouter.RouteInfo route = routeCache.get(rawId);
            if (route == null) {
                call.reject("TV sem fio não encontrada mais no alcance. Toque em Procurar TV.");
                return;
            }
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    MediaRouter router = (MediaRouter) getContext().getSystemService(Context.MEDIA_ROUTER_SERVICE);
                    if (router == null) {
                        call.reject("Serviço MediaRouter indisponível neste aparelho.");
                        return;
                    }
                    router.selectRoute(MediaRouter.ROUTE_TYPE_LIVE_VIDEO, route);
                    openSystemMediaRouteDialog();

                    connectedSource = rawSource;
                    connectedDeviceId = rawId;
                    connectedTvName = rawName;
                    connectedManufacturer = rawManufacturer;
                    connectedTvIp = null;
                    connectedAvTransportUrl = null;

                    JSObject res = new JSObject();
                    res.put("connected", true);
                    res.put("mode", "miracast");
                    res.put("tvName", rawName);
                    res.put("manufacturer", rawManufacturer);
                    res.put("message", "Selecione " + rawName + " na janela de transmissão ou toque em Desconectar para encerrar.");
                    call.resolve(res);
                } catch (Exception e) {
                    call.reject("Não foi possível conectar na rota sem fio: " + e.getMessage());
                }
            });
            return;
        }

        if ("wifi_direct".equals(rawSource)) {
            String targetNorm = normalizeTvName(rawName);

            // 1. Prefer real system MediaRouter wireless display route (in-app Miracast dialog)
            MediaRouter.RouteInfo matchedRoute = null;
            for (Map.Entry<String, MediaRouter.RouteInfo> entry : routeCache.entrySet()) {
                CharSequence rName = entry.getValue().getName(getContext());
                String rNorm = normalizeTvName(rName != null ? rName.toString() : "");
                if (!rNorm.isEmpty() && !targetNorm.isEmpty() && (rNorm.contains(targetNorm) || targetNorm.contains(rNorm))) {
                    matchedRoute = entry.getValue();
                    break;
                }
            }
            if (matchedRoute != null) {
                final MediaRouter.RouteInfo routeToUse = matchedRoute;
                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        MediaRouter router = (MediaRouter) getContext().getSystemService(Context.MEDIA_ROUTER_SERVICE);
                        if (router != null) {
                            router.selectRoute(MediaRouter.ROUTE_TYPE_LIVE_VIDEO, routeToUse);
                        }
                        openSystemMediaRouteDialog();
                        connectedSource = "media_router";
                        connectedDeviceId = rawId;
                        connectedTvName = rawName;
                        connectedManufacturer = rawManufacturer;
                        connectedTvIp = null;
                        connectedAvTransportUrl = null;

                        JSObject res = new JSObject();
                        res.put("connected", true);
                        res.put("mode", "miracast");
                        res.put("tvName", rawName);
                        res.put("manufacturer", rawManufacturer);
                        res.put("message", "Selecione " + rawName + " na janela de transmissão sem fio para iniciar o espelhamento.");
                        call.resolve(res);
                    } catch (Exception e) {
                        call.reject("Não foi possível iniciar a rota sem fio: " + e.getMessage());
                    }
                });
                return;
            }

            // 2. Android restricts WFD Miracast RTSP streaming to the system Wireless Display driver
            // (raw WifiP2pManager.connect drops on LG TVs without CONFIGURE_WIFI_DISPLAY).
            // Open the system Wireless Display / Miracast picker directly so hardware Miracast pairs stably.
            new Handler(Looper.getMainLooper()).post(() -> {
                if (openNativeWifiDisplayPicker()) {
                    connectedSource = "wifi_direct";
                    connectedDeviceId = rawId;
                    connectedTvName = rawName;
                    connectedManufacturer = rawManufacturer;
                    connectedTvIp = null;
                    connectedAvTransportUrl = null;

                    JSObject res = new JSObject();
                    res.put("connected", true);
                    res.put("mode", "miracast");
                    res.put("tvName", rawName);
                    res.put("manufacturer", rawManufacturer);
                    res.put(
                        "message",
                        "Na tela de Transmissão sem fio (Miracast / Wi-Fi Direct) que foi aberta, toque em "
                            + rawName + " para espelhar a tela sem interrupções."
                    );
                    call.resolve(res);
                } else {
                    openSystemMediaRouteDialog();
                    call.reject(
                        "Este aparelho não liberou o painel nativo de Tela Sem Fio (Miracast / Wi-Fi Direct) para conexão direta com " + rawName + "."
                    );
                }
            });
            return;
        }

        final String targetId = rawId;
        final String targetSource = rawSource;
        final String targetName = rawName;
        final String targetManufacturer = rawManufacturer;
        final String targetIp = rawIp;
        final String targetAvUrl = rawAvTransportUrl;

        // Network Smart TV (DLNA, Samsung, LG, Sony, Roku, mDNS)
        executor.execute(() -> {
            if (targetIp != null && !targetIp.isEmpty()) {
                boolean reachable = isAnyTvPortReachable(targetIp);
                if (!reachable) {
                    call.reject("Não foi possível alcançar " + targetName + " na rede Wi-Fi. Verifique se a TV está ligada.");
                    return;
                }
            }

            String resolvedAv = (targetAvUrl != null && !targetAvUrl.isEmpty())
                ? targetAvUrl
                : ((targetIp != null && !targetIp.isEmpty()) ? findDlnaEndpointForIp(targetIp) : null);

            boolean supportsSamsungWs = targetIp != null && !targetIp.isEmpty() && (isTcpPortOpen(targetIp, 8001, 350) || isTcpPortOpen(targetIp, 8002, 350));
            boolean supportsLgWs = targetIp != null && !targetIp.isEmpty() && (isTcpPortOpen(targetIp, 3000, 350) || isTcpPortOpen(targetIp, 3001, 350));

            if (resolvedAv == null && !supportsSamsungWs && !supportsLgWs) {
                call.reject(
                    targetName + " está na rede, mas não possui receptor DLNA/Tizen/webOS ativo para receber o vídeo diretamente. "
                        + "Ative o espelhamento/DLNA nas configurações da TV ou abra o Modo TV no navegador da TV."
                );
                return;
            }

            // On LG webOS without DLNA AVTransport, complete pairing during Conectar so user can click "Aceitar" on the TV remote now
            if (resolvedAv == null && supportsLgWs) {
                SmartTvWsHelper.LgResult pairRes = SmartTvWsHelper.pairLgWebOsTv(getContext(), getWifiNetwork(), targetIp);
                if (!pairRes.success) {
                    call.reject(pairRes.errorReason != null
                        ? pairRes.errorReason
                        : "Não foi possível parear com " + targetName + ". Aceite na TV ou use o Modo TV.");
                    return;
                }
            }

            connectedSource = targetSource;
            connectedDeviceId = targetId;
            connectedTvName = targetName;
            connectedManufacturer = targetManufacturer;
            connectedTvIp = targetIp;
            connectedAvTransportUrl = resolvedAv;

            JSObject res = new JSObject();
            res.put("connected", true);
            res.put("mode", resolvedAv != null ? "dlna" : "network");
            res.put("tvName", targetName);
            res.put("manufacturer", targetManufacturer);
            res.put("ip", targetIp);
            res.put("canCastDlna", resolvedAv != null || supportsSamsungWs || supportsLgWs);
            res.put("message", "Conectado com " + targetName + " pela rede Wi-Fi.");
            call.resolve(res);
        });
    }

    private boolean openNativeWifiDisplayPicker() {
        String[] actions = {
            "com.samsung.wfd.LAUNCH_WFD_PICKER_DLG",
            "android.settings.WIFI_DISPLAY_SETTINGS",
            Settings.ACTION_CAST_SETTINGS
        };
        PackageManager pm = getContext().getPackageManager();
        Activity act = getActivity();
        for (String action : actions) {
            try {
                Intent intent = new Intent(action);
                if (pm.resolveActivity(intent, 0) != null) {
                    if (act != null && !act.isFinishing()) {
                        act.startActivity(intent);
                    } else {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(intent);
                    }
                    return true;
                }
            } catch (Exception ignored) {}
        }
        return false;
    }

    private void openSystemMediaRouteDialog() {
        try {
            Activity act = getActivity();
            if (act == null || act.isFinishing()) return;
            MediaRouteButton btn = new MediaRouteButton(act);
            btn.setRouteTypes(MediaRouter.ROUTE_TYPE_LIVE_VIDEO);
            View decor = act.getWindow().getDecorView();
            if (decor instanceof ViewGroup) {
                ViewGroup root = (ViewGroup) decor;
                btn.setVisibility(View.GONE);
                root.addView(btn, new ViewGroup.LayoutParams(1, 1));
                btn.performClick();
                root.postDelayed(() -> {
                    try { root.removeView(btn); } catch (Exception ignored) {}
                }, 400);
            } else {
                btn.performClick();
            }
        } catch (Exception ignored) {}
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void disconnectTv(PluginCall call) {
        stopCaptureInternal(true);

        if ("media_router".equals(connectedSource)) {
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    MediaRouter router = (MediaRouter) getContext().getSystemService(Context.MEDIA_ROUTER_SERVICE);
                    if (router != null) {
                        router.selectRoute(MediaRouter.ROUTE_TYPE_LIVE_VIDEO, router.getDefaultRoute());
                    }
                } catch (Exception ignored) {}
            });
        } else if ("wifi_direct".equals(connectedSource) && wifiP2pManager != null && wifiP2pChannel != null) {
            try {
                wifiP2pManager.cancelConnect(wifiP2pChannel, null);
                wifiP2pManager.removeGroup(wifiP2pChannel, null);
            } catch (Exception ignored) {}
        }

        connectedSource = null;
        connectedDeviceId = null;
        connectedTvName = null;
        connectedManufacturer = null;
        connectedTvIp = null;
        connectedAvTransportUrl = null;

        call.resolve();
    }

    @PluginMethod
    public void ensureMediaPermissions(PluginCall call) {
        boolean hasCam = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED;
        boolean hasMic = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
        if (hasCam && hasMic) {
            call.resolve();
            return;
        }
        requestPermissionForAliases(new String[] { "camera", "audio" }, call, "onMediaPermissionsResult");
    }

    @PermissionCallback
    private void onMediaPermissionsResult(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void startScreenCapture(PluginCall call) {
        requestedTargetMode = call.getString("targetMode", "auto");

        if (streamingActive) {
            JSObject res = new JSObject();
            res.put("started", true);
            res.put("streamUrl", getStreamUrl("/stream.ts"));
            res.put("dlnaStarted", tvPullingStream || connectedAvTransportUrl != null);
            call.resolve(res);
            return;
        }

        MediaProjectionManager projectionManager =
            (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (projectionManager == null) {
            call.reject("Captura de tela indisponível neste dispositivo Android.");
            return;
        }

        Intent captureIntent = projectionManager.createScreenCaptureIntent();
        startActivityForResult(call, captureIntent, "onScreenCaptureResult");
    }

    @ActivityCallback
    private void onScreenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Permissão cancelada. Autorize a captura da tela para espelhar na TV.");
            return;
        }

        final int resultCode = result.getResultCode();
        final Intent data = result.getData();

        Runnable startProjectionTask = () -> executor.execute(() -> {
            try {
                boolean useH264TsPipeline =
                    !"webrtc".equals(requestedTargetMode) && connectedAvTransportUrl != null;

                if (useH264TsPipeline) {
                    beginH264TsProjection(resultCode, data);
                    String tsUrl = getStreamUrl("/stream.ts");
                    boolean dlnaAccepted = tsUrl != null && sendDlnaSetUriAndPlay(
                        connectedAvTransportUrl,
                        tsUrl,
                        "video/mp2t",
                        "object.item.videoItem",
                        "DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"
                    );

                    if (dlnaAccepted) {
                        // Wait briefly to see if the TV actually pulls /stream.ts
                        long waitEnd = System.currentTimeMillis() + 2600;
                        while (!tvPullingStream && System.currentTimeMillis() < waitEnd) {
                            Thread.sleep(100);
                        }
                        if (tvPullingStream || !hasSmartTvBrowserFallback(connectedTvIp, connectedManufacturer)) {
                            JSObject res = new JSObject();
                            res.put("started", true);
                            res.put("width", captureWidth);
                            res.put("height", captureHeight);
                            res.put("streamUrl", tsUrl);
                            res.put("dlnaStarted", true);
                            res.put("tvConnectedStream", tvPullingStream);
                            res.put("message", tvPullingStream
                                ? "Espelhando tela em tempo real na TV " + connectedTvName + "."
                                : "Comando de reprodução enviado para " + connectedTvName + ". Aguardando a TV abrir o fluxo de vídeo.");
                            call.resolve(res);
                            return;
                        }
                        // TV acknowledged SOAP Play but never pulled /stream.ts -> stop DLNA & fall back to TV browser
                        final String stopUrl = connectedAvTransportUrl;
                        executor.execute(() -> sendDlnaSoapAction(
                            stopUrl,
                            "Stop",
                            "<u:Stop xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Stop>"
                        ));
                    }

                    // DLNA AVTransport rejected or stalled stream: reuse the SAME MediaProjection + ScreenCastService!
                    switchH264ToJpegOnExistingProjection();
                    String viewerUrl = getStreamUrl("/viewer");
                    String launchError = viewerUrl != null
                        ? tryLaunchTvBrowserWithReason(connectedTvIp, connectedManufacturer, viewerUrl)
                        : "Rede Wi-Fi local indisponível.";

                    if (launchError == null) {
                        JSObject res = new JSObject();
                        res.put("started", true);
                        res.put("width", captureWidth);
                        res.put("height", captureHeight);
                        res.put("streamUrl", viewerUrl);
                        res.put("dlnaStarted", true);
                        res.put("tvConnectedStream", tvPullingStream);
                        res.put("message", "Navegador da TV " + connectedTvName + " aberto para espelhar a tela ao vivo.");
                        call.resolve(res);
                        return;
                    }

                    // Keep live capture + HTTP viewer active so user can open viewerUrl in the TV browser or Modo TV immediately
                    if (viewerUrl != null) {
                        JSObject res = new JSObject();
                        res.put("started", true);
                        res.put("width", captureWidth);
                        res.put("height", captureHeight);
                        res.put("streamUrl", viewerUrl);
                        res.put("dlnaStarted", false);
                        res.put("tvConnectedStream", false);
                        res.put(
                            "message",
                            connectedTvName + " não aceitou abertura automática (" + launchError + "). "
                                + "Para espelhar agora, abra no navegador da TV: " + viewerUrl + " (ou use o Modo TV na TV)."
                        );
                        call.resolve(res);
                        return;
                    }

                    stopCaptureInternal(false);
                    call.reject(
                        connectedTvName + " recusou o fluxo DLNA direto. " + launchError
                    );
                    return;
                }

                // Either WebRTC Modo TV or TV browser / network viewer mode
                beginJpegProjection(resultCode, data);
                String viewerUrl = getStreamUrl("/viewer");
                boolean launchedAuto = !"webrtc".equals(requestedTargetMode);
                String statusMsg = "webrtc".equals(requestedTargetMode)
                    ? "Espelhando tela ao vivo."
                    : "Navegador de " + connectedTvName + " aberto para espelhamento ao vivo.";

                if (!"webrtc".equals(requestedTargetMode) && connectedTvIp != null && !connectedTvIp.isEmpty()) {
                    String launchError = viewerUrl != null
                        ? tryLaunchTvBrowserWithReason(connectedTvIp, connectedManufacturer, viewerUrl)
                        : "Rede Wi-Fi local indisponível.";
                    if (launchError != null) {
                        if (viewerUrl != null) {
                            launchedAuto = false;
                            statusMsg = launchError + " Abra no navegador da TV: " + viewerUrl + " (ou use o Modo TV na TV).";
                        } else {
                            stopCaptureInternal(false);
                            call.reject(launchError);
                            return;
                        }
                    }
                }

                JSObject res = new JSObject();
                res.put("started", true);
                res.put("width", captureWidth);
                res.put("height", captureHeight);
                res.put("streamUrl", viewerUrl);
                res.put("dlnaStarted", launchedAuto);
                res.put("tvConnectedStream", tvPullingStream);
                res.put("message", statusMsg);
                call.resolve(res);
            } catch (Exception e) {
                stopCaptureInternal(false);
                call.reject("Não foi possível iniciar a captura da tela: " + e.getMessage());
            }
        });

        ScreenCastService.setOnForegroundReady(() -> new Handler(Looper.getMainLooper()).post(startProjectionTask));
        Intent serviceIntent = new Intent(getContext(), ScreenCastService.class);
        ContextCompat.startForegroundService(getContext(), serviceIntent);
    }

    @PluginMethod
    public void stopScreenCapture(PluginCall call) {
        stopCaptureInternal(true);
        call.resolve();
    }

    private void computeCaptureDimensions() {
        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        if (wm != null) {
            wm.getDefaultDisplay().getRealMetrics(metrics);
        } else {
            metrics = getContext().getResources().getDisplayMetrics();
        }
        int srcW = Math.max(360, metrics.widthPixels);
        int srcH = Math.max(640, metrics.heightPixels);
        double scale = Math.min(1.0, 1280.0 / Math.max(srcW, srcH));
        // H.264 hardware encoders require dimensions divisible by 16
        captureWidth = Math.max(320, (((int) Math.round(srcW * scale)) / 16) * 16);
        captureHeight = Math.max(320, (((int) Math.round(srcH * scale)) / 16) * 16);
    }

    private void beginH264TsProjection(int resultCode, Intent data) throws Exception {
        MediaProjectionManager projectionManager =
            (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (projectionManager == null) {
            throw new IllegalStateException("MediaProjectionManager nulo");
        }

        computeCaptureDimensions();
        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        int density = Math.max(120, metrics.densityDpi);

        tsMuxer = new TsMuxer();
        spsPpsBytes = null;
        firstTsKeyframeReady.set(false);
        tvPullingStream = false;

        captureThread = new HandlerThread("TelaLivreH264");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        startEmbeddedHttpStreamServer();

        mediaProjection = projectionManager.getMediaProjection(resultCode, data);
        if (mediaProjection == null) {
            throw new IllegalStateException("Falha ao obter MediaProjection");
        }
        mediaProjection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                new Handler(Looper.getMainLooper()).post(() -> {
                    stopCaptureInternal(false);
                    notifyListeners("screenCaptureStopped", new JSObject());
                });
            }
        }, captureHandler);

        MediaFormat format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, captureWidth, captureHeight);
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        format.setInteger(MediaFormat.KEY_BIT_RATE, 2_500_000);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 30);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);

        h264Codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        h264Codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        codecInputSurface = h264Codec.createInputSurface();
        h264Codec.start();

        virtualDisplay = mediaProjection.createVirtualDisplay(
            "TelaLivreH264Display",
            captureWidth,
            captureHeight,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            codecInputSurface,
            null,
            captureHandler
        );
        streamingActive = true;

        executor.execute(this::drainH264EncoderLoop);

        // Wait up to 1.8s for first SPS/PPS + IDR keyframe before telling the TV to play
        long deadline = System.currentTimeMillis() + 1800;
        while (!firstTsKeyframeReady.get() && streamingActive && System.currentTimeMillis() < deadline) {
            Thread.sleep(40);
        }
    }

    private void drainH264EncoderLoop() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        while (streamingActive && h264Codec != null) {
            try {
                int outIndex = h264Codec.dequeueOutputBuffer(info, 25_000);
                if (outIndex >= 0) {
                    ByteBuffer outBuf = h264Codec.getOutputBuffer(outIndex);
                    if (outBuf != null && info.size > 0) {
                        outBuf.position(info.offset);
                        outBuf.limit(info.offset + info.size);
                        byte[] bytes = new byte[info.size];
                        outBuf.get(bytes);

                        if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                            spsPpsBytes = bytes;
                        } else {
                            boolean isKey = (info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0;
                            byte[] tsChunk = tsMuxer.muxVideoFrame(
                                bytes,
                                info.presentationTimeUs,
                                isKey,
                                spsPpsBytes
                            );
                            if (isKey) {
                                firstTsKeyframeReady.set(true);
                            }
                            broadcastTsToClients(tsChunk);
                        }
                    }
                    h264Codec.releaseOutputBuffer(outIndex, false);
                }
            } catch (Exception e) {
                if (!streamingActive) break;
            }
        }
    }

    private void broadcastTsToClients(byte[] tsChunk) {
        if (tsClients.isEmpty() || tsChunk == null || tsChunk.length == 0) return;
        for (OutputStream clientOut : tsClients) {
            try {
                clientOut.write(tsChunk);
                clientOut.flush();
            } catch (Exception e) {
                tsClients.remove(clientOut);
                try { clientOut.close(); } catch (Exception ignored) {}
            }
        }
    }

    private void switchH264ToJpegOnExistingProjection() throws Exception {
        for (OutputStream os : tsClients) {
            try { os.close(); } catch (Exception ignored) {}
        }
        tsClients.clear();
        firstTsKeyframeReady.set(false);
        tvPullingStream = false;
        tsMuxer = null;

        MediaCodec codecToStop = h264Codec;
        h264Codec = null;
        if (codecToStop != null) {
            try { codecToStop.stop(); } catch (Exception ignored) {}
            try { codecToStop.release(); } catch (Exception ignored) {}
        }
        if (codecInputSurface != null) {
            try { codecInputSurface.release(); } catch (Exception ignored) {}
            codecInputSurface = null;
        }

        setupImageReaderOnActiveProjection();
    }

    private void setupImageReaderOnActiveProjection() throws Exception {
        latestJpegFrame = null;
        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(reader -> {
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null || !streamingActive) return;

                Image.Plane[] planes = image.getPlanes();
                if (planes == null || planes.length == 0) return;

                ByteBuffer buffer = planes[0].getBuffer();
                int pixelStride = planes[0].getPixelStride();
                int rowStride = planes[0].getRowStride();
                int rowPadding = rowStride - pixelStride * captureWidth;

                Bitmap fullBitmap = Bitmap.createBitmap(
                    captureWidth + rowPadding / pixelStride,
                    captureHeight,
                    Bitmap.Config.ARGB_8888
                );
                fullBitmap.copyPixelsFromBuffer(buffer);
                Bitmap cropped = rowPadding > 0
                    ? Bitmap.createBitmap(fullBitmap, 0, 0, captureWidth, captureHeight)
                    : fullBitmap;

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                cropped.compress(Bitmap.CompressFormat.JPEG, 68, baos);
                if (cropped != fullBitmap) cropped.recycle();
                fullBitmap.recycle();

                byte[] jpegBytes = baos.toByteArray();
                latestJpegFrame = jpegBytes;

                long now = System.currentTimeMillis();
                if (now - lastFrameNotifyAt >= 50) {
                    lastFrameNotifyAt = now;
                    String b64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP);
                    JSObject frameEvent = new JSObject();
                    frameEvent.put("dataUrl", "data:image/jpeg;base64," + b64);
                    frameEvent.put("width", captureWidth);
                    frameEvent.put("height", captureHeight);
                    notifyListeners("screenFrame", frameEvent);
                }
            } catch (Exception ignored) {
            } finally {
                if (image != null) image.close();
            }
        }, captureHandler);

        if (virtualDisplay != null) {
            virtualDisplay.setSurface(imageReader.getSurface());
        } else if (mediaProjection != null) {
            DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
            int density = Math.max(120, metrics.densityDpi);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "TelaLivreJpegDisplay",
                captureWidth,
                captureHeight,
                density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                captureHandler
            );
        }

        long deadline = System.currentTimeMillis() + 1200;
        while (latestJpegFrame == null && streamingActive && System.currentTimeMillis() < deadline) {
            Thread.sleep(30);
        }
    }

    private void beginJpegProjection(int resultCode, Intent data) throws Exception {
        MediaProjectionManager projectionManager =
            (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (projectionManager == null) {
            throw new IllegalStateException("MediaProjectionManager nulo");
        }

        computeCaptureDimensions();
        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        int density = Math.max(120, metrics.densityDpi);

        captureThread = new HandlerThread("TelaLivreJpegCapture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        startEmbeddedHttpStreamServer();

        mediaProjection = projectionManager.getMediaProjection(resultCode, data);
        if (mediaProjection == null) {
            throw new IllegalStateException("Falha ao obter MediaProjection");
        }
        mediaProjection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                new Handler(Looper.getMainLooper()).post(() -> {
                    stopCaptureInternal(false);
                    notifyListeners("screenCaptureStopped", new JSObject());
                });
            }
        }, captureHandler);

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(reader -> {
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null || !streamingActive) return;

                Image.Plane[] planes = image.getPlanes();
                if (planes == null || planes.length == 0) return;

                ByteBuffer buffer = planes[0].getBuffer();
                int pixelStride = planes[0].getPixelStride();
                int rowStride = planes[0].getRowStride();
                int rowPadding = rowStride - pixelStride * captureWidth;

                Bitmap fullBitmap = Bitmap.createBitmap(
                    captureWidth + rowPadding / pixelStride,
                    captureHeight,
                    Bitmap.Config.ARGB_8888
                );
                fullBitmap.copyPixelsFromBuffer(buffer);
                Bitmap cropped = rowPadding > 0
                    ? Bitmap.createBitmap(fullBitmap, 0, 0, captureWidth, captureHeight)
                    : fullBitmap;

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                cropped.compress(Bitmap.CompressFormat.JPEG, 68, baos);
                if (cropped != fullBitmap) cropped.recycle();
                fullBitmap.recycle();

                byte[] jpegBytes = baos.toByteArray();
                latestJpegFrame = jpegBytes;

                long now = System.currentTimeMillis();
                if (now - lastFrameNotifyAt >= 50) {
                    lastFrameNotifyAt = now;
                    String b64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP);
                    JSObject frameEvent = new JSObject();
                    frameEvent.put("dataUrl", "data:image/jpeg;base64," + b64);
                    frameEvent.put("width", captureWidth);
                    frameEvent.put("height", captureHeight);
                    notifyListeners("screenFrame", frameEvent);
                }
            } catch (Exception ignored) {
            } finally {
                if (image != null) image.close();
            }
        }, captureHandler);

        virtualDisplay = mediaProjection.createVirtualDisplay(
            "TelaLivreJpegDisplay",
            captureWidth,
            captureHeight,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
        streamingActive = true;

        long deadline = System.currentTimeMillis() + 1200;
        while (latestJpegFrame == null && streamingActive && System.currentTimeMillis() < deadline) {
            Thread.sleep(30);
        }
    }

    private void startEmbeddedHttpStreamServer() throws Exception {
        if (httpStreamServer != null && !httpStreamServer.isClosed()) return;
        try {
            httpStreamServer = new ServerSocket(8787);
        } catch (Exception busy) {
            httpStreamServer = new ServerSocket(0);
        }
        httpStreamServer.setReuseAddress(true);

        executor.execute(() -> {
            while (streamingActive && httpStreamServer != null && !httpStreamServer.isClosed()) {
                try {
                    Socket client = httpStreamServer.accept();
                    executor.execute(() -> handleHttpStreamClient(client));
                } catch (Exception e) {
                    if (!streamingActive) break;
                }
            }
        });
    }

    private void handleHttpStreamClient(Socket client) {
        try {
            client.setSoTimeout(10000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream()));
            String requestLine = reader.readLine();
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                // Drain headers
            }

            OutputStream out = client.getOutputStream();
            boolean isHead = requestLine != null && requestLine.startsWith("HEAD ");

            if (requestLine != null && requestLine.contains("/stream.ts")) {
                String headers = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: video/mp2t\r\n"
                    + "Accept-Ranges: none\r\n"
                    + "Cache-Control: no-store, no-cache\r\n"
                    + "transferMode.dlna.org: Streaming\r\n"
                    + "contentFeatures.dlna.org: DLNA.ORG_PN=AVC_TS_MP_HD_AAC_MULT5;DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Connection: close\r\n\r\n";
                out.write(headers.getBytes(StandardCharsets.US_ASCII));
                out.flush();
                if (isHead) {
                    client.close();
                    return;
                }

                tvPullingStream = true;
                if (tsMuxer != null) {
                    ByteArrayOutputStream patPmt = new ByteArrayOutputStream(376);
                    tsMuxer.writePatAndPmt(patPmt);
                    out.write(patPmt.toByteArray());
                    out.flush();
                }

                // Request immediate IDR keyframe so TV starts decoding instantly
                if (h264Codec != null) {
                    try {
                        Bundle syncBundle = new Bundle();
                        syncBundle.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
                        h264Codec.setParameters(syncBundle);
                    } catch (Exception ignored) {}
                }

                tsClients.add(out);
                notifyListeners("tvStreamConnected", new JSObject());

                while (streamingActive && tsClients.contains(out) && !client.isClosed()) {
                    Thread.sleep(300);
                }
                tsClients.remove(out);
                client.close();
                return;
            }

            if (requestLine != null && requestLine.contains("/viewer")) {
                String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                    + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                    + "<title>TelaLivre</title>"
                    + "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;}"
                    + "img{width:100vw;height:100vh;object-fit:contain;display:block;}</style></head>"
                    + "<body><img id=\"v\" src=\"/stream.mjpeg\" alt=\"TelaLivre\"/>"
                    + "<script>(function(){"
                    + "var img=document.getElementById('v'),mode='mjpeg';"
                    + "function pull(){if(mode!=='poll')return;var n=new Image();"
                    + "n.onload=function(){img.src=n.src;setTimeout(pull,35);};"
                    + "n.onerror=function(){setTimeout(pull,250);};"
                    + "n.src='/screen.jpg?t='+Date.now();}"
                    + "img.onerror=function(){if(mode==='mjpeg'){mode='poll';pull();}};"
                    + "setTimeout(function(){if(mode==='mjpeg'&&(!img.complete||img.naturalWidth===0)){mode='poll';pull();}},1800);"
                    + "})();</script></body></html>";
                byte[] htmlBytes = html.getBytes(StandardCharsets.UTF_8);
                String hdr = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: text/html; charset=utf-8\r\n"
                    + "Content-Length: " + htmlBytes.length + "\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n\r\n";
                out.write(hdr.getBytes(StandardCharsets.US_ASCII));
                if (!isHead) {
                    tvPullingStream = true;
                    out.write(htmlBytes);
                }
                out.flush();
                client.close();
                return;
            }

            if (requestLine != null && requestLine.contains("/screen.jpg")) {
                byte[] frame = latestJpegFrame;
                if (frame == null) {
                    out.write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                } else {
                    String hdr = "HTTP/1.1 200 OK\r\n"
                        + "Content-Type: image/jpeg\r\n"
                        + "Content-Length: " + frame.length + "\r\n"
                        + "Cache-Control: no-store\r\n"
                        + "Access-Control-Allow-Origin: *\r\n"
                        + "Connection: close\r\n\r\n";
                    out.write(hdr.getBytes(StandardCharsets.US_ASCII));
                    if (!isHead) {
                        if (!tvPullingStream) {
                            tvPullingStream = true;
                            notifyListeners("tvStreamConnected", new JSObject());
                        }
                        out.write(frame);
                    }
                }
                out.flush();
                client.close();
                return;
            }

            // /stream.mjpeg
            String header = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: multipart/x-mixed-replace; boundary=telalivreframe\r\n"
                + "Cache-Control: no-store, no-cache\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n\r\n";
            out.write(header.getBytes(StandardCharsets.US_ASCII));
            out.flush();
            if (isHead) {
                client.close();
                return;
            }

            tvPullingStream = true;
            notifyListeners("tvStreamConnected", new JSObject());

            while (streamingActive && !client.isClosed()) {
                byte[] frame = latestJpegFrame;
                if (frame != null) {
                    String partHeader = "--telalivreframe\r\n"
                        + "Content-Type: image/jpeg\r\n"
                        + "Content-Length: " + frame.length + "\r\n\r\n";
                    out.write(partHeader.getBytes(StandardCharsets.US_ASCII));
                    out.write(frame);
                    out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                }
                Thread.sleep(45);
            }
        } catch (Exception ignored) {
        } finally {
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    private boolean hasSmartTvBrowserFallback(String ip, String manufacturer) {
        if (ip == null || ip.isEmpty()) return false;
        String lower = manufacturer != null ? manufacturer.toLowerCase(Locale.ROOT) : "";
        return lower.contains("samsung")
            || lower.contains("lg")
            || isTcpPortOpen(ip, 8001, 250)
            || isTcpPortOpen(ip, 8002, 250)
            || isTcpPortOpen(ip, 3000, 250)
            || isTcpPortOpen(ip, 3001, 250);
    }

    /**
     * Returns null on success, or a user-facing Portuguese error reason if launching the TV browser fails.
     */
    private String tryLaunchTvBrowserWithReason(String ip, String manufacturer, String viewerUrl) {
        if (ip == null || ip.isEmpty()) {
            return "Endereço IP da TV não encontrado na rede Wi-Fi.";
        }
        Network wifiNet = getWifiNetwork();
        String lower = manufacturer != null ? manufacturer.toLowerCase(Locale.ROOT) : "";
        if (lower.contains("samsung") || isTcpPortOpen(ip, 8001, 350) || isTcpPortOpen(ip, 8002, 350)) {
            if (SmartTvWsHelper.tryOpenViewerOnSamsungTv(wifiNet, ip, viewerUrl)) {
                return null;
            }
        }
        if (lower.contains("lg") || isTcpPortOpen(ip, 3000, 350) || isTcpPortOpen(ip, 3001, 350)) {
            SmartTvWsHelper.LgResult res = SmartTvWsHelper.tryOpenViewerOnLgWebOsTv(getContext(), wifiNet, ip, viewerUrl);
            if (res.success) {
                return null;
            }
            return res.errorReason != null
                ? res.errorReason
                : "A TV LG (" + ip + ") não aceitou abrir o navegador automático.";
        }
        return "A TV " + connectedTvName + " não aceitou abrir o receptor automático.";
    }

    private void stopCaptureInternal(boolean stopDlnaOnTv) {
        streamingActive = false;
        tvPullingStream = false;
        latestJpegFrame = null;
        firstTsKeyframeReady.set(false);

        for (OutputStream os : tsClients) {
            try { os.close(); } catch (Exception ignored) {}
        }
        tsClients.clear();

        if (stopDlnaOnTv && connectedAvTransportUrl != null) {
            final String url = connectedAvTransportUrl;
            executor.execute(() -> sendDlnaSoapAction(
                url,
                "Stop",
                "<u:Stop xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Stop>"
            ));
        }

        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        MediaCodec codecToStop = h264Codec;
        h264Codec = null;
        if (codecToStop != null) {
            try { codecToStop.stop(); } catch (Exception ignored) {}
            try { codecToStop.release(); } catch (Exception ignored) {}
        }
        if (codecInputSurface != null) {
            try { codecInputSurface.release(); } catch (Exception ignored) {}
            codecInputSurface = null;
        }
        if (imageReader != null) {
            try { imageReader.close(); } catch (Exception ignored) {}
            imageReader = null;
        }
        if (mediaProjection != null) {
            try { mediaProjection.stop(); } catch (Exception ignored) {}
            mediaProjection = null;
        }
        if (httpStreamServer != null) {
            try { httpStreamServer.close(); } catch (Exception ignored) {}
            httpStreamServer = null;
        }
        if (captureThread != null) {
            try { captureThread.quitSafely(); } catch (Exception ignored) {}
            captureThread = null;
            captureHandler = null;
        }

        try {
            getContext().stopService(new Intent(getContext(), ScreenCastService.class));
        } catch (Exception ignored) {}
    }

    private String getStreamUrl(String path) {
        if (httpStreamServer == null) return null;
        String ip = getLocalWifiIpv4();
        if (ip == null) return null;
        return "http://" + ip + ":" + httpStreamServer.getLocalPort() + path;
    }

    private boolean sendDlnaSetUriAndPlay(
        String avTransportUrl,
        String mediaUrl,
        String mime,
        String upnpClass,
        String dlnaFeatures
    ) {
        sendDlnaSoapAction(
            avTransportUrl,
            "Stop",
            "<u:Stop xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Stop>"
        );

        String safeUrl = escapeXml(mediaUrl);
        String[] metadataCandidates = {
            escapeXml(
                "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" "
                    + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
                    + "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
                    + "<item id=\"0\" parentID=\"-1\" restricted=\"1\">"
                    + "<dc:title>TelaLivre</dc:title>"
                    + "<upnp:class>" + upnpClass + "</upnp:class>"
                    + "<res protocolInfo=\"http-get:*:" + mime + ":" + dlnaFeatures + "\">" + safeUrl + "</res>"
                    + "</item></DIDL-Lite>"
            ),
            escapeXml(
                "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" "
                    + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
                    + "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
                    + "<item id=\"0\" parentID=\"-1\" restricted=\"1\">"
                    + "<dc:title>TelaLivre</dc:title>"
                    + "<upnp:class>" + upnpClass + "</upnp:class>"
                    + "<res protocolInfo=\"http-get:*:" + mime + ":*\">" + safeUrl + "</res>"
                    + "</item></DIDL-Lite>"
            ),
            ""
        };

        boolean uriSet = false;
        for (String meta : metadataCandidates) {
            String setUriBody = "<u:SetAVTransportURI xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"
                + "<InstanceID>0</InstanceID>"
                + "<CurrentURI>" + safeUrl + "</CurrentURI>"
                + "<CurrentURIMetaData>" + meta + "</CurrentURIMetaData>"
                + "</u:SetAVTransportURI>";
            if (sendDlnaSoapAction(avTransportUrl, "SetAVTransportURI", setUriBody)) {
                uriSet = true;
                break;
            }
        }
        if (!uriSet) {
            return false;
        }

        String playBody = "<u:Play xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"
            + "<InstanceID>0</InstanceID><Speed>1</Speed></u:Play>";
        return sendDlnaSoapAction(avTransportUrl, "Play", playBody);
    }

    private boolean sendDlnaSoapAction(String controlUrl, String action, String bodyXml) {
        HttpURLConnection conn = null;
        try {
            String envelope = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
                + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body>" + bodyXml + "</s:Body></s:Envelope>";

            conn = (HttpURLConnection) new URL(controlUrl).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(2500);
            conn.setReadTimeout(2500);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
            conn.setRequestProperty("SOAPACTION", "\"urn:schemas-upnp-org:service:AVTransport:1#" + action + "\"");

            try (OutputStream os = conn.getOutputStream()) {
                os.write(envelope.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private boolean isAnyTvPortReachable(String ip) {
        int[] ports = { 8001, 8002, 3000, 3001, 8060, 80, 7676, 9197, 8008, 8009 };
        for (int port : ports) {
            if (isTcpPortOpen(ip, port, 350)) {
                return true;
            }
        }
        return false;
    }

    private boolean isTcpPortOpen(String ip, int port, int timeoutMs) {
        Network wifiNet = getWifiNetwork();
        try (Socket socket = wifiNet != null ? wifiNet.getSocketFactory().createSocket() : new Socket()) {
            socket.connect(new InetSocketAddress(ip, port), timeoutMs);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private Network getWifiNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return null;

            Network active = cm.getActiveNetwork();
            if (active != null) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(active);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    return active;
                }
            }
            for (Network net : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    return net;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private NetworkInterface getWifiNetworkInterface() {
        try {
            String wifiIp = getLocalWifiIpv4();
            if (wifiIp != null) {
                InetAddress addr = InetAddress.getByName(wifiIp);
                return NetworkInterface.getByInetAddress(addr);
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String getLocalWifiIpv4() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                Network active = cm.getActiveNetwork();
                if (active != null) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(active);
                    LinkProperties lp = cm.getLinkProperties(active);
                    if (caps != null && lp != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        for (LinkAddress la : lp.getLinkAddresses()) {
                            InetAddress addr = la.getAddress();
                            if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                                return addr.getHostAddress();
                            }
                        }
                    }
                }
            }

            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface nif : Collections.list(ifaces)) {
                if (nif.isLoopback() || !nif.isUp()) continue;
                for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String host = addr.getHostAddress();
                        if (host != null && (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172."))) {
                            return host;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String httpGetText(String urlStr, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            if (conn.getResponseCode() >= 400) return null;
            return readStream(conn.getInputStream());
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String httpPostJson(String urlStr, String jsonBody, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
            }
            if (conn.getResponseCode() >= 400) return null;
            return readStream(conn.getInputStream());
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String readStream(InputStream is) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }

    private String extractHeader(String raw, String headerName) {
        String[] lines = raw.split("\\r?\\n");
        for (String line : lines) {
            int colon = line.indexOf(':');
            if (colon > 0) {
                String k = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                if (k.equals(headerName)) {
                    return line.substring(colon + 1).trim();
                }
            }
        }
        return null;
    }

    private String extractXmlTag(String xml, String tag) {
        if (xml == null) return null;
        Matcher m = Pattern.compile("<" + tag + "[^>]*>([^<]+)</" + tag + ">", Pattern.CASE_INSENSITIVE)
            .matcher(xml);
        return m.find() ? m.group(1).trim() : null;
    }

    private String extractAvTransportControlUrl(String xml, String baseUrl) {
        Matcher serviceMatcher = Pattern.compile("<service>[\\s\\S]*?</service>", Pattern.CASE_INSENSITIVE)
            .matcher(xml);
        while (serviceMatcher.find()) {
            String block = serviceMatcher.group();
            if (block.toLowerCase(Locale.ROOT).contains("avtransport")) {
                String ctrl = extractXmlTag(block, "controlURL");
                if (ctrl != null) {
                    try {
                        return new URL(new URL(baseUrl), ctrl).toString();
                    } catch (Exception ignored) {}
                }
            }
        }
        return null;
    }

    private String extractJsonString(String json, String key) {
        if (json == null) return null;
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        return m.find() ? m.group(1).trim() : null;
    }

    private String inferManufacturer(String text) {
        if (text == null) return "Outra TV";
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.contains("samsung") || lower.contains("tizen")) return "Samsung";
        if (lower.contains("lg") || lower.contains("webos")) return "LG";
        if (lower.contains("sony") || lower.contains("bravia")) return "Sony";
        if (lower.contains("tcl") || lower.contains("semp")) return "TCL";
        if (lower.contains("philips") || lower.contains("tpvision")) return "Philips";
        if (lower.contains("roku")) return "Roku";
        return "Outra TV";
    }

    private String escapeXml(String text) {
        return text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;");
    }
}
