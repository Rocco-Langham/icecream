"use strict";
/* ================= SLOTS ================= */
var SYMBOLS = [
  {s:"🍒", name:"Cherry",   weight:22, pay:6},
  {s:"🍋", name:"Lemon",    weight:20, pay:8},
  {s:"🍇", name:"Grapes",   weight:16, pay:12},
  {s:"🔔", name:"Bell",     weight:12, pay:20},
  {s:"💎", name:"Diamond",  weight:7,  pay:50},
  {s:"7️⃣", name:"Seven",   weight:50,  pay:250}
];
var WHEEL_POOL = [];
SYMBOLS.forEach(function(sym){
  for(var i=0;i<sym.weight;i++) WHEEL_POOL.push(sym);
});

$("paytable").innerHTML = SYMBOLS.slice().reverse().map(function(s){
  return "<div><span>" + s.s + " " + s.s + " " + s.s + " &nbsp;" + s.name + "</span><b>" + s.pay + "x</b></div>";
}).join("") + "<div><span>🍒 🍒 &nbsp;Any two cherries</span><b>2x</b></div>";

var slotStake = 25, slotBusy = false;
var slotBtns = chipRow($("tab-slots"), function(){ return slotStake; }, function(v){
  slotStake = v;
  $("slotStake").textContent = fmt(slotStake);
}, null);
slotBtns[1].classList.add("sel");

