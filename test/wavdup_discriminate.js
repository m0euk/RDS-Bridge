/* wavdup_discriminate.js — does wavdup.js report a duplicate rate it was GIVEN?
   An instrument that has not been shown to discriminate is not evidence. Builds WAVs with a known
   percentage of re-delivered frames, at VARIABLE frame lengths (4800 and 4802 samples, as measured
   on the wire), and checks the reported figure against the injected one. */
const fs=require("fs"), cp=require("child_process");
const SR=48000;
function wav(samples){
  const d=Buffer.alloc(samples.length*2); samples.forEach((v,i)=>d.writeInt16LE(v,i*2));
  const h=Buffer.alloc(44); h.write("RIFF",0); h.writeUInt32LE(36+d.length,4); h.write("WAVE",8);
  h.write("fmt ",12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(1,22);
  h.writeUInt32LE(SR,24); h.writeUInt32LE(SR*2,28); h.writeUInt16LE(2,32); h.writeUInt16LE(16,34);
  h.write("data",36); h.writeUInt32LE(d.length,40); return Buffer.concat([h,d]);
}
/* Compare against what was ACTUALLY injected, not against the probability: at ~200 frames a 5%
   rate lands anywhere from 2 to 18 duplicates by seed, and checking against 5% would fail a
   correct instrument (or pass a wrong one) for reasons of arithmetic rather than detection. */
function make(sec,dupPct,seed){
  let x=seed>>>0; const rnd=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};
  const out=[]; let t=0, n=0; let injected=0;
  while(out.length < sec*SR){
    const L = (n++%3===0)?4802:4800;                       // variable frame length, as on the wire
    const f=[]; for(let i=0;i<L;i++){ t++; f.push(Math.round(12000*Math.sin(t/40)+3000*(rnd()-0.5))); }
    out.push(...f);
    if(rnd()*100 < dupPct){ out.push(...f); injected+=L; }  // a re-delivered frame
  }
  const cut=out.slice(0, sec*SR);
  cut.injected = Math.min(injected, cut.length);
  return cut;
}
let bad=0;
for(const [pct,seed] of [[0,1],[5,2],[12,3],[25,4]]){
  const samples=make(20,pct,seed);
  const p="/tmp/dup_"+pct+".wav"; fs.writeFileSync(p, wav(samples));
  const out=cp.execSync("node wavdup.js "+p).toString();
  const got=parseFloat((out.match(/duplicated : ([\d.]+)%/)||[])[1]);
  const actual=100*samples.injected/samples.length;
  const okish = Math.abs(got-actual) < 1.0;
  if(!okish) bad++;
  console.log(`rate ${String(pct).padStart(2)}%  ->  actually injected ${actual.toFixed(2)}%  reported ${got.toFixed(2)}%  ${okish?"ok":"MISMATCH"}`);
}
/* the control that matters most: a clean file must read exactly zero */
const clean=cp.execSync("node wavdup.js /tmp/dup_0.wav").toString();
console.log(/no repeated audio found/.test(clean) ? "\nclean file verdict: correct (0.00%)" : "\nclean file verdict: WRONG — false positive on clean audio");
if(!/no repeated audio found/.test(clean)) bad++;
console.log(bad? "\n"+bad+" FAILED" : "\nthe instrument discriminates");
