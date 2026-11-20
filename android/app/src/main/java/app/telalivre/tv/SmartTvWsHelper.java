package app.telalivre.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Network;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * RFC-6455 WebSocket helper for Samsung Tizen and LG webOS Smart TVs.
 * Supports Wi-Fi Network binding, WS (3000/8001) and WSS (3001/8002),
 * WebSocket Ping/Pong, LG SSAP client-key persistence, and user pairing prompt waits.
 */
public class SmartTvWsHelper {

    private static final String PREFS_NAME = "TelaLivreTvPairingPrefs";
    private static final String KEY_LG_PREFIX = "lg_client_key_";

    public static class LgResult {
        public final boolean success;
        public final String errorReason;

        public LgResult(boolean success, String errorReason) {
            this.success = success;
            this.errorReason = errorReason;
        }
    }

    public static boolean tryOpenViewerOnSamsungTv(Network wifiNetwork, String ip, String viewerUrl) {
        String encodedName = Base64.encodeToString("TelaLivre".getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        String path = "/api/v2/channels/samsung.remote.control?name=" + encodedName;
        String payload = "{\"method\":\"ms.channel.emit\",\"params\":{"
            + "\"event\":\"ed.apps.launch\","
            + "\"to\":\"host\","
            + "\"data\":{\"appId\":\"org.tizen.browser\",\"action_type\":\"NATIVE_LAUNCH\",\"metaTag\":\""
            + escapeJson(viewerUrl) + "\"}}}";

        if (sendSingleWsJson(wifiNetwork, ip, 8002, true, path, payload, false)) {
            return true;
        }
        return sendSingleWsJson(wifiNetwork, ip, 8001, false, path, payload, false);
    }

    /**
     * Pairs with an LG webOS TV (persisting client-key in SharedPreferences) so subsequent
     * browser launches happen immediately without re-prompting.
     */
    public static LgResult pairLgWebOsTv(Context context, Network wifiNetwork, String ip) {
        return runLgWithBestPort(context, wifiNetwork, ip, null);
    }

    public static LgResult tryOpenViewerOnLgWebOsTv(
        Context context,
        Network wifiNetwork,
        String ip,
        String viewerUrl
    ) {
        return runLgWithBestPort(context, wifiNetwork, ip, viewerUrl);
    }

    private static LgResult runLgWithBestPort(
        Context context,
        Network wifiNetwork,
        String ip,
        String viewerUrlToOpen
    ) {
        boolean open3001 = isPortReachable(wifiNetwork, ip, 3001, 500);
        boolean open3000 = isPortReachable(wifiNetwork, ip, 3000, 500);

        if (!open3001 && !open3000) {
            return new LgResult(
                false,
                "A TV LG (" + ip + ") não liberou o controle de rede (portas 3000/3001 fechadas). Ative 'Aplicativos LG Connect' nas configurações da TV ou abra o endereço abaixo no navegador da TV."
            );
        }

        LgResult wssRes = null;
        if (open3001) {
            wssRes = executeLgSession(context, wifiNetwork, ip, 3001, true, viewerUrlToOpen);
            if (wssRes.success) return wssRes;
        }

        LgResult wsRes = null;
        if (open3000) {
            wsRes = executeLgSession(context, wifiNetwork, ip, 3000, false, viewerUrlToOpen);
            if (wsRes.success) return wsRes;
        }

        if (wssRes != null && wssRes.errorReason != null) {
            return wssRes;
        }
        if (wsRes != null && wsRes.errorReason != null) {
            return wsRes;
        }
        return new LgResult(false, "Não foi possível comunicar com a TV LG na rede Wi-Fi.");
    }

    private static LgResult executeLgSession(
        Context context,
        Network wifiNetwork,
        String ip,
        int port,
        boolean useTls,
        String viewerUrlToOpen
    ) {
        String savedKey = getSavedLgClientKey(context, ip);
        // Attempt 1: minimal manifest (with savedKey if present); Attempt 2: legacy signed manifest
        boolean[] signedModes = savedKey != null
            ? new boolean[] { false, true }
            : new boolean[] { false, true };

        LgResult lastFailure = null;
        for (int attempt = 0; attempt < signedModes.length; attempt++) {
            boolean includeSigned = signedModes[attempt];
            String keyForAttempt = (attempt == 0) ? savedKey : null;
            Socket socket = null;
            try {
                socket = openSocket(wifiNetwork, ip, port, useTls, 2200, 25000);
                if (!performHandshake(socket, ip, port, "/")) {
                    lastFailure = new LgResult(false, "A TV LG (" + ip + ") recusou o handshake WebSocket na porta " + port + ".");
                    continue;
                }

                OutputStream out = socket.getOutputStream();
                InputStream in = socket.getInputStream();

                boolean registered = registerLgClient(context, ip, out, in, keyForAttempt, includeSigned);
                if (!registered) {
                    lastFailure = new LgResult(
                        false,
                        "Confirme a solicitação de pareamento na tela da TV LG com o controle remoto (ou ative 'LG Connect Apps' nas configurações da TV)."
                    );
                    continue;
                }

                if (viewerUrlToOpen == null) {
                    return new LgResult(true, null);
                }

                // 1. Primary LG launcher endpoint
                String openPayload = "{\"type\":\"request\",\"id\":\"open_1\",\"uri\":\"ssap://system.launcher/open\","
                    + "\"payload\":{\"target\":\"" + escapeJson(viewerUrlToOpen) + "\"}}";
                writeMaskedTextFrame(out, openPayload);
                String openResp = readMatchingResponse(in, out, "open_1", 4000);
                if (openResp != null && openResp.contains("\"returnValue\":true")) {
                    return new LgResult(true, null);
                }

                // 2. Fallback for newer webOS versions: explicit browser app launch
                String browserPayload = "{\"type\":\"request\",\"id\":\"open_2\",\"uri\":\"ssap://com.webos.applicationManager/launch\","
                    + "\"payload\":{\"id\":\"com.webos.app.browser\",\"params\":{\"target\":\""
                    + escapeJson(viewerUrlToOpen) + "\"}}}";
                writeMaskedTextFrame(out, browserPayload);
                String browserResp = readMatchingResponse(in, out, "open_2", 4000);
                if (browserResp != null && browserResp.contains("\"returnValue\":true")) {
                    return new LgResult(true, null);
                }

                return new LgResult(
                    false,
                    "A TV LG bloqueou a abertura automática do navegador."
                );
            } catch (Exception e) {
                String detail = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                lastFailure = new LgResult(
                    false,
                    "Não foi possível comunicar com a TV LG na porta " + port + " (" + e.getClass().getSimpleName() + ": " + detail + ")."
                );
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }
        }

        return lastFailure != null
            ? lastFailure
            : new LgResult(false, "Não foi possível comunicar com a TV LG na rede Wi-Fi.");
    }

    private static boolean registerLgClient(
        Context context,
        String ip,
        OutputStream out,
        InputStream in,
        String clientKey,
        boolean includeSignedBlock
    ) throws Exception {
        String registerPayload = buildLgRegisterPayload(clientKey, includeSignedBlock);
        writeMaskedTextFrame(out, registerPayload);

        long deadline = System.currentTimeMillis() + 24000;
        while (System.currentTimeMillis() < deadline) {
            String msg = readTextMessage(in, out);
            if (msg == null) return false;

            if (msg.contains("\"type\":\"registered\"")) {
                String newKey = extractJsonValue(msg, "client-key");
                if (newKey != null && !newKey.isEmpty() && context != null) {
                    saveLgClientKey(context, ip, newKey);
                }
                return true;
            }

            if (msg.contains("\"type\":\"error\"")) {
                if (clientKey != null && !clientKey.isEmpty()) {
                    clearLgClientKey(context, ip);
                    String freshPayload = buildLgRegisterPayload(null, includeSignedBlock);
                    writeMaskedTextFrame(out, freshPayload);
                    clientKey = null;
                    continue;
                }
                return false;
            }
            // If msg has "pairingType":"PROMPT", keep looping until user accepts on TV remote
        }
        return false;
    }

    private static String buildLgRegisterPayload(String clientKey, boolean includeSignedBlock) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"type\":\"register\",\"id\":\"reg_1\",\"payload\":{");
        sb.append("\"forcePairing\":false,");
        sb.append("\"pairingType\":\"PROMPT\",");
        if (clientKey != null && !clientKey.isEmpty()) {
            sb.append("\"client-key\":\"").append(escapeJson(clientKey)).append("\",");
        }
        sb.append("\"manifest\":{\"manifestVersion\":1,\"appVersion\":\"1.1\",");
        if (includeSignedBlock) {
            sb.append("\"signed\":{")
              .append("\"created\":\"20140509\",")
              .append("\"appId\":\"com.lge.test\",")
              .append("\"vendorId\":\"com.lge\",")
              .append("\"localizedAppNames\":{\"\":\"TelaLivre\",\"pt-BR\":\"TelaLivre\"},")
              .append("\"localizedVendorNames\":{\"\":\"TelaLivre\"},")
              .append("\"serial\":\"2f930e2d2cfe083771f68e4fe7bb07\"")
              .append("},");
        }
        sb.append("\"permissions\":[")
          .append("\"LAUNCH\",")
          .append("\"LAUNCH_WEBAPP\",")
          .append("\"APP_TO_APP\",")
          .append("\"CLOSE\",")
          .append("\"CONTROL_AUDIO\",")
          .append("\"CONTROL_DISPLAY\",")
          .append("\"CONTROL_INPUT_MEDIA_PLAYBACK\",")
          .append("\"CONTROL_POWER\",")
          .append("\"READ_INSTALLED_APPS\",")
          .append("\"WRITE_NOTIFICATION_TOAST\"")
          .append("]}}}");
        return sb.toString();
    }

    private static String readMatchingResponse(
        InputStream in,
        OutputStream out,
        String expectedId,
        int timeoutMs
    ) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            String msg = readTextMessage(in, out);
            if (msg == null) return null;
            if (msg.contains("\"" + expectedId + "\"")) {
                return msg;
            }
        }
        return null;
    }

    private static String getSavedLgClientKey(Context context, String ip) {
        if (context == null || ip == null) return null;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_LG_PREFIX + ip, null);
    }

    private static void saveLgClientKey(Context context, String ip, String key) {
        if (context == null || ip == null || key == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_LG_PREFIX + ip, key).apply();
    }

    private static void clearLgClientKey(Context context, String ip) {
        if (context == null || ip == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(KEY_LG_PREFIX + ip).apply();
    }

    private static boolean sendSingleWsJson(
        Network wifiNetwork,
        String ip,
        int port,
        boolean useTls,
        String path,
        String jsonPayload,
        boolean requireAck
    ) {
        Socket socket = null;
        try {
            socket = openSocket(wifiNetwork, ip, port, useTls, 1800, 2500);
            if (!performHandshake(socket, ip, port, path)) {
                return false;
            }

            OutputStream out = socket.getOutputStream();
            InputStream in = socket.getInputStream();

            String welcome = readTextMessage(in, out);
            writeMaskedTextFrame(out, jsonPayload);

            if (requireAck) {
                String ack = readTextMessage(in, out);
                return ack != null;
            }
            return welcome == null || !welcome.contains("ms.channel.unauthorized");
        } catch (Exception e) {
            return false;
        } finally {
            if (socket != null) {
                try { socket.close(); } catch (Exception ignored) {}
            }
        }
    }

    private static boolean isPortReachable(Network wifiNetwork, String ip, int port, int timeoutMs) {
        try (Socket socket = wifiNetwork != null ? wifiNetwork.getSocketFactory().createSocket() : new Socket()) {
            socket.connect(new InetSocketAddress(ip, port), timeoutMs);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static Socket openSocket(
        Network wifiNetwork,
        String ip,
        int port,
        boolean useTls,
        int connectTimeoutMs,
        int soTimeoutMs
    ) throws Exception {
        Socket plain = wifiNetwork != null ? wifiNetwork.getSocketFactory().createSocket() : new Socket();
        plain.connect(new InetSocketAddress(ip, port), connectTimeoutMs);
        plain.setSoTimeout(soTimeoutMs);

        if (!useTls) {
            return plain;
        }

        SSLContext sc = SSLContext.getInstance("TLS");
        sc.init(null, new TrustManager[] {
            new X509TrustManager() {
                @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            }
        }, new SecureRandom());

        SSLSocket ssl = (SSLSocket) sc.getSocketFactory().createSocket(plain, ip, port, true);
        ssl.setSoTimeout(soTimeoutMs);
        ssl.startHandshake();
        return ssl;
    }

    private static boolean performHandshake(Socket socket, String host, int port, String path) throws Exception {
        byte[] keyBytes = new byte[16];
        new SecureRandom().nextBytes(keyBytes);
        String wsKey = Base64.encodeToString(keyBytes, Base64.NO_WRAP);

        String req = "GET " + path + " HTTP/1.1\r\n"
            + "Host: " + host + ":" + port + "\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Key: " + wsKey + "\r\n"
            + "Sec-WebSocket-Version: 13\r\n\r\n";

        OutputStream out = socket.getOutputStream();
        out.write(req.getBytes(StandardCharsets.US_ASCII));
        out.flush();

        InputStream in = socket.getInputStream();
        StringBuilder headerBuf = new StringBuilder();
        int b;
        while ((b = in.read()) != -1) {
            headerBuf.append((char) b);
            int len = headerBuf.length();
            if (len >= 4
                && headerBuf.charAt(len - 4) == '\r'
                && headerBuf.charAt(len - 3) == '\n'
                && headerBuf.charAt(len - 2) == '\r'
                && headerBuf.charAt(len - 1) == '\n') {
                break;
            }
            if (len > 4096) break;
        }
        return headerBuf.toString().contains("101");
    }

    private static void writeMaskedTextFrame(OutputStream out, String text) throws Exception {
        writeMaskedFrame(out, 0x81, text.getBytes(StandardCharsets.UTF_8));
    }

    private static void writeMaskedFrame(OutputStream out, int firstByte, byte[] payload) throws Exception {
        byte[] mask = new byte[4];
        new SecureRandom().nextBytes(mask);

        out.write(firstByte);
        if (payload.length < 126) {
            out.write(0x80 | payload.length);
        } else {
            out.write(0x80 | 126);
            out.write((payload.length >> 8) & 0xFF);
            out.write(payload.length & 0xFF);
        }
        out.write(mask);
        byte[] masked = new byte[payload.length];
        for (int i = 0; i < payload.length; i++) {
            masked[i] = (byte) (payload[i] ^ mask[i % 4]);
        }
        out.write(masked);
        out.flush();
    }

    private static String readTextMessage(InputStream in, OutputStream out) {
        try {
            ByteArrayOutputStream assembled = new ByteArrayOutputStream();
            while (true) {
                int b1 = in.read();
                if (b1 == -1) return null;
                int b2 = in.read();
                if (b2 == -1) return null;

                boolean fin = (b1 & 0x80) != 0;
                int opcode = b1 & 0x0F;
                boolean masked = (b2 & 0x80) != 0;
                int len = b2 & 0x7F;

                if (len == 126) {
                    int hi = in.read();
                    int lo = in.read();
                    if (hi == -1 || lo == -1) return null;
                    len = ((hi & 0xFF) << 8) | (lo & 0xFF);
                } else if (len == 127) {
                    return null;
                }

                byte[] mask = new byte[4];
                if (masked) {
                    for (int i = 0; i < 4; i++) {
                        int m = in.read();
                        if (m == -1) return null;
                        mask[i] = (byte) m;
                    }
                }

                byte[] data = new byte[len];
                int read = 0;
                while (read < len) {
                    int r = in.read(data, read, len - read);
                    if (r <= 0) return null;
                    read += r;
                }
                if (masked) {
                    for (int i = 0; i < read; i++) {
                        data[i] = (byte) (data[i] ^ mask[i % 4]);
                    }
                }

                if (opcode == 0x08) {
                    return null;
                }
                if (opcode == 0x09) {
                    try {
                        writeMaskedFrame(out, 0x8A, data);
                    } catch (Exception ignored) {}
                    continue;
                }
                if (opcode == 0x0A) {
                    continue;
                }

                assembled.write(data, 0, read);
                if (fin) {
                    return new String(assembled.toByteArray(), StandardCharsets.UTF_8);
                }
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static String extractJsonValue(String json, String key) {
        if (json == null) return null;
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    private static String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
