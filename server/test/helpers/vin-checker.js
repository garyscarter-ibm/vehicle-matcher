// Independent offline checker: no imports from production or its checksum data.
export function offlineVinCheck(vin) {
  if (typeof vin !== 'string' || !/^[0-9A-HJ-NPR-Z]{17}$/.test(vin)) return { valid: false };
  const groups = ['0', '1AJ', '2BKS', '3CLT', '4DMU', '5ENV', '6FW', '7GPX', '8HY', '9RZ'];
  const multipliers = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let total = 0;
  for (let index = 0; index < 17; index += 1) {
    total += groups.findIndex((group) => group.includes(vin[index])) * multipliers[index];
  }
  const remainder = total % 11;
  const expected = remainder === 10 ? 'X' : `${remainder}`;
  return { valid: vin[8] === expected, total, remainder, expected };
}
