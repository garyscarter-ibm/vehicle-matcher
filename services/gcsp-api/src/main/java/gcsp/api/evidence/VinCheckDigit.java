package gcsp.api.evidence;

import java.util.regex.Pattern;

/** VIN position 9 check digit, ported from Node vin-generator.js calculateVinCheckDigit. */
public final class VinCheckDigit {

    private static final Pattern VIN17 = Pattern.compile("[A-HJ-NPR-Z0-9]{17}");
    private static final int[] WEIGHTS = {8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2};
    private static final String LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
    private static final int[] LETTER_VALUES = {1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9};

    private VinCheckDigit() {}

    public static boolean isVin17(String vin) {
        return vin != null && VIN17.matcher(vin).matches();
    }

    /** The expected position-9 character: a digit, or X for remainder 10. */
    public static char calculate(String vin17) {
        if (!isVin17(vin17)) {
            throw new IllegalArgumentException("Expected 17 uppercase permitted VIN characters");
        }
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            char c = vin17.charAt(i);
            int value = Character.isDigit(c) ? c - '0' : LETTER_VALUES[LETTERS.indexOf(c)];
            sum += value * WEIGHTS[i];
        }
        int remainder = sum % 11;
        return remainder == 10 ? 'X' : (char) ('0' + remainder);
    }
}
