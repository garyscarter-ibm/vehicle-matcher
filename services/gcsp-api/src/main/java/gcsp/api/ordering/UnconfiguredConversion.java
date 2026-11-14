package gcsp.api.ordering;

import gcsp.api.persistence.Tx;

/** The default until a source Story supplies its converter: every selection from it is refused. */
public final class UnconfiguredConversion implements SelectionConversionPort {

    public static final String CODE = "selection-source-unsupported";
    private final String sourceType;

    public UnconfiguredConversion(String sourceType) {
        this.sourceType = sourceType;
    }

    @Override
    public String sourceType() {
        return sourceType;
    }

    @Override
    public Preparation prepare(OrderingScope scope, SourceInput source) {
        return new Refusal(CODE);
    }

    @Override
    public Conversion convert(Tx tx, OrderingScope scope, ConversionRequest request) {
        return new Refusal(CODE);
    }
}
