import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('./open-browser.ts', import.meta.url));

// The child owns its node:child_process mock. A global module mock here would
// replace spawn in unrelated process-lifecycle suites running in the same VM.
async function verifyLaunch(source: string): Promise<void> {
  const child = Bun.spawn([process.execPath, '--eval', `
    import assert from 'node:assert/strict';
    import { spyOn } from 'bun:test';
    import * as processes from 'node:child_process';
    const calls=[];
    spyOn(processes,'spawn').mockImplementation((command,args)=>{calls.push({command,args});return {on(){},unref(){}};});
    const {openBrowser}=await import(${JSON.stringify(launcher)});
    ${source}
  `], {stdout:'pipe',stderr:'pipe'});
  const [code, stderr] = await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect({code,stderr:code===0?'':stderr}).toEqual({code:0,stderr:''});
}

describe('openBrowser safe process arguments', () => {
  it('passes a web URL as a standalone argument without invoking a shell', async () => {
    await verifyLaunch(`
      openBrowser('https://zcode.z.ai/oauth?code=abc');
      assert.equal(calls.length,1);assert.notEqual(calls[0].command,'cmd.exe');
      assert(calls[0].args.includes('https://zcode.z.ai/oauth?code=abc'));
      assert(!calls[0].args.some(arg=>arg.includes('start ')||arg.includes('""')));
    `);
  });
  it('refuses unsafe schemes and malformed URLs without spawning', async () => {
    await verifyLaunch(`
      for(const value of ['file:///etc/passwd','data:text/html,<script>1</script>','javascript:alert(1)','not a url']) openBrowser(value);
      assert.equal(calls.length,0);
    `);
  });
  it('encodes embedded quotes rather than creating an additional argument', async () => {
    await verifyLaunch(`
      openBrowser('https://example.test/?x="&calc');
      assert.equal(calls.length,1);assert(!calls[0].args.join(' ').includes('"'));
    `);
  });
});
