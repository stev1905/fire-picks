/**
 * NBA First Basket backtest
 *
 *   node scripts/backtest-nba-first-basket.mjs          # report
 *   node scripts/backtest-nba-first-basket.mjs --tune   # + parameter grid (tune on 1st half, test on 2nd)
 *
 * Reads Supabase (read-only): the season's play-by-play cache (`nba-pbp-{season}`)
 * and the daily snapshots (`nba-YYYY-MM-DD`).
 *
 * Sections:
 *  1. Live record — what the app actually showed each day vs. who scored first,
 *     plus flat-stake ROI against DraftKings once snapshots carry book odds
 *  2. Replay — every game re-scored walk-forward (games from earlier ET dates only)
 *     using the game's ACTUAL starters, so it measures the scoring model, not the
 *     lineup projection. Compared with an equal split among the 10 starters.
 *  3. Signals — which inputs predict the player share
 *  4. What matters — tip, first shot, home, jumper
 *
 * Log loss = average −ln(probability given to the player who actually scored first).
 * Lower is better; the equal split is the bar to beat.
 *
 * The model below MIRRORS lib/nbaApi.ts (teamShares, leagueRates, tip model).
 * It's duplicated because this runs under plain node; keep PROD in sync by hand.
 * Settlement: first MADE field goal (free throws excluded). Check that this matches
 * your book's First Basket rules before reading anything into the ROI section.
 */
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(".env.local"); } catch { /* use the shell env */ }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const TUNE = process.argv.includes("--tune");

// ── Production parameters — MUST mirror lib/nbaApi.ts ───────────────────────
const PROD = {
  tipPrior: 4,                       // TIP_PRIOR_TIPS
  twfPrior: 0.57, twfN: 40,          // TIP_WINNER_FIRST_PRIOR(_N)
  benchPrior: 0.005, benchN: 100,    // BENCH_SHARE_PRIOR(_N)
  fgaPow: 0.5,                       // FGA_SHARE_POWER
  sharePrior: 5, recentPrior: 2,     // SHARE_PRIOR_STARTS, RECENT_PRIOR_STARTS
  w: { fga: 1, shot: 0, make: 0, recent: 0 },   // SHARE_WEIGHTS
  useTip: true, home: 0, uniform: false,
};
const variant = (o) => ({ ...PROD, ...o, w: { ...PROD.w, ...(o.w ?? {}) } });

// ── Load ────────────────────────────────────────────────────────────────────
const etDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const today = etDate(new Date().toISOString());
const [y, m] = today.split("-").map(Number);
const season = m >= 8 ? y + 1 : y;

const [{ data: pbpRow, error: e1 }, { data: snapRows, error: e2 }] = await Promise.all([
  sb.from("snapshots").select("data").eq("date", `nba-pbp-${season}`).maybeSingle(),
  sb.from("snapshots").select("date,data").like("date", "nba-____-__-__"),
]);
if (e1 || e2) throw e1 ?? e2;
if (!pbpRow) throw new Error(`No play-by-play cache for season ${season}`);

const ALL = Object.values(pbpRow.data.games)
  .filter((g) => g.firstFG)
  .map((g) => ({ ...g, et: etDate(g.date) }))
  .sort((a, b) => a.date.localeCompare(b.date));
const byId = new Map(ALL.map((g) => [g.id, g]));
const snaps = (snapRows ?? []).filter((s) => s.data?.season === season).sort((a, b) => a.date.localeCompare(b.date));

const pc = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
const f4 = (x) => x.toFixed(4);
const implied = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
const BUCKETS = ["0–5%", "5–10%", "10–15%", "15–20%", "20%+"];
const bucketOf = (p) => Math.min(4, Math.floor(p / 0.05));
function printCalibration(pairs) {   // [{ p, hit }]
  const B = {};
  for (const { p, hit } of pairs) {
    const b = bucketOf(p);
    B[b] ??= { n: 0, pred: 0, hits: 0 };
    B[b].n++; B[b].pred += p; B[b].hits += hit ? 1 : 0;
  }
  for (const [b, v] of Object.entries(B).sort()) {
    console.log(`  ${BUCKETS[b].padEnd(7)} n=${String(v.n).padStart(4)}  predicted ${pc(v.pred / v.n).padStart(6)}  actual ${pc(v.hits / v.n).padStart(6)}`);
  }
}

