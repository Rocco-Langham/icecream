"use strict";
/* ================= CRASH ================= */
/* A multiplier climbs from 1.00x and at some point it crashes. Cash out before
   it does and you take the stake times wherever it had got to; still in when
   it goes and the stake goes with it. Mines' sibling -- the same money, stats
   and best handling -- with the risk turned from a grid into a clock.

   The crash point is decided at the bet and never touched again: with U
   uniform in [0,1), 0.99 / (1 - U), floored to the cent. The chance it reaches
   any m is then 0.99 / m, which is a flat 1% house edge whatever you aim for,
   and it is also why about two rounds in a hundred go at 1.00x on the pad:
   the one in a hundred that comes out under 1 and is held up to it, plus the
   one in a hundred that lands in [1.00, 1.01) and floors down to it.

   Everything runs off timestamps. The multiplier at any moment is worked out
   from how long the round has been going, never added up frame by frame, and
   a plain timer (not requestAnimationFrame) is what notices a crash or an auto
   cash-out -- so a round in a background tab, where frames stop, still ends
   at the right number and still pays the right amount. Frames only draw. */
var crCanvas = $("crashCanvas"), crCtx = crCanvas.getContext("2d");
var CR_VIEW_H = 240;                                   // the height the graph is drawn for
var CR_RATE = 0.06;                                    // m(t) = e^(0.06 t): 2x at 11.6s, 10x at 38s, 100x at 77s
var CR_EDGE = 0.99;                                    // P(crash >= m) = 0.99 / m
var CR_MAX = 1000000;                                  // the ceiling on any round
var CR_AUTO_MIN = 1.01;
var CR_TICK_MS = 50;                                   // how often the logic timer looks
var CR_TICK_GAP = 0.3;                                 // seconds between climb ticks -- about three a second
var CR_HISTORY = 12;
/* The graph always shows at least this much, so the opening second of a round
   is a gentle slope rather than a line going straight up the side. */
var CR_VIEW_T = 16, CR_VIEW_M = 2;

var crW = 480, crH = 240, crCssW = 0, crCssH = 0;
var crStake = 25, crState = "idle";                    // idle | live
var crIn = false;                                      // live and not yet cashed out
var crT0 = 0, crPoint = 1, crAutoAt = 0, crRig = null;
var crCashM = 0, crCashT = 0, crCashNet = 0, crCashAuto = false;
var crEndT = 0, crRound = false;                       // a finished round is left on the graph until the next bet
var crTickT = 0, crTimer = 0;
/* After a crash that took the stake, the button and key sit out this long, as
   Mines' dead state does: presses meant as a cash-out that land just after
   the crash would otherwise each place a fresh bet. */
var CR_DEAD_MS = 700, crDeadUntil = 0;
var crHist = [];

function crMult(t){ return Math.exp(CR_RATE * t); }
function crTimeOf(m){ return Math.log(m) / CR_RATE; }
function crElapsed(now){ return Math.max(0, ((now === undefined ? performance.now() : now) - crT0) / 1000); }
/* The multiplier as the player sees it: cut, never rounded, to the cent. The
   figure on the button is then exactly the figure that gets paid -- rounding
   could show 2.35x a hair before it was really there. */
function crCut(m){ return Math.floor(m * 100 + 1e-9) / 100; }
/* In whole cents, because 100 * 1.15 is 114.99999999999999 in floating point
   and would floor a chip short. Stake times a whole number of cents is exact,
   and so is dividing it by 100 whenever the answer is a whole chip. */
function crCashValue(m){ return Math.floor(crStake * Math.round(m * 100) / 100); }
/* What the round is showing right now, for the readouts: the live figure, or
   where the last one ended. */
function crNowMult(){
  if(crState === "live") return crCut(crMult(crElapsed()));
  return crRound ? crPoint : 1;
}

