package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Retained display imagery ported from Node display-images.js and the retained path of live-display-images.js.
 * An unreadable or changed catalogue is unavailable; no image is ever added from unverified bytes.
 */
public final class DisplayCatalogue {

    /** Pinned sha256 of the retained display image catalogue. */
    public static final String CATALOGUE_SHA256 = "f12e588c78ca900dc98800697960f7d2857283d982fadd5cde292ba6be27b694";

    private static final long MAX_ASSET_BYTES = 2L * 1024 * 1024;
    private static final long MAX_CATALOGUE_BYTES = 16L * 1024 * 1024;
    private static final String ASSET_DIRECTORY = "assets/gcsp-vehicle-evidence";
    private static final Pattern ASSET = Pattern.compile("assets/gcsp-vehicle-evidence/[a-f0-9]{64}\\.webp");
    private static final Pattern IMAGE_ID = Pattern.compile("bmw-display-[a-f0-9]{20}");
    private static final Pattern SHA256 = Pattern.compile("[a-f0-9]{64}");
    private static final Pattern PAINT = Pattern.compile("P[A-Z0-9]{4}");
    private static final Pattern SIGNATURE_BASE64 = Pattern.compile("[A-Za-z0-9+/]+={0,2}");
    private static final Pattern SIGNATURE_TEXT = Pattern.compile("[A-Z0-9]+:[A-Z0-9,]+");

    /** Verified retained bytes for the image endpoint. */
    public record RetainedImage(byte[] bytes, String contentType) {}

    /** Loads an asset's bytes, or null when it is not a regular file of the declared size. */
    interface AssetLoader {
        byte[] load(JsonNode image) throws IOException;
    }

    private final Path assetsRoot;
    private final AssetLoader loader;
    private final boolean cacheVerification;
    private final JsonNode data;
    private final Map<String, JsonNode> configurations = new LinkedHashMap<>();
    private final Map<String, JsonNode> mapping = new LinkedHashMap<>();
    private final Map<String, Boolean> verified = new ConcurrentHashMap<>();

    /** The assets root holds assets/gcsp-vehicle-evidence/; a missing or changed catalogue is unavailable. */
    public DisplayCatalogue(Path catalogueFile, Path assetsRoot) {
        this(catalogueFile, assetsRoot, null);
    }

    DisplayCatalogue(Path catalogueFile, Path assetsRoot, AssetLoader injected) {
        this.assetsRoot = assetsRoot.toAbsolutePath().normalize();
        this.loader = injected != null ? injected : this::readAsset;
        this.cacheVerification = injected == null;
        JsonNode loaded = null;
        try {
            loaded = load(catalogueFile);
            index(loaded);
        } catch (IOException | RuntimeException e) {
            loaded = null;
            configurations.clear();
            mapping.clear();
        }
        this.data = loaded;
    }

    private static JsonNode load(Path file) throws IOException {
        if (Files.size(file) > MAX_CATALOGUE_BYTES) throw new IOException("catalogue too large");
        byte[] bytes = Files.readAllBytes(file);
        if (!CanonicalJson.sha256Hex(bytes).equals(CATALOGUE_SHA256)) throw new IOException("Display image catalogue changed.");
        return StrictJson.parse(bytes, bytes.length);
    }

    public boolean available() {
        return data != null;
    }

    /** Number of image ids the retained endpoint can serve (Node live handler mapping size). */
    public int imageCount() {
        return mapping.size();
    }

    /** True when the retained endpoint can serve this id (it may still fail verification). */
    public boolean knows(String imageId) {
        return imageId != null && mapping.containsKey(imageId);
    }

    /** Ids in Node mapping order. */
    List<String> imageIds() {
        return List.copyOf(mapping.keySet());
    }

