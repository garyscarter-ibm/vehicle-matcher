// Tiny owned synthetic runtime for client HTTP/browser proof; no product boot or new route authority.
import { buildServer } from '../../index.js';
import { createMemoryRepository, createMemoryStore } from '../../gcsp/repository/index.js';
import { createPolicyService } from '../../gcsp/policy/index.js';
import { createDemoRuntime } from '../../gcsp/clock/index.js';
import { createBriefService } from '../../gcsp/brief/index.js';
import { createBriefEditorService } from '../../gcsp/brief/editor.js';
import { createManualContextService, createRepositoryManualPorts } from '../../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../../gcsp/manual-context/fixtures.js';
import { createActivityService } from '../../gcsp/brief/activity.js';
import { providerValue, stock } from './employee-recommendation.js';
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
    const deps={repository,policy,identity,clock};
    checked(await seedManualDemoContext({...deps,context}));
    const account=createManualContextService({...deps,ports:createRepositoryManualPorts(deps)});
    const provider={resolve:async () => ({status:'ok',value:{...providerValue([stock(1)]),runId:context.runId,environmentId:context.environmentId,employeeId:context.employeeId}})};
    const editor=createBriefEditorService({...deps,brief,account,provider});
    const principals=checked(await policy.getAssumption('identity.demo.principals',{runId:context.runId,asOf:(await clock.now(context)).value.now})).value;
    const principal=principals.find((p) => p.employeeId===context.employeeId);
    return {store,repository,policy,identity,clock,brief,activity,context,presenter,
      cookie:[acting.setCookie].flat().map((v) => v.split(';')[0]).join('; '),
      account:{status:'ready',name:principal?.name || 'Synthetic employee',context:'Synthetic activity proof'},
      server({origin='https://activity-client.test',service=activity}={}) {return buildServer({gcspIdentity:identity,gcspActivity:service,gcspBrief:brief,gcspBriefEditor:editor,gcspVehicleEvidence:{lookup:{resolve:async () => ({status:'unavailable'})}},gcspAllowedOrigins:[origin]});},
      async confirm() {
        checked(await editor.savePreferences(context,{commandId:'draft',expectedBriefVersion:0,expectedDraftVersion:0,
          changes:{body:{value:['estate']},comfort:{value:50},economy:{value:50}}}));
        return checked(await editor.engage(context,{commandId:'confirm',expectedBriefVersion:0,expectedDraftVersion:1}));
      },
      close:() => repository.close() };
  } catch(error) {await repository.close();throw error;}
}