function crRollPoint(){
  var u = Math.random();
  return Math.min(CR_MAX, Math.max(1, Math.floor(100 * CR_EDGE / (1 - u)) / 100));
}
/* Blank is off. Anything else under the minimum is off too rather than a
   guess at what was meant, and a figure past the ceiling is pulled back to it,
   since no round can go further than that anyway. */
function crReadAuto(){
  var raw = $("crAuto").value.trim();
  if(!raw) return 0;
  var v = Number(raw);
  if(!isFinite(v) || v < CR_AUTO_MIN) return 0;
  return Math.min(CR_MAX, Math.floor(v * 100 + 1e-9) / 100);
}

function crResize(){
  if(!crCanvas) return;
  var rect = crCanvas.getBoundingClientRect();
  if(!rect.width) return;
  var dpr = window.devicePixelRatio || 1;
  /* Same rule as Snake: past the height it is drawn for, the extra pixels
     magnify the graph rather than squeezing more grid into it. */
  var z = Math.max(0.7, rect.height / CR_VIEW_H);
  crW = rect.width / z; crH = rect.height / z;
  crCssW = rect.width; crCssH = rect.height;
  crCanvas.width  = Math.round(rect.width*dpr);
  crCanvas.height = Math.round(rect.height*dpr);
  crCtx.setTransform(dpr*z, 0, 0, dpr*z, 0, 0);
}

function crStart(){
  if(crState !== "idle") return;
  if(crStake > bank){ msg($("crMsg"), "Not enough chips for that bet.", "lose"); return; }
  wager(crStake, "crash");
  stats.hands++;
  /* Rolled once, at the bet, like every other game. The house's round goes
     on the pad, before anyone could react; the player's cannot go at all
     while they are in (see crSettle for how it ends once they are out). */
  crRig = rigRoll();
  crPoint = crRig === "host" ? 1 : crRig === "user" ? Infinity : crRollPoint();
  crAutoAt = crReadAuto();
  $("crAuto").value = crAutoAt ? crAutoAt.toFixed(2) : "";
  crState = "live"; crIn = true; crRound = true;
  crCashM = 0; crCashT = 0; crCashNet = 0; crCashAuto = false;
  crT0 = performance.now();
  crTickT = 0;
  playChip();
  crPlayLaunch();
  msg($("crMsg"), "Lift-off — cash out before it crashes." +
                  (crAutoAt ? " Auto cash-out at " + mnMultText(crAutoAt) + "." : ""), "info");
  clearInterval(crTimer);
  crTimer = setInterval(function(){ crTick(); }, CR_TICK_MS);
  crTick();                                            /* a 1.00x round is over before the first interval */
  syncCrashUI();
}

/* The logic of the round, run off the timer and before any manual cash-out.
   Order matters when one late tick finds several things have happened: an
   auto target at or under the crash point was reached first, so it pays
   before the crash is recorded. */
function crTick(now){
  if(crState !== "live") return;
  var t = crElapsed(now);
  var tc = crTimeOf(crPoint);                          /* Infinity while a rigged round has you in */
  if(crIn && crAutoAt && crAutoAt <= crPoint){
    var ta = crTimeOf(crAutoAt);
    if(t >= ta){ crSettle(crAutoAt, ta, true); tc = crTimeOf(crPoint); }
  }
  /* Only reachable with the player's rig on, which never crashes on them:
     the ceiling still stands, so it pays there rather than climbing forever. */
  if(crIn && crPoint > CR_MAX && t >= crTimeOf(CR_MAX)){ crSettle(CR_MAX, crTimeOf(CR_MAX), false); tc = crTimeOf(crPoint); }
  if(t >= tc){ crCrash(); return; }
  /* The round carries on behind another game's tab, but its ticks stay here. */
  if(crIn && t - crTickT >= CR_TICK_GAP && $("tab-crash").classList.contains("on")){
    crTickT = t;
    crPlayTick(crMult(t));
  }
  syncCrashUI();
}

