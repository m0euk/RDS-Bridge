/* 0.10.5-cand.8 — prove the environment journal records the external conditions that have actually
   cost us rounds in this investigation, and reports each one distinguishably.
   Extracts the real ENV/envStart/envTxt/shTick sleep detector and drives them with stubbed events. */
const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync(process.argv[2]||'work.html','utf8');
function grab(re){ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; }
const code=[ grab(/var ENV=\{[\s\S]*?started:Date\.now\(\) \};/),
             grab(/function envNow\(\)\{[\s\S]*?\}\n/),
             grab(/function envMs\([^\n]*\}/),
             grab(/function envHiddenDuring\(mark\)\{[^\n]*\}/),
             grab(/function envTxt\(\)\{[\s\S]*?\n\}/),
             grab(/function monLongTasks\(\)\{[\s\S]*?\n\}catch\(_\)\{\} \}/),
             grab(/function monBattery\(\)\{[\s\S]*?\n\}catch\(_\)\{\} \}/),
             grab(/function envStart\(\)\{[\s\S]*?\n\}/) ].join('\n');

let T=0, WALL=0, LOG=[];
const handlers={};
function on(o){ return (ev,fn)=>{ (handlers[ev]=handlers[ev]||[]).push(fn); }; }
const ctx={ performance:{now:()=>T}, Date:{now:()=>WALL}, log:(k,m)=>LOG.push(k+'|'+m),
            audioOn:false, actx:{state:'running'},
            navigator:{}, PerformanceObserver:undefined,
            document:{ visibilityState:'visible', hasFocus:()=>true, addEventListener:on() },
            window:{ addEventListener:on() } };
vm.createContext(ctx); vm.runInContext(code,ctx); ctx.envStart();
function fire(ev){ (handlers[ev]||[]).forEach(f=>f()); }
function check(n,c){ console.log((c?'PASS  ':'FAIL  ')+n); if(!c) process.exitCode=1; }

console.log('registered listeners: '+Object.keys(handlers).sort().join(', ')+'\n');
check('listens for visibility, focus, blur',   ['visibilitychange','focus','blur'].every(e=>handlers[e]));
check('listens for freeze/resume (tab frozen)',!!handlers.freeze && !!handlers.resume);
check('listens for offline/online',            !!handlers.offline && !!handlers.online);

/* the 03-Aug case: tab backgrounded for 4 minutes, then brought back */
LOG=[]; ctx.document.visibilityState='hidden'; fire('visibilitychange');
check('backgrounding is logged AND explains the consequence',
      /went to the background/.test(LOG[0]) && /audio on exempts it/.test(LOG[0]));
T+=240000; ctx.document.visibilityState='visible'; fire('visibilitychange');
check('hidden time is accumulated',            Math.round(ctx.ENV.hiddenMs/1000)===240 && ctx.ENV.hides===1);
/* cand.13: ENV.hides only counts hides, so it cannot distinguish "still visible throughout" from
   "was hidden and came back" — which is precisely the interval the display-stall and clock-gap
   monitors have to judge. visN counts every transition, both directions. */
check('visibility transitions counted BOTH ways', ctx.ENV.visN===2);

/* window lost focus but tab still visible \u2014 a different state, and it must read differently */
LOG=[]; ctx.document.hasFocus=()=>false; fire('blur'); T+=60000; fire('focus');
check('focus loss tracked separately from visibility',
      ctx.ENV.blurs===1 && Math.round(ctx.ENV.blurredMs/1000)===60 && ctx.ENV.hides===1);

/* the 02-Aug case: 8.9 hours of "stalls" that were a sleeping Mac */
const tick=new Function('ENV','log','Date','envNow','document','envHiddenDuring', grab(/var _wall=Date\.now\(\)[\s\S]*?\n  \}/)+'\n');   /* cand.13: the cause is judged over the whole interval (ENV.visN), not by sampling
      visibilityState at the end of it — see mon_discriminate.js */
LOG=[]; WALL=1000; ctx.ENV.lastWall=0; ctx.ENV.gapVis=ctx.ENV.visN;   /* as a preceding tick would leave it */
tick(ctx.ENV,(k,m)=>LOG.push(m),{now:()=>WALL},ctx.envNow,ctx.document,ctx.envHiddenDuring);
check('a normal 1 s tick is not a clock gap',  ctx.ENV.sleeps===0 && LOG.length===0);
WALL=1000+8.9*3600*1000;
tick(ctx.ENV,(k,m)=>LOG.push(m),{now:()=>WALL},ctx.envNow,ctx.document,ctx.envHiddenDuring);
check('an 8.9 h gap is caught and named',      ctx.ENV.sleeps===1 && /clock jumped 32040 s/.test(LOG[0]));
check('a VISIBLE tab losing it is named as sleep', /machine was most likely asleep/.test(LOG[0]));
check('it says the stall figures are not a fault', /not a fault/.test(LOG[0]));

/* audio state is in the stamp, because it decides whether throttling applies at all */
ctx.audioOn=true;
check('state stamp includes audio',            /audio on/.test(ctx.envNow()));
ctx.audioOn=false;
check('state stamp distinguishes audio off',   /audio off/.test(ctx.envNow()));

console.log('\nfooter reads:\n  '+ctx.envTxt()+'\n');
check('footer carries every counter',
      /hidden 1/.test(ctx.envTxt()) && /unfocused 1/.test(ctx.envTxt()) &&
      /clock gaps 1/.test(ctx.envTxt()) && /page freezes 0/.test(ctx.envTxt()));
