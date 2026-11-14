package gcsp.api.returns;

import java.time.Instant;

/**
 * The order's selection record, read only. A new order is {@code applicable=false} with null old-car fields; a
 * buddy order has no location and records the odometer reading.
 */
public record ReturnSource(String orderUuid, String employeeId, boolean applicable, String oldContractId,
        String entitlementSlotId, String oldSlotId, String locationId, boolean buddy, Long mileage, String mileageUnit,
        String sourceReference, Instant receivedAt, String configurationId) {

    public static final String INVALID = "return-plan-source-invalid";

    /**
     * Ports the selection checks of return-plan/index.js: a replacement needs the contract, the vehicle slot and a
     * non-negative mileage; a non-buddy replacement also names the collection location; a buddy carries the unit.
     */
    public boolean valid() {
        if (!ReturnJson.text(orderUuid, 128) || !ReturnJson.text(employeeId, 128)) return false;
        if (!applicable) return oldContractId == null && entitlementSlotId == null && oldSlotId == null;
        if (!ReturnJson.text(oldContractId, 128) || !ReturnJson.text(entitlementSlotId, 128)
                || !ReturnJson.text(sourceReference, 256) || mileage == null || mileage < 0) {
            return false;
        }
        if (buddy) return ReturnJson.text(mileageUnit, 16);
        return ReturnJson.text(locationId, 128);
    }
}