function crCashOut(){
  if(crState !== "live" || !crIn) return;
  /* Judged at the moment of the click, not the last frame or tick. Anything
     the timer has not caught up with by then -- an auto target passed, or the
     crash itself -- is settled first, at that same moment. */
  var now = performance.now(), t = crElapsed(now);
  crTick(now);
  if(crState !== "live" || !crIn) return;
  if(t >= crTimeOf(crPoint)){ crCrash(); return; }
  crSettle(crCut(crMult(t)), t, false);
  syncCrashUI();
}
/* Pays the cash-out and, if the player's rig was holding the round up, gives
   it somewhere natural to end now that nobody is riding it. */
function crSettle(m, t, auto){
  var ret = crCashValue(m), net = ret - crStake;
  crIn = false;
  crCashM = m; crCashT = t; crCashNet = net; crCashAuto = auto;
  if(crPoint === Infinity) crPoint = Math.min(CR_MAX, Math.max(crCut(m * (1.05 + Math.random()*0.55)), m + 0.01));
  /* A best is a run that paid; getting your own stake back is not one. */
  var best = net > 0 && m > crashBest;
  if(best){ crashBest = m; save(); }
  payout(ret, "crash");

  var head = (auto ? "Auto cash-out" : "Cashed out") + " at " + mnMultText(m);
  if(net > 0){
    playWin(m >= 20 ? "jackpot" : m >= 3 ? "big" : "small");
    if(m >= 3) setTimeout(playCoin, 90);
    msg($("crMsg"), head + " — " + fmt(ret) + " chips (+" + fmt(net) + ").", "win");
  }else{
    playCoin();
    msg($("crMsg"), head + " — " + fmt(ret) + " chips back.", "info");
  }
  if(best) msg($("crMsg"), $("crMsg").textContent + " New best!", "win");
}
function crCrash(){
  var wasIn = crIn;
  clearInterval(crTimer);
  crState = "idle"; crIn = false;
  crEndT = crTimeOf(crPoint);
  crHist.unshift(crPoint);
  if(crHist.length > CR_HISTORY) crHist.length = CR_HISTORY;
  crRenderHistory();
  crPlayBoom(wasIn);
  if(wasIn){
    crDeadUntil = performance.now() + CR_DEAD_MS;
    setTimeout(syncCrashUI, CR_DEAD_MS + 20);
    playLose();
    msg($("crMsg"), (crPoint <= 1 ? "Busted on the pad at 1.00x" : "Crashed at " + mnMultText(crPoint)) +
                    " — " + fmt(crStake) + " chips gone.", "lose");
  }else{
    /* Out already: the line that says what you won stays, and gains how much
       further it would have gone. */
    msg($("crMsg"), $("crMsg").textContent + " It crashed at " + mnMultText(crPoint) + ".",
        crCashNet > 0 ? "win" : "info");
  }
  syncCrashUI();
  crDraw();
}
function crDead(){ return crState !== "live" && performance.now() < crDeadUntil; }
function crToggle(){
  if(crState === "live") crCashOut();
  else if(!crDead()) crStart();
}

/* ---- sound ---- */
/* A short rising whoosh: air, and three quick notes climbing under it. */
function crPlayLaunch(){
  sfx(function(ctx, t){
    noiseBurst(ctx, t, 0.26, 0.010, 1100);
    tone(ctx, 262, t,        0.09, "triangle", 0.012);
    tone(ctx, 392, t + 0.06, 0.09, "triangle", 0.011);
    tone(ctx, 523, t + 0.12, 0.12, "triangle", 0.010);
  });
}
/* The climb. It plays a few times a second for as long as the round lasts,
   so it sits under everything else in the app, and its pitch follows log(m)
   so a long run audibly winds up. */
function crPlayTick(m){
  var f = Math.min(1800, 420 + 190 * Math.log(m));
  sfx(function(ctx, t){ tone(ctx, f, t, 0.035, "sine", 0.005); });
}
/* The crash: a burst of noise with a low note under it. Softer when you had
   already got off -- it is somebody else's bad news by then. */
