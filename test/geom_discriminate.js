/* 0.10.5-cand.2 — prove the spectrum-geometry report can actually catch a wrong hz->bin map.
   Synthesises a spectrum with one strong carrier at a known frequency and asks the real
   scanBaseGeomTxt() where it thinks the peak is, under a correct map and under two wrong ones. */
const fs=require('fs'), vm=require('vm'), path=process.argv[2]||'work.html';
const src=fs.readFileSync(path,'utf8');
function grab(re){ const m=src.match(re); if(!m) throw new Error('not found'); return m[0]; }
const code=[ grab(/var SCAN=\{[\s\S]*?rasterHz:100000 \};/),   /* cand.12: scanBaseGeomTxt now reads SCAN.fmLo — the channel grid's origin */
             grab(/function shAge\(p\)\{[^\n]*\}/),
             grab(/function shAgeTxt\(p\)\{[^\n]*\}/),
             grab(/var SH=\{[\s\S]*?recentre:0 \};/),
             grab(/function scanBaseGeomTxt\(\)\{[\s\S]*?\n\}/) ].join('\n');
const ctx={performance:{now:()=>1000}, scanRaster:()=>100000}; vm.createContext(ctx); vm.runInContext(code,ctx);
ctx.SH.lastProp['device_center_frequency']=0;

/* one strong carrier at 97.9 MHz, flat floor elsewhere */
function spectrum(centre, span, bins, carrierHz){
  const a=new Float32Array(bins); a.fill(40);
  const b=Math.round((carrierHz-(centre-span/2))/(span/bins));
  if(b>=0&&b<bins) a[b]=120;
  return a;
}
function ask(centreUsed, rateUsed, arr){ ctx.curCenter=centreUsed; ctx.rateHz=rateUsed;
  ctx.scanAvg=arr; ctx.scanFloor=40; return ctx.scanBaseGeomTxt(); }

const TRUE_CENTRE=97.75e6, TRUE_SPAN=10e6, BINS=1024, CARRIER=97.9e6;
const arr=spectrum(TRUE_CENTRE,TRUE_SPAN,BINS,CARRIER);

const good = ask(TRUE_CENTRE, TRUE_SPAN, arr);
const staleCentre = ask(90.917e6, TRUE_SPAN, arr);              // curCenter one window behind
const wrongSpan  = ask(TRUE_CENTRE, 5e6,  arr);                 // bins cover the VISIBLE range, not rateHz
console.log('correct map     :', good);
console.log('stale curCenter :', staleCentre);
console.log('span mismatch   :', wrongSpan);

function peak(t){ return parseFloat(t.match(/at ([\d.]+) MHz/)[1]); }
function off(t){ return parseInt(t.match(/(\d+) kHz off the nearest/)[1],10); }
function check(n,c){ console.log((c?'PASS  ':'FAIL  ')+n); if(!c) process.exitCode=1; }
console.log('');
check('correct map: peak on 97.90, within one bin, unflagged', Math.abs(peak(good)-97.90)<0.02 && off(good)<=10 && !/MAP IS WRONG/.test(good));   /* residual is bin quantisation — which is why the flag threshold is relative to bin width, not an absolute kHz */
check('stale curCenter flagged by the raster offset',      off(staleCentre)>0 && /MAP IS WRONG/.test(staleCentre));
check('span mismatch flagged by the raster offset',        off(wrongSpan)>0 && /MAP IS WRONG/.test(wrongSpan));
check('the three cases are distinguishable',               new Set([good,staleCentre,wrongSpan]).size===3);
check('report states bins, span and kHz/bin',              /\d+ bins over [\d.]+ MHz \(\d+ kHz\/bin\)/.test(good));
check('report states the curCenter age',                   /old/.test(good));
console.log('');
