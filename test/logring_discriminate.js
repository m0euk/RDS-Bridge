/* 0.10.5-cand.4 — prove the log ring keeps the full transcript while capping the DOM, and that
   the export still reads everything. Extracts the real log()/logFlush() and runs them against a
   jsdom document. The point of the change is that DOM node count stops growing while export
   depth does not shrink, so both halves have to be measured. */
const fs=require('fs'), vm=require('vm'), {JSDOM}=require('jsdom');
const path=process.argv[2]||'work.html', src=fs.readFileSync(path,'utf8');
function grab(re){ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; }
const code=[ grab(/var LOG_DOM_MAX=\d+, LOG_KEEP=\d+;/),
             grab(/var logAll=\[\][^\n]*;/),
             grab(/function logFlush\(\)\{[\s\S]*?\n\}/),
             grab(/function log\(kind,msg\)\{[\s\S]*?\n\}/) ].join('\n');

const dom=new JSDOM('<div id="log"></div>');
const ctx={ document:dom.window.document, performance:{now:()=>Date.now()},
            els:{log:dom.window.document.getElementById('log')},
            setTimeout:()=>1 };   /* flush is driven manually so the test is deterministic */
vm.createContext(ctx); vm.runInContext(code,ctx);

function emit(n){ for(let i=0;i<n;i++){ ctx.log('ev','line '+i); ctx.logFlushT=0; ctx.logFlush(); } }
function check(n,c){ console.log((c?'PASS  ':'FAIL  ')+n); if(!c) process.exitCode=1; }

emit(5000);
const nodes=ctx.els.log.children.length;
console.log('after 5000 lines:  DOM nodes '+nodes+'   transcript '+ctx.logAll.length+'\n');
check('DOM is capped at LOG_DOM_MAX',        nodes===ctx.LOG_DOM_MAX);
check('DOM did NOT grow with the session',   nodes<5000);
check('transcript kept every line',          ctx.logAll.length===5000);
check('transcript keeps the OLDEST lines too (export depth unchanged)', /line 0$/.test(ctx.logAll[0]));
check('transcript keeps the newest',         /line 4999$/.test(ctx.logAll[4999]));
check('DOM holds the NEWEST lines, not the oldest',
      ctx.els.log.lastChild.textContent.indexOf('line 4999')>=0 &&
      ctx.els.log.firstChild.textContent.indexOf('line 3500')>=0);
check('transcript lines carry a timestamp',  /^\d\d:\d\d:\d\d  line 0$/.test(ctx.logAll[0]));

/* the transcript ring itself */
ctx.logAll.length=0; ctx.els.log.innerHTML='';
ctx.LOG_KEEP=100; emit(150);
check('transcript ring honours LOG_KEEP',    ctx.logAll.length===100 && /line 50$/.test(ctx.logAll[0]));
console.log('');