function crPlayBoom(wasIn){
  var k = wasIn ? 1 : 0.55;
  sfx(function(ctx, t){
    noiseBurst(ctx, t, 0.45, 0.020 * k, 260);
    tone(ctx, 72, t, 0.42, "sine", 0.020 * k);
    tone(ctx, 54, t + 0.05, 0.40, "triangle", 0.014 * k);
  });
}

/* ---- the graph ---- */
/* A step from the 1-2-5 ladder that puts at most `lines` gridlines across
   `span`. */
function crStep(span, lines){
  var raw = span / lines, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var s = [1, 2, 5, 10];
  for(var i = 0; i < s.length; i++) if(s[i]*p >= raw) return s[i]*p;
  return 10*p;
}
/* Short past ten thousand: the labels sit in a narrow margin, and "200kx"
   says as much as "200,000x" in half the room. */
function crAxisText(m){
  if(m >= 1e6) return parseFloat((m / 1e6).toFixed(2)) + "Mx";
  if(m >= 1e4) return parseFloat((m / 1e3).toFixed(1)) + "kx";
  return (m >= 1000 ? fmt(Math.round(m)) : String(parseFloat(m.toFixed(2)))) + "x";
}
/* The y gridlines. Under a whole step they count up from the 1x baseline
   (1.5, 2, 2.5 ...); from a step of 1 up they sit on multiples of it, so the
   labels read 100,000x rather than 100,001x, with the baseline kept. */
