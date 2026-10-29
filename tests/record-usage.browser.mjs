import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'vite'
import { chromium } from 'playwright'
import { readPublication } from '../examples/react/publications.ts'

// A retained Discovery projection with real per-response counters, metered windows and tool returns.
test('record usage keeps original source actions and measured semantics through the shared figure', { timeout: 150_000 }, async () => {
  const require = createRequire(process.env.AGENT_RECORD_PACKAGE ?? resolve('package.json'))
  const assets = dirname(require.resolve('@drewstone/agent-record/workspace-viewer.js'))
  const bytes = await readFile(new URL('./fixtures/waterfall-discovery-record.json', import.meta.url))
  const digest = createHash('sha256').update(bytes).digest('hex'), record = JSON.parse(bytes)
  assert.equal(record.events.length, 281)
  assert.ok(record.events.some(event => event.detail?.usageScope), 'the retained projection includes aggregate windows')
  const firstUsage = record.events.find(event => event.node === 'root' && event.detail?.usage && event.detail.usageScope === undefined)
  assert.ok(firstUsage)
  const stoppedBytes=Buffer.from(await readPublication('ftqc-zips-2026-08-05-r1')), stoppedRecord=JSON.parse(stoppedBytes)
  const stoppedActors=stoppedRecord.nodes.filter(node=>node.status==='down')
  assert.equal(stoppedActors.length,2,'the immutable real publication retains two stopped actors')
  const evidence = process.env.RUN_UI_EVIDENCE_DIR, checks = []
  if (evidence) await mkdir(evidence, { recursive: true })
  const scratch = await mkdtemp(resolve('.usage-host-')), entry = resolve(scratch, 'host.js')
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AgentRecord,parseRecord}from${JSON.stringify(resolve(assets,'index.js'))};
const record=parseRecord(await fetch('/retained-record'+location.search).then(response=>response.json()));const initial={runId:record.runId,nodeId:'root',view:'usage'};
function Host(){const[selection,set]=useState(initial);return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>{window.chosen=initial;set(initial)}},'Return to full usage'),React.createElement(AgentRecord,{records:[record],selection,onSelectionChange:value=>{window.chosen=value;set(value)},theme:new URL(location.href).searchParams.get('theme')}))}createRoot(document.getElementById('host')).render(React.createElement(Host));`)
  const built = await build({ configFile:false, logLevel:'silent', resolve:{dedupe:['react','react-dom']}, define:{'process.env.NODE_ENV':JSON.stringify('production')}, build:{write:false,lib:{entry,formats:['es'],fileName:()=> 'host.js'},rollupOptions:{output:{chunkFileNames:'usage/[name]-[hash].js'}}} })
  const chunks = new Map((Array.isArray(built)?built:[built]).flatMap(result=>result.output).map(item=>[item.fileName,item.type==='chunk'?item.code:item.source]))
  let theme='light'
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname
    if(path==='/retained-record'){res.setHeader('content-type','application/json');return res.end(new URL(req.url,'http://localhost').searchParams.has('stopped')?stoppedBytes:bytes)}
    if(path==='/styles.css'){res.setHeader('content-type','text/css');return res.end(await readFile(resolve(assets,'styles.css')))}
    const chunk=chunks.get(path.slice(1));if(chunk!==undefined){res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');return res.end(chunk)}
    res.setHeader('content-type','text/html');res.end(`<!doctype html><html class="${theme}" data-theme="${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="host"></div><script type="module" src="/host.js"></script></html>`)
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const browser=await chromium.launch({headless:true})
  try{
    for(theme of ['light','dark'])for(const width of [1512,390]){
      const context=await browser.newContext({viewport:{width,height:982},colorScheme:theme,...(evidence?{recordVideo:{dir:evidence,size:{width,height:982}}}:{})})
      const page=await context.newPage(), errors=[], began=Date.now(), captions={}
      page.on('pageerror',error=>{errors.push(error.message);console.error('usage host:',error.message)})
      await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`)
      await page.getByRole('button',{name:'Return to full usage',exact:true}).waitFor({timeout:10_000}).catch(async error=>{if(evidence)await page.screenshot({path:`${evidence}/host-failure-${theme}-${width}.png`,fullPage:true});throw new Error(JSON.stringify({errors}),{cause:error})})
      const reset=async()=>{await page.getByRole('button',{name:'Return to full usage',exact:true}).click();await page.getByRole('tab',{name:'Usage',exact:true}).waitFor()}
      const tree=page.locator('[data-graph]')
      await page.locator('.topology > summary').click()
      await tree.waitFor()
      assert.equal(await tree.locator('[data-node]').count(),2,'each canonical actor appears once')
      const cursor=page.locator('[data-cursor]');await cursor.focus();await page.keyboard.press('Home')
      await page.waitForFunction(()=>document.querySelector('[data-cursor]')?.value==='0')
      const child=tree.locator('[data-node="echo"]')
      assert.match(await child.getAttribute('aria-label'),/Not yet started/)
      assert.equal(await child.locator('[data-run-status]').getAttribute('data-run-status'),'unknown','a future actor stays unknown')
      await child.focus();await page.keyboard.press('Enter')
      assert.equal(await page.locator('[data-agent]').inputValue(),'echo','keyboard selection keeps canonical agent identity')
      await page.getByRole('button',{name:'Full run',exact:true}).click()
      await tree.locator('[data-node="root"]').click()
      assert.equal(await page.locator('[data-agent]').inputValue(),'root')
      assert.equal(await tree.locator('[data-node="root"] [data-run-status]').getAttribute('data-run-status'),'stopped','known no-winner is terminal, not unknown')
      if(evidence)await page.screenshot({path:evidence+'/tree-'+theme+'-'+width+'.png',fullPage:true})
      for(const metric of ['cumulative','response','tool-time'])for(const axis of ['time','order']){
        await reset()
        await page.getByRole('combobox',{name:'Measure',exact:true}).selectOption(metric)
        await page.getByRole('combobox',{name:'Horizontal axis',exact:true}).selectOption(axis)
        const caption=page.locator('[data-token-caption]');await caption.waitFor()
        captions[metric+'/'+axis]=await caption.innerText()
        assert.match(captions[metric+'/'+axis],metric==='tool-time'?/Observed tool return time, not model latency/:/tokens are not billed cost/)
        if(metric==='response')assert.equal(await page.getByText('metered windows · execution-to-date',{exact:true}).count(),0,'aggregate counters are not per-response measurements')
      }
      await reset();await page.getByRole('combobox',{name:'Measure',exact:true}).selectOption('cumulative')
      await page.getByTitle('Hide Input',{exact:true}).click()
      await page.getByTitle('Show Input',{exact:true}).click()
      assert.equal(await page.getByTitle('Hide Input',{exact:true}).getAttribute('aria-pressed'),'true')
      if(await page.locator('[data-tokens] .tgc-data').count()){
        const rows=await page.locator('[data-tokens] .tgc-data tbody tr').evaluateAll(nodes=>nodes.map(node=>[...node.children].map(cell=>cell.textContent.trim())))
        assert.ok(rows.some(row=>row[0]==='Cache read'&&/^0(?: tokens)?$/.test(row[2])),'a recorded zero remains a measured zero')
        if(record.events.some(event=>event.node==='root'&&event.detail?.usage&&Object.values(event.detail.usage).length<4))assert.ok(rows.some(row=>row[2]==='not measured'),'an absent counter remains unmeasured')
        for(const label of ['Input','Output','Cache read','Cache write'])await page.getByTitle(`Hide ${label}`,{exact:true}).click()
        await page.getByText('All token channels are hidden. Select a channel to show its recorded values.',{exact:true}).waitFor()
        for(const label of ['Input','Output','Cache read','Cache write'])await page.getByTitle(`Show ${label}`,{exact:true}).click()
      }
      const sourceActions=[]
      for(const action of ['click','Enter','Space']){
        await reset()
        const point=page.locator('[data-tokens] .tgc-series-observation:visible,[data-tokens] circle[data-id]:visible').first()
        await point.waitFor();assert.equal(await point.getAttribute('role'),'button','an activated point exposes its action to assistive technology')
        if(action==='click'){await point.scrollIntoViewIfNeeded();const box=await point.boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2)}else{await point.focus();await page.keyboard.press(action)}
        await page.waitForFunction(()=>window.chosen?.view==='source')
        const chosen=await page.evaluate(()=>window.chosen)
        assert.equal(chosen.eventId,firstUsage.id,'each activation opens the original retained event, including duplicate-time/zero-valued channels')
        assert.equal(await page.getByRole('tab',{name:'Event details',exact:true}).getAttribute('aria-selected'),'true')
        sourceActions.push({action,eventId:chosen.eventId})
      }
      await reset();await page.getByRole('combobox',{name:'Measure',exact:true}).selectOption('cumulative')
      await page.locator('[data-tokens]').scrollIntoViewIfNeeded()
      if(evidence)await page.screenshot({path:`${evidence}/usage-${theme}-${width}.png`,fullPage:true})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await page.goto('http://127.0.0.1:'+server.address().port+'/?theme='+theme+'&stopped')
      await page.getByRole('button',{name:'Full run',exact:true}).click()
      for(const node of stoppedActors){
        const button=page.locator('[data-graph] [data-node]').filter({has:page.locator('[data-run-status="stopped"]')}).filter({hasText:node.label})
        assert.equal(await button.count(),1,'each stopped publication actor is retained once')
        assert.match(await button.getAttribute('aria-label'),/Stopped/)
        assert.equal(await button.locator('[data-run-status]').getAttribute('data-run-status'),'stopped')
        await button.focus();await page.keyboard.press('Enter')
        assert.equal(await page.locator('[data-agent]').inputValue(),node.id,'stopped actor selection preserves original identity')
      }
      if(evidence)await page.screenshot({path:evidence+'/stopped-'+theme+'-'+width+'.png',fullPage:true})
      assert.deepEqual(errors,[])
      checks.push({theme,width,retainedEvents:record.events.length,recordSha256:digest,captions,sourceActions})
      await page.waitForTimeout(Math.max(0,10_100-(Date.now()-began)))
      await context.close()
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true})}
  assert.equal(createHash('sha256').update(await readFile(new URL('./fixtures/waterfall-discovery-record.json',import.meta.url))).digest('hex'),digest)
  if(evidence)await writeFile(`${evidence}/checks.json`,JSON.stringify(checks,null,2)+'\n')
})