$("slotClear").addEventListener("click", function(){
  slotStake = 5;
  $("slotStake").textContent = "5";
  Array.prototype.forEach.call(slotBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("slotCustom").value = "";
  $("slotCustom").classList.remove("sel");
});

/* Picks a spin that pays nothing: not three-of-a-kind and never exactly two cherries. */
function losingSpin(){
  for(var t = 0; t < 200; t++){
    var r = [WHEEL_POOL[rnd(WHEEL_POOL.length)], WHEEL_POOL[rnd(WHEEL_POOL.length)], WHEEL_POOL[rnd(WHEEL_POOL.length)]];
    if(r[0] === r[1] && r[1] === r[2]) continue;
    var cherries = r.filter(function(s){ return s.name === "Cherry"; }).length;
    if(cherries === 2) continue;
    return r;
  }
  return [SYMBOLS[1], SYMBOLS[2], SYMBOLS[3]];        // lemon / grapes / bell
}

$("spinBtn").addEventListener("click", function(){
  if(slotBusy) return;
  if(slotStake > bank){ msg($("slotMsg"), "Not enough chips for that bet.", "lose"); return; }

  slotBusy = true;
  $("spinBtn").disabled = true;
  wager(slotStake, "slots");
  stats.hands++;
  msg($("slotMsg"), "Spinning…", "info");

  var rigMode = rigRoll();
  var forced = null;
  if(rigMode === "user"){
    var seven = SYMBOLS[SYMBOLS.length - 1];           // 777 — the top payout
    forced = [seven, seven, seven];
  }else if(rigMode === "host"){
    forced = losingSpin();
  }

  var reels = [$("r0"), $("r1"), $("r2")];
  var result = [];
  reels.forEach(function(r){
    r.classList.add("spin");
    r.classList.remove("hit");
  });

  var tick = setInterval(function(){
    reels.forEach(function(r){
      if(r.classList.contains("spin")) r.textContent = WHEEL_POOL[rnd(WHEEL_POOL.length)].s;
    });
    playSpinTick();
  }, 70);

  reels.forEach(function(r, i){
    setTimeout(function(){
      var pick = forced ? forced[i] : WHEEL_POOL[rnd(WHEEL_POOL.length)];
      result[i] = pick;
      r.classList.remove("spin");
      r.textContent = pick.s;
      playReelStop();
      if(i === reels.length - 1){
        clearInterval(tick);
        settleSlots(result, reels);
      }
    }, 700 + i*450);
  });
});

function settleSlots(result, reels){
  var win = 0, note = "";
  if(result[0] === result[1] && result[1] === result[2]){
    win = slotStake * result[0].pay;
    note = "Three " + result[0].name + "s — " + result[0].pay + "x!";
    reels.forEach(function(r){ r.classList.add("hit"); });
  }else{
    var cherries = result.filter(function(s){ return s.name === "Cherry"; }).length;
    if(cherries === 2){
      win = slotStake * 2;
      note = "Two cherries — 2x.";
      result.forEach(function(s, i){ if(s.name === "Cherry") reels[i].classList.add("hit"); });
    }
  }

  if(win > 0){
    payout(win, "slots");
    var size = win >= slotStake * 50 ? "jackpot" : win >= slotStake * 12 ? "big" : "small";
    playWin(size);
    if(size !== "small") setTimeout(playCoin, 90);
    msg($("slotMsg"), note + " You win " + fmt(win) + " chips.", "win");
  }else{
    playLose();
    msg($("slotMsg"), "No match. Try again.", "lose");
  }
  slotBusy = false;
  $("spinBtn").disabled = false;
}

/* ================= BLACKJACK ================= */
var SUITS = [
  {s:"♠", red:false}, {s:"♥", red:true},
  {s:"♦", red:true},  {s:"♣", red:false}
];
var RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

var shoe = [];
function buildShoe(){
  shoe = [];
  for(var d=0; d<4; d++){
    SUITS.forEach(function(su){
      RANKS.forEach(function(r){ shoe.push({r:r, su:su}); });
    });
  }
  for(var i=shoe.length-1; i>0; i--){
    var j = rnd(i+1), t = shoe[i]; shoe[i] = shoe[j]; shoe[j] = t;
  }
}
function draw(){
  if(shoe.length < 30) buildShoe();
  return shoe.pop();
}
buildShoe();

/* Pulls the first card matching pred out of the shoe (used by the rig commands). */
function drawWhere(pred){
  if(shoe.length < 30) buildShoe();
  for(var i = shoe.length - 1; i >= 0; i--){
    if(pred(shoe[i])) return shoe.splice(i, 1)[0];
  }
  buildShoe();
  for(var j = shoe.length - 1; j >= 0; j--){
    if(pred(shoe[j])) return shoe.splice(j, 1)[0];
  }
  return draw();
}
var isAceCard = function(c){ return c.r === "A"; };
var isTenCard = function(c){ return c.r === "10" || c.r === "J" || c.r === "Q" || c.r === "K"; };
var isSmallCard = function(c){ return c.r !== "A" && !isTenCard(c) && Number(c.r) <= 6; };

function handValue(cards){
  var total = 0, aces = 0;
  cards.forEach(function(c){
    if(c.r === "A"){ aces++; total += 11; }
    else if(c.r === "K" || c.r === "Q" || c.r === "J" || c.r === "10") total += 10;
    else total += Number(c.r);
  });
  while(total > 21 && aces > 0){ total -= 10; aces--; }
  return {total:total, soft:aces > 0};
}
function cardEl(card, hidden){
  var el = document.createElement("div");
  if(hidden){ el.className = "card back"; return el; }
  el.className = "card" + (card.su.red ? " red" : "");
  el.innerHTML =
    '<div class="corner tl">' + card.r + '<br>' + card.su.s + '</div>' +
    '<div class="pip">' + card.su.s + '</div>' +
    '<div class="corner br">' + card.r + '<br>' + card.su.s + '</div>';
  return el;
}

var bj = {stake:25, player:[], dealer:[], live:false, hole:true, doubled:false};
var bjBtns = chipRow($("bjBetBar"), null, function(v){
  bj.stake = v;
  $("bjStake").textContent = fmt(bj.stake);
}, null);
bjBtns[1].classList.add("sel");

$("bjClear").addEventListener("click", function(){
  bj.stake = 5;
  $("bjStake").textContent = "5";
  Array.prototype.forEach.call(bjBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("bjCustom").value = "";
  $("bjCustom").classList.remove("sel");
});

function renderBJ(){
  var dh = $("dHand"), ph = $("pHand");
  dh.innerHTML = ""; ph.innerHTML = "";
  bj.dealer.forEach(function(c, i){ dh.appendChild(cardEl(c, bj.hole && i === 1)); });
  bj.player.forEach(function(c){ ph.appendChild(cardEl(c, false)); });

  var pv = handValue(bj.player);
  $("pScore").textContent = bj.player.length ? (pv.soft && pv.total <= 21 ? "soft " + pv.total : pv.total) : "—";
  if(bj.hole && bj.dealer.length){
    $("dScore").textContent = handValue([bj.dealer[0]]).total + " + ?";
  }else{
    $("dScore").textContent = bj.dealer.length ? handValue(bj.dealer).total : "—";
  }
}
function bjMode(live){
  bj.live = live;
  $("bjBetBar").style.display  = live ? "none" : "flex";
  $("bjActions").style.display = live ? "flex" : "none";
  $("dblBtn").disabled = bj.player.length !== 2 || bj.stake > bank;
}

$("dealBtn").addEventListener("click", function(){
  if(bj.stake > bank){ msg($("bjMsg"), "Not enough chips for that wager.", "lose"); return; }
  wager(bj.stake, "blackjack");
  stats.hands++;

  var rigMode = rigRoll();
  if(rigMode === "user"){
    /* Natural blackjack for the player, dealer can't tie it. */
    bj.player = [drawWhere(isAceCard), drawWhere(isTenCard)];
    bj.dealer = [drawWhere(isSmallCard), drawWhere(isSmallCard)];
  }else if(rigMode === "host"){
    /* Dealer blackjack, player holds two low cards so it can't push. */
    bj.dealer = [drawWhere(isAceCard), drawWhere(isTenCard)];
    bj.player = [drawWhere(isSmallCard), drawWhere(isSmallCard)];
  }else{
    bj.player = [draw(), draw()];
    bj.dealer = [draw(), draw()];
  }
  bj.hole = true;
  bj.doubled = false;
  renderBJ();
  bjMode(true);
  msg($("bjMsg"), "Hit, stand, or double.", "info");
  [0, 110, 230, 340].forEach(function(delay){ setTimeout(playDeal, delay); });

  var pNat = handValue(bj.player).total === 21;
  var dNat = handValue(bj.dealer).total === 21;
  if(pNat || dNat){
    bj.hole = false;
    renderBJ();
    if(pNat && dNat){
      payout(bj.stake, "blackjack");
      playClick();
      msg($("bjMsg"), "Both blackjack — push. Wager returned.", "info");
    }else if(pNat){
      var win = Math.floor(bj.stake * 2.5);
      payout(win, "blackjack");
      playWin("big");
      msg($("bjMsg"), "Blackjack! You collect " + fmt(win) + " chips.", "win");
    }else{
      playLose();
      msg($("bjMsg"), "Dealer has blackjack. Hand lost.", "lose");
    }
    bjMode(false);
  }
});

$("hitBtn").addEventListener("click", function(){
  playDeal();
  bj.player.push(draw());
  renderBJ();
  $("dblBtn").disabled = true;
  if(handValue(bj.player).total > 21){
    bj.hole = false;
    renderBJ();
    playLose();
    msg($("bjMsg"), "Bust at " + handValue(bj.player).total + ". Hand lost.", "lose");
    bjMode(false);
  }
});

$("dblBtn").addEventListener("click", function(){
  if(bj.stake > bank) return;
  playDeal();
  wager(bj.stake, "blackjack");
  bj.stake *= 2;
  bj.doubled = true;
  bj.player.push(draw());
  renderBJ();
  if(handValue(bj.player).total > 21){
    bj.hole = false;
    renderBJ();
    playLose();
    msg($("bjMsg"), "Doubled and busted at " + handValue(bj.player).total + ".", "lose");
    bj.stake /= 2;
    bjMode(false);
  }else{
    dealerPlay();
  }
});

$("standBtn").addEventListener("click", dealerPlay);

function dealerPlay(){
  bj.hole = false;
  bjMode(true);
  $("hitBtn").disabled = $("standBtn").disabled = $("dblBtn").disabled = true;
  renderBJ();

  var step = function(){
    var dv = handValue(bj.dealer);
    if(dv.total < 17){
      playDeal();
      bj.dealer.push(draw());
      renderBJ();
      setTimeout(step, 620);
    }else{
      setTimeout(settleBJ, 350);
    }
  };
  setTimeout(step, 620);
}

function settleBJ(){
  var p = handValue(bj.player).total;
  var d = handValue(bj.dealer).total;
  if(d > 21){
    payout(bj.stake * 2, "blackjack");
    playWin("big");
    msg($("bjMsg"), "Dealer busts at " + d + ". You win " + fmt(bj.stake * 2) + " chips.", "win");
  }else if(p > d){
    payout(bj.stake * 2, "blackjack");
    playWin("big");
    msg($("bjMsg"), p + " beats " + d + ". You win " + fmt(bj.stake * 2) + " chips.", "win");
  }else if(p === d){
    payout(bj.stake, "blackjack");
    playClick();
    msg($("bjMsg"), "Push at " + p + ". Wager returned.", "info");
  }else{
    playLose();
    msg($("bjMsg"), "Dealer wins with " + d + " to your " + p + ".", "lose");
  }
  if(bj.doubled) bj.stake /= 2;
  $("bjStake").textContent = fmt(bj.stake);
  $("hitBtn").disabled = $("standBtn").disabled = false;
  bjMode(false);
}
renderBJ();

/* ================= ROULETTE ================= */
var REDS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
function isRed(n){ return REDS.indexOf(n) !== -1; }

var rChip = 25, rBets = {}, rBusy = false;
var rBtns = chipRow($("tab-roulette"), null, function(v){ rChip = v; }, null);
rBtns[1].classList.add("sel");

var OUTSIDE = {
  "1st12": {label:"1st 12",  pay:3, hit:function(n){ return n >= 1  && n <= 12; }},
  "2nd12": {label:"2nd 12",  pay:3, hit:function(n){ return n >= 13 && n <= 24; }},
  "3rd12": {label:"3rd 12",  pay:3, hit:function(n){ return n >= 25 && n <= 36; }},
  "low":   {label:"1-18",    pay:2, hit:function(n){ return n >= 1  && n <= 18; }},
  "even":  {label:"Even",    pay:2, hit:function(n){ return n !== 0 && n % 2 === 0; }},
  "red":   {label:"Red",     pay:2, hit:function(n){ return isRed(n); }},
  "black": {label:"Black",   pay:2, hit:function(n){ return n !== 0 && !isRed(n); }},
  "odd":   {label:"Odd",     pay:2, hit:function(n){ return n % 2 === 1; }},
  "high":  {label:"19-36",   pay:2, hit:function(n){ return n >= 19 && n <= 36; }}
};

var board = $("board");
function buildBoard(){
  board.innerHTML = "";
  var zero = document.createElement("div");
  zero.className = "cell green";
  zero.dataset.bet = "n0";
  zero.textContent = "0";
  board.appendChild(zero);

  for(var n=1; n<=36; n++){
    var c = document.createElement("div");
    c.className = "cell " + (isRed(n) ? "red" : "black");
    c.dataset.bet = "n" + n;
    c.textContent = n;
    board.appendChild(c);
  }
  ["1st12","2nd12","3rd12"].forEach(function(k){
    var c = document.createElement("div");
    c.className = "cell out";
    c.dataset.bet = k;
    c.textContent = OUTSIDE[k].label;
    board.appendChild(c);
  });
  ["low","even","red","black","odd","high"].forEach(function(k){
    var c = document.createElement("div");
    c.className = "cell out sm";
    c.dataset.bet = k;
    c.textContent = OUTSIDE[k].label;
    board.appendChild(c);
  });
}
buildBoard();

board.addEventListener("click", function(e){
  var cell = e.target.closest(".cell");
  if(!cell || rBusy) return;
  var key = cell.dataset.bet;
  var staked = totalStaked();
  if(staked + rChip > bank){
    msg($("rMsg"), "That would put you over your bankroll.", "lose");
    return;
  }
  playChip();
  rBets[key] = (rBets[key] || 0) + rChip;
  renderBets();
});

function totalStaked(){
  var t = 0;
  for(var k in rBets) t += rBets[k];
  return t;
}
function betLabel(key){
  return key.charAt(0) === "n" && !OUTSIDE[key] ? "#" + key.slice(1) : OUTSIDE[key].label;
}
function renderBets(){
  Array.prototype.forEach.call(board.querySelectorAll(".cell"), function(c){
    var old = c.querySelector(".stack");
    if(old) old.remove();
    var amt = rBets[c.dataset.bet];
    if(amt){
      var s = document.createElement("span");
      s.className = "stack";
      s.textContent = amt;
      c.appendChild(s);
    }
  });
  var keys = Object.keys(rBets);
  $("slips").innerHTML = keys.length
    ? keys.map(function(k){ return "<span>" + betLabel(k) + " &middot; " + fmt(rBets[k]) + "</span>"; }).join("")
    : "";
  $("rTotal").textContent = fmt(totalStaked());
}

$("rClear").addEventListener("click", function(){
  if(rBusy) return;
  playClick();
  rBets = {};
  renderBets();
  msg($("rMsg"), "Bets cleared.", "info");
});

$("rSpin").addEventListener("click", function(){
  var staked = totalStaked();
  if(rBusy) return;
  if(staked === 0){ msg($("rMsg"), "Place at least one chip on the layout.", "lose"); return; }
  if(staked > bank){ msg($("rMsg"), "Not enough chips.", "lose"); return; }

  rBusy = true;
  $("rSpin").disabled = true;
  wager(staked, "roulette");
  stats.hands++;

  Array.prototype.forEach.call(board.querySelectorAll(".hitnum"), function(c){ c.classList.remove("hitnum"); });
  var wheel = $("wheel"), hub = $("wheelNum");
  wheel.classList.add("spinning");
  msg($("rMsg"), "No more bets…", "info");

  var teaser = setInterval(function(){ hub.textContent = rnd(37); playSpinTick(); }, 80);
  var rigMode = rigRoll();
  var result = rigMode ? riggedResult(rigMode) : rnd(37);

  setTimeout(function(){
    clearInterval(teaser);
    wheel.classList.remove("spinning");
    hub.textContent = result;
    hub.style.color = result === 0 ? "#4ade80" : (isRed(result) ? "#ff6b70" : "#f4ead7");
    playReelStop();
    var cell = board.querySelector('[data-bet="n' + result + '"]');
    if(cell) cell.classList.add("hitnum");
    settleRoulette(result, staked);
  }, 2200);
});

/* What the current bets would return if the ball landed on `result`. */
function returnFor(result){
  var ret = 0, hits = [];
  for(var key in rBets){
    var amt = rBets[key];
    if(OUTSIDE[key]){
      if(OUTSIDE[key].hit(result)){
        ret += amt * OUTSIDE[key].pay;
        hits.push(OUTSIDE[key].label);
      }
    }else if(Number(key.slice(1)) === result){
      ret += amt * 36;
      hits.push("straight up #" + result);
    }
  }
  return {ret:ret, hits:hits};
}

/* Best-paying number for the player, or the worst — whichever the rig calls for. */
function riggedResult(mode){
  var pick = 0, pickRet = mode === "user" ? -1 : Infinity;
  for(var n = 0; n <= 36; n++){
    var r = returnFor(n).ret;
    if(mode === "user" ? r > pickRet : r < pickRet){ pickRet = r; pick = n; }
  }
  return pick;
}

function settleRoulette(result, staked){
  var outcome = returnFor(result);
  var ret = outcome.ret, hits = outcome.hits;

  var colour = result === 0 ? "green" : (isRed(result) ? "red" : "black");
  if(ret > 0){
    payout(ret, "roulette");
    var net = ret - staked;
    var size = ret >= staked * 20 ? "jackpot" : ret >= staked * 5 ? "big" : "small";
    playWin(size);
    if(size !== "small") setTimeout(playCoin, 90);
    msg($("rMsg"),
      result + " " + colour + " — " + hits.join(", ") + ". Returned " + fmt(ret) +
      " (" + (net >= 0 ? "+" : "") + fmt(net) + ").", net >= 0 ? "win" : "lose");
  }else{
    playLose();
    msg($("rMsg"), result + " " + colour + " — nothing on it. Lost " + fmt(staked) + ".", "lose");
  }

  rBets = {};
  renderBets();
  rBusy = false;
  $("rSpin").disabled = false;
}

/* ================= HORSE RACING ================= */
/* Hand-rolled 3D: orbit camera + near-plane clipped polygon projection onto a
   2D canvas. No libraries, so the file stays a single self-contained download. */
var SILKS = ["#e23c3c","#3b82f6","#22c55e","#eab308","#a855f7","#ec4899",
             "#14b8a6","#f97316","#94a3b8","#84cc16","#06b6d4","#fb7185"];
/* Real coat colours — bay, chestnut, black, grey, palomino… identity comes
   from the silks and the saddle-cloth number, not from rainbow horses. */
var COATS = ["#6b4423","#8a5524","#332a26","#9c9186","#c19a4b","#4a3527",
             "#7a4a2a","#3d3330","#a8814e","#5c4033","#8a7f76","#63432a"];
function shade(hex, f){
  var n = parseInt(hex.slice(1), 16);
  var r = Math.round(((n>>16)&255)*f), g = Math.round(((n>>8)&255)*f), b = Math.round((n&255)*f);
  return "rgb(" + r + "," + g + "," + b + ")";
}
var RX = 150, RZ = 95, LANE = 6.5;

var hrCanvas = $("trackCanvas"), hrCtx = hrCanvas.getContext("2d");
var stripCanvas = $("stripCanvas"), stripCtx = stripCanvas.getContext("2d");
var sW = 700, sH = 120;
var hrW = 700, hrH = 340, hrFocal = 740;   /* the course only ever used the middle of its frame; a longer lens fills it */
/* The width the course is drawn for. Anything wider is magnification, not a
   bigger world — see hrResize. */
var HR_VIEW_W = 860, HR_VIEW_H = 280, HR_STRIP_H = 176, hrZoom = 1, hrCssW = 0, hrCssH = 0;
var hrCam = {yaw:0.85, pitch:0.58, dist:440, tx:0, ty:0, tz:0};
var hrCount = 6, hrPick = 1, hrStake = 25, hrLaps = 2, hrQuick = false;
var horses = [], hrRacing = false, hrLast = 0, hrTime = 0, hrWinner = -1, hrSettled = true;
var hrGallop = 0;

function hrResize(){
  if(!hrCanvas) return;
  var dpr = window.devicePixelRatio || 1;
  /* Height is what magnifies the course, not width: a taller frame means a
     bigger track drawn at full resolution, while a wider one is simply more of
     the course either side of it. Below the design height nothing changes,
     which is what keeps phones as they were. */
  var rect = hrCanvas.getBoundingClientRect();
  if(rect.width){
    hrZoom = Math.max(1, rect.height / HR_VIEW_H);
    hrW = rect.width / hrZoom; hrH = rect.height / hrZoom;
    hrCssW = rect.width; hrCssH = rect.height;
    hrCanvas.width = Math.round(rect.width * dpr);
    hrCanvas.height = Math.round(rect.height * dpr);
    hrCtx.setTransform(dpr*hrZoom, 0, 0, dpr*hrZoom, 0, 0);
  }
  var srect = stripCanvas.getBoundingClientRect();
  if(srect.width){
    var sz = Math.max(1, srect.height / HR_STRIP_H);
    sW = srect.width / sz; sH = srect.height / sz;
    stripCanvas.width = Math.round(srect.width * dpr);
    stripCanvas.height = Math.round(srect.height * dpr);
    stripCtx.setTransform(dpr*sz, 0, 0, dpr*sz, 0, 0);
  }
}

/* ---- camera basis ---- */
var hrB = {c:{x:0,y:0,z:0}, r:{x:1,y:0,z:0}, u:{x:0,y:1,z:0}, f:{x:0,y:0,z:1}};
function hrUpdateBasis(){
  var cp = Math.cos(hrCam.pitch), sp = Math.sin(hrCam.pitch);
  var c = {
    x: hrCam.tx + hrCam.dist*cp*Math.sin(hrCam.yaw),
    y: hrCam.ty + hrCam.dist*sp,
    z: hrCam.tz + hrCam.dist*cp*Math.cos(hrCam.yaw)
  };
  var fx = hrCam.tx-c.x, fy = hrCam.ty-c.y, fz = hrCam.tz-c.z;
  var fl = Math.sqrt(fx*fx+fy*fy+fz*fz) || 1;
  fx/=fl; fy/=fl; fz/=fl;
  var rx = -fz, ry = 0, rz = fx;                       // forward x worldUp
  var rl = Math.sqrt(rx*rx+rz*rz) || 1;
  rx/=rl; rz/=rl;
  var ux = ry*fz - rz*fy, uy = rz*fx - rx*fz, uz = rx*fy - ry*fx;
  hrB = {c:c, r:{x:rx,y:0,z:rz}, u:{x:ux,y:uy,z:uz}, f:{x:fx,y:fy,z:fz}};
}
function hrView(p){
  var dx = p.x-hrB.c.x, dy = p.y-hrB.c.y, dz = p.z-hrB.c.z;
  return {
    vx: dx*hrB.r.x + dy*hrB.r.y + dz*hrB.r.z,
    vy: dx*hrB.u.x + dy*hrB.u.y + dz*hrB.u.z,
    vz: dx*hrB.f.x + dy*hrB.f.y + dz*hrB.f.z
  };
}
function hrScreen(v){
  /* The lens follows the frame, so a shallower one sees the same course from the
     same place rather than cropping the top off the bend. Width counts too, but
     with a floor: a phone is far narrower than the frame this is drawn for, and
     backing all the way off would leave the course a postage stamp. */
  var k = (hrFocal * Math.min(hrH / HR_VIEW_H, Math.max(0.75, hrW / HR_VIEW_W))) / v.vz;
  return {x: hrW/2 + v.vx*k, y: hrH/2 - v.vy*k, k: k};
}
function hrPoint(p){
  var v = hrView(p);
  if(v.vz < 14) return null;
  var s = hrScreen(v); s.vz = v.vz;
  return s;
}
/* Clips a world polygon against the near plane so geometry behind the camera
   never wraps around to the wrong side of the screen. */
function hrPoly(pts){
  var vs = [], i;
  for(i=0; i<pts.length; i++) vs.push(hrView(pts[i]));
  var NEAR = 14, out = [];
  for(i=0; i<vs.length; i++){
    var a = vs[i], b = vs[(i+1)%vs.length];
    var ain = a.vz >= NEAR, bin = b.vz >= NEAR;
    if(ain) out.push(a);
    if(ain !== bin){
      var t = (NEAR - a.vz) / (b.vz - a.vz);
      out.push({vx:a.vx+(b.vx-a.vx)*t, vy:a.vy+(b.vy-a.vy)*t, vz:NEAR});
    }
  }
  if(out.length < 3) return null;
  return out.map(hrScreen);
}
function hrFill(pts, style){
  var s = hrPoly(pts);
  if(!s) return;
  hrCtx.beginPath();
  hrCtx.moveTo(s[0].x, s[0].y);
  for(var i=1;i<s.length;i++) hrCtx.lineTo(s[i].x, s[i].y);
  hrCtx.closePath();
  hrCtx.fillStyle = style;
  hrCtx.fill();
}
function hrRing(off, steps){
  var pts = [];
  for(var i=0;i<steps;i++){
    var a = i/steps * Math.PI*2;
    pts.push({x:(RX+off)*Math.cos(a), y:0, z:(RZ+off)*Math.sin(a)});
  }
  return pts;
}

/* ---- track geometry helpers ---- */
function hrBand(){                                    // inner/outer edge offsets
  var half = (hrCount-1) * LANE / 2;
  return {inner: -half - 9, outer: half + 9};
}
function laneOff(i){ return (i - (hrCount-1)/2) * LANE; }

/* An ellipse covers unequal ground per radian, so stepping theta linearly makes
   horses surge on the ends and crawl down the sides. These tables re-map even
   progress onto even ARC LENGTH, giving a constant ground speed all the way round. */
function arcTable(rx, rz){
  var n = 512, cum = [0], total = 0, prevX = rx, prevZ = 0, i;
  for(i=1;i<=n;i++){
    var a = i/n * Math.PI*2;
    var x = rx*Math.cos(a), z = rz*Math.sin(a);
    total += Math.sqrt((x-prevX)*(x-prevX) + (z-prevZ)*(z-prevZ));
    cum.push(total);
    prevX = x; prevZ = z;
  }
  var m = 256, table = [];
  for(var k=0;k<=m;k++){
    var target = total * k/m, lo = 0, hi = n;
    while(lo < hi){ var mid = (lo+hi) >> 1; if(cum[mid] < target) lo = mid+1; else hi = mid; }
    if(lo === 0){ table.push(0); continue; }
    var c0 = cum[lo-1], c1 = cum[lo];
    var f = c1 > c0 ? (target-c0)/(c1-c0) : 0;
    table.push(((lo-1)+f)/n * Math.PI*2);
  }
  return table;
}
function thetaAt(table, frac){
  frac = frac - Math.floor(frac);                      // wrap into one lap
  var m = table.length - 1, x = frac*m, i = Math.floor(x);
  if(i >= m) return table[m];
  return table[i] + (table[i+1]-table[i]) * (x-i);
}

function hrDrawTrack(){
  var band = hrBand(), steps = 120, i, a;
  /* track surface = outer ring forward, inner ring backward */
  var surface = [];
  for(i=0;i<=steps;i++){
    a = i/steps * Math.PI*2;
    surface.push({x:(RX+band.outer)*Math.cos(a), y:0, z:(RZ+band.outer)*Math.sin(a)});
  }
  for(i=steps;i>=0;i--){
    a = i/steps * Math.PI*2;
    surface.push({x:(RX+band.inner)*Math.cos(a), y:0, z:(RZ+band.inner)*Math.sin(a)});
  }
  hrFill(surface, "#8a5a3c");

  /* infield */
  hrFill(hrRing(band.inner, 90), "#123d24");

  /* lane separators */
  hrCtx.lineWidth = 1;
  hrCtx.strokeStyle = "rgba(255,255,255,.13)";
  for(var L=0; L<=hrCount; L++){
    var off = laneOff(0) - LANE/2 + L*LANE;
    var pts = hrRing(off, 90), scr = [], ok = true;
    for(i=0;i<pts.length;i++){
      var p = hrPoint(pts[i]);
      if(!p){ ok = false; break; }
      scr.push(p);
    }
    if(!ok) continue;
    hrCtx.beginPath();
    hrCtx.moveTo(scr[0].x, scr[0].y);
    for(i=1;i<scr.length;i++) hrCtx.lineTo(scr[i].x, scr[i].y);
    hrCtx.closePath();
    hrCtx.stroke();
  }

  /* finish line — checkered strip across the track at theta = 0 */
  var n = 10, w = 0.055;
  for(i=0;i<n;i++){
    var o0 = band.inner + (band.outer-band.inner) * (i/n);
    var o1 = band.inner + (band.outer-band.inner) * ((i+1)/n);
    hrFill([
      {x:(RX+o0)*Math.cos(-w), y:0.3, z:(RZ+o0)*Math.sin(-w)},
      {x:(RX+o1)*Math.cos(-w), y:0.3, z:(RZ+o1)*Math.sin(-w)},
      {x:(RX+o1)*Math.cos(w),  y:0.3, z:(RZ+o1)*Math.sin(w)},
      {x:(RX+o0)*Math.cos(w),  y:0.3, z:(RZ+o0)*Math.sin(w)}
    ], i%2 ? "#f4f4f4" : "#1a1a1a");
  }

  /* rails */
  [band.inner, band.outer].forEach(function(off){
    var steps2 = 56, prevTop = null, prevOk = false;
    hrCtx.lineWidth = 1.4;
    for(i=0;i<=steps2;i++){
      a = i/steps2 * Math.PI*2;
      var base = {x:(RX+off)*Math.cos(a), y:0,  z:(RZ+off)*Math.sin(a)};
      var top  = {x:(RX+off)*Math.cos(a), y:9, z:(RZ+off)*Math.sin(a)};
      var pb = hrPoint(base), pt = hrPoint(top);
      if(pb && pt){
        hrCtx.strokeStyle = "rgba(240,235,225,.5)";
        hrCtx.beginPath(); hrCtx.moveTo(pb.x, pb.y); hrCtx.lineTo(pt.x, pt.y); hrCtx.stroke();
        if(prevOk && prevTop){
          hrCtx.strokeStyle = "rgba(240,235,225,.32)";
          hrCtx.beginPath(); hrCtx.moveTo(prevTop.x, prevTop.y); hrCtx.lineTo(pt.x, pt.y); hrCtx.stroke();
        }
        prevTop = pt; prevOk = true;
      }else{
        prevOk = false;
      }
    }
  });
}

function hrDrawHorse(h){
  var rx = RX + h.off, rz = RZ + h.off;
  var pos  = {x: rx*Math.cos(h.theta), y:0, z: rz*Math.sin(h.theta)};
  var pg = hrPoint(pos);
  if(!pg) return null;
  var ahead = {x: rx*Math.cos(h.theta+0.05), y:0, z: rz*Math.sin(h.theta+0.05)};
  var pf = hrPoint(ahead);
  var pt = hrPoint({x:pos.x, y:20, z:pos.z});
  if(!pf || !pt) return null;

  var upx = pt.x-pg.x, upy = pt.y-pg.y;
  var upLen = Math.sqrt(upx*upx + upy*upy) || 1;
  var s = upLen / 20;                                  // px per world unit
  var ang = Math.atan2(pf.y-pg.y, pf.x-pg.x);

  return {vz: pg.vz, draw: function(){
    var ctx = hrCtx;
    var gp = h.legPhase;
    /* the whole body lifts twice per stride, like a real gallop */
    var bob = Math.sin(gp*2) * 0.55;

    /* shadow — stays on the ground, tightens as the horse lifts */
    ctx.save();
    ctx.globalAlpha = 0.3 - Math.max(0, bob)*0.06;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(pg.x, pg.y, 12*s, 4.2*s, ang, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(pg.x + upx*(0.60 + bob*0.02), pg.y + upy*(0.60 + bob*0.02));
    ctx.rotate(ang);
    /* Rotating alone flips the horse over whenever it runs "backwards" across
       the screen, so mirror the local Y axis when local-up stops agreeing with
       the projected world-up. The horse then faces its heading and stays upright. */
    if(Math.sin(ang)*upx - Math.cos(ang)*upy < 0) ctx.scale(1, -1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    var coat = h.coat, dark = h.coatDark, hoof = "#241a14";

    /* two-jointed leg: shoulder/hip -> knee -> fetlock -> hoof */
    function leg(px, py, phase, len, col){
      var swing = Math.sin(phase);
      var fold  = Math.max(0, Math.sin(phase + 1.15));
      var upperA = swing * 0.85 - 0.12;
      var lowerA = upperA + fold * 1.25 + 0.18;
      var kx = px + Math.sin(upperA)*len*0.52, ky = py + Math.cos(upperA)*len*0.52;
      var fx = kx + Math.sin(lowerA)*len*0.48, fy = ky + Math.cos(lowerA)*len*0.48;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.3*s;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.lineWidth = 1.5*s;
      ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = hoof;
      ctx.beginPath(); ctx.ellipse(fx, fy, 1.5*s, 1.1*s, lowerA, 0, Math.PI*2); ctx.fill();
    }

    /* far-side pair first, shaded down so it reads as depth */
    leg(-7.0*s, 2.6*s, gp + 0.5, 11*s, dark);
    leg( 6.2*s, 2.4*s, gp + 3.3, 11*s, dark);

    /* tail */
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.6*s;
    ctx.beginPath();
    ctx.moveTo(-10.5*s, -2.2*s);
    ctx.quadraticCurveTo(-15.5*s, -1.5*s + Math.sin(gp)*1.6*s, -17*s, 3.2*s);
    ctx.stroke();
    ctx.lineWidth = 1.4*s;
    ctx.beginPath();
    ctx.moveTo(-10.5*s, -1.6*s);
    ctx.quadraticCurveTo(-14.5*s, 0.5*s + Math.sin(gp+1)*1.2*s, -15.5*s, 4.4*s);
    ctx.stroke();

    /* body: croup -> back -> withers -> chest -> belly -> rump */
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(-11*s, -1.8*s);
    ctx.bezierCurveTo(-10.4*s, -5.6*s, -5*s, -6.4*s, 1*s, -6.0*s);
    ctx.bezierCurveTo(4*s, -5.9*s, 6.2*s, -5.6*s, 8.2*s, -5.2*s);
    ctx.bezierCurveTo(9.2*s, -3.4*s, 9.6*s, -0.6*s, 8.6*s, 2.2*s);
    ctx.bezierCurveTo(6*s, 4.6*s, -1*s, 5.0*s, -7*s, 4.2*s);
    ctx.bezierCurveTo(-10*s, 3.6*s, -11.6*s, 1.2*s, -11*s, -1.8*s);
    ctx.closePath();
    ctx.fill();

    /* belly shading */
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,.20)";
    ctx.beginPath();
    ctx.ellipse(-1*s, 5.4*s, 11*s, 4.2*s, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    /* neck + head */
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(7.0*s, -5.0*s);
    ctx.bezierCurveTo(10.6*s, -6.8*s, 12.8*s, -9.4*s, 14.2*s, -11.8*s);
    ctx.lineTo(17.2*s, -13.2*s);
    ctx.bezierCurveTo(19.4*s, -13.8*s, 20.4*s, -12.2*s, 19.2*s, -10.7*s);
    ctx.lineTo(15.8*s, -9.6*s);
    ctx.bezierCurveTo(13.2*s, -7.6*s, 11.0*s, -4.8*s, 9.4*s, -3.0*s);
    ctx.closePath();
    ctx.fill();

    /* muzzle + eye */
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(19.4*s, -11.6*s, 1.5*s, 1.1*s, -0.3, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = "#100c0a";
    ctx.beginPath();
    ctx.arc(16.6*s, -12.0*s, 0.62*s, 0, Math.PI*2);
    ctx.fill();

    /* ears */
    ctx.fillStyle = dark;
    [[15.4, -13.4], [16.4, -13.6]].forEach(function(e){
      ctx.beginPath();
      ctx.moveTo(e[0]*s, e[1]*s);
      ctx.lineTo((e[0]+0.35)*s, (e[1]-2.3)*s);
      ctx.lineTo((e[0]+1.15)*s, (e[1]-0.35)*s);
      ctx.closePath();
      ctx.fill();
    });

    /* mane along the crest */
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.7*s;
    ctx.beginPath();
    ctx.moveTo(8.0*s, -5.6*s);
    ctx.bezierCurveTo(11.0*s, -7.6*s, 13.2*s, -10.2*s, 14.8*s, -12.6*s);
    ctx.stroke();

    /* saddle cloth in the runner's silks */
    ctx.fillStyle = h.silk;
    ctx.beginPath();
    ctx.moveTo(-1.5*s, -5.6*s);
    ctx.lineTo(4.5*s, -5.2*s);
    ctx.lineTo(4.2*s, -0.6*s);
    ctx.lineTo(-1.8*s, -1.0*s);
    ctx.closePath();
    ctx.fill();

    /* jockey crouched over the withers */
    ctx.fillStyle = h.silk;
    ctx.beginPath();
    ctx.ellipse(1.6*s, -9.0*s + bob*0.5*s, 4.2*s, 2.9*s, -0.42, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = h.silk;
    ctx.lineWidth = 1.7*s;
    ctx.beginPath();
    ctx.moveTo(3.6*s, -8.6*s + bob*0.5*s);
    ctx.lineTo(8.2*s, -7.2*s);
    ctx.stroke();
    ctx.strokeStyle = "#2a2320";                       // boot
    ctx.lineWidth = 1.9*s;
    ctx.beginPath();
    ctx.moveTo(0.4*s, -7.6*s + bob*0.5*s);
    ctx.lineTo(0.0*s, -3.6*s);
    ctx.stroke();
    ctx.fillStyle = "#15110f";                         // helmet
    ctx.beginPath();
    ctx.arc(5.0*s, -11.0*s + bob*0.5*s, 2.2*s, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = h.silk;
    ctx.beginPath();
    ctx.arc(4.6*s, -11.4*s + bob*0.5*s, 1.5*s, 0, Math.PI*2);
    ctx.fill();

    /* near-side legs last so they sit in front of the body */
    leg(-7.6*s, 2.6*s, gp, 11.5*s, coat);
    leg( 6.8*s, 2.4*s, gp + 2.8, 11.5*s, coat);

    ctx.restore();

    /* saddle-cloth number, kept upright so it stays readable */
    var br = Math.max(6, Math.min(14, 6*s));
    var bx = pg.x + upx*1.5, by = pg.y + upy*1.5;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI*2);
    ctx.fillStyle = h.silk;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + Math.round(br*1.15) + "px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(h.num), bx, by + 0.5);
  }};
}

/* ---- straight strip below the oval: live position of every runner ---- */
function hrDrawStrip(){
  if(!stripCtx || sW < 10) return;
  var ctx = stripCtx;
  ctx.clearRect(0, 0, sW, sH);

  var padL = 26, padR = 20, top = 8;
  var usable = Math.max(20, sW - padL - padR);
  var rowH = (sH - top*2) / Math.max(1, hrCount);

  /* dirt */
  ctx.fillStyle = "#7c5238";
  ctx.fillRect(padL, top, usable, sH - top*2);

  /* lanes */
  for(var i=0;i<hrCount;i++){
    var y = top + i*rowH;
    if(i % 2) { ctx.fillStyle = "rgba(0,0,0,.11)"; ctx.fillRect(padL, y, usable, rowH); }
    if(horses[i] && horses[i].num === hrPick){
      ctx.fillStyle = "rgba(var(--gold-rgb),.0)";
      ctx.fillStyle = "rgba(232,194,100,.13)";
      ctx.fillRect(padL, y, usable, rowH);
    }
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y+0.5); ctx.lineTo(padL+usable, y+0.5); ctx.stroke();
  }

  /* lap markers */
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.setLineDash([3,3]);
  for(var L=1; L<hrLaps; L++){
    var lx = padL + usable * (L/hrLaps);
    ctx.beginPath(); ctx.moveTo(lx, top); ctx.lineTo(lx, sH-top); ctx.stroke();
  }
  ctx.setLineDash([]);

  /* start + checkered finish */
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.fillRect(padL, top, 2, sH - top*2);
  var cell = Math.max(4, rowH/2), fx = padL + usable - 8;
  for(var cy=0, row=0; cy < sH - top*2; cy += cell, row++){
    for(var c=0;c<2;c++){
      ctx.fillStyle = ((row + c) % 2) ? "#f2f2f2" : "#181818";
      ctx.fillRect(fx + c*4, top + cy, 4, Math.min(cell, sH - top - (top+cy)));
    }
  }

  /* runners */
  horses.forEach(function(h, idx){
    var cy = top + idx*rowH + rowH/2;
    var x = padL + usable * h.p;
    var r = Math.max(5, Math.min(9, rowH*0.36));

    /* lane number in the gutter */
    ctx.fillStyle = h.silk;
    ctx.font = "700 10px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(h.num), padL/2 + 2, cy);

    /* speed trail */
    if(hrRacing && h.p > 0 && h.p < 1){
      var grad = ctx.createLinearGradient(x-22, 0, x, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, h.silk);
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.5, r*0.5);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(Math.max(padL, x-22), cy); ctx.lineTo(x, cy); ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI*2);
    ctx.fillStyle = h.silk;
    ctx.fill();
    ctx.lineWidth = h.num === hrPick ? 2 : 1;
    ctx.strokeStyle = h.num === hrPick ? "#e8c264" : "rgba(0,0,0,.55)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + Math.round(r*1.15) + "px Segoe UI, system-ui, sans-serif";
    ctx.fillText(String(h.num), x, cy + 0.5);
  });
}

function hrRender(){
  hrCtx.clearRect(0, 0, hrW, hrH);
  /* grass */
  var g = hrCtx.createLinearGradient(0, 0, 0, hrH);
  g.addColorStop(0, "#0d3a22");
  g.addColorStop(1, "#061a10");
  hrCtx.fillStyle = g;
  hrCtx.fillRect(0, 0, hrW, hrH);

  hrUpdateBasis();
  hrDrawTrack();

  var drawables = [];
  horses.forEach(function(h){
    var d = hrDrawHorse(h);
    if(d) drawables.push(d);
  });
  drawables.sort(function(a,b){ return b.vz - a.vz; });   // far to near
  drawables.forEach(function(d){ d.draw(); });
}

/* ---- standings overlay ---- */
function hrBoard(){
  var order = horses.slice().sort(function(a,b){ return b.p - a.p; });
  var rows = [], shown = Math.min(5, order.length), i;
  for(i=0;i<shown;i++){
    var h = order[i];
    rows.push('<div class="rb-row' + (h.num === hrPick ? ' rb-you' : '') + '">' +
      (i+1) + '. <span class="rb-dot" style="background:' + h.silk + '"></span>#' + h.num +
      (h.num === hrPick ? ' (you)' : '') + '</div>');
  }
  var mine = order.findIndex(function(h){ return h.num === hrPick; });
  if(mine >= shown){
    rows.push('<div class="rb-row rb-you">' + (mine+1) + '. <span class="rb-dot" style="background:' +
      order[mine].silk + '"></span>#' + hrPick + ' (you)</div>');
  }
  $("raceBoard").innerHTML = rows.join("");
}

/* ---- runners ---- */
function buildHorses(){
  horses = [];
  for(var i=0;i<hrCount;i++){
    var coat = COATS[i % COATS.length];
    var off = laneOff(i);
    horses.push({
      num: i+1, silk: SILKS[i % SILKS.length], coat: coat, coatDark: shade(coat, 0.62),
      off: off, arc: arcTable(RX+off, RZ+off),
      p: 0, theta: 0, legPhase: Math.random()*6, t: 0, amp: 0, w: 0, ph: 0
    });
  }
  /* The strip keeps a constant height and divides it into however many lanes
     are running. Sizing it per runner used to grow the canvas by ~96px when you
     went from 6 runners to 12, shoving every control below it down the page
     mid-session. hrDrawStrip already derives lane height from the canvas, so
     fewer runners simply get taller lanes. */
  hrResize();
  renderHorsePick();
  hrBoard();
}
function renderHorsePick(){
  var wrap = $("horsePick");
  wrap.innerHTML = horses.map(function(h){
    return '<button class="horse-btn' + (h.num === hrPick ? ' sel' : '') + '" data-h="' + h.num +
           '" style="background:' + h.silk + '">' + h.num + '</button>';
  }).join("");
  Array.prototype.forEach.call(wrap.querySelectorAll(".horse-btn"), function(b){
    b.addEventListener("click", function(){
      if(hrRacing) return;
      playChip();
      hrPick = Number(b.dataset.h);
      renderHorsePick();
      hrBoard();
    });
  });
}
function hrOddsVal(){ return Math.round(hrCount * 0.9 * 10) / 10; }
function syncHorseUI(){
  $("hrCountVal").textContent = hrCount;
  $("hrLapVal").textContent = hrLaps;
  $("hrOdds").textContent = hrOddsVal() + "x";
  $("hrMinus").disabled    = hrRacing || hrCount <= 3;
  $("hrPlus").disabled     = hrRacing || hrCount >= 12;
  $("hrLapMinus").disabled = hrRacing || hrLaps <= 1;
  $("hrLapPlus").disabled  = hrRacing || hrLaps >= 6;
  $("hrQuick").disabled    = hrRacing;
  $("hrRace").disabled     = hrRacing;
}
function setCount(n){
  hrCount = Math.max(3, Math.min(12, n));
  if(hrPick > hrCount) hrPick = hrCount;
  buildHorses();
  syncHorseUI();
}
function setLaps(n){
  hrLaps = Math.max(1, Math.min(6, n));
  horses.forEach(function(h){ h.p = 0; h.theta = 0; });
  syncHorseUI();
  hrBoard();
}
$("hrMinus").addEventListener("click", function(){ playClick(); setCount(hrCount-1); });
$("hrPlus").addEventListener("click", function(){ playClick(); setCount(hrCount+1); });
$("hrLapMinus").addEventListener("click", function(){ playClick(); setLaps(hrLaps-1); });
$("hrLapPlus").addEventListener("click", function(){ playClick(); setLaps(hrLaps+1); });
$("hrQuick").addEventListener("change", function(){
  hrQuick = this.checked;
  playClick();
});

var hrBtns = chipRow($("tab-horse"), null, function(v){
  hrStake = v;
  $("hrStake").textContent = fmt(hrStake);
}, null);
hrBtns[1].classList.add("sel");
$("hrClear").addEventListener("click", function(){
  hrStake = 5;
  $("hrStake").textContent = "5";
  Array.prototype.forEach.call(hrBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("hrCustom").value = "";
  $("hrCustom").classList.remove("sel");
});

/* ---- the race ---- */
$("hrRace").addEventListener("click", function(){
  if(hrRacing) return;
  if(hrStake > bank){ msg($("hrMsg"), "Not enough chips for that bet.", "lose"); return; }

  wager(hrStake, "horse");
  stats.hands++;

  /* Finishing order is decided up front so the rig commands can steer it; the
     wobble below only shuffles the running order mid-race, never the result. */
  var rigMode = rigRoll();
  var winIdx;
  if(rigMode === "user"){
    winIdx = hrPick - 1;
  }else if(rigMode === "host"){
    do { winIdx = rnd(hrCount); } while(hrCount > 1 && winIdx === hrPick - 1);
  }else{
    winIdx = rnd(hrCount);
  }
  hrWinner = winIdx + 1;

  var perLap = hrQuick ? 1.55 : 3.6;                   // seconds per lap
  var winT = perLap * hrLaps;
  horses.forEach(function(h, i){
    h.t = i === winIdx ? winT + Math.random()*perLap*0.08
                       : winT + perLap*0.09 + Math.random()*perLap*0.55;
    h.p = 0; h.prevP = 0; h.theta = 0;
    /* amp gives visible position swaps; w stays low so the speed those swaps
       imply is a gentle surge rather than a lurch. */
    h.amp = 0.03 + Math.random()*0.025;
    h.w   = (0.35 + Math.random()*0.35) * (hrQuick ? 2 : 1);
    h.ph  = Math.random()*6.28;
  });

  hrRacing = true; hrSettled = false; hrTime = 0; hrGallop = 0;
  syncHorseUI();
  msg($("hrMsg"), "And they're off! " + hrLaps + (hrLaps === 1 ? " lap." : " laps."), "info");
});

function hrSettle(){
  hrSettled = true;
  var won = hrWinner === hrPick;
  if(won){
    var ret = Math.floor(hrStake * hrOddsVal());
    payout(ret, "horse");
    playWin(hrOddsVal() >= 8 ? "jackpot" : "big");
    setTimeout(playCoin, 90);
    msg($("hrMsg"), "#" + hrWinner + " wins! You collect " + fmt(ret) + " chips.", "win");
  }else{
    playLose();
    msg($("hrMsg"), "#" + hrWinner + " takes it. Your #" + hrPick + " didn't get there.", "lose");
  }
}

function hrStep(dt){
  if(!hrRacing) return;
  hrTime += dt;
  var allDone = true, maxT = 0;
  horses.forEach(function(h){
    maxT = Math.max(maxT, h.t);
    var base = hrTime / h.t;
    var wob  = h.amp * Math.sin(h.w*hrTime + h.ph) * Math.max(0, 1 - base);
    h.p = Math.max(0, Math.min(1, base + wob));
    h.theta = thetaAt(h.arc, h.p * hrLaps);
    /* stride rate follows the horse's actual pace, so a surging horse's legs
       speed up with it instead of sliding */
    var rate = dt > 0 ? ((h.p - (h.prevP || 0)) / dt) * h.t : 1;
    h.prevP = h.p;
    rate = Math.max(0.45, Math.min(1.8, rate || 1));
    h.legPhase += dt * (h.p < 1 ? (hrQuick ? 24 : 15) * rate : 3);
    if(h.p < 1) allDone = false;
  });

  hrGallop += dt;
  if(hrGallop > (hrQuick ? 0.13 : 0.2)){ hrGallop = 0; playSpinTick(); }

  if(!hrSettled){
    var w = horses[hrWinner-1];
    if(w && w.p >= 1) hrSettle();
  }
  if(allDone || hrTime > maxT + 0.4){
    hrRacing = false;
    syncHorseUI();
  }
  hrBoard();
}

/* ---- orbit controls ---- */
var hrDrag = null;
var wrapEl = $("trackWrap");
hrCanvas.addEventListener("pointerdown", function(e){
  hrDrag = {x:e.clientX, y:e.clientY};
  wrapEl.classList.add("dragging");
  hrCanvas.setPointerCapture(e.pointerId);
});
hrCanvas.addEventListener("pointermove", function(e){
  if(!hrDrag) return;
  hrCam.yaw   += (e.clientX - hrDrag.x) * 0.008;
  hrCam.pitch -= (e.clientY - hrDrag.y) * 0.006;
  hrCam.pitch = Math.max(0.12, Math.min(1.35, hrCam.pitch));
  hrDrag = {x:e.clientX, y:e.clientY};
});
function endDrag(){ hrDrag = null; wrapEl.classList.remove("dragging"); }
hrCanvas.addEventListener("pointerup", endDrag);
hrCanvas.addEventListener("pointercancel", endDrag);
hrCanvas.addEventListener("wheel", function(e){
  e.preventDefault();
  hrCam.dist = Math.max(240, Math.min(900, hrCam.dist + e.deltaY * 0.6));
}, {passive:false});

/* ---- frame loop ---- */
/* The canvases now flex to fill the viewport, so height changes on its own
   without the width moving — both dimensions have to be watched or the backing
   store goes stale and the scene renders stretched. */
/* w/h are the last size the canvas took up on screen, which is not the size it
   draws at any more — the two differ by whatever magnification fitGame's width
   left it at. */
function stale(canvas, w, h){
  var r = canvas.getBoundingClientRect();
  return Math.abs(r.width - w) > 1 || Math.abs(r.height - h) > 1;
}
function hrFrame(now){
  var dt = Math.min(0.05, (now - hrLast) / 1000 || 0);
  hrLast = now;
  if($("tab-horse").classList.contains("on")){
    if(hrCssW < 5 || stale(hrCanvas, hrCssW, hrCssH)) hrResize();
    hrStep(dt);
    hrRender();
    hrDrawStrip();
  }
  if($("tab-plinko").classList.contains("on")){
    if(pkCssW < 5 || stale(pkCanvas, pkCssW, pkCssH)) pkResize();
    pkStep(dt);
    pkRender();
  }
  if($("tab-flappy").classList.contains("on")){
    if(fbW < 5 || stale(fbCanvas, fbCssW, fbCssH)) fbResize();
    fbStep(dt);
    fbRender();
  }
  if($("tab-snake").classList.contains("on")){
    if(snCssW < 5 || stale(snCanvas, snCssW, snCssH)) snResize();
    snClock += dt;
    snStep(dt);
    snRender();
  }
  requestAnimationFrame(hrFrame);
}

setCount(hrCount);
hrResize();
requestAnimationFrame(hrFrame);

/* ================= PLINKO ================= */
var pkCanvas = $("plinkoCanvas"), pkCtx = pkCanvas.getContext("2d");
var pkW = 700, pkH = 420;
var PK_VIEW = 860, pkCssW = 0, pkCssH = 0;           /* the width the board is drawn for */
var pkRows = 12, pkRisk = "medium", pkStake = 25;
var pkMults = [], pkBalls = [], pkFlash = {}, pkHits = {}, pkClock = 0;
var pkBallCount = 1;
/* Balls queued by a multi-drop, released one per PK_STAGGER so they cascade
   down the board instead of landing on top of each other. Each entry is a
   reference to the burst it belongs to, so overlapping bursts stay separate. */
var pkPending = [], pkQueueTimer = 0, PK_STAGGER = 0.07;
/* Sound throttles — 50 balls x 16 pegs would otherwise fire hundreds of
   oscillators a second and turn the audio to mush. */
var pkLastChip = -9, pkLastPeg = -9;

/* C(n,k) / 2^n — the chance of finishing in bucket k, done in log space so the
   binomial coefficient doesn't overflow at high row counts. */
function pkBinom(n, k){
  var lg = 0;
  for(var i=1;i<=k;i++) lg += Math.log((n-k+i)/i);
  return Math.exp(lg - n*Math.LN2);
}
/* The edge multiplier is the design anchor, so we solve for the centre value
   that lands the whole table on a ~3% house edge instead of scaling the edges. */
function pkSolveCentre(N, edge, p){
  var lo = 0.005, hi = 1.2;
  for(var it=0; it<50; it++){
    var c = (lo+hi)/2, ev = 0;
    for(var i=0;i<=N;i++){
      var d = Math.abs(i - N/2) / (N/2);
      ev += pkBinom(N,i) * c * Math.pow(edge/c, Math.pow(d, p));
    }
    if(ev < 0.97) lo = c; else hi = c;
  }
  return (lo+hi)/2;
}
function pkBuildMults(){
  var N = pkRows;
  var cfg = {
    low:    {edge: 5.6 + (N-8)*1.3,  p:2.3},
    medium: {edge: 13  + (N-8)*11,   p:2.7},
    high:   {edge: 29  + (N-8)*121,  p:3.1}
  }[pkRisk];
  var centre = pkSolveCentre(N, cfg.edge, cfg.p);
  pkMults = [];
  for(var i=0;i<=N;i++){
    var d = Math.abs(i - N/2) / (N/2);
    var m = centre * Math.pow(cfg.edge/centre, Math.pow(d, cfg.p));
    pkMults.push(m >= 10 ? Math.round(m) : Math.round(m*100)/100);
  }
}
function pkMultText(m){
  return (m >= 10 ? m : (m >= 1 ? m.toFixed(1) : m.toFixed(2))) + "x";
}
/* hue ramp: cool in the safe middle, hot out at the rare edges */
function pkBucketColour(i){
  var d = Math.abs(i - pkRows/2) / (pkRows/2);
  return "hsl(" + Math.round(190 - 190*Math.pow(d, 0.8)) + ",72%," + Math.round(46 + 10*d) + "%)";
}

function pkResize(){
  if(!pkCanvas) return;
  var rect = pkCanvas.getBoundingClientRect();
  if(!rect.width) return;
  var dpr = window.devicePixelRatio || 1;
  /* Same deal as the racecourse: past PK_VIEW the board is magnified rather
     than surrounded by more empty sky. */
  var z = Math.max(1, rect.width / PK_VIEW);
  pkW = rect.width / z; pkH = rect.height / z;
  pkCssW = rect.width; pkCssH = rect.height;
  pkCanvas.width = Math.round(rect.width*dpr);
  pkCanvas.height = Math.round(rect.height*dpr);
  pkCtx.setTransform(dpr*z, 0, 0, dpr*z, 0, 0);
}

/* board geometry, recomputed each frame so it tracks canvas resizes */
function pkGeo(){
  var N = pkRows, pad = 16, bucketH = 34;
  var availW = pkW - pad*2;
  var availH = pkH - pad - bucketH - 14;
  var S = Math.min(availW/(N+1), (availH/(N+0.9))/0.86, 36);
  var V = S*0.86;
  return {N:N, S:S, V:V, cx:pkW/2, topY: pad + V*0.9, bucketH:bucketH};
}
function pkPegPos(g, r, j){
  return {x: g.cx + (j - r/2)*g.S, y: g.topY + r*g.V};
}

function pkRender(){
  pkCtx.clearRect(0, 0, pkW, pkH);
  var g = pkGeo(), N = g.N, r, j;

  var bg = pkCtx.createLinearGradient(0, 0, 0, pkH);
  bg.addColorStop(0, "#0e2036");
  bg.addColorStop(1, "#050b12");
  pkCtx.fillStyle = bg;
  pkCtx.fillRect(0, 0, pkW, pkH);

  /* pegs */
  for(r=0; r<N; r++){
    for(j=0; j<=r; j++){
      var p = pkPegPos(g, r, j);
      var hit = pkFlash[r+":"+j];
      var age = hit === undefined ? 9 : pkClock - hit;
      var lit = Math.max(0, 1 - age/0.32);
      var rad = Math.max(1.6, g.S*0.10) * (1 + lit*0.5);
      if(lit > 0){
        pkCtx.beginPath();
        pkCtx.arc(p.x, p.y, rad*2.6, 0, Math.PI*2);
        pkCtx.fillStyle = "rgba(255,238,180," + (lit*0.22) + ")";
        pkCtx.fill();
      }
      pkCtx.beginPath();
      pkCtx.arc(p.x, p.y, rad, 0, Math.PI*2);
      pkCtx.fillStyle = lit > 0 ? "#fff6d5" : "rgba(226,236,255,.82)";
      pkCtx.fill();
    }
  }

  /* buckets */
  var by = g.topY + N*g.V + 8;
  var bw = g.S*0.94;
  for(j=0; j<=N; j++){
    var bx = g.cx + (j - N/2)*g.S;
    var pop = pkHits[j] === undefined ? 0 : Math.max(0, 1 - (pkClock - pkHits[j])/0.5);
    var h = g.bucketH + pop*5;
    pkCtx.fillStyle = pkBucketColour(j);
    pkCtx.globalAlpha = pop > 0 ? 1 : 0.9;
    pkCtx.beginPath();
    if(pkCtx.roundRect) pkCtx.roundRect(bx-bw/2, by - pop*3, bw, h, 6);
    else pkCtx.rect(bx-bw/2, by - pop*3, bw, h);
    pkCtx.fill();
    pkCtx.globalAlpha = 1;
    if(pop > 0){
      pkCtx.lineWidth = 2;
      pkCtx.strokeStyle = "rgba(255,255,255," + (0.35+pop*0.5) + ")";
      pkCtx.stroke();
    }
    pkCtx.fillStyle = "rgba(0,0,0,.82)";
    pkCtx.font = "700 " + Math.max(8, Math.min(12, bw*0.30)) + "px Segoe UI, system-ui, sans-serif";
    pkCtx.textAlign = "center";
    pkCtx.textBaseline = "middle";
    pkCtx.fillText(pkMultText(pkMults[j]), bx, by + h/2 - pop*3);
  }

  /* ball */
  var br = Math.max(3.5, g.S*0.26);
  pkBalls.forEach(function(ball){
    var fade = ball.done ? Math.max(0, 1 - (pkClock - ball.doneAt)/0.9) : 1;
    if(fade <= 0) return;
    pkCtx.globalAlpha = fade;
    pkCtx.beginPath();
    pkCtx.arc(ball.x, ball.y, br*2.2, 0, Math.PI*2);
    pkCtx.fillStyle = "rgba(255,214,106,.16)";
    pkCtx.fill();
    var grd = pkCtx.createRadialGradient(ball.x - br*0.35, ball.y - br*0.35, br*0.15, ball.x, ball.y, br);
    grd.addColorStop(0, "#fff4cf");
    grd.addColorStop(1, "#e8a53c");
    pkCtx.beginPath();
    pkCtx.arc(ball.x, ball.y, br, 0, Math.PI*2);
    pkCtx.fillStyle = grd;
    pkCtx.fill();
    pkCtx.globalAlpha = 1;
  });

  /* how many are still in the air */
  var live = 0;
  pkBalls.forEach(function(b){ if(!b.done) live++; });
  if(live > 1){
    pkCtx.fillStyle = "rgba(var(--cream-rgb),.55)";
    pkCtx.fillStyle = "rgba(236,244,255,.5)";
    pkCtx.font = "700 11px Segoe UI, system-ui, sans-serif";
    pkCtx.textAlign = "left";
    pkCtx.textBaseline = "top";
    pkCtx.fillText(live + " balls in play", 12, 10);
  }
}

function pkStep(dt){
  pkClock += dt;

  /* release any queued balls, one per stagger interval */
  if(pkPending.length){
    pkQueueTimer -= dt;
    while(pkPending.length && pkQueueTimer <= 0){
      if(!pkSpawnBall(pkPending[0])){
        pkPending = [];
        msg($("pkMsg"), "Ran out of chips — remaining balls cancelled.", "lose");
        break;
      }
      pkPending.shift();
      pkQueueTimer += PK_STAGGER;
    }
    syncPlinkoUI();
  }
  var g = pkGeo(), settledAny = false;
  pkBalls.forEach(function(ball){
    if(ball.done) return;
    ball.t += dt / ball.segDur;

    while(ball.t >= 1 && ball.seg <= ball.path.length){
      ball.t -= 1;
      ball.seg++;
      var r = ball.seg - 1;                            // peg row just struck
      if(r >= 0 && r < ball.rows){
        pkFlash[r + ":" + ball.col] = pkClock;
        if(pkClock - pkLastPeg > 0.025){
          pkLastPeg = pkClock;
          sfx(function(ctx, t){ tone(ctx, 900 + rnd(500), t, 0.035, "triangle", 0.03); });
        }
        ball.col += ball.path[r];
      }
      if(ball.seg > ball.path.length) break;
    }

    if(ball.seg > ball.rows){
      ball.done = true;
      ball.doneAt = pkClock;
      pkHits[ball.col] = pkClock;
      pkSettle(ball);
      settledAny = true;
      return;
    }

    /* interpolate between the current waypoint and the next */
    var a = pkWaypoint(g, ball, ball.seg);
    var b = pkWaypoint(g, ball, ball.seg + 1);
    var t = Math.max(0, Math.min(1, ball.t));
    ball.x = a.x + (b.x - a.x) * (t*t*(3-2*t));        // smoothstep sideways
    ball.y = a.y + (b.y - a.y) * Math.pow(t, 1.45);    // accelerating fall
  });

  /* retire faded-out balls so they can't pile up over a long session */
  if(pkBalls.length){
    pkBalls = pkBalls.filter(function(b){ return !b.done || pkClock - b.doneAt < 1.0; });
  }
  if(settledAny) syncPlinkoUI();
}
/* waypoint 0 = above the top peg, k = peg row k-1, N+1 = the bucket mouth */
function pkWaypoint(g, ball, k){
  if(k <= 0) return {x: g.cx, y: g.topY - g.V*0.95};
  var col = 0;
  for(var i=0; i<Math.min(k-1, ball.path.length); i++) col += ball.path[i];
  var r = k - 1, N = ball.rows;
  if(r >= N) return {x: g.cx + (col - N/2)*g.S, y: g.topY + N*g.V + 12};
  return {x: g.cx + (col - r/2)*g.S, y: g.topY + r*g.V};
}

/* Each ball carries the stake and paytable it was dropped under, so a ball
   already in the air settles on its own terms. */
function pkSettle(ball){
  var m = ball.mults[ball.col];
  var ret = Math.floor(ball.stake * m);
  var net = ret - ball.stake;
  if(ret > 0) payout(ret, "plinko");

  var burst = ball.burst;
  if(burst && burst.total > 1){
    /* Multi-drop: keep a running tally and report once, rather than letting
       50 individual results strobe through the message line. */
    burst.landed++;
    burst.returned += ret;
    if(m >= 10) playCoin();                            // still flag the rare big ones
    if(burst.landed >= burst.total){
      var bnet = burst.returned - burst.staked;
      if(bnet >= 0) playWin(bnet >= burst.staked ? "jackpot" : "big"); else playLose();
      msg($("pkMsg"), burst.total + " balls — staked " + fmt(burst.staked) +
          ", returned " + fmt(burst.returned) +
          " (" + (bnet >= 0 ? "+" : "") + fmt(bnet) + ").", bnet >= 0 ? "win" : "lose");
    }else{
      msg($("pkMsg"), burst.landed + " of " + burst.total + " landed — returned " +
          fmt(burst.returned) + " so far.", "info");
    }
    return;
  }

  if(net > 0){
    playWin(m >= 20 ? "jackpot" : m >= 3 ? "big" : "small");
    if(m >= 3) setTimeout(playCoin, 90);
    msg($("pkMsg"), pkMultText(m) + " — returned " + fmt(ret) + " chips (+" + fmt(net) + ").", "win");
  }else{
    playLose();
    msg($("pkMsg"), pkMultText(m) + " — returned " + fmt(ret) + " chips (" + fmt(net) + ").", "lose");
  }
}

function pkAirborne(){
  for(var i=0;i<pkBalls.length;i++) if(!pkBalls[i].done) return true;
  return false;
}
function syncPlinkoUI(){
  /* Drop is never gated — you can stack up as many balls as you can click for.
     Board shape stays locked while anything is falling, since changing it would
     invalidate the paths already in flight. */
  var flying = pkAirborne() || pkPending.length > 0;
  $("pkRowsVal").textContent = pkRows;
  $("pkMinus").disabled = flying || pkRows <= 8;
  $("pkPlus").disabled  = flying || pkRows >= 16;
  $("pkDrop").disabled  = false;
  $("pkDrop").textContent = pkBallCount === 1 ? "Drop" : "Drop " + pkBallCount;
  Array.prototype.forEach.call(document.querySelectorAll("#pkRiskSeg button"), function(b){
    b.classList.toggle("on", b.dataset.risk === pkRisk);
    b.disabled = flying;
  });
  Array.prototype.forEach.call(document.querySelectorAll("#pkCountSeg button"), function(b){
    b.classList.toggle("on", Number(b.dataset.n) === pkBallCount);
  });
}
function setRows(n){
  pkRows = Math.max(8, Math.min(16, n));
  pkBuildMults();
  pkFlash = {}; pkHits = {}; pkBalls = []; pkPending = [];
  syncPlinkoUI();
}
$("pkMinus").addEventListener("click", function(){ playClick(); setRows(pkRows-1); });
$("pkPlus").addEventListener("click", function(){ playClick(); setRows(pkRows+1); });
Array.prototype.forEach.call(document.querySelectorAll("#pkCountSeg button"), function(b){
  b.addEventListener("click", function(){
    playClick();
    pkBallCount = Number(b.dataset.n);
    syncPlinkoUI();
  });
});
Array.prototype.forEach.call(document.querySelectorAll("#pkRiskSeg button"), function(b){
  b.addEventListener("click", function(){
    playClick();
    pkRisk = b.dataset.risk;
    pkBuildMults();
    pkHits = {};
    syncPlinkoUI();
  });
});

var pkBtns = chipRow($("tab-plinko"), null, function(v){
  pkStake = v;
  $("pkStake").textContent = fmt(pkStake);
}, null);
pkBtns[1].classList.add("sel");
$("pkClear").addEventListener("click", function(){
  pkStake = 5;
  $("pkStake").textContent = "5";
  Array.prototype.forEach.call(pkBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("pkCustom").value = "";
  $("pkCustom").classList.remove("sel");
});

/* Spawns one ball for the given burst. Returns false if it can't be afforded,
   which cancels whatever is left of that burst. */
function pkSpawnBall(burst){
  if(pkStake > bank) return false;

  wager(pkStake, "plinko");
  stats.hands++;
  burst.staked += pkStake;

  /* Bucket is chosen first so the rig can steer it, then a path of lefts and
     rights that adds up to that bucket is shuffled into place. */
  var N = pkRows, target, i;
  var rigMode = rigRoll();
  if(rigMode === "user"){
    var best = 0;
    for(i=0;i<=N;i++) if(pkMults[i] > pkMults[best]) best = i;
    target = (best === 0 || best === N) ? (Math.random() < 0.5 ? 0 : N) : best;
  }else if(rigMode === "host"){
    var worst = 0;
    for(i=0;i<=N;i++) if(pkMults[i] < pkMults[worst]) worst = i;
    target = worst;
  }else{
    target = 0;
    for(i=0;i<N;i++) target += (Math.random() < 0.5 ? 0 : 1);
  }

  var path = [];
  for(i=0;i<N;i++) path.push(i < target ? 1 : 0);
  for(i=path.length-1; i>0; i--){                      // Fisher-Yates
    var j = rnd(i+1), tmp = path[i]; path[i] = path[j]; path[j] = tmp;
  }

  var g = pkGeo();
  pkBalls.push({
    path:path, rows:N, seg:0, t:0, col:0, done:false, doneAt:0,
    x: g.cx, y: g.topY - g.V*0.95,
    stake: pkStake, mults: pkMults.slice(), burst: burst,
    segDur: Math.max(0.055, 0.115 - N*0.002)
  });
  if(pkClock - pkLastChip > 0.12){ pkLastChip = pkClock; playChip(); }
  return true;
}

$("pkDrop").addEventListener("click", function(){
  var n = pkBallCount, cost = pkStake * n;
  if(cost > bank){
    msg($("pkMsg"), "Not enough chips for " + n + (n === 1 ? " ball" : " balls") +
        " — that needs " + fmt(cost) + ".", "lose");
    return;
  }
  var burst = {total:n, landed:0, staked:0, returned:0};
  for(var i=0;i<n;i++) pkPending.push(burst);
  pkQueueTimer = 0;
  msg($("pkMsg"), n === 1 ? "Dropping…" : "Dropping " + n + " balls…", "info");
  syncPlinkoUI();
});

setRows(pkRows);
pkResize();

/* ================= FLAPPY ================= */
/* A crash game wearing a flappy-bird costume: the stake is spent on take-off and
   every pipe cleared compounds the multiplier, so the only decision that matters
   is when to bail out. Clipping anything forfeits the lot. */
var fbCanvas = $("flappyCanvas"), fbCtx = fbCanvas.getContext("2d");
var fbW = 700, fbH = 420;
var fbStake = 25;
var fbState = "idle";                                  // idle | flying | dead
var fbBirdY = 0, fbBirdV = 0;
var fbPipes = [], fbPassed = 0, fbMult = 0.5;
var fbClock = 0, fbDeadAt = 0, fbScroll = 0, fbRig = 1, fbFlight = 0;

var FB_GRAV = 1500, FB_FLAP = -430, FB_R = 13;
var FB_PIPE_W = 58, FB_SPACING = 232, FB_GROUND = 26;
var FB_STEP = 1.12;                                    // each pipe compounds by this much
var FB_MULT0 = 0.5;                                    // bail out too early and you take a haircut
/* On a phone the canvas is far narrower than on a desktop, which left barely a
   pipe of warning. Below this width we zoom the camera out — the world keeps
   its own coordinates and we scale the drawing down to fit, so a narrow screen
   shows the same distance ahead instead of less. */
var FB_MIN_VIEW = 560;
var FB_VIEW_H = 420;                                   // a taller sky than this magnifies instead
var FB_PLAY_H = 420;                                   // playable band height, matching desktop
var fbScale = 1, fbCssW = 0, fbCssH = 0;

function fbResize(){
  if(!fbCanvas) return;
  var rect = fbCanvas.getBoundingClientRect();
  if(!rect.width) return;
  var dpr = window.devicePixelRatio || 1;
  fbCssW = rect.width; fbCssH = rect.height;           // on-screen size, for the staleness check
  /* Two scales, stacked. The first keeps the climb the same game whatever shape
     the sky is: the world stays FB_VIEW_H tall and is drawn to fit, so a short
     window is a smaller picture of the same flight rather than a narrower gap
     to thread. The second is the phone rule — below FB_MIN_VIEW across, zoom out
     so there is still a useful distance of warning. */
  var mag = Math.max(0.7, rect.height / FB_VIEW_H);
  var cw = rect.width / mag, ch = rect.height / mag;
  fbCanvas.width  = Math.round(rect.width*dpr);
  fbCanvas.height = Math.round(rect.height*dpr);
  fbScale = cw < FB_MIN_VIEW ? cw/FB_MIN_VIEW : 1;
  fbW = cw / fbScale;                                  // logical world size
  fbH = ch / fbScale;
  fbCtx.setTransform(dpr*fbScale*mag, 0, 0, dpr*fbScale*mag, 0, 0);
}

function fbFloor(){ return fbH - FB_GROUND; }
/* Zooming out makes the world taller as well as wider, which would scatter the
   pipe openings over three times the vertical range on a phone. Gameplay stays
   inside a fixed-height band sitting on the ground; anything above it is just
   extra sky, so a narrow screen sees further ahead without changing the climb. */
function fbCeil(){ return Math.max(0, fbFloor() - (FB_PLAY_H - FB_GROUND)); }
function fbBirdX(){ return Math.max(64, fbW*0.26); }
function fbMultText(){ return fbMult.toFixed(2) + "x"; }
function fbCashValue(){ return Math.floor(fbStake * fbMult); }

/* The board tightens as you go — that ramp is what eventually ends every run.
   Speed is driven mostly by seconds in the air rather than pipes cleared, so
   hanging around to farm the multiplier is exactly what kills you. */
function fbGap(){ return Math.max(90, 160*fbRig - fbPassed*3.2); }
function fbSpeed(){ return Math.min(560, 150 + fbFlight*10 + fbPassed*4); }

function fbSpawnPipe(){
  var ceil = fbCeil(), band = fbFloor() - ceil;
  var gap = Math.min(fbGap(), band - 60);
  var room = Math.max(24, band - gap - 76);
  fbPipes.push({x: fbW + FB_PIPE_W, top: ceil + 38 + Math.random()*room, gap: gap, scored: false});
}

function fbReset(){
  fbBirdY = fbCeil() + (fbFloor() - fbCeil())*0.42;
  fbBirdV = 0;
  fbPipes = [];
  fbPassed = 0;
  fbMult = FB_MULT0;
  fbFlight = 0;
}

function fbStart(){
  if(fbState !== "idle") return;
  if(fbStake > bank){ msg($("fbMsg"), "Not enough chips for that bet.", "lose"); return; }
  wager(fbStake, "flappy");
  stats.hands++;

  var rigMode = rigRoll();
  fbRig = rigMode === "user" ? 1.3 : rigMode === "host" ? 0.76 : 1;

  fbReset();
  fbBirdV = FB_FLAP;
  fbState = "flying";
  playChip();
  msg($("fbMsg"), "Airborne — clear pipes to build the multiplier, then cash out.", "info");
  syncFlappyUI();
}

function fbFlap(){
  if(fbState !== "flying") return;
  fbBirdV = FB_FLAP;
  sfx(function(ctx, t){ tone(ctx, 560, t, 0.05, "triangle", 0.028); });
}

/* Call before fbReset() — that zeroes fbPassed. Returns true on a new record. */
function fbRecordBest(){
  if(fbPassed <= flappyBest) return false;
  flappyBest = fbPassed;
  save();                                            /* also queues the cloud push */
  syncFlappyUI();
  renderFlappyBoard();
  return true;
}

function fbCashOut(){
  if(fbState !== "flying") return;
  var ret = fbCashValue(), net = ret - fbStake;
  var best = fbRecordBest();
  fbState = "idle";
  if(ret > 0) payout(ret, "flappy");
  if(net > 0){
    playWin(fbMult >= 20 ? "jackpot" : fbMult >= 3 ? "big" : "small");
    if(fbMult >= 3) setTimeout(playCoin, 90);
    msg($("fbMsg"), "Cashed out at " + fbMultText() + " — " + fmt(ret) + " chips (+" + fmt(net) + ").", "win");
  }else if(net < 0){
    playLose();
    msg($("fbMsg"), "Bailed early at " + fbMultText() + " — " + fmt(ret) + " chips back (" + fmt(net) + ").", "lose");
  }else{
    playClick();
    msg($("fbMsg"), "Bailed at " + fbMultText() + " — " + fmt(ret) + " chips back.", "info");
  }
  if(best) msg($("fbMsg"), $("fbMsg").textContent + " New best: " + fbPassed + " pipes!", "win");
  fbReset();
  syncFlappyUI();
}

function fbCrash(){
  var best = fbRecordBest();
  fbState = "dead";
  fbDeadAt = fbClock;
  playLose();
  msg($("fbMsg"), "Clipped it at " + fbMultText() + " — lost " + fmt(fbStake) + " chips." +
      (best ? " New best: " + fbPassed + " pipes!" : ""), best ? "win" : "lose");
  syncFlappyUI();
}

function fbHits(p){
  var bx = fbBirdX();
  if(bx + FB_R < p.x || bx - FB_R > p.x + FB_PIPE_W) return false;
  return fbBirdY - FB_R < p.top || fbBirdY + FB_R > p.top + p.gap;
}

function fbStep(dt){
  fbClock += dt;

  if(fbState === "idle"){
    fbBirdY = fbFloor()*0.42 + Math.sin(fbClock*2.4)*7;   // idle hover
    return;
  }

  if(fbState === "dead"){
    fbBirdV += FB_GRAV*dt;
    fbBirdY = Math.min(fbFloor() - FB_R, fbBirdY + fbBirdV*dt);
    if(fbClock - fbDeadAt > 1.1){ fbState = "idle"; fbReset(); syncFlappyUI(); }
    return;
  }

  fbFlight += dt;
  var sp = fbSpeed();
  fbScroll += sp*dt;
  fbBirdV += FB_GRAV*dt;
  fbBirdY += fbBirdV*dt;
  var ceilY = fbCeil() + FB_R;
  if(fbBirdY < ceilY){ fbBirdY = ceilY; fbBirdV = 0; }   // ceiling nudges, never kills

  fbPipes.forEach(function(p){ p.x -= sp*dt; });
  if(!fbPipes.length || fbPipes[fbPipes.length-1].x < fbW - FB_SPACING) fbSpawnPipe();
  fbPipes = fbPipes.filter(function(p){ return p.x + FB_PIPE_W > -24; });

  var bx = fbBirdX(), scored = false;
  fbPipes.forEach(function(p){
    if(!p.scored && p.x + FB_PIPE_W < bx - FB_R){
      p.scored = true;
      fbPassed++;
      fbMult *= FB_STEP;
      scored = true;
      sfx(function(ctx, t){ tone(ctx, 880 + fbPassed*18, t, 0.06, "triangle", 0.032); });
    }
  });
  if(scored) syncFlappyUI();

  if(fbBirdY + FB_R > fbFloor()){ fbCrash(); return; }
  for(var i=0;i<fbPipes.length;i++){
    if(fbHits(fbPipes[i])){ fbCrash(); return; }
  }
}

/* deterministic star field so the sky doesn't shimmer between frames */
function fbHash(i){
  var h = Math.sin(i*12.9898)*43758.5453;
  return h - Math.floor(h);
}

function fbPipeShape(p){
  var floorY = fbFloor(), botY = p.top + p.gap;
  var grad = fbCtx.createLinearGradient(p.x, 0, p.x + FB_PIPE_W, 0);
  grad.addColorStop(0, "#227a42");
  grad.addColorStop(0.42, "#5ad47e");
  grad.addColorStop(1, "#175c30");
  fbCtx.fillStyle = grad;
  fbCtx.fillRect(p.x, 0, FB_PIPE_W, p.top);
  fbCtx.fillRect(p.x, botY, FB_PIPE_W, floorY - botY);
  fbCtx.fillRect(p.x - 5, p.top - 17, FB_PIPE_W + 10, 17);
  fbCtx.fillRect(p.x - 5, botY, FB_PIPE_W + 10, 17);
  fbCtx.strokeStyle = "rgba(0,0,0,.42)";
  fbCtx.lineWidth = 2;
  fbCtx.strokeRect(p.x - 5, p.top - 17, FB_PIPE_W + 10, 17);
  fbCtx.strokeRect(p.x - 5, botY, FB_PIPE_W + 10, 17);
}

function fbBirdShape(){
  var bx = fbBirdX();
  var tilt = Math.max(-0.5, Math.min(1.1, fbBirdV/900));
  fbCtx.save();
  fbCtx.translate(bx, fbBirdY);
  fbCtx.rotate(tilt);

  fbCtx.fillStyle = "#ffd24a";
  fbCtx.beginPath();
  fbCtx.arc(0, 0, FB_R, 0, Math.PI*2);
  fbCtx.fill();
  fbCtx.strokeStyle = "rgba(0,0,0,.45)";
  fbCtx.lineWidth = 2;
  fbCtx.stroke();

  fbCtx.fillStyle = "#f0a92c";                          // wing, beats with the flap
  var beat = fbState === "flying" ? Math.sin(fbClock*22)*4 : 2;
  fbCtx.beginPath();
  fbCtx.ellipse(-3, 2 + beat*0.35, 7, 4.5, 0, 0, Math.PI*2);
  fbCtx.fill();

  fbCtx.fillStyle = "#ff8b2e";
  fbCtx.beginPath();
  fbCtx.moveTo(FB_R - 2, 1);
  fbCtx.lineTo(FB_R + 7, 4);
  fbCtx.lineTo(FB_R - 2, 6);
  fbCtx.closePath();
  fbCtx.fill();

  fbCtx.fillStyle = "#fff";
  fbCtx.beginPath();
  fbCtx.arc(4.5, -4, 4, 0, Math.PI*2);
  fbCtx.fill();
  fbCtx.fillStyle = "#101820";
  fbCtx.beginPath();
  fbCtx.arc(6, -4, 1.8, 0, Math.PI*2);
  fbCtx.fill();
  fbCtx.restore();
}

function fbRender(){
  var floorY = fbFloor(), i;

  var sky = fbCtx.createLinearGradient(0, 0, 0, fbH);
  sky.addColorStop(0, "#16294a");
  sky.addColorStop(1, "#070d18");
  fbCtx.fillStyle = sky;
  fbCtx.fillRect(0, 0, fbW, fbH);

  fbCtx.fillStyle = "rgba(255,246,213,.5)";
  for(i=0;i<46;i++){
    var sx = (fbHash(i)*fbW - fbScroll*0.06) % fbW;
    if(sx < 0) sx += fbW;
    fbCtx.fillRect(sx, fbHash(i+90)*(floorY-40), 1.6, 1.6);
  }
  fbCtx.fillStyle = "rgba(255,248,224,.16)";
  fbCtx.beginPath();
  fbCtx.arc(fbW - 74, 62, 26, 0, Math.PI*2);
  fbCtx.fill();

  fbPipes.forEach(fbPipeShape);

  fbCtx.fillStyle = "#0a1a12";
  fbCtx.fillRect(0, floorY, fbW, FB_GROUND);
  fbCtx.fillStyle = "#1d6b39";
  fbCtx.fillRect(0, floorY, fbW, 4);
  fbCtx.fillStyle = "rgba(255,255,255,.06)";
  for(i=-1;i<fbW/26+1;i++){
    fbCtx.fillRect(i*26 - (fbScroll % 26), floorY + 8, 13, 3);
  }

  fbBirdShape();

  fbCtx.textAlign = "center";
  fbCtx.fillStyle = fbState === "flying" ? "#ffe9a8" : "rgba(236,244,255,.62)";
  fbCtx.font = "700 34px Segoe UI, system-ui, sans-serif";
  fbCtx.textBaseline = "top";
  fbCtx.fillText(fbMultText(), fbW/2, 16);

  fbCtx.font = "700 11px Segoe UI, system-ui, sans-serif";
  fbCtx.fillStyle = "rgba(236,244,255,.45)";
  if(fbState === "flying"){
    fbCtx.fillText(fbPassed + (fbPassed === 1 ? " PIPE · " : " PIPES · ") + fmt(fbCashValue()) + " CHIPS", fbW/2, 56);
  }else if(fbState === "idle"){
    fbCtx.fillText("FLY OR K TO BET · TAP SKY OR SPACE TO FLAP", fbW/2, 56);
  }else{
    fbCtx.fillStyle = "rgba(255,140,140,.85)";
    fbCtx.fillText("CRASHED", fbW/2, 56);
  }
  fbCtx.textAlign = "left";
}

function syncFlappyUI(){
  var flying = fbState === "flying";
  $("fbMultVal").textContent = fbMultText();
  $("fbPipeVal").textContent = fbPassed;
  $("fbBestVal").textContent = fmt(flappyBest);
  var go = $("fbGo");
  go.textContent = flying ? "Cash out " + fmt(fbCashValue()) + " (K)" : "Fly (K)";
  go.classList.toggle("cash", flying);
  go.disabled = fbState === "dead";
  Array.prototype.forEach.call(fbBtns, function(b){ b.disabled = flying; });
  $("fbCustom").disabled = flying;
  $("fbClear").disabled  = flying;
}

function fbToggle(){
  if(fbState === "flying") fbCashOut();
  else if(fbState === "idle") fbStart();
}

var fbBtns = chipRow($("tab-flappy"), null, function(v){
  fbStake = v;
  $("fbStake").textContent = fmt(fbStake);
}, null);
fbBtns[1].classList.add("sel");

$("fbClear").addEventListener("click", function(){
  playClick();
  fbStake = 5;
  $("fbStake").textContent = "5";
  Array.prototype.forEach.call(fbBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("fbCustom").value = "";
  $("fbCustom").classList.remove("sel");
});

$("fbGo").addEventListener("click", fbToggle);

fbCanvas.addEventListener("pointerdown", function(e){
  e.preventDefault();
  fbFlap();
});

/* Space flaps; K bets and cashes out, so the whole round can be played from the
   keyboard without reaching for the button mid-flight. */
document.addEventListener("keydown", function(e){
  if(e.code !== "Space" && e.code !== "KeyK") return;
  if(!$("tab-flappy").classList.contains("on")) return;
  var t = e.target;
  if(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  e.preventDefault();
  if(e.repeat && e.code === "KeyK") return;              // holding K must not re-bet
  if(e.code === "Space") fbFlap();
  else fbToggle();
});

fbResize();
fbReset();
syncFlappyUI();

/* ================= SNAKE ================= */
/* The same crash-game bones as Flappy — stake on start, a multiplier that
   compounds per bite, cash out or lose the lot — but the thing that kills you
   is the tail you grew getting there.

   It does not run on a grid. The head is a position rather than a cell and it
   moves a fraction of a pixel per frame; the body is the path it has taken,
   trimmed to whatever length the snake has earned and drawn as one continuous
   stroke. So the animal is one long thing rather than a row of squares, and it
   can be halfway between anywhere. */
var snCanvas = $("snakeCanvas"), snCtx = snCanvas.getContext("2d");
var SN_VIEW_H = 240;                                   // the height the board is drawn for
var SN_MARGIN = 9;                                     // wall inset, in world units
var SN_R = 7;                                          // half the body's thickness
var SN_FOOD_R = 6.5;
var SN_LEN0 = 62;                                      // starting body length, in world units
var SN_GROW = 30;                                      // ...and what a bite adds
var SN_SPEED0 = 118, SN_SPEED_MAX = 235, SN_SPEED_RAMP = 7.5;   // units per second
var SN_SAMPLE = 4;                                     // how often the path lays down a point
/* The stretch of body just behind the head that cannot kill you. A square turn
   leaves the neck lying right alongside the head, and without this every corner
   would be fatal. It also forgives a very tight double-back, which is the trade
   for being able to turn anywhere rather than only on a grid line. */
var SN_GRACE = SN_R*4;
var SN_MULT0 = 0.5;                                    // bail out too early and you take a haircut
var SN_STEP  = 1.18;                                   // each bite compounds by this much

var snW = 480, snH = 240, snCssW = 0, snCssH = 0;
var snStake = 25, snState = "idle";                    // idle | live | dead
var snHead = {x:0, y:0}, snDir = {x:1, y:0}, snTurns = [];
var snPath = [], snLen = SN_LEN0, snFood = null;
var snEaten = 0, snMult = SN_MULT0, snRig = 1;
var snDeadAt = 0, snClock = 0;

function snResize(){
  if(!snCanvas) return;
  var rect = snCanvas.getBoundingClientRect();
  if(!rect.width) return;
  var dpr = window.devicePixelRatio || 1;
  /* Same rule as the other boards: past the height it is drawn for, the extra
     pixels magnify the board rather than revealing more of it. */
  var z = Math.max(0.7, rect.height / SN_VIEW_H);
  snW = rect.width / z; snH = rect.height / z;
  snCssW = rect.width; snCssH = rect.height;
  snCanvas.width  = Math.round(rect.width*dpr);
  snCanvas.height = Math.round(rect.height*dpr);
  snCtx.setTransform(dpr*z, 0, 0, dpr*z, 0, 0);
}
function snBoard(){
  return {x:SN_MARGIN, y:SN_MARGIN, w:snW - SN_MARGIN*2, h:snH - SN_MARGIN*2};
}
function snSpeed(){ return Math.min(SN_SPEED_MAX, (SN_SPEED0 + snEaten*SN_SPEED_RAMP) / snRig); }
function snMultText(){ return snMult.toFixed(2) + "x"; }
function snCashValue(){ return Math.floor(snStake * snMult); }
function snDist(a, b){ var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx*dx + dy*dy); }

/* Somewhere clear of the body. The rig leans on WHERE rather than whether: a
   friendly round drops the next bite near the head, a hostile one as far away
   as it can, which is more ground covered on a longer body. */
function snPlaceFood(){
  var b = snBoard(), pad = SN_FOOD_R + SN_R + 4;
  var best = null, bestD = 0;
  for(var n = 0; n < 40; n++){
    var c = {x: b.x + pad + Math.random()*(b.w - pad*2),
             y: b.y + pad + Math.random()*(b.h - pad*2)};
    var clear = true;
    for(var i = 0; i < snPath.length; i++){
      if(snDist(c, snPath[i]) < SN_R + SN_FOOD_R + 6){ clear = false; break; }
    }
    if(!clear) continue;
    if(snRig === 1){ snFood = c; return; }
    var d = snDist(c, snHead);
    if(!best || (snRig > 1 ? d < bestD : d > bestD)){ best = c; bestD = d; }
  }
  /* On a crowded board every candidate may have been rejected; anywhere inside
     the walls beats leaving the player with nothing to chase. */
  snFood = best || {x: b.x + pad + Math.random()*(b.w - pad*2),
                    y: b.y + pad + Math.random()*(b.h - pad*2)};
}
function snReset(){
  var b = snBoard();
  snHead = {x: b.x + b.w*0.25, y: b.y + b.h/2};
  snDir = {x:1, y:0}; snTurns = [];
  snLen = SN_LEN0; snEaten = 0; snMult = SN_MULT0;
  snPath = [{x:snHead.x, y:snHead.y}, {x:snHead.x - SN_LEN0, y:snHead.y}];
  snPlaceFood();
}
function snStart(){
  if(snState !== "idle") return;
  if(snStake > bank){ msg($("snMsg"), "Not enough chips for that bet.", "lose"); return; }
  wager(snStake, "snake");
  stats.hands++;

  var rigMode = rigRoll();
  snRig = rigMode === "user" ? 1.25 : rigMode === "host" ? 0.8 : 1;

  snReset();
  snState = "live";
  playChip();
  msg($("snMsg"), "Off you go — every bite compounds, and the tail is the trap.", "info");
  syncSnakeUI();
}
/* A turn is queued rather than applied, and each queued turn is checked against
   the one before it rather than against the direction on screen, so two keys
   inside one frame cannot fold the head straight back into its own neck. */
function snTurn(dx, dy){
  if(snState !== "live") return;
  var last = snTurns.length ? snTurns[snTurns.length-1] : snDir;
  if(last.x === -dx && last.y === -dy) return;         /* no reversing */
  if(last.x === dx && last.y === dy) return;           /* already going that way */
  if(snTurns.length < 2) snTurns.push({x:dx, y:dy});
}
/* Trim the recorded path back to the body's length, cutting the last segment
   part-way so the tail ends exactly where it should rather than at whichever
   sample happened to be nearest. */
function snTrim(){
  var run = 0;
  for(var i = 1; i < snPath.length; i++){
    var seg = snDist(snPath[i-1], snPath[i]);
    if(run + seg >= snLen){
      var t = (snLen - run) / (seg || 1);
      snPath[i] = {x: snPath[i-1].x + (snPath[i].x - snPath[i-1].x)*t,
                   y: snPath[i-1].y + (snPath[i].y - snPath[i-1].y)*t};
      snPath.length = i + 1;
      return;
    }
    run += seg;
  }
}
function snStep(dt){
  if(snState === "dead"){
    if(snClock - snDeadAt > 1.1){ snState = "idle"; snReset(); syncSnakeUI(); }
    return;
  }
  if(snState !== "live") return;

  /* One queued turn per frame, pinned at the head's current position so the
     corner lands exactly where it was asked for. */
  if(snTurns.length){
    snDir = snTurns.shift();
    snPath.unshift({x:snHead.x, y:snHead.y});
  }

  var move = snSpeed() * dt;
  snHead.x += snDir.x*move;
  snHead.y += snDir.y*move;

  /* The head is always path[0]; a new fixed point is laid down behind it once
     it has travelled far enough to be worth recording. */
  if(snPath.length < 2 || snDist(snHead, snPath[1]) >= SN_SAMPLE) snPath.unshift({x:snHead.x, y:snHead.y});
  else snPath[0] = {x:snHead.x, y:snHead.y};
  snTrim();

  var b = snBoard();
  if(snHead.x - SN_R < b.x || snHead.y - SN_R < b.y ||
     snHead.x + SN_R > b.x + b.w || snHead.y + SN_R > b.y + b.h){ snDie(); return; }

  /* Walk back along the path, skipping the stretch of neck a square turn always
     leaves lying beside the head, then look for anything the head overlaps. */
  var run = 0;
  for(var i = 1; i < snPath.length; i++){
    run += snDist(snPath[i-1], snPath[i]);
    if(run < SN_GRACE) continue;
    if(snDist(snHead, snPath[i]) < SN_R*1.5){ snDie(); return; }
  }

  if(snFood && snDist(snHead, snFood) < SN_R + SN_FOOD_R){
    snEaten++;
    snMult *= SN_STEP;
    snLen += SN_GROW;
    snPlaceFood();
    playCoin();
    syncSnakeUI();
  }
}
function snDie(){
  snState = "dead";
  snDeadAt = snClock;
  playLose();
  msg($("snMsg"), "Ran out of room on " + fmt(snEaten) + " " + (snEaten === 1 ? "bite" : "bites") +
                  " — " + fmt(snStake) + " chips gone.", "lose");
  snRecordBest();
  syncSnakeUI();
}
function snRecordBest(){
  if(snEaten <= snakeBest) return false;
  snakeBest = snEaten;
  save();
  return true;
}
function snCashOut(){
  if(snState !== "live") return;
  var ret = snCashValue(), net = ret - snStake;
  var best = snRecordBest();
  snState = "idle";
  if(ret > 0) payout(ret, "snake");
  if(net > 0){
    playWin(snMult >= 20 ? "jackpot" : snMult >= 3 ? "big" : "small");
    if(snMult >= 3) setTimeout(playCoin, 90);
    msg($("snMsg"), "Cashed out at " + snMultText() + " — " + fmt(ret) + " chips (+" + fmt(net) + ").", "win");
  }else if(net < 0){
    playLose();
    msg($("snMsg"), "Stopped early at " + snMultText() + " — " + fmt(ret) + " chips back (" + fmt(net) + ").", "lose");
  }else{
    playClick();
    msg($("snMsg"), "Stopped at " + snMultText() + " — " + fmt(ret) + " chips back.", "info");
  }
  if(best) msg($("snMsg"), $("snMsg").textContent + " New best: " + snEaten + "!", "win");
  snReset();
  syncSnakeUI();
}
function snToggle(){ if(snState === "live") snCashOut(); else snStart(); }

function snRender(){
  var b = snBoard();
  snCtx.clearRect(0, 0, snW, snH);
  var bg = snCtx.createLinearGradient(0, 0, 0, snH);
  bg.addColorStop(0, "#0e2a1b"); bg.addColorStop(1, "#050f0a");
  snCtx.fillStyle = bg;
  snCtx.fillRect(0, 0, snW, snH);

  snCtx.strokeStyle = "rgba(255,255,255,.10)";
  snCtx.lineWidth = 1;
  snCtx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

  if(snFood){
    var pulse = 1 + Math.sin(snClock*6)*0.12;
    snCtx.fillStyle = "#ffcf4d";
    snCtx.beginPath(); snCtx.arc(snFood.x, snFood.y, SN_FOOD_R*pulse, 0, Math.PI*2); snCtx.fill();
    snCtx.fillStyle = "rgba(255,255,255,.55)";
    snCtx.beginPath();
    snCtx.arc(snFood.x - SN_FOOD_R*0.3, snFood.y - SN_FOOD_R*0.35, SN_FOOD_R*0.3, 0, Math.PI*2);
    snCtx.fill();
  }

  if(snPath.length > 1){
    snCtx.save();
    snCtx.beginPath();
    snCtx.rect(b.x, b.y, b.w, b.h);
    snCtx.clip();
    snCtx.lineCap = "round"; snCtx.lineJoin = "round";
    snCtx.beginPath();
    snCtx.moveTo(snPath[0].x, snPath[0].y);
    for(var i = 1; i < snPath.length; i++) snCtx.lineTo(snPath[i].x, snPath[i].y);
    /* Stroked twice: a dark outline underneath, so where the body runs close to
       itself you can still see which strand is which, then the body over it. */
    snCtx.strokeStyle = "rgba(4,20,12,.85)";
    snCtx.lineWidth = SN_R*2 + 3;
    snCtx.stroke();
    var tail = snPath[snPath.length-1];
    var grad = snCtx.createLinearGradient(snPath[0].x, snPath[0].y, tail.x, tail.y);
    if(snState === "dead"){ grad.addColorStop(0, "#e05a5a"); grad.addColorStop(1, "#7a2222"); }
    else                  { grad.addColorStop(0, "#7ef2a8"); grad.addColorStop(1, "#2c8f56"); }
    snCtx.strokeStyle = grad;
    snCtx.lineWidth = SN_R*2;
    snCtx.stroke();

    /* eyes, set either side of the direction of travel */
    var off = SN_R*0.46, fwd = SN_R*0.34;
    snCtx.fillStyle = "#04120a";
    snCtx.beginPath();
    snCtx.arc(snHead.x + snDir.x*fwd - snDir.y*off, snHead.y + snDir.y*fwd - snDir.x*off, SN_R*0.26, 0, Math.PI*2);
    snCtx.fill();
    snCtx.beginPath();
    snCtx.arc(snHead.x + snDir.x*fwd + snDir.y*off, snHead.y + snDir.y*fwd + snDir.x*off, SN_R*0.26, 0, Math.PI*2);
    snCtx.fill();
    snCtx.restore();
  }

  /* Pinned to the canvas rather than the board, so where the two differ the
     readout sits in the band instead of over the play area. */
  snCtx.textAlign = "center";
  if(snState === "live"){
    snCtx.font = "700 30px system-ui, sans-serif";
    snCtx.fillStyle = "rgba(255,255,255,.9)";
    snCtx.fillText(snMultText(), snW/2, 32);
    snCtx.font = "600 11px system-ui, sans-serif";
    snCtx.fillStyle = "rgba(255,255,255,.45)";
    snCtx.fillText(fmt(snCashValue()) + " CHIPS IF YOU STOP NOW", snW/2, 50);
  }else if(snState === "dead"){
    snCtx.font = "700 26px system-ui, sans-serif";
    snCtx.fillStyle = "#ff6b6b";
    snCtx.fillText("CRASHED", snW/2, 34);
  }
  snCtx.textAlign = "left";
}

function syncSnakeUI(){
  var live = snState === "live";
  $("snMultVal").textContent = snMultText();
  $("snEatVal").textContent  = snEaten;
  $("snBestVal").textContent = fmt(snakeBest);
  var go = $("snGo");
  go.textContent = live ? "Cash out " + fmt(snCashValue()) + " (K)" : "Play (K)";
  go.classList.toggle("cash", live);
  go.disabled = snState === "dead";
  Array.prototype.forEach.call(snBtns, function(b){ b.disabled = live; });
  $("snCustom").disabled = live;
  $("snClear").disabled  = live;
}

var snBtns = chipRow($("tab-snake"), null, function(v){
  snStake = v;
  $("snStake").textContent = fmt(snStake);
}, null);
snBtns[1].classList.add("sel");

$("snClear").addEventListener("click", function(){
  playClick();
  snStake = 5;
  $("snStake").textContent = "5";
  Array.prototype.forEach.call(snBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("snCustom").value = "";
  $("snCustom").classList.remove("sel");
});
$("snGo").addEventListener("click", function(){ snToggle(); });

/* Swipe to steer. The axis with the larger travel wins, so a lazy diagonal
   still turns the way it was mostly heading. */
var snTouch = null;
snCanvas.addEventListener("pointerdown", function(e){
  e.preventDefault();
  snTouch = {x:e.clientX, y:e.clientY};
});
snCanvas.addEventListener("pointermove", function(e){
  if(!snTouch) return;
  var dx = e.clientX - snTouch.x, dy = e.clientY - snTouch.y;
  if(Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
  if(Math.abs(dx) > Math.abs(dy)) snTurn(dx > 0 ? 1 : -1, 0);
  else snTurn(0, dy > 0 ? 1 : -1);
  snTouch = {x:e.clientX, y:e.clientY};                /* re-anchor so one drag can turn twice */
});
window.addEventListener("pointerup", function(){ snTouch = null; });

var SN_KEYS = {
  ArrowLeft:[-1,0], KeyA:[-1,0], ArrowRight:[1,0], KeyD:[1,0],
  ArrowUp:[0,-1],   KeyW:[0,-1], ArrowDown:[0,1],  KeyS:[0,1]
};
document.addEventListener("keydown", function(e){
  if(!$("tab-snake").classList.contains("on")) return;
  var t = e.target;
  if(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  var d = SN_KEYS[e.code];
  if(d){ e.preventDefault(); snTurn(d[0], d[1]); return; }   /* arrows must not scroll the page */
  if(e.code === "KeyK"){
    e.preventDefault();
    if(e.repeat) return;                                     /* holding K must not re-bet */
    snToggle();
  }
});

snResize();
snReset();
syncSnakeUI();