console.log(`NBA first basket backtest · season ${season} · ${ALL.length} games (${ALL[0]?.et} → ${ALL.at(-1)?.et}) · ${snaps.length} daily snapshots\n`);

// ── 1. Live record ──────────────────────────────────────────────────────────
console.log("=== 1. LIVE RECORD (what the app showed) ===");
{
  let n = 0, ll = 0, llEq = 0, top1 = 0, top3 = 0, lineupRight = 0, lineupN = 0;
  const cal = [];
  const bets = [];   // { edge, odds, hit }
  for (const s of snaps) {
    for (const game of s.data.games) {
      const g = byId.get(game.id);
      const rows = s.data.players.filter((p) => p.gameId === game.id);
      if (!g || rows.length < 10) continue;
      n++;
      const win = g.firstFG.playerId;
      const hit = rows.find((r) => r.id === win);
      const unassigned = Math.max(1 - rows.reduce((a, r) => a + r.prob, 0), 1e-4);
      ll += -Math.log(hit ? Math.max(hit.prob, 1e-6) : unassigned / 2);
      llEq += -Math.log(hit ? 0.1 * (1 - unassigned) : unassigned / 2);
      const sorted = [...rows].sort((a, b) => b.prob - a.prob);
      if (sorted[0].id === win) top1++;
      if (sorted.slice(0, 3).some((r) => r.id === win)) top3++;
      const starters = new Set(g.players.filter((p) => p.starter).map((p) => p.id));
      lineupRight += rows.filter((r) => starters.has(r.id)).length; lineupN += rows.length;
      for (const r of rows) {
        cal.push({ p: r.prob, hit: r.id === win });
        if (r.book?.first != null) bets.push({ edge: r.prob - implied(r.book.first), odds: r.book.first, hit: r.id === win });
      }
    }
  }
  if (!n) console.log("  no scorable snapshot games yet");
  else {
    console.log(`  games ${n} · top pick scored first ${pc(top1 / n)} (random ≈ 10%) · winner in top 3 ${pc(top3 / n)} (≈ 30%)`);
    console.log(`  log loss ${f4(ll / n)} vs equal split ${f4(llEq / n)} · projected starters correct ${pc(lineupRight / lineupN)}`);
    console.log("  (snapshots synced before the model change on 2026-11-16 used the old share model)");
    printCalibration(cal);
    console.log(`\n  ROI vs DraftKings First Basket, 1 unit per bet (${bets.length} priced rows):`);
    if (!bets.length) console.log("  no snapshots with book odds yet — they start with the odds-capture deploy");
    for (const min of [0, 0.02, 0.04]) {
      const pick = bets.filter((b) => b.edge > min);
      const profit = pick.reduce((a, b) => a + (b.hit ? (b.odds > 0 ? b.odds / 100 : 100 / -b.odds) : -1), 0);
      if (pick.length) console.log(`    edge > ${(min * 100).toFixed(0)} pts: ${pick.length} bets, ${pick.filter((b) => b.hit).length} won, ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} u, ROI ${pc(profit / pick.length)}`);
    }
    if (bets.length && bets.length < 500) console.log("    (small sample: one +1000 winner swings ROI by ~10 units)");
  }
}