function crGridLines(mMax, step){
  var out = [1], gi;
  if(step < 1){
    for(gi = 1; 1 + gi*step <= mMax + 1e-9; gi++) out.push(1 + gi*step);
  }else{
    for(gi = Math.floor(1 / step) + 1; gi*step <= mMax + 1e-9; gi++) out.push(gi*step);
  }
  return out;
}
function crDraw(){
  var ctx = crCtx, W = crW, H = crH;
  ctx.clearRect(0, 0, W, H);
  /* Its own night sky whatever the page theme, like Snake's and Flappy's
     boards -- the gold, green and red below are picked against it. */
  var bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#101a33"); bg.addColorStop(1, "#060913");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  var live = crState === "live";
  var tNow = live ? crElapsed() : crRound ? crEndT : 0;
  var mNow = crMult(tNow);
  /* The axes run a little ahead of the tip and grow as continuous functions of
     it, so they rescale smoothly rather than jumping when a line is passed. */
  var tMax = Math.max(CR_VIEW_T, tNow / 0.82);
  var mMax = Math.max(CR_VIEW_M, 1 + (mNow - 1) / 0.78);
  var my = crStep(mMax - 1, 4), grid = crGridLines(mMax, my);

  ctx.lineWidth = 1;
  ctx.font = "600 9px system-ui, sans-serif";
  /* The left margin is as wide as the widest label needs, so none runs off
     the edge of the canvas. */
  var lw = 0;
  for(var gi = 0; gi < grid.length; gi++) lw = Math.max(lw, ctx.measureText(crAxisText(grid[gi])).width);
  var L = Math.max(40, Math.ceil(lw) + 12), R = 14, T = 12, B = 22;
  var pw = W - L - R, ph = H - T - B;
  var X = function(t){ return L + t / tMax * pw; };
  var Y = function(m){ return T + ph - (m - 1) / (mMax - 1) * ph; };

  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for(gi = 0; gi < grid.length; gi++){
    var g = grid[gi], y = Math.round(Y(g)) + 0.5;
    ctx.strokeStyle = g === 1 ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.07)";
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fillText(crAxisText(g), L - 6, y);
  }
  var tx = crStep(tMax, 5);
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for(var si = 1; si*tx <= tMax + 1e-9; si++){
    var s = si*tx, x = Math.round(X(s)) + 0.5;
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fillText(fmt(Math.round(s)) + "s", x, T + ph + 6);
  }
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.beginPath(); ctx.moveTo(L + 0.5, T); ctx.lineTo(L + 0.5, T + ph); ctx.stroke();

  var crashed = !live && crRound;
  /* The big number's box is placed before the curve is drawn so the cash-out
     label below can keep out of it; it is painted last, over the curve. */
  var sub = "", subCol = "rgba(255,255,255,.6)";
  if(crashed){ sub = "CRASHED AT " + mnMultText(crPoint); subCol = "#ff8a8a"; }
  else if(live && crIn) sub = "CASH OUT NOW: " + fmt(crCashValue(crCut(mNow)));
  else if(live){ sub = "CASHED OUT AT " + mnMultText(crCashM); subCol = "#6fe3a0"; }
  else sub = "PLACE A BET TO LAUNCH";
  var big = mnMultText(crashed ? crPoint : live ? crCut(mNow) : 1);
  ctx.font = "800 40px system-ui, sans-serif";
  var bw = ctx.measureText(big).width;
  ctx.font = "700 11px system-ui, sans-serif";
  var boxW = Math.max(bw, ctx.measureText(sub).width) + 20, boxH = 66;
  var cxm = Math.max(L + 4 + boxW/2, Math.min(W - R - 4 - boxW/2, L + pw*0.32));
  var cym = T + Math.max(boxH/2 + 2, ph*0.3);
  var col = crashed ? "#ff5a5a" : crIn ? "#ffc34d" : "#6fe3a0";
  if(crRound && tNow > 0){
    var n = 90, pts = [];
    for(var i = 0; i <= n; i++){ var ti = tNow * i / n; pts.push([X(ti), Y(crMult(ti))]); }
    var fill = ctx.createLinearGradient(0, T, 0, T + ph);
    fill.addColorStop(0, crashed ? "rgba(255,90,90,.30)" : crIn ? "rgba(255,195,77,.30)" : "rgba(111,227,160,.26)");
    fill.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.moveTo(pts[0][0], T + ph);
    for(i = 0; i <= n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[n][0], T + ph);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();

    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for(i = 1; i <= n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* where you got off */
    if(crCashM && crCashT <= tNow){
      var cx = X(crCashT), cy = Y(crMult(crCashT));
      ctx.fillStyle = "#6fe3a0";
      ctx.strokeStyle = "#062014"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.font = "700 11px system-ui, sans-serif";
      var lab = "+" + fmt(crCashNet), lw2 = ctx.measureText(lab).width, lh = 13;
      /* Up and to the left of the dot, where the curve rising away to the
         right leaves it clear -- unless that is inside the big number's box
         (a narrow phone graph), in which case below and to the right, under
         the curve. */
      var bx0 = cxm - boxW/2, by0 = cym - 30;
      var hits = function(x0, y0){
        return x0 < bx0 + boxW && x0 + lw2 > bx0 && y0 < by0 + boxH && y0 + lh > by0;
      };
      if(!hits(cx - 7 - lw2, cy - 7 - lh) || cy + 7 + lh > T + ph){
        ctx.textAlign = "right"; ctx.textBaseline = "bottom";
        ctx.fillText(lab, cx - 7, cy - 7);
      }else{
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(lab, cx + 7, cy + 7);
      }
    }

    /* the tip */
    var tip = pts[n];
    var glow = ctx.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], 14);
    glow.addColorStop(0, crashed ? "rgba(255,90,90,.7)" : "rgba(255,230,160,.8)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 14, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = crashed ? "#ff8a8a" : "#fff4d6";
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 3.6, 0, Math.PI*2); ctx.fill();
  }

  /* The big number sits up and to the left. The curve is convex and the axes
     keep its tip at the same place in the frame, so it runs below the straight
     line from the origin to the tip and that corner is the part of the plot it
     crosses least. On a narrow phone graph it can still clip the caption, so
     the pair gets a dark backing, pulled in to stay inside the plot. */
  if(crRound){
    ctx.fillStyle = "rgba(6,9,19,.62)";
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(cxm - boxW/2, cym - 30, boxW, boxH, 10);
    else ctx.rect(cxm - boxW/2, cym - 30, boxW, boxH);
    ctx.fill();
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "800 40px system-ui, sans-serif";
  ctx.fillStyle = crashed ? "#ff6b6b" : live ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.35)";
  ctx.fillText(big, cxm, cym - 4);
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.fillStyle = subCol;
  ctx.fillText(sub, cxm, cym + 24);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

