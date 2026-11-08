// Tiny owned synthetic runtime for client HTTP/browser proof; no product boot or new route authority.
import { buildServer } from '../../index.js';
import { createMemoryRepository, createMemoryStore } from '../../gcsp/repository/index.js';
import { createPolicyService } from '../../gcsp/policy/index.js';
import { createDemoRuntime } from '../../gcsp/clock/index.js';
import { createBriefService } from '../../gcsp/brief/index.js';
import { createActivityService } from '../../gcsp/brief/activity.js';
import { preference, essential } from './employee-recommendation.js';
const checked = (out) => { if (out.status !== 'ok') throw new Error(`Activity client fixture: ${out.status}`); return out.value; };
export async function createActivityClientRuntime() {
  const store=createMemoryStore(); const repository=createMemoryRepository({store}); checked(await repository.open());
  const policy=createPolicyService();
  try {
    const {identity,clock}=checked(await createDemoRuntime({repository,policy,environmentId:'activity-client-proof',environmentKind:'synthetic',
      policyAsOf:'2026-11-05T00:00:00.000Z',commandId:'bootstrap',sessionNow:() => '2026-11-05T00:00:00.000Z'}));
    const presenter=checked(await identity.createPresenterSession('presenter'));
    const acting=checked(await identity.switchPrincipal(presenter.context,'demo-paula','paula')); const context=acting.context;
    const brief=createBriefService({repository,policy,identity,clock}); const activity=createActivityService({repository,identity,clock});
    const principals=checked(await policy.getAssumption('identity.demo.principals',{runId:context.runId,asOf:(await clock.now(context)).value.now})).value;
    const principal=principals.find((p) => p.employeeId===context.employeeId);
    return {store,repository,policy,identity,clock,brief,activity,context,presenter,
      cookie:[acting.setCookie].flat().map((v) => v.split(';')[0]).join('; '),
      account:{status:'ready',name:principal?.name || 'Synthetic employee',context:'Synthetic activity proof'},
      server({origin='https://activity-client.test',service=activity}={}) {return buildServer({gcspIdentity:identity,gcspActivity:service,gcspBrief:brief,gcspAllowedOrigins:[origin]});},
      async confirm() {
        checked(await brief.saveDraft(context,{commandId:'draft',expectedBriefVersion:0,expectedDraftVersion:0,
          brief:{schemaVersion:1,preferences:{body:preference('estate')},essentials:{seats:essential(5)}}}));
        return checked(await brief.confirm(context,{commandId:'confirm',expectedBriefVersion:0,expectedDraftVersion:1,consent:{search:true,hold:true}}));
      },
      close:() => repository.close() };
  } catch(error) {await repository.close();throw error;}
}