// ── Model (mirror of lib/nbaApi.ts) ─────────────────────────────────────────
function buildHist(games) {
  const hist = new Map();
  for (const g of [...games].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const p of g.players) {
      let h = hist.get(p.id);
      if (!h) { h = { pos: p.pos, gp: 0, fga: 0, tipsTaken: 0, tipsWon: 0, starts: [] }; hist.set(p.id, h); }
      h.gp++; h.fga += p.fga;
      if (g.tip?.jumpers.includes(p.id)) { h.tipsTaken++; if (g.tip.winnerTeamId === p.teamId) h.tipsWon++; }
      if (p.starter) h.starts.push({ teamId: p.teamId, fga: p.fga, shot: g.teamFirstShot[p.teamId] === p.id, fg: g.teamFirstFG[p.teamId] === p.id });
    }
  }
  return hist;
}
function leagueRates(games, P) {
  let tipN = 0, tipFirst = 0, teamFG = 0, bench = 0;
  for (const g of games) {
    if (g.tip && g.firstFG) { tipN++; if (g.firstFG.teamId === g.tip.winnerTeamId) tipFirst++; }
    const st = new Set(g.players.filter((p) => p.starter).map((p) => p.id));
    for (const pid of Object.values(g.teamFirstFG)) { teamFG++; if (!st.has(pid)) bench++; }
  }
  return { twf: (tipFirst + P.twfPrior * P.twfN) / (tipN + P.twfN), bench: (bench + P.benchPrior * P.benchN) / (teamFG + P.benchN) };
}
const shrunkTip = (h, P) => (h ? (h.tipsWon + P.tipPrior / 2) / (h.tipsTaken + P.tipPrior) : 0.5);
const log5 = (a, b) => { const n = a * (1 - b), d = n + b * (1 - a); return d > 0 ? n / d : 0.5; };
function pickJumper(st, hist) {
  let best = null, bt = 0;
  for (const id of st) { const t = hist.get(id)?.tipsTaken ?? 0; if (t > bt) { best = id; bt = t; } }
  return best ?? st.find((id) => hist.get(id)?.pos === "C") ?? st.find((id) => /F/.test(hist.get(id)?.pos ?? "")) ?? st[0];
}
function teamShares(st, teamId, hist, bench, P) {
  const rows = st.map((id) => {
    const h = hist.get(id);
    const own = (h?.starts ?? []).filter((s) => s.teamId === teamId);
    const starts = own.length ? own : h?.starts ?? [];
    const fgaPer = starts.length ? starts.reduce((a, s) => a + s.fga, 0) / starts.length : h?.gp ? h.fga / h.gp : 6;
    return { id, starts, wt: Math.max(fgaPer, 0.5) ** P.fgaPow };
  });
  const tot = rows.reduce((a, r) => a + r.wt, 0) || 1;
  const raw = rows.map((r) => {
    const prior = P.uniform ? 1 / rows.length : r.wt / tot;
    const n = r.starts.length;
    const l5 = r.starts.slice(0, 5);
    const shot = (r.starts.filter((s) => s.shot).length + P.sharePrior * prior) / (n + P.sharePrior);
    const make = (r.starts.filter((s) => s.fg).length + P.sharePrior * prior) / (n + P.sharePrior);
    const recent = (l5.reduce((a, s) => a + (Number(s.shot) + Number(s.fg)) / 2, 0) + P.recentPrior * prior) / (l5.length + P.recentPrior);
    return { id: r.id, v: P.w.fga * prior + P.w.shot * shot + P.w.make * make + P.w.recent * recent };
  });
  const sum = raw.reduce((a, r) => a + r.v, 0) || 1;
  return new Map(raw.map((r) => [r.id, (r.v / sum) * (1 - bench)]));
}

const dates = [...new Set(ALL.map((g) => g.et))];
const before = new Map(dates.map((d) => { const prior = ALL.filter((g) => g.et < d); return [d, { prior, hist: buildHist(prior) }]; }));

