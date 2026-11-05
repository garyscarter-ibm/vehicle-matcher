// Fictional fixtures are configured in the canonical policy source, never copied here.
export async function loadDemoPrincipals(policy, read) {
  const [configured, mapping] = await Promise.all([
    policy.getAssumption('identity.demo.principals', read),
    policy.getAssumption('eligibility.context.mapping', read),
  ]);
  if (configured.status !== 'ok' || mapping.status !== 'ok') return { status: 'unavailable', reason: 'Identity policy is unavailable.', retryable: true };
  const principals = configured.value.value;
  const text = (value) => typeof value === 'string' && value.length > 0;
  const allowed = ['principalId', 'employeeId', 'name', 'roles', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId'];
  const valid = Array.isArray(principals) && principals.length > 0
    && principals.every((p) => p && typeof p === 'object' && !Array.isArray(p))
    && new Set(principals.map((p) => p.principalId)).size === principals.length
    && new Set(principals.map((p) => p.employeeId)).size === principals.length
    && new Set(principals.filter((p) => p.roles?.includes('employee')).map((p) => p.entitlementSlotId)).size === principals.filter((p) => p.roles?.includes('employee')).length
    && principals.every((p) => Object.keys(p).every((key) => allowed.includes(key))
      && ['principalId', 'employeeId', 'name'].every((key) => text(p[key]))
      && Array.isArray(p.roles) && p.roles.length === 1 && ['employee', 'greg', 'presenter'].includes(p.roles[0])
      && (p.roles[0] === 'presenter' || mapping.value.value.some((m) => m.companyId === p.companyId && m.schemeId === p.schemeId
        && (p.roles[0] === 'greg' || m.gradeIds.includes(p.gradeId) && text(p.entitlementSlotId)))))
    && principals.filter((p) => p.roles.includes('presenter')).length === 1;
  return valid ? { status: 'ok', value: structuredClone(principals), policyVersion: configured.policyVersion }
    : { status: 'unavailable', reason: 'Fictional principal configuration is invalid.', retryable: false };
}

// Shared by initial identity setup and the atomic scenario reset fixture builder.
export async function loadDemoPrincipalSeed(policy, read) {
  const [principals, capacity] = await Promise.all([loadDemoPrincipals(policy, read), policy.getAssumption('hold.employee.maxActive', read)]);
  if (principals.status !== 'ok' || capacity.status !== 'ok' || !Number.isSafeInteger(capacity.value.value) || capacity.value.value <= 0) {
    return { status: 'unavailable', reason: 'Identity fixture policy is unavailable.', retryable: true };
  }
  return { status: 'ok', value: { principals: principals.value, capacity: capacity.value.value }, policyVersion: principals.policyVersion };
}
