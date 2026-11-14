package gcsp.api.evidence;

import java.math.BigInteger;
import java.net.IDN;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** The part of the WHATWG URL parser Node's new URL() applies to an https reference with no base; other schemes parse to null. */
final class WhatwgUrl {

    final String username;
    final String password;
    final String host;
    final String port;
    final String path;
    final String query;
    final String fragment;

    private WhatwgUrl(String username, String password, String host, String port, String path, String query, String fragment) {
        this.username = username;
        this.password = password;
        this.host = host;
        this.port = port;
        this.path = path;
        this.query = query;
        this.fragment = fragment;
    }

    /** Null when new URL(input) would throw or the scheme is not https; callers treat both as unsafe. */
    static WhatwgUrl parse(String raw) {
        String input = clean(raw);
        int colon = input.indexOf(':');
        if (colon < 1 || !isAlpha(input.charAt(0))) return null;
        for (int i = 1; i < colon; i++) {
            char c = input.charAt(i);
            if (!(isAlpha(c) || (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.')) return null;
        }
        if (!"https".equals(input.substring(0, colon).toLowerCase(Locale.ROOT))) return null;
        int start = colon + 1;
        while (start < input.length() && (input.charAt(start) == '/' || input.charAt(start) == '\\')) start++;
        int end = start;
        while (end < input.length() && "/\\?#".indexOf(input.charAt(end)) < 0) end++;
        String authority = input.substring(start, end);
        String username = "";
        String password = "";
        String hostPort = authority;
        int at = authority.lastIndexOf('@');
        if (at >= 0) {
            String userInfo = authority.substring(0, at);
            hostPort = authority.substring(at + 1);
            int split = userInfo.indexOf(':');
            username = split < 0 ? userInfo : userInfo.substring(0, split);
            password = split < 0 ? "" : userInfo.substring(split + 1);
        }
        // A bracketed host is an IPv6 literal (private by rule) or a forbidden code point; both are unsafe.
        if (hostPort.indexOf('[') >= 0 || hostPort.indexOf(']') >= 0) return null;
        int portAt = hostPort.indexOf(':');
        String hostText = portAt < 0 ? hostPort : hostPort.substring(0, portAt);
        String portText = portAt < 0 ? "" : hostPort.substring(portAt + 1);
        if (hostText.isEmpty()) return null;
        String port = "";
        if (!portText.isEmpty()) {
            for (int i = 0; i < portText.length(); i++) {
                if (portText.charAt(i) < '0' || portText.charAt(i) > '9') return null;
            }
            BigInteger number = new BigInteger(portText);
            if (number.compareTo(BigInteger.valueOf(65535)) > 0) return null;
            port = number.intValue() == 443 ? "" : number.toString();
        }
        String host = parseHost(hostText);
        if (host == null) return null;
        String rest = input.substring(end);
        int q = rest.indexOf('?');
        int h = rest.indexOf('#');
        int pathEnd = q >= 0 && (h < 0 || q < h) ? q : h >= 0 ? h : rest.length();
        String query = null;
        String fragment = null;
        if (h >= 0 && (q < 0 || h < q)) {
            fragment = rest.substring(h + 1);
        } else if (q >= 0) {
            query = rest.substring(q + 1, h >= 0 ? h : rest.length());
            if (h >= 0) fragment = rest.substring(h + 1);
        }
        return new WhatwgUrl(username, password, host, port, pathname(rest.substring(0, pathEnd)), query, fragment);
    }

    boolean hasCredentials() {
        return !username.isEmpty() || !password.isEmpty();
    }

    boolean hasSearch() {
        return query != null && !query.isEmpty();
    }

    boolean hasHash() {
        return fragment != null && !fragment.isEmpty();
    }

    /** The serialisation after url.search = '' for a URL without credentials (credentials are refused before this). */
    String hrefWithoutQuery() {
        StringBuilder out = new StringBuilder("https://").append(host);
        if (!port.isEmpty()) out.append(':').append(port);
        out.append(path);
        if (fragment != null) out.append('#').append(encode(fragment, false));
        return out.toString();
    }

    /** The decoded application/x-www-form-urlencoded pairs of the query, in order and with duplicates. */
    List<String[]> searchParams() {
        List<String[]> pairs = new ArrayList<>();
        if (query == null) return pairs;
        for (String piece : query.split("&", -1)) {
            if (piece.isEmpty()) continue;
            int eq = piece.indexOf('=');
            String name = eq < 0 ? piece : piece.substring(0, eq);
            String value = eq < 0 ? "" : piece.substring(eq + 1);
            pairs.add(new String[] {formDecode(name), formDecode(value)});
        }
        return pairs;
    }

    // ---- input cleaning -------------------------------------------------------------------------------------------

    private static String clean(String raw) {
        int s = 0;
        int e = raw.length();
        while (s < e && raw.charAt(s) <= 0x20) s++;
        while (e > s && raw.charAt(e - 1) <= 0x20) e--;
        StringBuilder out = new StringBuilder(e - s);
        for (int i = s; i < e; i++) {
            char c = raw.charAt(i);
            if (c == '\t' || c == '\n' || c == '\r') continue;
            if (Character.isHighSurrogate(c) && i + 1 < e && Character.isLowSurrogate(raw.charAt(i + 1))) {
                out.append(c).append(raw.charAt(++i));
            } else if (Character.isSurrogate(c)) {
                out.append('�');
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    private static boolean isAlpha(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    // ---- host -----------------------------------------------------------------------------------------------------

    private static String parseHost(String text) {
        String domain = new String(percentDecode(text), StandardCharsets.UTF_8);
        String ascii;
        if (domain.chars().allMatch(c -> c < 0x80)) {
            ascii = domain.toLowerCase(Locale.ROOT);
        } else {
            try {
                ascii = IDN.toASCII(domain, IDN.ALLOW_UNASSIGNED).toLowerCase(Locale.ROOT);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
        if (ascii.isEmpty()) return null;
        for (int i = 0; i < ascii.length(); i++) {
            char c = ascii.charAt(i);
            if (c <= 0x20 || c == 0x7f || "#/:<>?@[\\]^|%".indexOf(c) >= 0) return null;
        }
        return endsInNumber(ascii) ? ipv4(ascii) : ascii;
    }

    private static boolean endsInNumber(String host) {
        List<String> parts = new ArrayList<>(List.of(host.split("\\.", -1)));
        if (parts.get(parts.size() - 1).isEmpty()) {
            if (parts.size() == 1) return false;
            parts.remove(parts.size() - 1);
        }
        String last = parts.get(parts.size() - 1);
        if (!last.isEmpty() && last.chars().allMatch(c -> c >= '0' && c <= '9')) return true;
        return number(last) != null;
    }

    private static String ipv4(String host) {
        List<String> parts = new ArrayList<>(List.of(host.split("\\.", -1)));
        if (parts.get(parts.size() - 1).isEmpty() && parts.size() > 1) parts.remove(parts.size() - 1);
        if (parts.size() > 4) return null;
        List<BigInteger> numbers = new ArrayList<>();
        for (String part : parts) {
            BigInteger value = number(part);
            if (value == null) return null;
            numbers.add(value);
        }
        for (int i = 0; i < numbers.size() - 1; i++) {
            if (numbers.get(i).compareTo(BigInteger.valueOf(255)) > 0) return null;
        }
        BigInteger limit = BigInteger.valueOf(256).pow(5 - numbers.size());
        BigInteger address = numbers.get(numbers.size() - 1);
        if (address.compareTo(limit) >= 0) return null;
        for (int i = 0; i < numbers.size() - 1; i++) {
            address = address.add(numbers.get(i).multiply(BigInteger.valueOf(256).pow(3 - i)));
        }
        long value = address.longValue();
        return ((value >> 24) & 255) + "." + ((value >> 16) & 255) + "." + ((value >> 8) & 255) + "." + (value & 255);
    }

    /** WHATWG "parse an IPv4 number"; null is failure. */
    private static BigInteger number(String text) {
        if (text.isEmpty()) return null;
        int radix = 10;
        String digits = text;
        if (text.length() >= 2 && (text.startsWith("0x") || text.startsWith("0X"))) {
            radix = 16;
            digits = text.substring(2);
        } else if (text.length() >= 2 && text.charAt(0) == '0') {
            radix = 8;
            digits = text.substring(1);
        }
        if (digits.isEmpty()) return BigInteger.ZERO;
        for (int i = 0; i < digits.length(); i++) {
            if (Character.digit(digits.charAt(i), radix) < 0 || digits.charAt(i) > 0x7f) return null;
        }
        return new BigInteger(digits, radix);
    }

    // ---- path and encoding ----------------------------------------------------------------------------------------

    private static String pathname(String raw) {
        String path = raw.startsWith("/") || raw.startsWith("\\") ? raw.substring(1) : raw;
        String[] segments = path.split("[/\\\\]", -1);
        List<String> out = new ArrayList<>();
        for (int i = 0; i < segments.length; i++) {
            boolean last = i == segments.length - 1;
            String lower = segments[i].toLowerCase(Locale.ROOT);
            if (lower.equals("..") || lower.equals(".%2e") || lower.equals("%2e.") || lower.equals("%2e%2e")) {
                if (!out.isEmpty()) out.remove(out.size() - 1);
                if (last) out.add("");
            } else if (lower.equals(".") || lower.equals("%2e")) {
                if (last) out.add("");
            } else {
                out.add(encode(segments[i], true));
            }
        }
        return "/" + String.join("/", out);
    }

    private static String encode(String text, boolean path) {
        StringBuilder out = new StringBuilder(text.length());
        text.codePoints().forEach(cp -> {
            boolean encode = cp <= 0x1f || cp > 0x7e || cp == ' ' || cp == '"' || cp == '<' || cp == '>' || cp == '`'
                    || (path ? cp == '#' || cp == '?' || cp == '^' || cp == '{' || cp == '}' : false);
            if (!encode) {
                out.appendCodePoint(cp);
                return;
            }
            for (byte b : new String(Character.toChars(cp)).getBytes(StandardCharsets.UTF_8)) {
                out.append('%').append(String.format("%02X", b & 0xff));
            }
        });
        return out.toString();
    }

    private static String formDecode(String text) {
        return new String(percentDecode(text.replace('+', ' ')), StandardCharsets.UTF_8);
    }

    private static byte[] percentDecode(String text) {
        byte[] in = text.getBytes(StandardCharsets.UTF_8);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(in.length);
        for (int i = 0; i < in.length; i++) {
            if (in[i] == '%' && i + 2 < in.length && hex(in[i + 1]) >= 0 && hex(in[i + 2]) >= 0) {
                out.write(hex(in[i + 1]) * 16 + hex(in[i + 2]));
                i += 2;
            } else {
                out.write(in[i]);
            }
        }
        return out.toByteArray();
    }

    private static int hex(byte b) {
        return b < 0 ? -1 : Character.digit((char) b, 16);
    }
}