function replay(P, minTeamGames = 3) {
  const out = [];
  for (const g of ALL) {
    const { prior, hist } = before.get(g.et);
    const played = (tid) => prior.filter((x) => x.homeId === tid || x.awayId === tid).length;
    if (played(g.homeId) < minTeamGames || played(g.awayId) < minTeamGames) continue;
    const side = (tid) => { const st = g.players.filter((p) => p.teamId === tid && p.starter).map((p) => p.id); return { tid, st, j: pickJumper(st, hist) }; };
    const H = side(g.homeId), A = side(g.awayId);
    if (H.st.length !== 5 || A.st.length !== 5) continue;
    const { twf, bench } = leagueRates(prior, P);
    const pTip = P.useTip ? log5(shrunkTip(hist.get(H.j), P), shrunkTip(hist.get(A.j), P)) : 0.5;
    const pHome = Math.min(0.95, Math.max(0.05, pTip * twf + (1 - pTip) * (1 - twf) + P.home));
    const players = [];
    for (const [S, pt] of [[H, pHome], [A, 1 - pHome]]) {
      const sh = teamShares(S.st, S.tid, hist, bench, P);
      for (const id of S.st) players.push({ id, tid: S.tid, share: sh.get(id), p: pt * sh.get(id) });
    }
    out.push({ g, pTip, pHome, bench, players });
  }
  return out;
}

function metrics(preds) {
  const M = { n: preds.length, ll: 0, llEq: 0, top1: 0, top3: 0, teamLL: 0, shareLL: 0, shareEq: 0, shareN: 0 };
  for (const { g, players, pHome, bench } of preds) {
    const win = g.firstFG.playerId;
    const hit = players.find((p) => p.id === win);
    const homeFirst = g.firstFG.teamId === g.homeId;
    M.ll += -Math.log(Math.max(hit ? hit.p : (homeFirst ? pHome : 1 - pHome) * bench, 1e-6));
    M.llEq += -Math.log(hit ? (1 - bench) / 10 : bench / 2);
    const sorted = [...players].sort((a, b) => b.p - a.p);
    if (sorted[0].id === win) M.top1++;
    if (sorted.slice(0, 3).some((p) => p.id === win)) M.top3++;
    M.teamLL += -Math.log(homeFirst ? pHome : 1 - pHome);
    for (const [tid, pid] of Object.entries(g.teamFirstFG)) {
      const mine = players.find((p) => p.tid === tid && p.id === pid);
      M.shareN++;
      M.shareLL += -Math.log(Math.max(mine ? mine.share : bench, 1e-6));
      M.shareEq += -Math.log(mine ? (1 - bench) / 5 : bench);
    }
  }
  for (const k of ["ll", "llEq", "top1", "top3", "teamLL"]) M[k] /= M.n || 1;
  M.shareLL /= M.shareN || 1; M.shareEq /= M.shareN || 1;
  return M;
}
const halves = (p) => [p.slice(0, p.length >> 1), p.slice(p.length >> 1)];

// ── 2. Replay ───────────────────────────────────────────────────────────────
console.log("\n=== 2. REPLAY, production model (walk-forward, actual starters) ===");
const prod = replay(PROD);
const PM = metrics(prod);
const [h1, h2] = halves(prod).map(metrics);
console.log(`  games ${PM.n} · log loss ${f4(PM.ll)} vs equal split ${f4(PM.llEq)} (1st half ${f4(h1.ll)}, 2nd half ${f4(h2.ll)})`);
console.log(`  top pick scored first ${pc(PM.top1)} · winner in top 3 ${pc(PM.top3)}`);
console.log(`  team-first log loss ${f4(PM.teamLL)} vs coin ${f4(Math.LN2)} · player-share log loss ${f4(PM.shareLL)} vs equal ${f4(PM.shareEq)}`);
printCalibration(prod.flatMap((r) => r.players.map((p) => ({ p: p.p, hit: p.id === r.g.firstFG.playerId }))));

