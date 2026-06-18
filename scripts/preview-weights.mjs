import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://dshrvzwpdixzhvoncgwi.supabase.co","sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek");

async function fetchAll(cutoffDate) {
  const PAGE = 1000, all = [];
  let page = 0;
  while (true) {
    const { data, error } = await sb.from("batter_outcomes")
      .select("got_hit, got_hr, features").gte("date", cutoffDate)
      .range(page*PAGE, (page+1)*PAGE-1);
    if (error || !data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
}

function sigmoid(z) { return 1/(1+Math.exp(-Math.max(-50,Math.min(50,z)))); }
function train(X, y, epochs=2000, lr=0.05) {
  const n=X.length, m=X[0].length, w=new Array(m).fill(0); let b=0;
  for (let e=0;e<epochs;e++) {
    const dw=new Array(m).fill(0); let db=0;
    for (let i=0;i<n;i++) {
      const err=sigmoid(w.reduce((s,wi,j)=>s+wi*X[i][j],b))-y[i];
      for (let j=0;j<m;j++) dw[j]+=err*X[i][j]/n; db+=err/n;
    }
    for (let j=0;j<m;j++) w[j]-=lr*dw[j]; b-=lr*db;
  }
  return w;
}
function normCols(rows, feats) {
  const means={},mins={},ranges={};
  for (const f of feats) {
    const v=rows.map(r=>r.features[f]).filter(v=>v!=null);
    means[f]=v.length?v.reduce((a,b)=>a+b,0)/v.length:0;
    mins[f]=v.length?Math.min(...v):0;
    ranges[f]=v.length?Math.max(...v)-Math.min(...v)||1:1;
  }
  return rows.map(r=>feats.map(f=>{ const v=r.features[f]??means[f]; return (v-mins[f])/ranges[f]; }));
}
function toWeights(feats, coeffs, groupMap, budget, maxShare=0.30) {
  const grouped={};
  for (let i=0;i<feats.length;i++) { const k=groupMap[feats[i]]??feats[i]; grouped[k]=(grouped[k]??0)+Math.abs(coeffs[i]); }
  const total=Object.values(grouped).reduce((a,b)=>a+b,0)||1;
  const maxPts=Math.floor(budget*maxShare);
  const scaled={}; let extra=0;
  for (const [k,v] of Object.entries(grouped)) {
    const raw=(v/total)*budget;
    if (raw>maxPts){scaled[k]=maxPts;extra+=raw-maxPts;}else scaled[k]=raw;
  }
  if (extra>0){const unc=Object.entries(scaled).filter(([,v])=>v<maxPts);const s=unc.reduce((a,[,v])=>a+v,0)||1;for(const[k,v]of unc)scaled[k]=v+extra*(v/s);}
  for (const k of Object.keys(scaled)) scaled[k]=Math.max(1,Math.round(scaled[k]));
  const tot=Object.values(scaled).reduce((a,b)=>a+b,0);
  if(tot!==budget){const lg=Object.entries(scaled).sort((a,b)=>b[1]-a[1])[0][0];scaled[lg]+=budget-tot;}
  return scaled;
}

const HIT_FEATS=["last3AVG","last10AVG","hitRate20","avgVsHand","situationalAVG","hittingStreak","xBA","hardHitPct","last3HitsAllowed","h2hAVG"];
const HR_FEATS =["last3HR","last6HR","last10HR","seasonSLG","slgVsHand","last10SLG","barrelPct","hardHitPct"];
const HIT_MAP  ={last3AVG:"form",last10AVG:"form",hitRate20:"consistency",avgVsHand:"vsHand",situationalAVG:"homeAway",hittingStreak:"streak",xBA:"xBA",hardHitPct:"hardHit",last3HitsAllowed:"pitcherH",h2hAVG:"h2h"};
const HR_MAP   ={last3HR:"recentHR",last6HR:"recentHR",last10HR:"recentHR",seasonSLG:"seasonSLG",slgVsHand:"slgVsHand",last10SLG:"recentSLG",barrelPct:"barrel",hardHitPct:"hardHit"};

const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-90);
const rows=await fetchAll(cutoff.toISOString().slice(0,10));
console.log(`Rows: ${rows.length}\n`);

const hitW=toWeights(HIT_FEATS, train(normCols(rows,HIT_FEATS), rows.map(r=>r.got_hit?1:0)), HIT_MAP, 85);
const hrW =toWeights(HR_FEATS,  train(normCols(rows,HR_FEATS),  rows.map(r=>r.got_hr ?1:0)), HR_MAP,  85);

console.log("HIT weights (data-driven vs current hardcoded):");
const CUR_HIT={form:20,consistency:18,vsHand:16,homeAway:7,streak:5,xBA:9,hardHit:3,pitcherH:4,h2h:3};
for (const [k,v] of Object.entries(hitW)) console.log(`  ${k.padEnd(14)} regression=${String(v).padEnd(4)} current=${CUR_HIT[k]??0}`);
console.log(`  Total: ${Object.values(hitW).reduce((a,b)=>a+b,0)}`);

console.log("\nHR weights (data-driven vs current hardcoded):");
const CUR_HR={recentHR:22,seasonSLG:12,slgVsHand:11,recentSLG:10,barrel:12,hardHit:8,pitcherHR:7,park:3};
for (const [k,v] of Object.entries(hrW)) console.log(`  ${k.padEnd(14)} regression=${String(v).padEnd(4)} current=${CUR_HR[k]??0}`);
console.log(`  Total: ${Object.values(hrW).reduce((a,b)=>a+b,0)}`);
