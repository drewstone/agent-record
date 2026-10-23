/** Static classification only: never execute agent-provided shell or JavaScript. */
export const activities = ['edit files', 'build', 'gate/test', 'git/PR write', 'prod/remote ops', 'workspace setup', 'messaging', 'waiting', 'read messages', 'query status', 'analysis script', 'read code/files', 'memory search', 'subagents', 'other tool', 'unknown']

// Keep quoted strings intact while splitting shell control operators. Heredocs are
// consumed with their command, so source code and quoted prose cannot become commands.
export function shellCommands(source, splitPipes = true) {
  const result = []
  let current = '', quote = '', escaped = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (escaped) { current += c; escaped = false; continue }
    if (c === '\\' && quote !== "'") { current += c; escaped = true; continue }
    if (quote) { current += c; if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; current += c; continue }
    if (c === '\n') {
      const doc = /<<-?\s*['"]?(\w+)['"]?/.exec(current)
      if (doc) {
        const end = new RegExp(`^\\t*${doc[1]}\\r?$`, 'm').exec(source.slice(i + 1))
        if (end) { const size = end.index + end[0].length; current += '\n' + source.slice(i + 1, i + 1 + size); i += size; result.push(current.trim()); current=''; continue }
      }
    }
    if (';|&\n'.includes(c) && (splitPipes || c!=='|') && !((c === '&' && /[<>]$/.test(current)) || (c === '|' && source[i + 1] === '>'))) {
      if (current.trim()) result.push(current.trim())
      current = ''; if (source[i + 1] === c) i++; continue
    }
    current += c
  }
  if (current.trim()) result.push(current.trim())
  return result
}
const unquote = s => {
  if (!s) return ''
  if (s[0] === '"') { try { return JSON.parse(s) } catch {} }
  return /^["'`]/.test(s) && s.at(-1) === s[0] ? s.slice(1, -1).replace(/\\([`"'\\])/g, '$1').replace(/\\n/g, '\n') : s
}
const words = source => {
  const out=[]
  let word='',quote='',escaped=false,started=false
  for(const c of source) {
    if(escaped) {word+=c;escaped=false;started=true;continue}
    if(c==='\\'&&quote!=="'") {escaped=true;started=true;continue}
    if(quote) {if(c===quote)quote='';else word+=c;started=true;continue}
    if(c==='"'||c==="'") {quote=c;started=true;continue}
    if(/\s/.test(c)) {if(started)out.push(word);word='';started=false;continue}
    word+=c;started=true
  }
  if(started)out.push(word)
  return out
}

const scriptWrite = /write_text|write_bytes|\.write\s*\(|open\([^)]*['"][wax]\+?['"]|json\.dump\s*\(|shutil\.(copy|move|rmtree)|os\.(remove|rename|replace|makedirs)|\.(unlink|mkdir|rename)\s*\(|writeFile(?:Sync)?\s*\(|appendFile(?:Sync)?\s*\(|fs\.(rm|mkdir|rename|copyFile)\s*\(/
const targetOf = raw => { const path=raw.replace(/^[^/:\s]+:(?=\/)/,''); return /^\/tmp\//.test(path) ? 'scratch' : /\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|sh|css|html|sql)$/.test(path) ? 'code' : /(^|\/)(status(?:\.md)?|state|evidence|reviews?|\.local|_handoff|\.agent)(\/|\.|$)/i.test(path) ? 'status/state/evidence' : /^\/tmp\//.test(path) ? 'scratch' : 'code' }
function writePaths(code) {
  const aliases={}
  for(const m of code.matchAll(/(\w+)\s*=\s*(?:pathlib\.)?Path\(\s*['"]([^'"\n]+)['"]\s*\)/g)) aliases[m[1]]=m[2]
  for(const m of code.matchAll(/(\w+)\s*=\s*(\w+)(\.parent)?\s*\/\s*['"]([^'"\n]+)['"]/g))if(aliases[m[2]])aliases[m[1]]=(m[3]?aliases[m[2]].split('/').slice(0,-1).join('/'):aliases[m[2]])+'/'+m[4]
  const out=[]
  for(const m of code.matchAll(/(\w+)\.(?:write_text|write_bytes|write)\s*\(/g)) if(aliases[m[1]])out.push(aliases[m[1]])
  for(const m of code.matchAll(/(?:writeFile(?:Sync)?|appendFile(?:Sync)?|\bopen)\s*\(\s*['"]([^'"\n]+)['"]/g))out.push(m[1])
  for(const m of code.matchAll(/(?:Path\(\s*['"]([^'"\n]+)['"]\s*\)|\(\s*(\w+)\s*\/\s*['"]([^'"\n]+)['"]\s*\))\.(?:write_text|write_bytes)\s*\(/g))out.push(m[1]??((aliases[m[2]]??'')+'/'+m[3]))
  return out.length ? out : Object.values(aliases)
}
function edit(method, paths = []) {
  const targets = [...new Set(paths.map(targetOf))]
  return { activity: 'edit files', editMethod: method, editTarget: targets.length > 1 ? 'mixed' : targets[0] ?? 'unknown' }
}
// Locate shell redirections outside quoted payloads; quoted `>` is data.
function redirectsOf(source) {
  const found = []
  let quote = '', escaped = false
  for (let i=0;i<source.length;i++) {
    const c=source[i]
    if (escaped) { escaped=false; continue }
    if (c==='\\' && quote!=="'") { escaped=true; continue }
    if (quote) { if (c===quote) quote=''; continue }
    if (c==='"' || c==="'" || c==='`') { quote=c; continue }
    if (c==='>' && !/[>&]/.test(source[i-1]??'') && source[i-1]!=='=') {
      const m=/^>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/.exec(source.slice(i))
      if (m) { const target=unquote(m[1]); if(target!=='/dev/null'&&!target.startsWith('&')) found.push({target,start:i,length:m[0].length}); i+=m[0].length-1 }
    }
  }
  return found
}
function commandClass(command, variables) {
  let source = command.trim()
  // Resolve literal assignments without executing substitutions or expanding secrets.
  const assignment = /^([A-Za-z_]\w*)=("(?:\\.|[^"\\])*"|'[^']*'|[^\s;]+)(?:\s+|$)/.exec(source)
  if (assignment) { variables[assignment[1]] = unquote(assignment[2]); source = source.slice(assignment[0].length); if (!source) return null; return commandClass(source, variables) }
  source = source.replace(/\$\{(\w+)\}|\$(\w+)/g, (all, a, b) => variables[a ?? b] ?? all)
  let w = words(source), prog = w.shift()?.split('/').pop(), args = w.join(' ')
  if (!prog) return null
  if (['then','do','else','{','(','exec','sudo','time'].includes(prog)) return commandClass(args, variables)
  if (prog === 'env') return commandClass(w.filter(x => !x.startsWith('-')).join(' '), variables)
  if (prog === 'timeout') { while (w[0]?.startsWith('-')) w.shift(); w.shift(); return commandClass(w.join(' '), variables) }
  if (prog === 'nice' || prog === 'ionice') { while (w[0]?.startsWith('-')) { const flag = w.shift(); if (['-n','-c'].includes(flag)) w.shift() } return commandClass(w.join(' '), variables) }
  if (prog === 'ssh') {
    const localDoc=/^ssh(?:\s+-[A-Za-z]\s+\S+)*\s+\S+\s+(['"])([^\n]*?)\1(\s+<<[\s\S]+)$/.exec(source)
    if(localDoc)return classifyShell(localDoc[2]+localDoc[3],variables)
    const remote=/^ssh(?:\s+-[A-Za-z]\s+\S+)*\s+\S+\s+([\s\S]+)$/.exec(source)?.[1]
    const quotedRemote=remote && /^(['"])([\s\S]*)\1(\s+>{1,2}[^\n]*)$/.exec(remote)
    if(quotedRemote) {const primary=classifyShell(quotedRemote[2].replace(/'"'"'/g,"'"),variables);const target=redirectsOf(quotedRemote[3]);return {...primary,substantive:primary.substantive||primary.activity==='analysis script',editMethod:'shell redirect',editTarget:target.length?edit('shell redirect',target.map(x=>x.target)).editTarget:'unknown',ancillaryEdit:true}}
    if(remote && /^["']/.test(remote) && remote.at(-1)===remote[0]) return classifyShell(remote.slice(1,-1).replace(/'"'"'/g,"'"),variables)
 while (w[0]?.startsWith('-')) { const flag = w.shift(); if (/^-[piloFJWSb]$/.test(flag)) w.shift() } w.shift(); return classifyShell(w.join(' '), variables) }
  if (/^wsl(?:\.exe)?$/.test(prog)) { const i = w.findIndex(x => ['--','-e','--exec'].includes(x)); return i >= 0 ? classifyShell(w.slice(i + 1).join(' '), variables) : {activity:'prod/remote ops'} }
  if (['bash','sh','zsh'].includes(prog)) {
    const doc = /<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\t*\1(?:\n|$)/.exec(source)
    if (doc) return classifyShell(doc[2], variables)
    const i = w.findIndex(x => /^-[a-z]*c$/.test(x)); return i >= 0 ? classifyShell(w.slice(i + 1).join(' '), variables) : {activity:'other tool'}
  }
  if (['cd','set','export','true','false','done','fi','do','then'].includes(prog)) return null
  if (prog==='fleet' && /--help/.test(args)) return {activity:'query status'}
  if (words(source.split('\n')[0]).slice(1).some(x=>['--help','-h','--version'].includes(x))) return {activity:'read code/files'}
  const redirects = redirectsOf(source.split('\n')[0])
  if (redirects.length) {
    let bare=source
    for(const r of [...redirects].reverse()) bare=bare.slice(0,r.start)+bare.slice(r.start+r.length)
    const metadata=edit('shell redirect',redirects.map(r=>r.target))
    if(['cat','echo','printf','tee'].includes(prog)) {
      if(metadata.editTarget==='scratch') {
        const doc=/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\t*\1(?:\n|$)/.exec(source)
        if(doc && /\.py$/.test(redirects[0].target)) {variables.__scripts??={};variables.__scripts[redirects[0].target]=classifyShell("python3 - <<'AGENT_BODY'\n"+doc[2]+"\nAGENT_BODY",variables)}
        return {...metadata,activity:'analysis script',ancillaryEdit:true}
      }
      return metadata
    }
    const primary=commandClass(bare,variables) ?? {activity:'other tool'}
    return {...metadata,...primary,editMethod:metadata.editMethod,editTarget:metadata.editTarget,activities:[primary.activity,'edit files'],ancillaryEdit:primary.activity!=='edit files'}
  }
  if (['python','python3','node','deno','bun','ruby','perl'].includes(prog)) {
    const docBody = /<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\t*\1(?:\n|$)/.exec(source)?.[2]
    const inline = w.findIndex(x=>['-c','-e','--eval'].includes(x))
    if(variables.__scripts?.[w[0]])return variables.__scripts[w[0]]
    if(w[0]?.replace(/^[^/:\s]+:(?=\/)/,'').startsWith('/tmp/'))return {activity:'analysis script',substantive:true}
    const code = docBody ?? (inline>=0 ? w[inline+1] ?? '' : '')
    const executableCode = code.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, 'STRING')
    if (scriptWrite.test(executableCode) || (prog === 'perl' && /^-\w*i/.test(args))) {
      const paths = writePaths(code)
      if (paths.length && paths.every(p=>p.startsWith('/tmp/'))) return {activity:'analysis script'}
      const metadata=edit(`${prog} write`, paths)
      return paths.length && paths.every(p=>['status/state/evidence','scratch'].includes(targetOf(p)) && !/(?:^|\/)(?:STATUS|README|AGENTS|CLAUDE)\.md$/i.test(p)) && !(/(\w+)\.read_text\s*\([\s\S]*?\1\.write_text/.test(code) && /\w+\[[^\n]+\]\s*=/.test(code)) ? {...metadata,activity:/\b(request|fetch)\s*\(/.test(executableCode)?'query status':'analysis script',activities:['analysis script','edit files'],ancillaryEdit:true,substantive:true} : metadata
    }
    if (/--test\b|pytest|vitest|playwright/.test(args)) return {activity:'gate/test'}
    if (/\.log['"]/.test(code) && /read_text|readFile/.test(executableCode)) return {activity:'query status'}
    const computed=/(?:hashlib|tarfile|struct|zlib|concurrent|numpy|statistics)\.|Image\.|\.save\s*\(/.test(executableCode)
    return {activity: /(?:^|\s)[^\s]+\.(?:mjs|cjs|js|py|ts)(?:\s|$)/.test(args) && !source.includes('\n') ? 'other tool' : 'analysis script',substantive:computed}
  }
  if (prog === 'sed') return /(?:^|\s)(?:-[a-z]*i|--in-place)/.test(args) ? edit('sed in-place',w.slice(-1)) : {activity:'read code/files'}
  if (prog==='mkdir' && /\/(?:reviews|\.local\/state)\//.test(source)) return {activity:'query status',editMethod:'mkdir',editTarget:'status/state/evidence',ancillaryEdit:true}
  if(['cp','scp','rsync'].includes(prog)){const metadata=edit(prog,w.filter(x=>!x.startsWith('-')).slice(-1));if(['status/state/evidence','scratch'].includes(metadata.editTarget))return {...metadata,activity:'analysis script',ancillaryEdit:true,substantive:true}}
  if (['apply_patch','tee','cp','mv','rm','mkdir','touch','chmod','ln','truncate','install','rsync','scp'].includes(prog)) return edit(prog,w.filter(x=>!x.startsWith('-')).slice(-1))
  if (['sleep','wait','watch'].includes(prog)) return {activity:'waiting'}
  if (['storage-lifecycle','wt-new','wt-remove','adc-wt'].includes(prog)) return {activity:'workspace setup'}
  if (prog === 'beelink-gate') return {activity:/--report|--status|--list|--cancel/.test(args)?'query status':/--ship(?:\s|$)/.test(args)?'prod/remote ops':'gate/test'}
  if (['vitest','jest','pytest','tsc','eslint','biome','actionlint','shellcheck','ruff','mypy','prettier','playwright'].includes(prog)) return {activity:'gate/test'}
  if (['pnpm','npm','yarn','npx','turbo','cargo','go','make','docker','tsup','vite','esbuild'].includes(prog)) {
    if (/\b(test|typecheck|lint|check|gate|signoff|vitest|e2e|pytest|tsc|playwright)\b/.test(args)) return {activity:'gate/test'}
    if (prog === 'docker' && /^(ps|logs|inspect|images|stats|version|info|system df)\b/.test(args)) return {activity:'query status'}
    if (/\b(build|install|i|ci|pack|publish|add|update|up)\b/.test(args) || ['cargo','go','make','tsup','vite','esbuild'].includes(prog)) return {activity:'build'}
    return {activity:prog === 'docker'?'prod/remote ops':'other tool'}
  }
  if (prog === 'git') {
    args = args.replace(/^(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+)*/, '')
    if (/^worktree (add|remove|prune)/.test(args)) return {activity:'workspace setup'}
    if (/^(commit|push|merge\b|rebase|cherry-pick|reset|tag|am|apply|stash|switch|checkout|branch -[dDmM])\b/.test(args)) return {activity:'git/PR write'}
    return {activity:/^(show|grep|diff|ls-tree|ls-files|blame|cat-file|log)\b/.test(args)?'read code/files':'query status'}
  }
  if (['gh','gh-drew','gh-read'].includes(prog)) {
    if (/^api graphql\b/.test(args)) return {activity:/\bmutation\s*(?:[({]|[A-Za-z_])/.test(args)?'git/PR write':'query status'}
    return {activity:/^(pr (create|merge|edit|ready|comment|close|review|reopen)|issue (create|edit|comment|close)|release (create|edit|upload)|workflow run|run (rerun|cancel))\b|(?:-X|--method)\s*(POST|PATCH|PUT|DELETE)|(?:-f|--field)\s/.test(args)?'git/PR write':/^run watch/.test(args)?'waiting':'query status'}
  }
  if (prog === 'fleet' && /^wait(?:\s|$)/.test(args)) return {activity:'waiting'}
  if (prog === 'fleet' && /^status\s+set(?:\s|$)/.test(args)) return {activity:'edit files',editMethod:'fleet status set',editTarget:'status/state/evidence'}
  if (prog === 'fleet') return {activity:/^(send|reply|done|ack)\b/.test(args)?'messaging':/^(inbox|messages)\b/.test(args)?'read messages':/^(start|stop|failover)\b/.test(args)?'prod/remote ops':'query status'}
  if (prog==='mkdir' && /\/(?:reviews|\.local\/state)\//.test(source)) return {activity:'query status',editMethod:'mkdir',editTarget:'status/state/evidence',ancillaryEdit:true}
  if (prog==='agent-ask' && /(?:^|\s)file(?:\s|$)/.test(args)) return {activity:'read code/files'}
  if (prog==='agent-ask') return {activity:/\b(status|inspect|health|list)\b/.test(args)?'query status':'prod/remote ops',substantive:true}
  if ((['tail','head','rg','grep','find','ls'].includes(prog) || (prog==='cat' && /(?:\.log(?:[\s'"]|$)|(?:status|result|scorecard)\.json(?:[\s'"]|$))/.test(source))) && /(?:\.log(?:[\s'"]|$)|\/(?:cache|renders)(?:\/|\s|$)|\.local\/state\/)/.test(source)) return {activity:'query status'}
  if (['tail','head','sort','uniq','wc','cut','tr'].includes(prog) && !w.some(x=>!x.startsWith('-')&&!/^\d+$/.test(x))) return null
  if (/\/fleet\/inbox\//.test(source)) return {activity:'read messages'}
  if (prog === 'qmd' || /hindsight/.test(prog)) return {activity:'memory search'}
  if (['wrangler','hcloud','kubectl','disco','tangle-tools-deploy','bp-ops','kill','pkill','acct','systemctl','dotenvx'].includes(prog)) return {activity:/\b(status|ls|show|observe|report|logs|list|cat|is-active)\b/.test(args)?'query status':'prod/remote ops'}
  if (['curl','wget','journalctl','ps','pgrep','uptime','free','df','du','nvidia-smi','ops-board','have','date','hostname','id','whoami','lsof','ss','netstat','top','vmstat','iostat','census','skill-run-log','climb-log'].includes(prog)) return {activity:'query status'}
  if (['rg','grep','cat','head','tail','ls','find','fd','jq','wc','nl','stat','tree','diff','cmp','sha256sum','file','readlink','realpath','less','awk','sort','uniq','cut','tr','column','basename','dirname','xxd','od','test','[','echo','printf','true','false','command','type','which','cd','set','export','pwd','for','done','fi','if','esac','case','local','read'].includes(prog)) return {activity:'read code/files'}
  return {activity: /\$/.test(prog)?'unknown':'other tool'}
}
const combine = list => {
  const valid = list.filter(Boolean)
  if (!valid.length) return {activity:'unknown',activities:['unknown']}
  const hard=['edit files','build','gate/test','git/PR write','prod/remote ops','workspace setup','messaging','waiting','subagents']
  const substantive=valid.filter(x=>(hard.includes(x.activity)||x.substantive)&&!(x.activity==='edit files'&&x.ancillaryEdit))
  const counts=new Map()
  for(const x of valid)for(const [key,n]of Object.entries(x.activityCounts??{[x.activity]:1}))counts.set(key,(counts.get(key)??0)+n)
  const winner=substantive.length ? [...substantive].sort((a,b)=>(hard.includes(a.activity)?hard.indexOf(a.activity):hard.length)-(hard.includes(b.activity)?hard.indexOf(b.activity):hard.length))[0]
    : [...valid].sort((a,b)=>(counts.get(b.activity)-counts.get(a.activity)) || (['read code/files','analysis script','query status','read messages'].indexOf(a.activity)-['read code/files','analysis script','query status','read messages'].indexOf(b.activity)))[0]

  return {...winner, activityCounts:Object.fromEntries(counts), activities:[...new Set(valid.flatMap(x=>x.activities??[x.activity]))]}
}
export function classifyShell(source, variables = {}) {
  if(/^\s*(?:ssh|timeout|wsl(?:\.exe)?)\s/.test(source)) return commandClass(source,variables) ?? {activity:'unknown',activities:['unknown']}
  return combine(shellCommands(source,false).map(x=>commandClass(shellCommands(x)[0]??x,variables)))
}

/** Extract literal JS command arguments plus simple const/let string variables. */
export function jsCommands(source) {
  const literal = '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)'
  const vars = {}
  for (const m of source.matchAll(new RegExp('(?:const|let|var)\\s+(\\w+)\\s*=\\s*'+literal,'g'))) vars[m[1]] = unquote(m[2])
  const out = []
  for (const m of source.matchAll(new RegExp('(?:"cmd"|cmd|"command"|command)\\s*:\\s*('+literal+'|[A-Za-z_]\\w*)','g'))) {
    const value = m[1]
    out.push(/^["'`]/.test(value) ? unquote(value).replace(/\$\{(\w+)\}/g,(all,n)=>vars[n]??all) : vars[value] ?? '$'+value)
  }
  for (const m of source.matchAll(/[{,]\s*(cmd|command)\s*[,}]/g)) if(vars[m[1]]) out.push(vars[m[1]])
  return out
}
export function classifyActivity(name, input = '', context = {}) {
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  const short = name.split(/[.:]/).at(-1)
  if (/apply_patch/.test(short)) {
    const paths = [...text.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)].map(m=>m[1])
    return {...edit('apply_patch',paths),activities:['edit files'],label:'apply_patch'}
  }
  if (['Read','Grep','Glob','WebFetch','WebSearch'].includes(short) || /web__run/.test(short)) return {activity:'read code/files',activities:['read code/files'],label:short}
  if (/clock.*curr_time/.test(short)) return {activity:'query status',activities:['query status'],label:short}
  if (['Edit','Write','MultiEdit'].includes(short)) { let p;try {p=JSON.parse(text)}catch{};return {...edit(short,[p?.file_path??'unknown']),activities:['edit files'],label:short} }
  if (['Agent','Task','SendMessage','spawn_agent','send_message','send_input','close_agent','resume_agent','interrupt_agent','followup_task'].includes(short)) return {activity:'subagents',activities:['subagents'],label:short}
  if (['wait','wait_agent','sleep'].includes(short)) return {activity:'waiting',activities:['waiting'],label:short}
  if (/hindsight|memory|qmd/.test(name)) return {activity:'memory search',activities:['memory search'],label:short}
  if (['view_image','read_file','list_dir'].includes(short)) return {activity:'read code/files',activities:['read code/files'],label:short}
  let obj
  try { obj = JSON.parse(text) } catch {}
  const commands = typeof obj?.cmd === 'string' ? [obj.cmd] : typeof obj?.command === 'string' ? [obj.command] : jsCommands(text)
  const outerCode=text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, 'STRING')
  const nested = [...outerCode.matchAll(/tools\.([\w]+)\s*\(/g)].map(m=>m[1]).filter(n=>n!=='exec_command')
  if (nested.length || commands.length) return {...combine([...commands.map(x=>classifyShell(x,context.variables??={})),...nested.map(n=>n==='write_stdin'?(commands.length&&!/yield_time_ms\s*:\s*(?:[1-9]\d{4,})/.test(text)?null:{activity:'waiting',activities:['waiting']}):classifyActivity(n,n==='apply_patch'?text:'',context))]),label:short || nested.join(', ')}
  return {activity: /exec_command/.test(text)?'unknown':short==='exec'?'analysis script':'other tool',activities:[/exec_command/.test(text)?'unknown':short==='exec'?'analysis script':'other tool'],label:short}
}