    private void index(JsonNode catalogue) {
        for (JsonNode row : catalogue.get("configurations")) {
            JsonNode id = row.get("configurationId");
            if (id != null && id.isTextual()) configurations.putIfAbsent(id.textValue(), row);
        }
        List<JsonNode> images = new ArrayList<>();
        for (JsonNode row : catalogue.get("configurations")) images.add(row.get("image"));
        catalogue.get("variants").forEach(images::add);
        catalogue.get("models").forEach(images::add);
        JsonNode galleries = catalogue.get("configurationGalleries") != null && !catalogue.get("configurationGalleries").isNull()
                ? catalogue.get("configurationGalleries")
                : catalogue.get("galleries");
        if (galleries != null && !galleries.isNull()) {
            for (JsonNode gallery : galleries) {
                if (gallery.isArray()) gallery.forEach(images::add);
                else images.add(gallery);
            }
        }
        for (JsonNode image : images) {
            if (image == null || !image.isObject()) continue;
            JsonNode id = image.get("imageId");
            JsonNode bytes = image.get("bytes");
            if (Js.text(id) && IMAGE_ID.matcher(id.textValue()).matches() && assetPath(image) != null
                    && image.get("sha256") != null && image.get("sha256").isTextual()
                    && SHA256.matcher(image.get("sha256").textValue()).matches()
                    && bytes != null && bytes.isIntegralNumber() && bytes.canConvertToLong()
                    && bytes.longValue() > 0 && bytes.longValue() <= MAX_ASSET_BYTES) {
                mapping.put(id.textValue(), image);
            }
        }
    }

    private static String assetPath(JsonNode image) {
        JsonNode asset = image == null ? null : image.get("asset");
        return asset != null && asset.isTextual() && ASSET.matcher(asset.textValue()).matches() ? asset.textValue() : null;
    }

