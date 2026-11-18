import { bootDemo } from './boot.js';
import { createEmployeeCapability } from './employee-entry.js';

bootDemo({ employeeCapability: createEmployeeCapability({ enabled: true, frontendUrl: null }) });
