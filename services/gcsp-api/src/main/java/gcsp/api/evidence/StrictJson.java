package gcsp.api.evidence;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Strict UTF-8 decoding and single-document JSON parsing (no trailing tokens, duplicate keys: last wins). */
final class StrictJson {

    private static final ObjectReader READER =
            new ObjectMapper().readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private StrictJson() {}

    static JsonNode parse(byte[] bytes, int length) throws IOException {
        String text = decode(bytes, length);
        JsonNode node = READER.readValue(text);
        if (node == null || node.isMissingNode()) throw new IOException("Empty JSON document");
        return node;
    }

    static String decode(byte[] bytes, int length) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, 0, length))
                .toString();
    }
}