function crRenderHistory(){
  var el = $("crHistory");
  if(!crHist.length){ el.innerHTML = '<span class="cr-pill none">No rounds yet</span>'; return; }
  el.innerHTML = crHist.map(function(p){
    var k = p < 2 ? "lo" : p < 10 ? "mid" : "hi";
    return '<span class="cr-pill ' + k + '">' + mnMultText(p) + '</span>';
  }).join("");
}

/* The readouts and button only change when the text does -- this runs twenty
   times a second while a round is live. */
function crSetText(el, s){ if(el.textContent !== s) el.textContent = s; }
function syncCrashUI(){
  var live = crState === "live";
  crSetText($("crMultVal"), mnMultText(crNowMult()));
  crSetText($("crBestVal"), crashBest > 0 ? mnMultText(crashBest) : "—");
  var go = $("crGo");
  if(live && crIn) crSetText(go, "Cash out " + fmt(crCashValue(crNowMult())) + keyTag("crash.go"));
  else if(live)    crSetText(go, "Cashed out " + (crCashNet > 0 ? "+" + fmt(crCashNet) : fmt(crCashNet)));
  else             crSetText(go, "Play" + keyTag("crash.go"));
  go.disabled = (live && !crIn) || crDead();
  /* Out and waiting for the crash: the green, faded, so what you took still
     reads on every theme's gradient. */
  go.classList.toggle("out", live && !crIn);
  /* Any cash-out here returns at least the stake, so it is green from the off. */
  go.classList.toggle("cash", live && crIn);
  Array.prototype.forEach.call(crBtns, function(b){ b.disabled = live; });
  $("crCustom").disabled = live;
  $("crClear").disabled  = live;
  $("crAuto").disabled   = live;
  var k = keyName("crash.go");
  crSetText($("crKeyHint"), "Cash out before it crashes" + (k ? " · " + k + " to bet & cash out" : ""));
}

var crBtns = chipRow($("tab-crash"), null, function(v){
  crStake = v;
  $("crStake").textContent = fmt(crStake);
}, null);
crBtns[1].classList.add("sel");

$("crClear").addEventListener("click", function(){
  playClick();
  crStake = 5;
  $("crStake").textContent = "5";
  Array.prototype.forEach.call(crBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("crCustom").value = "";
  $("crCustom").classList.remove("sel");
});
$("crGo").addEventListener("click", function(){ crToggle(); });
/* Tidied when you leave the field, not while you type: the figure that will
   actually be used, or blank with a word on why if it cannot be. */
$("crAuto").addEventListener("change", function(){
  var el = $("crAuto"), raw = el.value.trim(), v = crReadAuto();
  if(raw && !v){
    el.value = "";
    msg($("crMsg"), "Auto cash-out is off — it needs " + CR_AUTO_MIN.toFixed(2) + "x or more.", "info");
  }else if(v){
    el.value = v.toFixed(2);
  }
});

document.addEventListener("keydown", function(e){
  if(!$("tab-crash").classList.contains("on") || keyBlocked(e)) return;
  if(keyIs(e, "crash.go")){
    e.preventDefault();
    if(e.repeat) return;                                     /* holding the bet key must not re-bet */
    crToggle();
  }
});

/* Frames only draw -- the round itself lives on the timer above. Coming back
   to the tab, the first frame draws wherever the clock says it has got to. */
function crFrame(){
  if($("tab-crash").classList.contains("on")){
    if(crCssW < 5 || stale(crCanvas, crCssW, crCssH)) crResize();
    crDraw();
  }
  requestAnimationFrame(crFrame);
}
window.addEventListener("resize", function(){ crResize(); crDraw(); });

crResize();
crRenderHistory();
syncCrashUI();
crDraw();
requestAnimationFrame(crFrame);