    /** Node configurationDisplayGallery: ordered, individually verified retained views, or none. */
    public List<JsonNode> gallery(JsonNode record) {
        if (data == null) return List.of();
        try {
            return galleryFor(configurationImage(record));
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    private List<JsonNode> galleryFor(JsonNode first) {
        if (first == null) return List.of();
        JsonNode images = null;
        JsonNode byConfiguration = lookup(data.get("configurationGalleries"), first.get("configurationId"));
        if (byConfiguration != null && !byConfiguration.isNull()) images = byConfiguration;
        else {
            JsonNode byImage = lookup(data.get("galleries"), first.get("imageId"));
            if (byImage != null && !byImage.isNull()) images = byImage;
        }
        List<JsonNode> views = new ArrayList<>();
        if (images == null) views.add(first);
        else if (images.isArray()) images.forEach(views::add);
        else return List.of();
        List<JsonNode> gallery = new ArrayList<>();
        for (JsonNode image : views) {
            JsonNode fidelity = Js.is(first.get("fidelity"), "representative-model") ? first.get("fidelity")
                    : Js.field(image, "fidelity");
            ObjectNode candidate = merged(image);
            candidate.set("configurationId", Js.copy(first.get("configurationId")));
            candidate.set("role", fidelity == null ? null : fidelity.deepCopy());
            candidate.set("fidelity", fidelity == null ? null : fidelity.deepCopy());
            JsonNode checked = published(candidate);
            if (checked != null && gallery.stream().noneMatch(entry -> Js.strictEquals(entry.get("sha256"), checked.get("sha256")))) {
                gallery.add(checked);
            }
        }
        return gallery;
    }

    private static ObjectNode merged(JsonNode image) {
        return image != null && image.isObject() ? ((ObjectNode) image).deepCopy() : new ObjectNode(JsonNodeFactory.instance);
    }

    private static JsonNode lookup(JsonNode object, JsonNode key) {
        return key != null && key.isTextual() ? lookup(object, key.textValue()) : null;
    }

    private static JsonNode lookup(JsonNode object, String key) {
        return Js.isObject(object) ? object.get(key) : null;
    }

    /** Node configurationDisplayImage: the exact entry, else the GB variant rule with exactly one paint code. */
    private JsonNode configurationImage(JsonNode record) {
        JsonNode id = Js.field(record, "configurationId");
        JsonNode entry = id != null && id.isTextual() ? configurations.get(id.textValue()) : null;
        if (entry != null) {
            JsonNode digest = entry.get("recordDigest");
            return digest != null && digest.isTextual() && digest.textValue().equals(CanonicalJson.digest(record))
                    ? published(merged(entry.get("image"))) : null;
        }
        JsonNode identity = Js.field(record, "canonicalIdentity");
        JsonNode configuration = Js.field(record, "configuration");
        JsonNode codes = Js.field(identity, "factoryOptionCodes");
        if (codes == null || !codes.isArray() || !Js.is(Js.field(configuration, "market"), "GB")
                || !Js.truthy(Js.field(configuration, "generation"))
                || !Js.strictEquals(identity.get("agModelCode"), configuration.get("agModelCode"))
                || !Js.strictEquals(identity.get("vgModelCode"), configuration.get("vgModelCode"))) return null;
        String vgModelCode = textOf(identity.get("vgModelCode"));
        List<String> sorted = textList(codes);
        if (vgModelCode == null || sorted == null || id == null || !id.isTextual()) return null;
        sorted = new ArrayList<>(sorted);
        sorted.sort(null);
        String expected = Base64.getEncoder().encodeToString(
                (vgModelCode + ":" + String.join(",", sorted)).getBytes(StandardCharsets.UTF_8));
        if (!expected.equals(id.textValue())) return null;
        List<String> paint = sorted.stream().filter(code -> PAINT.matcher(code).matches()).toList();
        if (paint.size() != 1) return null;
        JsonNode model = lookup(data.get("vgModels"), identity.get("vgModelCode"));
        if (!Js.strictEquals(Js.field(model, "generation"), configuration.get("generation"))
                || !Js.strictEquals(Js.field(model, "agModelCode"), configuration.get("agModelCode"))) return null;
        JsonNode image = variantImage(model, paint.get(0));
        if (image == null) return null;
        ObjectNode candidate = merged(image);
        candidate.set("configurationId", id.deepCopy());
        return published(candidate);
    }

    private JsonNode variantImage(JsonNode model, String paint) {
        String generation = model.get("generation").asText();
        JsonNode variants = data.get("variants");
        JsonNode specific = lookup(variants, generation + "|" + textOf(model.get("agModelCode")) + "|" + paint);
        JsonNode image = specific != null && !specific.isNull() ? specific : lookup(variants, generation + "|" + paint);
        Signature signature = signature(Js.field(image, "configurationId"));
        JsonNode source = signature == null ? null : lookup(data.get("vgModels"), signature.vg());
        if (signature == null || !signature.paint().equals(paint)
                || !Js.strictEquals(Js.field(source, "generation"), model.get("generation"))
                || Js.truthy(specific) && !Js.strictEquals(Js.field(source, "agModelCode"), model.get("agModelCode"))) {
            return null;
        }
        return image;
    }

    private record Signature(String vg, String paint) {}

    private static Signature signature(JsonNode id) {
        if (id == null || !id.isTextual() || id.textValue().length() > 4096
                || !SIGNATURE_BASE64.matcher(id.textValue()).matches()) return null;
        String decoded;
        try {
            byte[] bytes = Base64.getDecoder().decode(id.textValue());
            decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (IllegalArgumentException | CharacterCodingException e) {
            return null;
        }
        if (!Base64.getEncoder().encodeToString(decoded.getBytes(StandardCharsets.UTF_8)).equals(id.textValue())
                || !SIGNATURE_TEXT.matcher(decoded).matches()) return null;
        int colon = decoded.indexOf(':');
        String list = decoded.substring(colon + 1);
        String[] codes = list.split(",", -1);
        String[] sorted = codes.clone();
        Arrays.sort(sorted);
        if (new HashSet<>(Arrays.asList(codes)).size() != codes.length || !String.join(",", sorted).equals(list)) return null;
        List<String> paints = Arrays.stream(codes).filter(code -> PAINT.matcher(code).matches()).toList();
        return paints.size() == 1 ? new Signature(decoded.substring(0, colon), paints.get(0)) : null;
    }

    private static String textOf(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }

    private static List<String> textList(JsonNode array) {
        List<String> out = new ArrayList<>();
        for (JsonNode item : array) {
            if (item == null || !item.isTextual()) return null;
            out.add(item.textValue());
        }
        return out;
    }

    /** Node published(): a shaped, byte-verified image or null. The result is a detached copy. */
    private JsonNode published(ObjectNode image) {
        JsonNode fidelity = image.get("fidelity");
        if (assetPath(image) == null
                || !(Js.is(fidelity, "representative-model") || Js.is(fidelity, "representative-configuration"))) return null;
        return verifiedBytes(image) ? image.deepCopy() : null;
    }

    private boolean verifiedBytes(JsonNode image) {
        String key = image.get("asset").textValue() + "|" + image.get("bytes") + "|" + image.get("sha256");
        if (cacheVerification) {
            Boolean known = verified.get(key);
            if (known != null) return known;
        }
        boolean ok;
        try {
            byte[] bytes = loader.load(image);
            JsonNode size = image.get("bytes");
            ok = bytes != null && size != null && size.isNumber() && bytes.length == size.doubleValue()
                    && Js.is(image.get("sha256"), CanonicalJson.sha256Hex(bytes));
        } catch (IOException e) {
            // As in Node, an unopenable asset empties the gallery; it is not remembered as a verdict on the bytes.
            throw new UncheckedIOException(e);
        }
        if (cacheVerification) verified.put(key, ok);
        return ok;
    }

    /** Verified retained bytes for an id in the live handler mapping, else empty. */
    public Optional<RetainedImage> retainedImage(String imageId) {
        JsonNode image = imageId == null ? null : mapping.get(imageId);
        if (image == null) return Optional.empty();
        try {
            byte[] bytes = loader.load(image);
            if (bytes == null || bytes.length != image.get("bytes").longValue() || bytes.length > MAX_ASSET_BYTES
                    || !CanonicalJson.sha256Hex(bytes).equals(image.get("sha256").textValue()) || !webp(bytes)) {
                return Optional.empty();
            }
            return Optional.of(new RetainedImage(bytes, "image/webp"));
        } catch (IOException | RuntimeException e) {
            return Optional.empty();
        }
    }

    private static boolean webp(byte[] bytes) {
        if (bytes.length < 20 || !ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return false;
        long riff = (bytes[4] & 0xffL) | (bytes[5] & 0xffL) << 8 | (bytes[6] & 0xffL) << 16 | (bytes[7] & 0xffL) << 24;
        return riff + 8 == bytes.length && (ascii(bytes, 12, "VP8 ") || ascii(bytes, 12, "VP8L") || ascii(bytes, 12, "VP8X"));
    }

    private static boolean ascii(byte[] bytes, int from, String text) {
        for (int i = 0; i < text.length(); i++) if (bytes[from + i] != text.charAt(i)) return false;
        return true;
    }

    /** The asset file when it resolves inside the assets directory, else null. */
    static Path contained(Path root, String asset) {
        Path normalized = root.toAbsolutePath().normalize();
        Path file = normalized.resolve(asset).normalize();
        Path directory = normalized.resolve(ASSET_DIRECTORY);
        return file.startsWith(directory) && !file.equals(directory) ? file : null;
    }

    /** Bounded read of a regular file whose size is the declared size; anything else is null. */
    private byte[] readAsset(JsonNode image) throws IOException {
        JsonNode declared = image.get("bytes");
        String asset = assetPath(image);
        Path file = asset == null ? null : contained(assetsRoot, asset);
        if (file == null || declared == null || !declared.isNumber()) return null;
        BasicFileAttributes attributes = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isRegularFile() || attributes.size() > MAX_ASSET_BYTES || attributes.size() != declared.doubleValue()) {
            return null;
        }
        int expected = (int) attributes.size();
        ByteBuffer buffer = ByteBuffer.allocate(expected + 1);
        try (SeekableByteChannel channel = Files.newByteChannel(file)) {
            while (buffer.hasRemaining() && channel.read(buffer) >= 0) {
                // A bounded read also handles a file growing between the size check and the read.
            }
        }
        return buffer.position() == expected ? Arrays.copyOf(buffer.array(), expected) : null;
    }
}
