import { ok, result } from '../repository/core.js';

export class PresenterControlsService {
  #clock; #identity; #scenarios;
  constructor({ clock, identity, scenarios } = {}) { this.#clock = clock; this.#identity = identity; this.#scenarios = scenarios; }
  async readState(context) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    if (allowed.status !== 'ok') return allowed;
    if (!this.#clock) return result('unavailable', { reason: 'Demo clock has not been configured.', retryable: true });
    const state = await (this.#scenarios ? this.#scenarios.readState(context) : this.#clock.readState(context));
    if (state.status !== 'ok') return state;
    const configuration = await this.#clock.readControlsConfiguration(context);
    if (configuration.status !== 'ok') return configuration;
    const principals = await this.#identity.readPresenterPrincipals(context);
    if (principals.status !== 'ok') return principals;
    return ok({ ...state.value, currentScenario: state.value.currentScenario ?? null,
      controls: configuration.value, principals: principals.value });
  }
  async tick(context, input) {
    if (!this.#clock) return result('unavailable', { reason: 'Demo clock has not been configured.', retryable: true });
    return this.#clock.advanceAndTick(context, input);
  }
}
export const createPresenterControlsService = (options) => new PresenterControlsService(options);
