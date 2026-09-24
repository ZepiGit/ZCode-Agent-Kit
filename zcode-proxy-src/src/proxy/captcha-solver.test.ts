import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const solverPath = fileURLToPath(new URL("./captcha-solver.ts", import.meta.url));
const fixtureUrl = new URL("./__fixtures__/solver-backend.ts", import.meta.url).href;

// Each scenario uses the production worker transport and a local backend.
// Child isolation prevents another suite's module mocks from replacing it.
// Real deadlines deliberately exercise OS worker termination during Atomics.wait;
// a fake host clock cannot drive a separate worker's event loop.
async function scenario(source: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "--eval", `
    import assert from 'node:assert/strict';
    import * as solver from ${JSON.stringify(solverPath)};
    import { classifyCaptchaError } from ${JSON.stringify(fileURLToPath(new URL('./captcha-token.ts', import.meta.url)))};
    solver.configureCaptchaSolver({backendModule:${JSON.stringify(fixtureUrl)},deadlineMs:3000,idleMs:1000,recycleAfterSolves:200,recycleAfterFailures:3,maxWorkerHeapMB:768});
    const run = async scene => {
      const token=await solver.runCaptchaSolve(scene,'fixture','fixture');
      return scene==='real-dom' ? token : JSON.parse(Buffer.from(token,'base64').toString()).certifyId;
    };
    const watchdog = setTimeout(() => { console.error('offline worker scenario timed out'); process.exit(1); }, 12000);
    try { ${source}; solver.shutdownCaptchaSolver(); console.log('SCENARIO_OK'); }
    finally { clearTimeout(watchdog); solver.shutdownCaptchaSolver(); }
  `], {stdout:'pipe',stderr:'pipe',env:{...process.env,ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA:'0'}});
  const [code, stdout, stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect({code,stderr:code===0?'':stderr}).toEqual({code:0,stderr:''});
  expect(stdout).toContain('SCENARIO_OK');
}

describe('isolated CAPTCHA solver lifecycle', () => {
  it('serializes concurrent solves across deferred shutdown', async () => {
    await scenario(`
      const first=run('slow:80'); const second=run('token:second');
      solver.shutdownCaptchaSolver();
      assert.equal(await first,'token:slow:active=1');
      assert.equal(await second,'token:second:active=1');
      assert.equal(solver.getCaptchaSolverStats().alive,false);
      assert.equal(solver.captchaSolverConcurrency(),1);
      assert.equal(await run('token:restarted'),'token:restarted:active=1');
    `);
  });
  it('keeps host timers alive and recovers from a blocked worker deadline', async () => {
    await scenario(`
      await run('token:warm');
      const initial=solver.getCaptchaSolverStats().generation;
      solver.configureCaptchaSolver({deadlineMs:250});
      let ticks=0; const interval=setInterval(()=>ticks++,10);
      await assert.rejects(run('hang'),/deadline exceeded/);
      clearInterval(interval); assert(ticks>=5,'host thread was blocked');
      solver.configureCaptchaSolver({deadlineMs:3000});
      assert.equal(await run('token:after'),'token:after:active=1');
      assert(solver.getCaptchaSolverStats().generation>initial);
      assert.equal(solver.getCaptchaSolverStats().deadlineKills,1);
    `);
  });
  it('checks admission after queued work settles without bypassing provider pause', async () => {
    await scenario(`
      let paused=false; let admitted=false;
      const first=solver.runCaptchaSolve('slow429:50','fixture','fixture').catch(error=>{paused=true;assert.equal(classifyCaptchaError(error),'rate-limit');});
      const second=solver.runCaptchaSolve('token:forbidden','fixture','fixture',()=>{if(paused)throw new Error('provider paused');admitted=true;});
      // Mark the pause synchronously from the rejection continuation before admission.
      await first;
      await assert.rejects(second,/provider paused/);
      assert.equal(admitted,false);
      assert.equal(await run('token:independent'),'token:independent:active=1');
    `);
  });
  it('rejects malformed and oversized worker success data then recovers', async () => {
    await scenario(`
      for(const invalid of ['invalid','oversized']) {
        await assert.rejects(run(invalid),/invalid token/);
        assert.equal(solver.getCaptchaSolverStats().alive,false);
        assert.equal(await run('token:recovered'),'token:recovered:active=1');
      }
    `);
  });
  it('preserves classified SDK errors without private provider payloads', async () => {
    await scenario(`
      for(const [scene,category] of [['rate-limit','rate-limit'],['incompatible','incompatible']]){
        try{await run(scene);assert.fail('expected failure');}catch(error){assert.equal(classifyCaptchaError(error),category);assert(!error.message.includes('PRIVATE_SDK_MARKER'));}
      }
    `);
  });
  it('recycles a faulted worker but survives attributable guest callbacks', async () => {
    await scenario(`
      await run('token:warm'); const first=solver.getCaptchaSolverStats().generation;
      assert.equal(await run('guest-throw'),'token:guest:active=1');
      assert.equal(solver.getCaptchaSolverStats().generation,first);
      await assert.rejects(run('host-throw'),/worker (fault|failed|exited)/);
      assert.equal(await run('token:after'),'token:after:active=1');
      assert(solver.getCaptchaSolverStats().generation>first);
    `);
  });
  it('recovers sticky cleanup failures and deferred recycle requests', async () => {
    await scenario(`
      await assert.rejects(run('cleanup'),/cleanup failed/);
      const before=solver.getCaptchaSolverStats().generation;
      const slow=run('slow:40'); solver.requestCaptchaSolverRecycle('memory');
      assert.equal(await slow,'token:slow:active=1');
      assert.equal(solver.getCaptchaSolverStats().alive,false);
      assert.equal(await run('token:after'),'token:after:active=1');
      assert(solver.getCaptchaSolverStats().generation>before);
    `);
  });
  it('recycles bounded generations after solve and failure thresholds', async () => {
    await scenario(`
      solver.configureCaptchaSolver({recycleAfterSolves:2});
      await run('token:one'); const first=solver.getCaptchaSolverStats().generation;
      await run('token:two'); assert.equal(solver.getCaptchaSolverStats().alive,false);
      solver.configureCaptchaSolver({recycleAfterSolves:200,recycleAfterFailures:2});
      await assert.rejects(run('fail')); await assert.rejects(run('fail'));
      assert.equal(solver.getCaptchaSolverStats().alive,false);
      await run('token:three'); assert(solver.getCaptchaSolverStats().generation>first);
    `);
  });
  it('keeps IPC working through real happy-dom global alias setup and teardown', async () => {
    await scenario(`
      const encoded=await run('real-dom');
      assert.equal(JSON.parse(Buffer.from(encoded,'base64').toString()).certifyId,'real-dom');
      assert.equal(await run('token:after'),'token:after:active=1');
      const metadata=solver.getCaptchaSolverStats().lastSdkScripts;
      assert(metadata.some(script=>script.filename==='feilin008.js'));
      assert(!JSON.stringify(metadata).includes('PRIVATE'));
      assert(!JSON.stringify(metadata).includes('https://'));
    `);
  });
});
