/* 0.10.5-cand.12 — prove scanBaseGeomTxt's "nearest channel" uses the grid the SCAN uses, on
   BOTH rasters. geom_discriminate.js stubs scanRaster at 100 kHz, where every tenth of an MHz is
   on grid either way, so it cannot see this: on the 200 kHz NA raster the channel grid is
   SCAN.fmLo + k*200k (odd tenths, 87.9/88.1/…) while Math.round(hz/200k)*200k is EVEN tenths.
   Rick's 03-Aug log flagged MAP IS WRONG on 36 of 36 baselines with peaks sitting exactly on
   88.9 / 97.9 / 105.5. Same lesson as scanInDxLog: a stub tests the guard, not the predicate. */
const fs=require('fs'), vm=require('vm'), path=process.argv[2]||'work.html';
const src=fs.readFileSync(path,'utf8');
function grab(re){ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; }
const code=[ grab(/function shAge\(p\)\{[^\n]*\}/),
             grab(/function shAgeTxt\(p\)\{[^\n]*\}/),
             grab(/var SH=\{[\s\S]*?recentre:0 \};/),
             grab(/var SCAN=\{[\s\S]*?rasterHz:100000 \};/),
             grab(/function scanBaseGeomTxt\(\)\{[\s\S]*?\n\}/) ].join('\n');

let RST=100000;
const ctx={performance:{now:()=>1000}, scanRaster:()=>RST};
vm.createContext(ctx); vm.runInContext(code,ctx); ctx.SH.lastProp['device_center_frequency']=0;

/* flat floor with one strong carrier exactly on a real channel */
function ask(centre, span, bins, carrierHz, centreUsed, spanUsed){
  const a=new Float32Array(bins); a.fill(40);
  const b=Math.round((carrierHz-(centre-span/2))/(span/bins));
  a[b]=140;
  ctx.curCenter=(centreUsed===undefined?centre:centreUsed);
  ctx.rateHz=(spanUsed===undefined?span:spanUsed);
  ctx.scanAvg=a; ctx.scanFloor=40;
  return ctx.scanBaseGeomTxt();
}
function off(t){ return parseInt(t.match(/(\d+) kHz off the nearest/)[1],10); }
function wrong(t){ return /MAP IS WRONG/.test(t); }
function check(n,c){ console.log((c?'PASS  ':'FAIL  ')+n); if(!c) process.exitCode=1; }

/* ── RoW / 100 kHz: unchanged behaviour, both grids agree ─────────────────────────────── */
RST=100000;
const uk = ask(97.75e6, 9e6, 512, 100.3e6);
console.log('RoW 100k, carrier on 100.300 :', uk);
check('100 kHz raster: a carrier on a channel reads ~0 kHz off', off(uk)<=10 && !wrong(uk));
const ukBad = ask(97.75e6, 9e6, 512, 100.3e6, 97.79e6);   /* curCenter reads 40 kHz stale — off-grid, > 1.5 bins */
check('100 kHz raster: a stale centre is still caught', off(ukBad)>0 && wrong(ukBad));

/* ── NA / 200 kHz: the real channels are SCAN.fmLo + k*200k, i.e. ODD tenths ──────────── */
RST=200000;
for(const [f,label] of [[88.9e6,'88.900'],[97.9e6,'97.900'],[105.5e6,'105.500'],[104.7e6,'104.700']]){
  const t = ask(f<93e6?90.917e6:(f<101e6?97.75e6:104.583e6), 10e6, 512, f);
  console.log('NA 200k, carrier on '+label+' :', t);
  check('200 kHz raster: '+label+' is ON the channel grid, must not flag',
        off(t)<=20 && !wrong(t));
}
/* and it must still catch a genuinely wrong map on that raster */
const naBad = ask(97.75e6, 10e6, 512, 97.9e6, 97.81e6);   /* curCenter reads 60 kHz stale */
console.log('NA 200k, stale centre        :', naBad);
check('200 kHz raster: a stale centre is still caught', off(naBad)>0 && wrong(naBad));

/* every real channel in the NA band, not just four samples */
RST=200000;
let bad=0, n=0;
for(let f=87.9e6; f<=107.9e6; f+=200000){
  const c = f<93e6?90.917e6 : (f<101e6?97.75e6:104.583e6);
  if(Math.abs(f-c)>4.5e6) continue;
  n++; const t=ask(c,10e6,512,f); if(wrong(t)) bad++;
}
check('200 kHz raster: 0 of '+n+' real NA channels flag (got '+bad+')', bad===0);