// ── 3. Signals ──────────────────────────────────────────────────────────────
console.log("\n=== 3. SIGNALS (player-share log loss, lower is better) ===");
const SIGNALS = [
  ["production", {}],
  ["equal split", { uniform: true, w: { fga: 1, shot: 0, make: 0, recent: 0 } }],
  ["raw FGA share (power 1)", { fgaPow: 1 }],
  ["first-shot history", { w: { fga: 0, shot: 1 } }],
  ["first-basket history", { w: { fga: 0, make: 1 } }],
  ["last-5 form", { w: { fga: 0, recent: 1 } }],
  ["old blend (40/35/25, ~pre 2026-11-16)", { fgaPow: 1, w: { fga: 0, shot: 0.4, make: 0.35, recent: 0.25 } }],
  ["ignore the tip", { useTip: false }],
  ["+3 pts home edge", { home: 0.03 }],
];
for (const [name, o] of SIGNALS) {
  const r = metrics(replay(variant(o)));
  console.log(`  ${name.padEnd(38)} share ${f4(r.shareLL)} · game ${f4(r.ll)} · team ${f4(r.teamLL)} · top3 ${pc(r.top3)}`);
}

// ── 4. What matters ─────────────────────────────────────────────────────────
console.log("\n=== 4. WHAT MATTERS (all games) ===");
const G = ALL.filter((g) => g.tip);
const rate = (fn, of = G) => pc(of.filter(fn).length / of.length);
console.log(`  tip winner made the first FG ........ ${rate((g) => g.firstFG.teamId === g.tip.winnerTeamId)}`);
console.log(`  team taking the first shot scored 1st ${rate((g) => g.firstShot && g.firstFG.teamId === g.firstShot.teamId)}`);
console.log(`  first shooter made the first FG ..... ${rate((g) => g.firstShot && g.firstFG.playerId === g.firstShot.playerId)}`);
console.log(`  a tip jumper made the first FG ...... ${rate((g) => g.tip.jumpers.includes(g.firstFG.playerId))}  (20% if no effect)`);
console.log(`  home team made the first FG ......... ${rate((g) => g.firstFG.teamId === g.homeId)}  (home won the tip ${rate((g) => g.tip.winnerTeamId === g.homeId)})`);
let benchFirst = 0, teamFirsts = 0;
for (const g of ALL) {
  const st = new Set(g.players.filter((p) => p.starter).map((p) => p.id));
  for (const pid of Object.values(g.teamFirstFG)) { teamFirsts++; if (!st.has(pid)) benchFirst++; }
}
console.log(`  team-first FGs by bench players ..... ${benchFirst} of ${teamFirsts}`);

// ── 5. Tuning (optional) ────────────────────────────────────────────────────
if (TUNE) {
  console.log("\n=== 5. TUNING (grid scored on the 1st half, reported on the 2nd) ===");
  const res = [];
  for (const fgaPow of [0.25, 0.5, 0.75, 1])
    for (const shot of [0, 0.1, 0.2, 0.3])
      for (const make of [0, 0.1, 0.2])
        for (const sharePrior of [5, 10, 20, 40])
          for (const tipPrior of [4, 8, 16])
            for (const home of [0, 0.03]) {
              const o = { fgaPow, w: { fga: 1 - shot - make, shot, make, recent: 0 }, sharePrior, tipPrior, home };
              const [a, b] = halves(replay(variant(o))).map(metrics);
              res.push({ o, tune: a.ll, test: b.ll });
            }
  res.sort((a, b) => a.tune - b.tune);
  console.log(`  production: tune ${f4(h1.ll)} · test ${f4(h2.ll)}`);
  for (const r of res.slice(0, 10)) {
    const { fgaPow, w, sharePrior, tipPrior, home } = r.o;
    console.log(`  pow ${fgaPow} shot ${w.shot} make ${w.make} sharePrior ${sharePrior} tipPrior ${tipPrior} home ${home} → tune ${f4(r.tune)} · test ${f4(r.test)}`);
  }
  console.log("  Only adopt a change that also wins on the test half, and re-check as the season grows.");
}
