"use strict";
/* ==========================================================================
   Poker, part 3 of 3: the table.

   Everything you can see or click: the room and the felt painted on a canvas,
   the controls beside them, the animations, and the wiring that turns a click
   into a call to the engine. This is the only part of poker that touches the
   page, and the only part that moves a chip in or out of the player's bank.

   Loads last, after parts 1 and 2 -- the code at the foot of this file runs
   on load and needs both of them already defined.
   ========================================================================== */

/* Recomputed only when the hero's cards actually changed since the last
   paint -- cheap either way (a few hundred 5-card evaluations at most), but
   there is no reason to redo it 60 times a second when nothing has moved. */
var pokHandInfoKey = null;
function pokRenderHandInfo(T){
  var el = document.getElementById("pokHandInfo");
  if(!el) return;
  var me = T.players[0];
  if(!me.hole.length || !me.inHand){ el.hidden = true; pokHandInfoKey = null; return; }

  var key = me.hole.map(function(c){ return c.r + c.su.s; }).join(",") + "|" +
            T.board.map(function(c){ return c.r + c.su.s; }).join(",");
  if(key === pokHandInfoKey) return;
  pokHandInfoKey = key;
  el.hidden = false;

  /* pokOuts only answers for a real street -- three, four or five cards -- and
     returns null for anything else. The single-player game never asks with a
     board of one or two, because its own board goes straight from nothing to a
     flop. Now that this readout is also drawn for a table arriving from
     somewhere else, a board mid-flight would have thrown here instead of
     simply showing the two cards in hand. */
  var info = T.board.length ? pokOuts(me.hole, T.board) : null;
  if(!info){
    el.innerHTML = '<div class="pok-hi-title">Your hand</div>' +
      '<div class="pok-hi-current">' + pokDescribeHole(me.hole) + "</div>";
    return;
  }
  var html = '<div class="pok-hi-title">Your hand</div>' +
             '<div class="pok-hi-current">' + pokDescribeHand(info.current) + "</div>";
  if(info.outs.length){
    html += '<div class="pok-hi-sub">Could improve to</div><ul class="pok-hi-list">' +
      info.outs.map(function(o){
        return "<li>" + o.name + ' <span>' + o.outs + " card" + (o.outs === 1 ? "" : "s") + "</span></li>";
      }).join("") + "</ul>";
  }else if(T.board.length < 5){
    html += '<div class="pok-hi-sub">Nothing left improves this</div>';
  }
  el.innerHTML = html;
}

/* ==========================================================================
   Table UI
   ========================================================================== */
var pok = {T:null, seated:false, buyin:250, timer:null, endTimer:null, revealed:false, say:{}, cigar:0,
           raiseTo:null, raiseKey:null, who:[], speed:1};

/* Fold and the hand still has to play itself out. Skip runs the rest of it at
   POK_SKIP times speed -- every pause and every animation divided by the same
   number, so the table still reads as a table, just a brisk one. Resets with
   the next deal, because the speed was for a hand you were no longer in. */
var POK_SKIP = 5;
function pokMs(n){ return Math.round(n / pok.speed); }

/* What a move should say, worked out BEFORE it is played. Acting can end the
   street, which zeroes every bet, so reading the amount afterwards would show
   nothing at all on exactly the moves worth announcing. */
function pokMoveText(T, action, raiseTo){
  var lg = pokLegal(T);
  if(!lg) return "";
  if(action === "fold")  return "Fold";
  if(action === "check") return "Check";
  if(action === "call")  return lg.callAmount >= T.players[T.toAct].stack
                              ? "All in" : "Call " + fmt(lg.callAmount);
  if(action === "raise"){
    var to = Math.max(lg.minRaiseTo, Math.min(raiseTo, lg.maxRaiseTo));
    return to >= lg.maxRaiseTo ? "All in " + fmt(to) : "Raise to " + fmt(to);
  }
  return "";
}
function pokSpeak(seat, text){
  if(text) pok.say[seat] = {text:text, until:Date.now() + pokMs(2100)};
}

/* Chips in motion. Purely decorative: the stacks and the pot are drawn from the
   engine either way, so a dropped frame costs an animation and never a chip. */
var pokChipFly = [];
function pokChipMove(from, to, n, col, delay){
  pokChipFly.push({x0:from.x, y0:from.y, x1:to.x, y1:to.y,
                   n:Math.max(1, Math.min(5, n)), col:col,
                   start:Date.now() + pokMs(delay||0), dur:pokMs(420)});
}
function pokSeatStackPt(seat){
  if(seat === 0) return {x:TBL.cx+176, y:pokHeroY()+2};
  var deg = pokCurDeg[seat] !== undefined ? pokCurDeg[seat] : POK_SEAT_DEG[seat-1];
  var cf = onFelt(deg, 0.76);
  var side = Math.cos(deg*Math.PI/180) > 0 ? -42 : 42;
  return {x:cf.x+side, y:cf.y+5};
}
/* A fraction of the scene, not a fixed offset from the table centre: at +96 it
   sat below the bottom edge on any scene shorter than ~619, which fullscreen
   produces routinely, and the chips flew off the canvas. */
function pokHeroBetY(){ return pokHeroY() - 52; }
function pokSeatBetPt(seat){
  if(seat === 0) return {x:TBL.cx-150, y:pokHeroBetY()};
  var deg = pokCurDeg[seat] !== undefined ? pokCurDeg[seat] : POK_SEAT_DEG[seat-1];
  return onFelt(deg, 0.52);
}
function pokPotPt(){ return {x:TBL.cx-46, y:pokPotY()}; }

/* What a refresh would hand back: only what is still in front of you. Chips
   already pushed into the pot are at risk, exactly as they are when you stand
   up -- counting them here made reloading the page a way to take a bet back. */
function pokSetPokerStack(n){ pokerStack = n; save(); }

function pokBlinds(buyin){
  /* Aiming at fifty big blinds so a sitting lasts, but rounded so the big
     blind is a multiple of ten and the small blind therefore a multiple of
     five. Otherwise the posts themselves are the one thing on the table that
     is not in fives -- a 3-chip small blind makes every call that answers it
     land off the mark too. */
  var bb = Math.max(10, Math.round(buyin / 50 / 10) * 10);
  return {sb: bb / 2, bb: bb};
}
function pokMiniCard(card, hidden){
  var el = cardEl(card, hidden);
  return el;
}
/* ==========================================================================
   The room. Everything below is presentation only — it reads pok.T and draws
   it, and never changes a chip.
   ========================================================================== */
var pokCanvas = $("pokCanvas"), pokCtx = pokCanvas.getContext("2d");
/* ---- lending the felt ----
   The online game draws the same room, the same table and the same people; it
   just has a different set of cards and a different screen to put them on.
   Rather than a second copy of six hundred lines of drawing, the scene is
   pointed at another canvas for as long as that game is up, and handed back
   afterwards. Everything below carries on reading pok.T without knowing. */
var pokLent = false;
/* The line across the top of the felt is read out of the page rather than
   held in a variable, so a borrower says which element holds its own. */
var pokMsgId = "pokMsg";
/* Set while the table is being driven from somewhere else. The buttons all
   funnel through pokHeroAct, so this is the only place a move has to be
   diverted -- everything above goes on computing what is legal, what the
   raise adds up to and what the hand is worth, none of which cares where the
   move ends up being applied. */
var pokRemote = null;
function pokLend(mount, msgId, remote){
  if(!mount || pok.seated) return false;             /* see pokCanLend */
  /* The whole stage moves, not a copy of it: the felt, the controls, the
     chips that build a raise, the hand readout and the fullscreen button are
     one piece of furniture and they are carried across together. */
  mount.appendChild(pokStage);
  pokMsgId = msgId || "pokMsg";
  pokRemote = remote || null;
  pokLent = true;
  /* The online felt rebuilds its table on every state that arrives, so the
     smoker cannot be chosen there without changing every few seconds. Taking
     the felt is the moment that happens once. */
  pok.cigar = pokPickSmoker();
  pokCssW = 0;                                       /* a different box: measure it again */
  return true;
}
function pokUnlend(){
  pokHushCards();
  var home = $("pokTableView");
  if(home && pokStage.parentNode !== home) home.appendChild(pokStage);
  pokMsgId = "pokMsg";
  pokRemote = null;
  pokLent = false;
  pokCssW = 0;
  pok.T = null;
  pokCurDeg = {};
  pokFly = []; pokChipFly = []; pokBoardShown = 0;
}
/* Only one game can own pok.T at a time, and the single-player table keeps
   real chips in it. Rather than quietly clobbering a seat somebody is still
   sitting in, the online game asks first and says so if the answer is no. */
function pokCanLend(){ return !pok.seated; }
var POK_W = 900, POK_H = 520, POK_ROOM = 300, pokZ = 1, pokCssW = 0, pokCssH = 0;
var TBL = {cx:450, cy:442, rx:400, ry:176};

/* The scene is composed 900 wide and then laid out down whatever height the box
   actually has. Pinning both axes meant any box that was not 900x520 got black
   bars, and no single CSS rule keeps that ratio across a phone, a 4:3 tablet
   and an ultrawide at once. Deriving the layout from the box removes the
   problem rather than chasing it. */
function pokResize(){
  var rect = pokCanvas.getBoundingClientRect();
  if(!rect.width) return;
  var dpr = window.devicePixelRatio || 1, z = rect.width / POK_W;
  /* Fit, never crop. The scene normally takes its scale from the width and its
     height from the box. When the box is shorter than the layout can sensibly
     go, the scale comes down instead so the whole scene still fits -- a sliver
     of empty either side costs nothing, where cropping would take the headline
     off the top and the player's own cards off the bottom. */
  var POK_FLOOR = 240;
  var h = rect.height / z;
  if(h < POK_FLOOR){ h = POK_FLOOR; z = rect.height / POK_FLOOR; }
  pokZ = z;
  POK_H = Math.min(1000, h);
  POK_ROOM = Math.round(POK_H * 0.577);
  TBL = {cx:POK_W/2, cy:POK_H*0.845, rx:400, ry:POK_H*0.338};
  pokCssW = rect.width; pokCssH = rect.height;
  pokCanvas.width  = Math.round(rect.width * dpr);
  pokCanvas.height = Math.round(rect.height * dpr);
  pokCtx.setTransform(dpr*z, 0, 0, dpr*z, (rect.width - POK_W*z)*dpr/2, (rect.height - POK_H*z)*dpr/2);
  pokBuildRoom(POK_ROOM);
}
function onFelt(deg, k){
  var a = deg*Math.PI/180;
  return {x:TBL.cx + TBL.rx*k*Math.cos(a), y:TBL.cy + TBL.ry*k*Math.sin(a)};
}
/* Seats sit back from the felt rather than straight out from it: pushed out on
   an ellipse this wide, the end seats walk off the canvas. Squeezed in x and
   stretched in y instead. */
function seatPos(deg){
  var a = deg*Math.PI/180;
  return {x:TBL.cx + TBL.rx*0.92*Math.cos(a), y:TBL.cy + TBL.ry*1.16*Math.sin(a)};
}
/* Four seats, paired either side of the dealer at 270 so the table reads as
   balanced rather than leaning. The spare chair is gone -- every seat is taken
   now, which is what the gap was standing in for. */
/* The outer pair sit a little higher than a wider spread would put them: on a
   short scene their nameplates were landing on the player's own cards, and the
   cards are the one thing that must stay readable. */
var POK_SEAT_DEG = [202, 232, 308, 338], POK_DEALER_DEG = 270;
/* Hair style 1 is the one that frames the whole face -- long hair, or a bob --
   and those two read as women. The two with short hair are the men, and the
   cigar only ever goes to one of them. */
var POK_LOOK = [
  {skin:"#b97a4e", hair:"#191210", shirt:"#35456b", style:0, glasses:true,  male:true},
  {skin:"#7b4a2a", hair:"#2b1e16", shirt:"#6e3230", style:1, glasses:false, male:false},
  {skin:"#e8b98a", hair:"#4a3423", shirt:"#2b5547", style:2, glasses:false, male:true},
  {skin:"#d09a68", hair:"#7a6a55", shirt:"#5a4a2c", style:1, glasses:true,  male:false}
];
/* Seat numbers (1-4) of the men, so the pick below cannot land on anyone else. */
var POK_MEN = POK_LOOK.map(function(o, i){ return o.male ? i + 1 : 0; }).filter(Boolean);
function pokPickSmoker(){ return POK_MEN[rnd(POK_MEN.length)]; }
var POK_CHIPCOL = ["#1f6fae", "#b3242e", "#2f8f5a", "#8a5cc4"];

/* Seats 1-2 are the left arm, seats 3-4 the right, same as POK_SEAT_DEG. A
   folded player is not drawn at all, and whoever is left in their arm
   re-centres across that arm's own span -- two players never sit as if a
   third invisible one were still propping the gap between them. */
var POK_ARM_L = [POK_SEAT_DEG[0], POK_SEAT_DEG[1]];
var POK_ARM_R = [POK_SEAT_DEG[2], POK_SEAT_DEG[3]];
function pokLiveSeatDegs(T){
  var left = [], right = [], seat;
  for(seat = 1; seat <= 4; seat++){
    if(T.players[seat] && T.players[seat].inHand)
      (seat <= 2 ? left : right).push(seat);
  }
  var degs = {};
  function place(arr, lo, hi){
    if(arr.length === 1){ degs[arr[0]] = (lo + hi) / 2; return; }
    arr.forEach(function(s, i){ degs[s] = lo + (hi - lo) * (i / (arr.length - 1)); });
  }
  place(left, POK_ARM_L[0], POK_ARM_L[1]);
  place(right, POK_ARM_R[0], POK_ARM_R[1]);
  return degs;
}
/* Eased toward the target rather than snapped to it, so a fold reads as the
   table closing the gap rather than a seat jumping. Cleared at the start of
   every hand: everyone is back in it then, so there is nothing to glide from. */
var pokCurDeg = {};
function pokAnimateSeatDegs(target){
  var seat;
  for(seat = 1; seat <= 4; seat++){
    if(target[seat] === undefined){ delete pokCurDeg[seat]; continue; }
    pokCurDeg[seat] = pokCurDeg[seat] === undefined
      ? target[seat]
      : pokCurDeg[seat] + (target[seat] - pokCurDeg[seat]) * 0.12;
  }
  return pokCurDeg;
}

/* A label sized in scene units disappears once the scene is squeezed onto a
   phone: at 230px wide a scene pixel is a third of a real one. Sizes are set
   from the real pixels they will end up as, so the text stays readable and the
   table simply carries bigger writing. */
function pokFont(px){ return Math.round(px * Math.max(1, Math.min(2.4, 0.62/pokZ))); }

function pokRR(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r);
  c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }

/* ---- the room, painted once and reused ---- */
var pokBg = document.createElement("canvas"), pokBgH = 0;
function pokBuildRoom(RH){
  if(pokBgH === RH) return;                          /* only when the shape changes */
  pokBgH = RH;
  pokBg.width = POK_W; pokBg.height = RH;
  var c = pokBg.getContext("2d"), i;
  var sc = RH/300;                                   /* the room was drawn for 300 */
  c.setTransform(1,0,0,sc,0,0);
  var g = c.createLinearGradient(0,0,0,300);
  g.addColorStop(0,"#0f0b09"); g.addColorStop(.45,"#1d1512"); g.addColorStop(1,"#0a0807");
  c.fillStyle=g; c.fillRect(0,0,POK_W,300);
  for(i=0;i<POK_W;i+=60){ c.fillStyle="rgba(255,190,120,.02)"; c.fillRect(i,40,30,150); }
  for(i=0;i<8;i++){
    var x=26+i*112, y=64, w=82, h=122;
    c.fillStyle="#1b1410"; pokRR(c,x,y,w,h,7); c.fill();
    c.fillStyle="#241a14"; pokRR(c,x+4,y+4,w-8,h-8,5); c.fill();
    var sg=c.createLinearGradient(0,y+12,0,y+72);
    sg.addColorStop(0,"rgba(255,196,96,.55)"); sg.addColorStop(1,"rgba(230,90,60,.30)");
    c.fillStyle=sg; pokRR(c,x+10,y+12,w-20,60,3); c.fill();
    for(var r2=0;r2<3;r2++){
      c.fillStyle="rgba(20,12,8,.45)"; c.fillRect(x+13+r2*((w-26)/3),y+22,(w-32)/3,38);
      c.fillStyle="rgba(255,235,180,.7)";
      c.beginPath(); c.arc(x+13+r2*((w-26)/3)+(w-32)/6,y+41,4,0,7); c.fill();
    }
    c.fillStyle="rgba(255,150,60,.22)"; pokRR(c,x+10,y+80,w-20,16,3); c.fill();
    c.fillStyle="rgba(255,220,160,.55)"; c.fillRect(x+12,y+h-12,w-24,3);
    c.fillStyle="#120d0a"; pokRR(c,x+26,y+h,30,26,6); c.fill();
  }
  [[150,214,86],[730,208,74]].forEach(function(d){          /* other tables, for depth */
    c.fillStyle="rgba(40,22,14,.5)";
    c.beginPath(); c.ellipse(d[0],d[1],d[2]+7,d[2]*0.34+5,0,0,7); c.fill();
    c.fillStyle="rgba(14,46,32,.6)";
    c.beginPath(); c.ellipse(d[0],d[1],d[2],d[2]*0.34,0,0,7); c.fill();
  });
  for(i=0;i<20;i++){
    var bx=(i*151)%POK_W, by=8+((i*61)%46), br=9+((i*31)%20);
    var b2=c.createRadialGradient(bx,by,0,bx,by,br);
    b2.addColorStop(0,"rgba(255,208,128,.34)"); b2.addColorStop(1,"rgba(255,190,100,0)");
    c.fillStyle=b2; c.beginPath(); c.arc(bx,by,br,0,7); c.fill();
  }
  var cg=c.createLinearGradient(0,206,0,300);
  cg.addColorStop(0,"#3a1c1c"); cg.addColorStop(1,"#150b0b");
  c.fillStyle=cg; c.fillRect(0,206,POK_W,94);
  c.globalAlpha=.13; c.fillStyle="#c9a227";
  for(i=0;i<POK_W;i+=46) for(var j=212;j<300;j+=26){
    c.beginPath(); c.ellipse(i+((j/26)%2?23:0),j,9,4,0,0,7); c.fill();
  }
  c.globalAlpha=1;
  var hz=c.createLinearGradient(0,196,0,300);
  hz.addColorStop(0,"rgba(255,170,80,.06)"); hz.addColorStop(1,"rgba(0,0,0,.62)");
  c.fillStyle=hz; c.fillRect(0,196,POK_W,104);
  c.setTransform(1,0,0,1,0,0);
}
pokBuildRoom(300);

var POK_WALK = [];
(function(){ for(var i=0;i<12;i++){ var d=i%3;
  POK_WALK.push({x:Math.random()*POK_W, yf:[0.567,0.633,0.707][d], s:[0.60,0.74,0.90][d],
    sp:[0.5,0.7,0.9][d]*(0.8+Math.random()*0.5), a:[0.5,0.62,0.72][d],
    dir:Math.random()<0.5?-1:1, col:["#070605","#0a0807","#0d0a08"][d], ph:Math.random()*7}); } })();
function pokWalker(c,p,t){
  var ph=t*p.sp*2.2+p.ph, sw=Math.sin(ph)*0.5, bob=Math.abs(Math.cos(ph))*1.5;
  c.save(); c.translate(p.x,POK_ROOM*p.yf-bob); c.scale(p.s*p.dir,p.s); c.globalAlpha=p.a; c.fillStyle=p.col;
  c.save(); c.rotate(sw*0.30); pokRR(c,-5,0,7,26,3); c.fill(); c.restore();
  c.save(); c.rotate(-sw*0.30); pokRR(c,-2,0,7,26,3); c.fill(); c.restore();
  pokRR(c,-11,-32,22,34,8); c.fill();
  c.beginPath(); c.arc(0,-40,8.5,0,7); c.fill();
  c.save(); c.rotate(-sw*0.5); pokRR(c,8,-28,6,22,3); c.fill(); c.restore();
  c.restore();
}

function pokDrawTable(c){
  c.fillStyle="rgba(0,0,0,.6)";
  c.beginPath(); c.ellipse(TBL.cx,TBL.cy+18,TBL.rx+52,TBL.ry+34,0,0,7); c.fill();
  var wg=c.createLinearGradient(0,TBL.cy-TBL.ry-42,0,TBL.cy+TBL.ry);
  wg.addColorStop(0,"#5a3a22"); wg.addColorStop(.45,"#3a2411"); wg.addColorStop(1,"#1d1208");
  c.fillStyle=wg; c.beginPath(); c.ellipse(TBL.cx,TBL.cy,TBL.rx+42,TBL.ry+28,0,0,7); c.fill();
  var lg=c.createLinearGradient(0,TBL.cy-TBL.ry-28,0,TBL.cy+TBL.ry);
  lg.addColorStop(0,"#553227"); lg.addColorStop(.4,"#39221b"); lg.addColorStop(1,"#20130e");
  c.fillStyle=lg; c.beginPath(); c.ellipse(TBL.cx,TBL.cy,TBL.rx+23,TBL.ry+15,0,0,7); c.fill();
  c.strokeStyle="rgba(255,205,150,.16)"; c.lineWidth=2;
  c.beginPath(); c.ellipse(TBL.cx,TBL.cy,TBL.rx+23,TBL.ry+15,0,0,7); c.stroke();
  c.strokeStyle="rgba(0,0,0,.35)"; c.lineWidth=1;
  for(var a=0;a<Math.PI*2;a+=0.105){                       /* stitching on the rail */
    c.beginPath();
    c.moveTo(TBL.cx+(TBL.rx+9)*Math.cos(a), TBL.cy+(TBL.ry+6)*Math.sin(a));
    c.lineTo(TBL.cx+(TBL.rx+20)*Math.cos(a), TBL.cy+(TBL.ry+13)*Math.sin(a));
    c.stroke();
  }
  var fg=c.createRadialGradient(TBL.cx,TBL.cy-60,20,TBL.cx,TBL.cy,TBL.rx);
  fg.addColorStop(0,"#1f7049"); fg.addColorStop(.42,"#12513a");
  fg.addColorStop(.78,"#0a3526"); fg.addColorStop(1,"#052018");
  c.fillStyle=fg; c.beginPath(); c.ellipse(TBL.cx,TBL.cy,TBL.rx,TBL.ry,0,0,7); c.fill();
  var sp=c.createRadialGradient(TBL.cx,TBL.cy-40,10,TBL.cx,TBL.cy-20,240);
  sp.addColorStop(0,"rgba(255,246,214,.13)"); sp.addColorStop(1,"rgba(255,246,214,0)");
  c.fillStyle=sp; c.beginPath(); c.ellipse(TBL.cx,TBL.cy,TBL.rx,TBL.ry,0,0,7); c.fill();
  c.strokeStyle="rgba(220,240,225,.10)"; c.lineWidth=2;
  c.beginPath(); c.ellipse(TBL.cx,TBL.cy,TBL.rx*0.72,TBL.ry*0.72,0,0,7); c.stroke();
  c.save(); c.globalAlpha=.12; c.fillStyle="#f4e7c8"; c.textAlign="center";
  c.font="700 20px Georgia, serif"; c.fillText(CASINO_NAME.toUpperCase(),TBL.cx,TBL.cy+86);
  c.font="10px Georgia, serif"; c.fillText("T E X A S   H O L D ’ E M",TBL.cx,TBL.cy+104);
  c.restore();
}

/* ---- the one with the cigar ----
   Every table has one. Drawn in the person's own coordinates, where the mouth
   sits at about (0,-75) and the head is twenty across, so it finds the corner
   of the mouth wherever the seats shuffle to. Purely decorative: it is painted
   from the clock, never from the game, so a dropped frame costs a puff of
   smoke and nothing else. */
function pokBob(t, seed){ return Math.sin(t*1.05 + seed) * 1.1; }
/* A draw every few seconds rather than a steady glow: the ember brightens,
   and the smoke thickens a moment later, which is the half of it that reads
   from across a table. */
function pokPull(t, seed){ return Math.pow(Math.max(0, Math.sin(t*0.55 + seed*1.7)), 10); }
var POK_CIGAR_LEN = 22, POK_CIGAR_TILT = 0.17;
/* Where the lit end is, in the person's own coordinates. */
function pokCigarTip(){
  return {x: 4 + POK_CIGAR_LEN*Math.cos(POK_CIGAR_TILT), y: -74 + POK_CIGAR_LEN*Math.sin(POK_CIGAR_TILT)};
}
function pokCigar(c, t, seed){
  var pull = pokPull(t, seed);
  c.save();
  c.translate(4, -74); c.rotate(POK_CIGAR_TILT);

  var ex = POK_CIGAR_LEN;                            /* the lit end, before rotating */
  c.fillStyle = "#4a2f1c"; pokRR(c, 0, -2.1, ex, 4.2, 2); c.fill();
  var wrap = c.createLinearGradient(0, -2.1, 0, 2.1);
  wrap.addColorStop(0, "rgba(255,226,182,.30)");
  wrap.addColorStop(.55, "rgba(0,0,0,0)");
  wrap.addColorStop(1, "rgba(0,0,0,.35)");
  c.fillStyle = wrap; pokRR(c, 0, -2.1, ex, 4.2, 2); c.fill();
  c.fillStyle = "#b98b3a"; c.fillRect(5.5, -2.1, 2.6, 4.2);      /* the band */
  c.fillStyle = "rgba(228,224,214,.75)";                          /* a finger of ash */
  pokRR(c, ex - 4.4, -2.1, 3, 4.2, 1.4); c.fill();

  var glow = 0.5 + 0.5 * pull;
  var g = c.createRadialGradient(ex, 0, 0, ex, 0, 7 + 3*pull);
  g.addColorStop(0, "rgba(255,170,70," + (0.5*glow).toFixed(3) + ")");
  g.addColorStop(1, "rgba(255,120,40,0)");
  c.fillStyle = g; c.beginPath(); c.arc(ex, 0, 7 + 3*pull, 0, 7); c.fill();
  c.fillStyle = "rgba(255," + Math.round(120 + 90*glow) + "," + Math.round(40 + 40*glow) + ",1)";
  c.beginPath(); c.ellipse(ex, 0, 2.1, 2.1, 0, 0, 7); c.fill();
  c.restore();
}

/* ---- the smoke ----
   Drawn in the scene, not in the person, and after every seat has been
   painted: it has to float away across the table and over whoever is
   sitting next to him, which it could not do from inside his own frame.
   Nothing about it is stored. Every puff's whole life is a function of the
   clock, so it costs nothing to keep and cannot get out of step with the
   game.

   Each puff rises, is caught by a slow drift that carries it off in the
   direction the cigar points, and swells and thins as it goes -- in fast,
   out slow, the way a puff arrives all at once and then hangs about.
   The lazier wide ones underneath are the haze that a room fills with. */
var POK_PUFFS = 28, POK_HAZE = 8;
function pokSmoke(c, x, y, s, t, seed){
  var pull = pokPull(t, seed), k, ph, rise, px, py, r, a, pg;
  for(k = 0; k < POK_PUFFS; k++){
    ph   = ((t*0.15 + k/POK_PUFFS + seed*0.13) % 1 + 1) % 1;
    rise = ph * 150 * s;
    px   = x + (2 + ph*ph*70 + Math.sin(ph*4.2 + k*1.9 + seed) * (3 + ph*20)) * s;
    py   = y - 5*s - rise + Math.cos(ph*3.1 + k*0.7) * 3 * s;
    r    = (2.6 + ph * 19) * s;
    a    = Math.min(1, ph*7) * Math.pow(1 - ph, 1.25) * 0.36 * (0.75 + 0.5*pull);
    pg   = c.createRadialGradient(px, py, 0, px, py, r);
    pg.addColorStop(0,  "rgba(232,229,222," + a.toFixed(3) + ")");
    pg.addColorStop(.6, "rgba(232,229,222," + (a*0.45).toFixed(3) + ")");
    pg.addColorStop(1,  "rgba(232,229,222,0)");
    c.fillStyle = pg; c.beginPath(); c.arc(px, py, r, 0, 7); c.fill();
  }
  /* the haze: slower, wider, barely there, and it never quite clears */
  for(k = 0; k < POK_HAZE; k++){
    ph   = ((t*0.06 + k/POK_HAZE + seed*0.29) % 1 + 1) % 1;
    px   = x + (10 + ph*95 + Math.sin(ph*2.6 + k*2.3) * 14) * s;
    py   = y - (40 + ph*130) * s;
    r    = (14 + ph * 26) * s;
    a    = Math.min(1, ph*4) * (1 - ph) * 0.12;
    pg   = c.createRadialGradient(px, py, 0, px, py, r);
    pg.addColorStop(0, "rgba(232,229,222," + a.toFixed(3) + ")");
    pg.addColorStop(1, "rgba(232,229,222,0)");
    c.fillStyle = pg; c.beginPath(); c.arc(px, py, r, 0, 7); c.fill();
  }
}

/* Dark glasses, for the one with the cigar. Drawn in the same coordinates as
   the wire pair they stand in for -- lenses over the eyes, a bridge between
   them, arms back toward the ears -- and painted after the eyes, so the eyes
   go behind them the way they should. */
function pokShades(c){
  c.save();
  c.strokeStyle = "rgba(18,15,13,.9)"; c.lineCap = "round";
  c.lineWidth = 1.8;                                  /* arms, back to the ears */
  c.beginPath(); c.moveTo(-12.4,-88.4); c.lineTo(-19.6,-86.6); c.stroke();
  c.beginPath(); c.moveTo( 12.4,-88.4); c.lineTo( 19.6,-86.6); c.stroke();
  c.lineWidth = 2.2;                                  /* bridge */
  c.beginPath(); c.moveTo(-2.4,-88.6); c.lineTo(2.4,-88.6); c.stroke();
  [-7.4, 7.4].forEach(function(lx){
    var g = c.createLinearGradient(lx-5.6,-90.6,lx+5.6,-81.6);
    g.addColorStop(0, "#42474f"); g.addColorStop(.45, "#15181d"); g.addColorStop(1, "#0a0c0f");
    c.fillStyle = g; pokRR(c, lx-5.6, -90.6, 11.2, 9, 4); c.fill();
    /* the glint, kept inside the lens rather than across the cheek */
    c.save();
    pokRR(c, lx-5.6, -90.6, 11.2, 9, 4); c.clip();
    c.fillStyle = "rgba(255,255,255,.20)";
    c.beginPath();
    c.moveTo(lx-4.8,-90.6); c.lineTo(lx-1.6,-90.6); c.lineTo(lx-4.4,-81.6); c.lineTo(lx-7.6,-81.6);
    c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = "rgba(232,224,206,.35)"; c.lineWidth = .9;
    pokRR(c, lx-5.6, -90.6, 11.2, 9, 4); c.stroke();
  });
  c.restore();
}
/* A fedora for him too, sat on the hair rather than instead of it, so what
   the hat does not cover still shows under the brim. The head is 40 across
   and its crown is at -109; the brim is wider than that on purpose, which is
   most of what makes a hat read as a hat at this size. */
function pokHat(c){
  c.save();
  var bg = c.createLinearGradient(0, -111, 0, -96);
  bg.addColorStop(0, "#3d342d"); bg.addColorStop(.55, "#241e1a"); bg.addColorStop(1, "#120f0d");
  c.fillStyle = bg;
  c.beginPath(); c.ellipse(0, -103.5, 29, 7.6, 0, 0, 7); c.fill();
  c.strokeStyle = "rgba(0,0,0,.5)"; c.lineWidth = 1;
  c.beginPath(); c.ellipse(0, -103.5, 29, 7.6, 0, 0, 7); c.stroke();

  var cg = c.createLinearGradient(-14, -122, 14, -102);
  cg.addColorStop(0, "#4c4239"); cg.addColorStop(.5, "#2a2420"); cg.addColorStop(1, "#141110");
  c.fillStyle = cg; pokRR(c, -14, -122, 28, 20, 9); c.fill();
  /* the crease, and a pinch either side of it */
  c.fillStyle = "rgba(0,0,0,.32)"; pokRR(c, -2.8, -122, 5.6, 11, 2.8); c.fill();
  c.fillStyle = "rgba(255,255,255,.06)";
  pokRR(c, -11.5, -121, 4, 9, 2); c.fill();
  pokRR(c,   7.5, -121, 4, 9, 2); c.fill();
  /* the band, and the light along the top of it */
  c.fillStyle = "#0d0a08"; c.fillRect(-14, -110, 28, 6);
  c.fillStyle = "rgba(255,255,255,.08)"; c.fillRect(-14, -110, 28, 1.5);
  c.restore();
}
/* A beard to go under the rest of it. Clipped to the head, so it takes the
   line of the jaw rather than being cut to one particular face, and it grows
   up the sides to meet the hair -- without that it is a bib. The mouth stays
   as a line drawn in it: a beard that swallows the mouth reads as a scarf. */
function pokBeard(c, o){
  c.save();
  /* A shade lower and wider than the head, so the beard hangs just past the
     jaw instead of being sliced off flush with it. */
  c.beginPath(); c.ellipse(0, -84, 20.5, 24, 0, 0, 7); c.clip();
  c.fillStyle = o.hair;
  /* The top edge is the whole shape of it: low across the lip, sweeping up at
     the sides to meet the hair. Everything below is jaw, and the clip cuts
     that to whatever the face is. */
  c.beginPath();
  c.moveTo(-21, -94);
  c.quadraticCurveTo(-12, -77, 0, -77);
  c.quadraticCurveTo( 12, -77, 21, -94);
  c.lineTo(21, -55); c.lineTo(-21, -55);
  c.closePath(); c.fill();
  /* a little shape in it, rather than one flat colour */
  var g = c.createLinearGradient(0, -80, 0, -60);
  g.addColorStop(0, "rgba(255,255,255,.07)"); g.addColorStop(1, "rgba(0,0,0,.30)");
  c.fillStyle = g; c.fill();
  c.fillStyle = "rgba(0,0,0,.20)";                    /* heavier over the lip */
  c.beginPath(); c.ellipse(0, -78.5, 9.5, 3, 0, 0, 7); c.fill();
  c.fillStyle = "rgba(0,0,0,.40)";                    /* and the mouth, a line in it */
  pokRR(c, -5, -74.8, 10, 1.6, .8); c.fill();
  c.restore();
}
/* A gold chain, worn over the collar rather than inside it -- inside, at this
   size, it is a scratch on the shirt. Drawn as links along the curve rather
   than a stroked line: a line reads as piping, a row of beads reads as gold.
   It hangs from the base of the neck and dips just past the point of the V,
   so it is plainly a chain and not a trim on the shirt. */
function pokChain(c){
  var x0 = -14, y0 = -52, cx = 0, cy = -14, x2 = 14, y2 = -52, N = 17;
  var i, t, u, x, y, g;
  c.save();
  for(i = 0; i <= N; i++){                            /* what it throws on the shirt */
    t = i/N; u = 1 - t;
    x = u*u*x0 + 2*u*t*cx + t*t*x2;
    y = u*u*y0 + 2*u*t*cy + t*t*y2;
    c.fillStyle = "rgba(0,0,0,.35)";
    c.beginPath(); c.arc(x, y + 1.2, 1.7, 0, 7); c.fill();
  }
  for(i = 0; i <= N; i++){
    t = i/N; u = 1 - t;
    x = u*u*x0 + 2*u*t*cx + t*t*x2;
    y = u*u*y0 + 2*u*t*cy + t*t*y2;
    g = c.createRadialGradient(x - .6, y - .7, 0, x, y, 2);
    g.addColorStop(0, "#fff1c4"); g.addColorStop(.5, "#e8c264"); g.addColorStop(1, "#9a7420");
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, 1.7, 0, 7); c.fill();
  }
  c.restore();
}
/* The suit. The jacket is the shirt colour swapped out before anything is
   drawn, so the sleeves come with it; this puts the rest on top -- the shirt
   showing in the opening and a lapel laid over each edge of it.

   The torso is a rounded rect 80 across with a 24 corner, so at the very top
   it is only 32 wide and the shoulders fall away fast. Everything here stays
   inside that: a lapel starting where a real shoulder is would be drawn on
   the wallpaper. */
var POK_SUIT = "#23262e";
function pokSuit(c){
  c.save();
  c.fillStyle = "#e7e1d3";
  c.beginPath(); c.moveTo(-14, -53); c.lineTo(0, -22); c.lineTo(14, -53); c.closePath(); c.fill();
  /* the shirt is behind the jacket, so it is in shadow where the jacket overhangs */
  var sg = c.createLinearGradient(0, -53, 0, -26);
  sg.addColorStop(0, "rgba(0,0,0,.30)"); sg.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = sg;
  c.beginPath(); c.moveTo(-14, -53); c.lineTo(0, -22); c.lineTo(14, -53); c.closePath(); c.fill();

  c.lineJoin = "round"; c.lineCap = "round";
  c.strokeStyle = "#3a4051"; c.lineWidth = 7;         /* the lapels */
  c.beginPath(); c.moveTo(-18, -52); c.lineTo(-1, -23); c.stroke();
  c.beginPath(); c.moveTo( 18, -52); c.lineTo( 1, -23); c.stroke();
  c.strokeStyle = "rgba(255,255,255,.11)"; c.lineWidth = 1.5;   /* light along each fold */
  c.beginPath(); c.moveTo(-15.5, -50.5); c.lineTo(-2.5, -26); c.stroke();
  c.beginPath(); c.moveTo( 15.5, -50.5); c.lineTo( 2.5, -26); c.stroke();

  /* The collar, worn out over the lapels, and the thing that stops the shirt
     reading as a grey triangle: without it the opening has a hard straight
     edge running under his chin. */
  c.fillStyle = "#dcd5c3";
  [-1, 1].forEach(function(k){
    c.beginPath();
    c.moveTo(k*3.5, -55.5); c.lineTo(k*15.5, -50.5); c.lineTo(k*3.5, -37);
    c.closePath(); c.fill();
  });
  c.strokeStyle = "rgba(0,0,0,.28)"; c.lineWidth = .9;
  [-1, 1].forEach(function(k){
    c.beginPath(); c.moveTo(k*3.5, -55.5); c.lineTo(k*15.5, -50.5); c.lineTo(k*3.5, -37); c.stroke();
  });

  /* The pocket square, in the breast pocket -- which is on his left, so on
     the viewer's right. A flat fold barely showing, not a fan of points:
     three points at this size are a row of teeth. The pocket is drawn first,
     a shade off the jacket so there is something for the cloth to come out
     of, and its welt goes over the foot of the square last. */
  c.fillStyle = "rgba(255,255,255,.055)"; c.fillRect(17, -31, 16.5, 10);
  c.fillStyle = "#e7e1d3";
  c.beginPath();
  c.moveTo(19, -30.2); c.lineTo(31.4, -32); c.lineTo(31.4, -35.4); c.lineTo(19, -33.6);
  c.closePath(); c.fill();
  var pg = c.createLinearGradient(19, -35.4, 31.4, -30.2);
  pg.addColorStop(0, "rgba(255,255,255,.20)"); pg.addColorStop(1, "rgba(0,0,0,.26)");
  c.fillStyle = pg; c.fill();
  c.strokeStyle = "rgba(0,0,0,.16)"; c.lineWidth = .7;   /* a crease in the cloth */
  c.beginPath(); c.moveTo(25, -34.5); c.lineTo(25, -31.2); c.stroke();
  c.fillStyle = "rgba(0,0,0,.5)";  c.fillRect(17, -31.6, 16.5, 1.7);
  c.fillStyle = "rgba(255,255,255,.10)"; c.fillRect(17, -31.9, 16.5, .6);
  c.restore();
}
/* A cane, stood against him on the side away from the cigar. It hugs the
   body rather than being planted out in the room: he is sitting at a table,
   and anything reaching far from him lands on the felt or on the next man's
   nameplate. The shaft stops just above where his own plate begins. */
function pokCane(c){
  c.save();
  c.lineCap = "round";
  c.strokeStyle = "rgba(0,0,0,.45)"; c.lineWidth = 3.6;     /* what it throws behind it */
  c.beginPath(); c.moveTo(-40.6, 17); c.lineTo(-46.6, -49); c.stroke();
  c.strokeStyle = "#3c2b1d"; c.lineWidth = 2.6;
  c.beginPath(); c.moveTo(-41, 16); c.lineTo(-47, -50); c.stroke();
  c.strokeStyle = "rgba(255,225,190,.18)"; c.lineWidth = .9; /* the light down one side */
  c.beginPath(); c.moveTo(-41.9, 15); c.lineTo(-47.9, -49); c.stroke();
  c.fillStyle = "#b98b3a";                                   /* the collar */
  c.beginPath(); c.ellipse(-46.7, -46.5, 2.3, 1.7, -.09, 0, 7); c.fill();
  var g = c.createRadialGradient(-48.7, -54.7, 0, -47.4, -53.2, 4.8);
  g.addColorStop(0, "#fff1c4"); g.addColorStop(.45, "#e8c264"); g.addColorStop(1, "#8a6a1e");
  c.fillStyle = g;                                           /* and the knob on top */
  c.beginPath(); c.arc(-47.4, -53.2, 4.2, 0, 7); c.fill();
  c.restore();
}
function pokPerson(c,x,y,s,o,t,seed,dim,cigar){
  /* Swapped before a stroke is drawn, so the sleeves are jacket too. */
  if(cigar) o = {skin:o.skin, hair:o.hair, shirt:POK_SUIT, style:o.style, glasses:o.glasses};
  var br=pokBob(t,seed);
  c.save(); c.translate(x,y+br); c.scale(s,s);
  if(dim) c.globalAlpha=0.42;
  c.fillStyle=o.shirt;
  c.save(); c.rotate(-0.40); pokRR(c,-48,-6,46,16,8); c.fill(); c.restore();
  c.save(); c.rotate( 0.40); pokRR(c,  2,-6,46,16,8); c.fill(); c.restore();
  c.fillStyle=o.skin;
  c.beginPath(); c.ellipse(-44,6,8,6,-0.4,0,7); c.fill();
  c.beginPath(); c.ellipse( 44,6,8,6, 0.4,0,7); c.fill();
  var tg=c.createLinearGradient(-38,-56,38,12);
  tg.addColorStop(0,"rgba(255,255,255,.13)"); tg.addColorStop(.35,o.shirt); tg.addColorStop(1,"rgba(0,0,0,.6)");
  c.fillStyle=o.shirt; pokRR(c,-40,-54,80,68,24); c.fill();
  c.fillStyle=tg; pokRR(c,-40,-54,80,68,24); c.fill();
  c.fillStyle="rgba(0,0,0,.35)";
  c.beginPath(); c.moveTo(-13,-54); c.lineTo(0,-36); c.lineTo(13,-54); c.closePath(); c.fill();
  c.fillStyle=o.skin; pokRR(c,-9,-74,18,22,7); c.fill();
  c.fillStyle="rgba(0,0,0,.28)"; pokRR(c,-9,-74,18,8,4); c.fill();
  c.fillStyle=o.skin;
  c.beginPath(); c.ellipse(0,-86,20,23,0,0,7); c.fill();
  c.beginPath(); c.ellipse(-20,-86,4,6,0,0,7); c.fill();
  c.beginPath(); c.ellipse( 20,-86,4,6,0,0,7); c.fill();
  var hg=c.createLinearGradient(-20,-96,20,-70);
  hg.addColorStop(0,"rgba(255,240,220,.16)"); hg.addColorStop(.55,"rgba(0,0,0,0)"); hg.addColorStop(1,"rgba(0,0,0,.30)");
  c.fillStyle=hg; c.beginPath(); c.ellipse(0,-86,20,23,0,0,7); c.fill();
  c.fillStyle=o.hair;
  if(o.style===0){ c.beginPath(); c.ellipse(0,-94,21,16,0,Math.PI,0); c.fill(); c.fillRect(-21,-95,42,10); }
  else if(o.style===1){ c.beginPath(); c.ellipse(0,-92,23,21,0,0,7); c.fill();
    c.fillStyle=o.skin; c.beginPath(); c.ellipse(0,-80,17,15,0,0,7); c.fill(); }
  else { c.beginPath(); c.ellipse(0,-97,20,11,0,Math.PI,0); c.fill(); c.fillRect(-20,-98,40,5); }
  c.fillStyle="rgba(15,10,8,.55)"; c.fillRect(-11,-93,8,2); c.fillRect(3,-93,8,2);
  c.fillStyle="rgba(15,10,8,.9)";
  c.beginPath(); c.ellipse(-7,-86,2.7,2.2,0,0,7); c.fill();
  c.beginPath(); c.ellipse( 7,-86,2.7,2.2,0,0,7); c.fill();
  c.fillStyle="rgba(0,0,0,.22)"; pokRR(c,-5,-75,10,2,1); c.fill();
  /* The smoker wears the dark pair, whichever he turned up in: the two never
     sit on the same face. */
  if(cigar) pokShades(c);
  else if(o.glasses){
    c.strokeStyle="rgba(235,225,205,.6)"; c.lineWidth=1.6;
    c.beginPath(); c.arc(-7,-86,7,0,7); c.stroke();
    c.beginPath(); c.arc( 7,-86,7,0,7); c.stroke();
    c.beginPath(); c.moveTo(-1,-86); c.lineTo(1,-86); c.stroke();
  }
  if(cigar){ pokSuit(c); pokChain(c); pokBeard(c, o); pokHat(c); pokCane(c); pokCigar(c, t, seed); }
  c.restore();
}

function pokCard(c,x,y,rot,s,cd,down){
  c.save(); c.translate(x,y); c.rotate(rot); c.scale(s,s);
  c.shadowColor="rgba(0,0,0,.6)"; c.shadowBlur=9; c.shadowOffsetY=4;
  if(down || !cd){
    var bgr=c.createLinearGradient(-17,-24,17,24);
    bgr.addColorStop(0,"#8a2330"); bgr.addColorStop(1,"#4a0f18");
    c.fillStyle=bgr; pokRR(c,-17,-24,34,48,4); c.fill(); c.shadowColor="transparent";
    c.strokeStyle="rgba(255,225,190,.32)"; c.lineWidth=1; pokRR(c,-13,-20,26,40,3); c.stroke();
    c.fillStyle="rgba(255,225,190,.2)"; c.beginPath(); c.arc(0,0,5,0,7); c.fill();
  }else{
    var cg=c.createLinearGradient(-17,-24,17,24);
    cg.addColorStop(0,"#fffdf6"); cg.addColorStop(1,"#e9e2d0");
    c.fillStyle=cg; pokRR(c,-17,-24,34,48,4); c.fill(); c.shadowColor="transparent";
    c.strokeStyle="rgba(0,0,0,.18)"; c.lineWidth=.8; pokRR(c,-17,-24,34,48,4); c.stroke();
    c.fillStyle=cd.su.red ? "#b3242e" : "#15110d";
    c.font="700 13px Georgia, serif"; c.textAlign="left"; c.fillText(cd.r,-14,-10);
    c.font="11px Georgia, serif"; c.fillText(cd.su.s,-14,2);
    c.font="21px Georgia, serif"; c.textAlign="center"; c.fillText(cd.su.s,3,17);
  }
  c.restore();
}
function pokChips(c,x,y,n,col){
  for(var i=0;i<n;i++){ var yy=y-i*3.3;
    c.fillStyle="rgba(0,0,0,.4)"; c.beginPath(); c.ellipse(x,yy+1.7,11,4.5,0,0,7); c.fill();
    c.fillStyle=col; c.beginPath(); c.ellipse(x,yy,11,4.5,0,0,7); c.fill();
    c.strokeStyle="rgba(255,255,255,.4)"; c.lineWidth=.8;
    c.beginPath(); c.ellipse(x,yy,11,4.5,0,0,7); c.stroke();
  }
}
/* Chips are a picture of the money, not the money: a tall stack would run off
   the table, so the count is capped and the number beside it stays exact. */
function pokStackH(n){ return Math.max(0, Math.min(9, Math.round(n/60))); }

/* ---- your own stack, as the chips it would be ----
   Everyone else's pile is one colour and a rough height, which is all you can
   tell of a stack across a table. Yours is in front of you, so it is racked
   the way you would rack it: two-fifties, hundreds, fifties, twenties, tens
   and fives, largest first, and the exact figure written underneath -- the
   figure is still the only thing that is precise. Greedy on purpose, which
   gives the fewest chips, and anything under a five has no chip to sit in.
   The colours are the ones on the raise buttons, so a chip means the same
   thing wherever it turns up and is learned once. */
/* `from` is the buy-in at which a chip comes into play, the same figures the
   raise buttons tier on. The bottom six are always in play. At the top the
   rack runs one denomination higher than the buttons do -- the biggest chip
   you can be holding is not the biggest one you would build a raise out of,
   which is why a real table has plaques as well as chips.
   The thousand is written 1K: it is the only four-figure chip, and spelled
   out it is wide enough to run into its neighbour once a stack is deep
   enough to have eight piles standing side by side. */
var POK_RACK = [
  {v:10000, col:"#9c2b45", from:1000000, label:"10K"},
  {v:1000, col:"#c87a22", from:30000, label:"1K"},
  {v:500,  col:"#23897d", from:5000},
  {v:250,  col:"#dd6d95", from:0},
  {v:100,  col:"#3a3a3a", from:0},
  {v:50,   col:"#7f5ad6", from:0},
  {v:20,   col:"#3c6ea8", from:0},
  {v:10,   col:"#4c9d6b", from:0},
  {v:5,    col:"#e05a5f", from:0}
];
/* A pile is 25 chips and then you start another one beside it, the way they
   actually come off a table -- a rack is five piles of twenty, and nobody
   stacks higher than about this before it topples. */
var POK_PILE = 25;
/* Nine, because at the top buy-in nine denominations can be on the table at
   once and every one of them is owed a pile. Greedy leaves at most a handful
   of anything below the top chip, so this is only ever reached by a stack
   that genuinely holds one of each. */
var POK_PILES_MAX = 9;
function pokRack(n){
  var left = Math.max(0, Math.floor(n)), out = [], buyin = pokBuyinNow();
  POK_RACK.forEach(function(d){
    if(buyin < d.from) return;                       /* not a chip this table plays with */
    var many = Math.floor(left / d.v);
    if(many){ out.push({v:d.v, col:d.col, label:d.label || String(d.v), count:many}); left -= many * d.v; }
  });
  return out;
}
/* Greedy leaves at most two of anything below the top denomination, so in
   practice only the 250s ever run past one pile. The budget still keeps a
   pile back for every denomination yet to come, so a mountain of 250s can
   never crowd your fives off the end. */
function pokPiles(n){
  var rack = pokRack(n), out = [];
  rack.forEach(function(st, i){
    var behind = rack.length - i - 1;
    var room   = Math.max(1, POK_PILES_MAX - out.length - behind);
    var want   = Math.ceil(st.count / POK_PILE);
    var draw   = Math.min(want, room);
    for(var k = 0; k < draw; k++){
      /* The last pile drawn carries the whole count when there was not room
         for the rest: a short pile that lied about the total would be worse
         than a number. */
      var capped = (k === draw - 1) && draw < want;
      out.push({
        v: st.v, col: st.col, label: st.label,
        count: capped ? POK_PILE : Math.min(POK_PILE, st.count - k * POK_PILE),
        more:  capped ? st.count : 0
      });
    }
  });
  return out;
}
/* ---- the chips you raise with ----
   Five buttons is all the row holds, so at a big buy-in they have to earn the
   space: a 20 is loose change in a thousand-chip game and a 10 is nothing at
   all in a five-thousand one. The buttons are the ones already in the page --
   only the number on them changes -- so the click handler bound at load
   keeps working, reading the value off the button at the moment it is hit. */
/* Each step up drops the chip that has become loose change and brings in one
   worth clicking, so the raise you actually mean is never more than a few
   presses away. Read top down: the first tier your buy-in reaches is yours.
   "At this buy-in and up", so a table bought for exactly the figure gets the
   chips -- a thousand is the largest buy-in the buttons offer, and a rule you
   cannot reach from the buttons is no rule at all. */
var POK_CHIP_TIERS = [
  {from: 1000000, chips: [100, 250, 500, 1000, 5000]},/* the 5 goes */
  {from: 30000, chips: [5, 100, 250, 500, 1000]},     /* the 50 goes */
  {from:  5000, chips: [5,  50, 100, 250,  500]},     /* the 10 goes */
  {from:  1000, chips: [5,  10,  50, 100,  250]},     /* the 20 goes */
  {from:     0, chips: [5,  10,  20,  50,  100]}
];
function pokBuyinNow(){
  if(pokRemote && typeof mpRoom !== "undefined" && mpRoom) return mpRoom.buyin || 0;
  return pok.buyin;
}
function pokChipSet(){
  var buyin = pokBuyinNow(), i;
  for(i = 0; i < POK_CHIP_TIERS.length; i++)
    if(buyin >= POK_CHIP_TIERS[i].from) return POK_CHIP_TIERS[i].chips;
  return POK_CHIP_TIERS[POK_CHIP_TIERS.length - 1].chips;
}
function pokTuneRaiseChips(){
  var set = pokChipSet();
  Array.prototype.forEach.call(document.querySelectorAll("#pokRaiseChips .pok-chip"), function(b, i){
    if(Number(b.dataset.r) === set[i]) return;
    b.dataset.r = set[i];
    b.textContent = String(set[i]);
  });
}

/* The pill is cut to fit what is in it. A fixed box big enough for a
   twenty-five pile would sit there mostly empty for the whole of a normal
   game, and one sized for a normal game would have chips standing out of the
   top of it. It is pinned by its bottom edge, so it grows upwards as you win
   and the figure underneath never moves. */
function pokHeroStackBox(c, me){
  var piles = pokPiles(me.stack), n = piles.length;
  var pitch = n > 1 ? Math.min(28, 178 / (n - 1)) : 0;
  var tall = 1, capped = false;
  piles.forEach(function(p){ if(p.count > tall) tall = p.count; if(p.more) capped = true; });
  /* Chips sit four apart while a pile can afford it and close up after that,
     so no pile is ever taller than about sixty -- which is roughly what
     twenty-five real chips look like beside a chip's width anyway. */
  var step = tall > 14 ? Math.max(1.8, 56 / (tall - 1)) : 4;
  var chipsH = 9.6 + (tall - 1) * step + (capped ? 11 : 0);
  c.save();
  c.font = "800 " + pokFont(10) + "px system-ui,sans-serif";
  var figure = c.measureText(fmt(me.stack)).width;
  /* The face values have to fit the gap between the piles, and on a phone the
     type is scaled up against a small canvas until three figures are wider
     than the gap is. The widest label decides the size for all of them, so
     they stay a set -- and at any ordinary stack it decides on the full size
     and nothing changes. */
  var labelPx = pokFont(8), widest = 0;
  c.font = "800 " + labelPx + "px system-ui,sans-serif";
  piles.forEach(function(p){ var w = c.measureText(p.label).width; if(w > widest) widest = w; });
  if(pitch && widest > pitch - 2) labelPx = Math.max(7, Math.floor(labelPx * (pitch - 2) / widest));
  c.restore();
  var w = Math.min(210, Math.max((n ? (n - 1) * pitch + 24 : 0) + 28, figure + 26, 92));
  var h = chipsH + 38;
  var bottom = pokHeroY() + 34;
  return {cx: TBL.cx + 176, w: w, h: h, top: bottom - h,
          piles: piles, pitch: pitch, step: step, base: bottom - 26, labelPx: labelPx};
}
/* Your own bubble hangs off the top of the pill, wherever the pill has got to. */
function pokHeroSayY(){
  var me = pok.T && pok.T.players[0];
  return me ? pokHeroStackBox(pokCtx, me).top - 6 : pokHeroY() - 56;
}
function pokDrawHeroStack(c, T, me){
  c.save();
  var b = pokHeroStackBox(c, me), turn = T.toAct === 0;
  c.fillStyle = turn ? "rgba(232,194,100,.2)" : "rgba(0,0,0,.55)";
  pokRR(c, b.cx - b.w/2, b.top, b.w, b.h, 9); c.fill();
  c.strokeStyle = turn ? "rgba(232,194,100,.85)" : "rgba(232,194,100,.25)";
  c.lineWidth = turn ? 2 : 1; c.stroke();

  var x0 = b.cx - (b.piles.length - 1) * b.pitch / 2;
  var drop = Math.min(1.8, b.step * 0.45);            /* the shadow closes up with them */
  b.piles.forEach(function(p, i){
    var x = x0 + i * b.pitch;
    for(var k = 0; k < p.count; k++){
      var yy = b.base - k * b.step;
      c.fillStyle = "rgba(0,0,0,.45)"; c.beginPath(); c.ellipse(x, yy + drop, 12, 4.8, 0, 0, 7); c.fill();
      c.fillStyle = p.col;             c.beginPath(); c.ellipse(x, yy, 12, 4.8, 0, 0, 7); c.fill();
      c.strokeStyle = "rgba(255,255,255,.42)"; c.lineWidth = .8;
      c.beginPath(); c.ellipse(x, yy, 12, 4.8, 0, 0, 7); c.stroke();
    }
    /* The first pile of a denomination is labelled and the ones beside it are
       not: they are the same colour and they are touching, so the label would
       only be repeating itself -- and once a stack runs to five or six piles
       the labels are close enough together to collide. */
    var topY = b.base - (p.count - 1) * b.step;
    if(i === 0 || b.piles[i-1].v !== p.v){
      c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "800 " + b.labelPx + "px system-ui,sans-serif";
      c.fillText(p.label, x, topY - .2);
    }
    if(p.more){
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "rgba(244,234,215,.85)"; c.font = "700 " + b.labelPx + "px system-ui,sans-serif";
      c.fillText("\u00d7" + p.more, x, topY - 11);
    }
  });
  c.textBaseline = "alphabetic";
  c.textAlign = "center"; c.fillStyle = "#efe2c2";
  c.font = "800 " + pokFont(10) + "px system-ui,sans-serif";
  c.fillText(fmt(me.stack), b.cx, b.top + b.h - 8);
  c.restore();
}

/* ---- dealing ----
   Cards are thrown from the dealer's hands to where they will sit. A slot is
   only painted at rest once its card has landed, so nothing is ever drawn in
   two places at once, and the pile arrives in the order it was dealt. */
var pokFly = [], pokBoardShown = 0;

/* Queued the moment a street closes rather than noticed later by the renderer.
   Watching for the change a frame afterwards read the bets as they stood BEFORE
   the closing action, so the bet that ended the street was swept short or not
   at all -- and with no frames running (another tab, a hidden window) the whole
   thing fired once, streets late, out of spots that were long empty. */
function pokSweepBets(bets){
  for(var i=0; i<bets.length; i++)
    if(bets[i] > 0)
      pokChipMove(pokSeatBetPt(i), pokPotPt(), pokStackH(bets[i])+1, "#c9a227", i*55);
}
/* The bets as they stand at this instant, with the chips this action is about
   to add already counted in. */
function pokBetSnapshot(T, seat, spend){
  var snap = T.players.map(function(p){ return p.bet; });
  snap[seat] += spend || 0;
  return snap;
}

function pokDrawSay(c, cx, y, text){
  var fs = pokFont(11);
  c.save();
  c.font = "700 " + fs + "px system-ui,sans-serif";
  var w = c.measureText(text).width + 18, h = fs + 14, x = cx - w/2;
  c.fillStyle = "rgba(16,12,9,.9)";
  pokRR(c, x, y-h, w, h, 8); c.fill();
  c.strokeStyle = "rgba(232,194,100,.5)"; c.lineWidth = 1; c.stroke();
  c.beginPath(); c.moveTo(cx-5, y-1); c.lineTo(cx+5, y-1); c.lineTo(cx, y+7); c.closePath();
  c.fillStyle = "rgba(16,12,9,.9)"; c.fill();
  c.fillStyle = "#f2e6c8"; c.textAlign = "center";
  c.fillText(text, cx, y - h/2 + fs*0.36);
  c.restore();
}
/* Fades out over its last third of a second so a move does not simply vanish. */
function pokSayFor(c, seat, x, y){
  var said = pok.say[seat];
  if(!said) return;
  var left = said.until - Date.now();
  if(left <= 0){ delete pok.say[seat]; return; }
  c.save(); c.globalAlpha = Math.min(1, left/350);
  pokDrawSay(c, x, y, said.text);
  c.restore();
}
function pokDrawChipFly(c){
  var now = Date.now();
  for(var i=pokChipFly.length-1; i>=0; i--){
    var f = pokChipFly[i], p = (now - f.start)/f.dur;
    if(p >= 1){ pokChipFly.splice(i,1); continue; }
    if(p <= 0) continue;
    var e = 1 - Math.pow(1-p, 2);
    pokChips(c, f.x0 + (f.x1-f.x0)*e,
                f.y0 + (f.y1-f.y0)*e - Math.sin(p*Math.PI)*16, f.n, f.col);
  }
}
/* The player's own cards used to sit 18px off the bottom of the scene, which
   hung them over the edge and cut them in half on a short screen. Everything on
   the felt is now placed as a fraction of the scene height, so the layout
   breathes with the box instead of running off it. */
function pokHeroY(){ return POK_H*0.915; }
function pokHeroS(){ return 1.26*Math.min(1, POK_H/520); }
function pokBoardY(){ return TBL.cy - POK_H*0.085; }
function pokPotY(){   return TBL.cy - POK_H*0.20; }

function pokDealPos(kind, seat, idx){
  if(kind === "board") return {x:TBL.cx+(idx-2)*50, y:pokBoardY(), rot:0, s:0.96};
  if(seat === 0) return {x:TBL.cx+(idx?32:-32), y:pokHeroY(), rot:idx?0.12:-0.12, s:pokHeroS()};
  var deg = POK_SEAT_DEG[seat-1], cf = onFelt(deg,0.76);
  return {x:cf.x+(idx?10:-10), y:cf.y, rot:(deg-270)*Math.PI/180*0.30, s:0.64};
}
/* ---- the sound of a card landing ----
   Scheduled when the card is thrown rather than played when it is painted.
   Painting stops while the tab is in the background, so a sound tied to it
   would either be lost or, worse, come back and play a whole deal at once
   the moment you returned. The handles are kept so a deal can be called off
   -- standing up mid-hand should not leave cards landing behind you. */
var pokSndTimers = [];
function pokCardSound(ms){
  if(typeof soundOn !== "undefined" && !soundOn) return;
  pokSndTimers.push(setTimeout(function(){
    if(typeof playCard === "function") playCard();
  }, Math.max(0, ms)));
}
function pokHushCards(){
  pokSndTimers.forEach(clearTimeout);
  pokSndTimers = [];
}
function pokQueueDeal(T){
  pokFly = []; pokBoardShown = 0;
  pokHushCards();
  var now = Date.now(), k = 0;
  /* one card each, round the table twice, starting left of the button */
  for(var round=0; round<2; round++){
    for(var i=0; i<T.players.length; i++){
      var seat = (T.dealer + 1 + i) % T.players.length;
      if(!T.players[seat].inHand) continue;
      pokFly.push({kind:"hole", seat:seat, idx:round, start:now + pokMs(k*80), dur:pokMs(260)});
      pokCardSound(pokMs(k*80) + pokMs(260));        /* as it lands, not as it leaves */
      k++;
    }
  }
}
/* Answered from the clock, not from whether a frame happened to run. Pruning
   only occurs while painting, and requestAnimationFrame stops when the tab is
   hidden -- tying "has it landed?" to that meant switching away mid-deal could
   bring you back to a table with no cards on it. */
function pokLanded(kind, seat, idx){
  var now = Date.now();
  for(var i=0; i<pokFly.length; i++){
    var f = pokFly[i];
    if(f.kind === kind && f.idx === idx && (kind === "board" || f.seat === seat))
      return now >= f.start + f.dur;
  }
  return true;
}
function pokDrawFlights(c){
  var now = Date.now(), dp = seatPos(POK_DEALER_DEG);
  for(var i=pokFly.length-1; i>=0; i--){
    var f = pokFly[i], p = (now - f.start) / f.dur;
    if(p >= 1){ pokFly.splice(i,1); continue; }      /* landed: the slot paints it now */
    if(p <= 0) continue;                              /* still in the dealer's hands */
    var to = pokDealPos(f.kind, f.seat, f.idx);
    var e = 1 - Math.pow(1 - p, 3);                   /* ease out, like a card losing speed */
    c.save();
    c.globalAlpha = Math.min(1, p*4);
    pokCard(c,
      dp.x + (to.x - dp.x)*e,
      dp.y - 6 + (to.y - (dp.y-6))*e - Math.sin(p*Math.PI)*20,   /* a little lift */
      to.rot*e, 0.5 + (to.s-0.5)*e, null, true);
    c.restore();
  }
}

function pokScene(t){
  var c = pokCtx, T = pok.T;
  c.clearRect(0,0,POK_W,POK_H);

  var lay = pokLayer || (pokLayer = document.createElement("canvas"));
  lay.width = POK_W; lay.height = POK_ROOM;
  var lc = lay.getContext("2d");
  lc.drawImage(pokBg,0,0);
  POK_WALK.forEach(function(p){
    p.x += p.dir*p.sp*0.55;
    if(p.x < -40) p.x = POK_W+40;
    if(p.x > POK_W+40) p.x = -40;
    pokWalker(lc,p,t);
  });
  /* composited through a blur: a real depth of field does more for how solid
     the table looks than any amount of detail painted behind it */
  c.save(); c.filter = "blur(2.6px)"; c.drawImage(lay,0,0); c.restore();

  pokDrawTable(c);

  var dp = seatPos(POK_DEALER_DEG);
  pokPerson(c,dp.x,dp.y-24,0.72,{skin:"#e8b98a",hair:"#191210",shirt:"#20242a",style:0,glasses:false},t,0.4,false);
  c.save(); c.translate(dp.x,dp.y-24); c.scale(0.72,0.72);
  c.fillStyle="#ece6d8"; pokRR(c,-15,-62,30,16,4); c.fill();
  c.fillStyle="#8d1f2b";
  c.beginPath(); c.moveTo(-10,-56); c.lineTo(0,-50); c.lineTo(-10,-44); c.closePath(); c.fill();
  c.beginPath(); c.moveTo( 10,-56); c.lineTo(0,-50); c.lineTo( 10,-44); c.closePath(); c.fill();
  c.restore();
  var tray = onFelt(POK_DEALER_DEG,0.70);
  c.save(); c.fillStyle="rgba(18,11,7,.7)"; pokRR(c,tray.x-66,tray.y-9,132,19,7); c.fill();
  c.strokeStyle="rgba(255,210,150,.16)"; c.lineWidth=1; c.stroke();
  ["#c9a227","#b3242e","#1f6fae","#2f8f5a","#c9a227"].forEach(function(col,i){
    c.fillStyle=col; c.beginPath(); c.ellipse(tray.x-52+i*26,tray.y,11,4.4,0,0,7); c.fill();
    c.strokeStyle="rgba(255,255,255,.35)"; c.stroke();
  });
  c.restore();

  if(!T){ pokVignette(c); return; }
  pokRenderHandInfo(T);

  /* A folded player is not drawn at all -- no ghost at the felt, no empty
     chair either -- and whoever is left in their arm (left: seats 1-2, right:
     seats 3-4) closes ranks across that arm's own span. Recomputed every
     frame off the engine's own T.players[].inHand, so it can never drift out
     of step with a fold the moment it happens. */
  var seatDegs = pokAnimateSeatDegs(pokLiveSeatDegs(T)), smokeAt = null;
  for(var seat = 1; seat <= 4; seat++){
    var deg = seatDegs[seat];
    if(deg === undefined) continue;                   /* folded: nothing here */
    var i = seat - 1, p = T.players[seat], sp2 = seatPos(deg), turn = T.toAct === seat;
    pokPerson(c,sp2.x,sp2.y-10,0.86,POK_LOOK[i],t,i*2.1,false,seat === pok.cigar);
    if(seat === pok.cigar){                           /* the plume waits until everyone is painted */
      var tip = pokCigarTip();
      smokeAt = {x: sp2.x + tip.x*0.86, y: sp2.y - 10 + pokBob(t,i*2.1) + tip.y*0.86, seed: i*2.1};
    }

    var cf = onFelt(deg,0.76), rot = (deg-270)*Math.PI/180*0.30;
    if(p.hole.length){
      var show = pok.revealed && T.stage === "done";
      if(pokLanded("hole",seat,0)) pokCard(c,cf.x-10,cf.y,rot,0.64,show?p.hole[0]:null,!show);
      if(pokLanded("hole",seat,1)) pokCard(c,cf.x+10,cf.y,rot,0.64,show?p.hole[1]:null,!show);
    }
    /* Stacks sit inboard, toward the middle of the table. Pushed outward they
       land under the seat's own nameplate on the shallow right-hand chairs. */
    var chipSide = Math.cos(deg*Math.PI/180) > 0 ? -42 : 42;
    pokChips(c,cf.x+chipSide,cf.y+5,pokStackH(p.stack),POK_CHIPCOL[i]);
    if(p.bet > 0){                                    /* chips pushed out in front */
      var bp = onFelt(deg,0.52);
      pokChips(c,bp.x,bp.y,Math.max(1,pokStackH(p.bet)),"#c9a227");
      c.fillStyle="rgba(244,234,215,.8)"; c.textAlign="center";
      c.font="700 "+pokFont(11)+"px system-ui,sans-serif"; c.fillText(fmt(p.bet),bp.x,bp.y+16);
    }
    if(T.dealer === seat){
      var bt = onFelt(deg,0.90);
      c.fillStyle="#f2ead6"; c.beginPath(); c.arc(bt.x-26,bt.y,9,0,7); c.fill();
      c.fillStyle="#1a1410"; c.textAlign="center"; c.font="700 10px system-ui,sans-serif";
      c.fillText("D",bt.x-26,bt.y+3.5);
    }

    var won = null;
    T.lastWinners.forEach(function(w){ if(w.id === seat) won = w; });
    c.save();
    c.fillStyle = turn ? "rgba(232,194,100,.20)" : "rgba(0,0,0,.55)";
    pokRR(c,sp2.x-44,sp2.y+16,88,31,9); c.fill();
    c.strokeStyle = turn ? "rgba(232,194,100,.85)" : "rgba(232,194,100,.25)";
    c.lineWidth = turn ? 2 : 1; c.stroke();
    c.textAlign="center"; c.fillStyle="#efe2c2";
    c.font="700 "+pokFont(11)+"px system-ui,sans-serif"; c.fillText(p.name,sp2.x,sp2.y+29);
    if(won){ c.fillStyle="#5fd39a"; c.font="700 "+pokFont(12)+"px system-ui,sans-serif";
      c.fillText("+"+fmt(won.won),sp2.x,sp2.y+42); }
    else if(p.allIn){ c.fillStyle="#e08a4a"; c.font="700 "+pokFont(11)+"px system-ui,sans-serif";
      c.fillText("ALL IN",sp2.x,sp2.y+42); }
    else { c.fillStyle="#e8c264"; c.font="700 "+pokFont(13)+"px system-ui,sans-serif";
      c.fillText(fmt(p.stack),sp2.x,sp2.y+42); }
    c.restore();
    pokSayFor(c, seat, sp2.x, sp2.y - (seat === pok.cigar ? 122 : 106));
  }
  if(smokeAt) pokSmoke(c, smokeAt.x, smokeAt.y, 0.86, t, smokeAt.seed);

  if(T.board.length > pokBoardShown){
    for(var bi=pokBoardShown; bi<T.board.length; bi++){
      pokFly.push({kind:"board", idx:bi, start:Date.now()+pokMs((bi-pokBoardShown)*110), dur:pokMs(250)});
      pokCardSound(pokMs((bi-pokBoardShown)*110) + pokMs(250));
    }
    pokBoardShown = T.board.length;
  }

  var pot = T.stage === "done" ? T.lastPot : pokPot(T);
  if(pot > 0){
    pokChips(c,TBL.cx-46,pokPotY(),Math.max(1,pokStackH(pot)),"#c9a227");
    c.fillStyle="rgba(244,234,215,.92)"; c.textAlign="left";
    c.font="700 "+pokFont(14)+"px system-ui,sans-serif"; c.fillText("POT "+fmt(pot),TBL.cx-22,pokPotY()+4);
  }
  T.board.forEach(function(cd,i){
    if(pokLanded("board",0,i)) pokCard(c,TBL.cx+(i-2)*50,pokBoardY(),0,0.96,cd,false);
  });

  var me = T.players[0];
  if(me.hole.length){
    var hy = pokHeroY(), hs = pokHeroS();
    /* a soft pool of light under them, so it reads at a glance which two are yours */
    var hl = c.createRadialGradient(TBL.cx,hy,4,TBL.cx,hy,86);
    hl.addColorStop(0,"rgba(255,240,200,.16)"); hl.addColorStop(1,"rgba(255,240,200,0)");
    c.fillStyle=hl; c.beginPath(); c.ellipse(TBL.cx,hy,86,44,0,0,7); c.fill();
    if(pokLanded("hole",0,0)) pokCard(c,TBL.cx-32,hy,-0.12,hs,me.hole[0],false);
    if(pokLanded("hole",0,1)) pokCard(c,TBL.cx+32,hy, 0.12,hs,me.hole[1],false);
  }
  if(T.dealer === 0){
    c.fillStyle="#f2ead6"; c.beginPath(); c.arc(TBL.cx-110,pokHeroY()-32,9,0,7); c.fill();
    c.fillStyle="#1a1410"; c.textAlign="center"; c.font="700 10px system-ui,sans-serif";
    c.fillText("D",TBL.cx-110,pokHeroY()-28.5);
  }
  if(me.bet > 0){
    pokChips(c,TBL.cx-150,pokHeroBetY(),Math.max(1,pokStackH(me.bet)),"#c9a227");
    c.fillStyle="rgba(244,234,215,.8)"; c.textAlign="center";
    c.font="700 "+pokFont(11)+"px system-ui,sans-serif"; c.fillText(fmt(me.bet),TBL.cx-150,pokHeroBetY()+16);
  }
  pokDrawHeroStack(c, T, me);

  /* Beside your stack rather than over your cards: centred, it landed on the
     community cards, and on a short scene there is no gap between the board and
     your own hand to put it in. */
  pokSayFor(c, 0, TBL.cx+176, pokHeroSayY());
  pokDrawChipFly(c);
  pokDrawFlights(c);
  pokDrawMessage(c);
  pokVignette(c);
}
var pokLayer = null;
/* The table's own headline. The DOM message sits at the top of the card for
   the buy-in screen; once you are seated the felt carries it instead, drawn
   big across the top where you are actually looking -- and, unlike the DOM
   one, it is still there in fullscreen. */
/* Greedy wrap at word boundaries, capped at maxLines; the last line keeps
   whatever is left rather than dropping it. */
function pokWrapText(c, text, maxW, maxLines){
  var words = String(text).split(/\s+/), lines = [], cur = "";
  for(var i = 0; i < words.length; i++){
    var next = cur ? cur + " " + words[i] : words[i];
    if(!cur || c.measureText(next).width <= maxW){ cur = next; continue; }
    lines.push(cur);
    cur = words[i];
    if(lines.length === maxLines - 1){                /* last line takes the rest */
      cur = words.slice(i).join(" ");
      break;
    }
  }
  if(cur) lines.push(cur);
  return lines.slice(0, maxLines);
}
function pokDrawMessage(c){
  var el = document.getElementById(pokMsgId);
  if(!el) return;
  var text = (el.textContent || "").trim();
  if(!text) return;
  var cls = el.className || "";
  var col = /\bwin\b/.test(cls)  ? "#5fd39a"
          : /\blose\b/.test(cls) ? "#e2645f"
          : "#f2e6c8";
  var fs = pokFont(18);
  c.save();
  c.font = "700 " + fs + "px system-ui,sans-serif";
  c.textAlign = "center";
  /* Capped well short of the full width: the hand readout sits over the
     top-left corner outside fullscreen, and a long message stretched across
     the whole table ran underneath it. Anything that does not fit wraps, the
     way the DOM message it replaced used to -- squeezing it onto one line
     instead turns a chopped four-way pot into unreadably condensed type. */
  var avail = 460 - 34;
  var lines = pokWrapText(c, text, avail, 3), widest = 0, i;
  for(i = 0; i < lines.length; i++) widest = Math.max(widest, c.measureText(lines[i]).width);
  var lh = fs + 4;
  var w = Math.min(460, widest + 34), h = lines.length * lh + 14;
  var x = POK_W / 2, y = 12;
  c.fillStyle = "rgba(8,6,5,.78)";
  pokRR(c, x - w/2, y, w, h, 10); c.fill();
  c.strokeStyle = "rgba(232,194,100,.3)"; c.lineWidth = 1; c.stroke();
  c.fillStyle = col;
  for(i = 0; i < lines.length; i++)
    c.fillText(lines[i], x, y + 10 + i*lh + fs*0.78, w - 24);   /* backstop for one very long word */
  c.restore();
}
function pokVignette(c){
  var vg=c.createRadialGradient(POK_W/2,POK_H*0.5,POK_H*0.38,POK_W/2,POK_H*0.46,POK_H*1.05);
  vg.addColorStop(0,"rgba(0,0,0,0)"); vg.addColorStop(1,"rgba(0,0,0,.6)");
  c.fillStyle=vg; c.fillRect(0,0,POK_W,POK_H);
}

/* One loop, and it only paints while the poker table is the tab on screen. */
var pokT0 = Date.now();
function pokFrame(){
  var sec = document.querySelector(".game.on");
  var mine = sec && (sec.id === "tab-poker" || (pokLent && sec.id === "tab-online"));
  if(mine){
    if(pokCssW < 5 || stale(pokCanvas, pokCssW, pokCssH)) pokResize();
    if(pokCssW > 4) pokScene((Date.now()-pokT0)/1000);
  }
  requestAnimationFrame(pokFrame);
}
requestAnimationFrame(pokFrame);

/* Raises go in fives, with two exceptions that the rules own rather than the
   interface: the smallest legal raise is whatever the engine says it is, and
   all-in is exactly your stack. Rounding either of those to a five would either
   offer an illegal raise or quietly leave chips behind. */
/* The raise amount is built up by clicking chips rather than dragged on a
   slider: it starts at the smallest legal raise and each chip adds its own
   value, so the number on the Raise button is always what you would be
   raising TO. Reset puts it back to the minimum. */
function pokRaiseValue(){
  var lg = pok.T && pok.T.toAct === 0 ? pokLegal(pok.T) : null;
  if(!lg) return 0;
  return pokSnapRaise(pok.raiseTo === null ? lg.minRaiseTo : pok.raiseTo, lg);
}
function pokRaiseLegal(){
  var lg = pok.T && pok.T.toAct === 0 ? pokLegal(pok.T) : null;
  return lg && lg.raise ? lg : null;
}
function pokRaiseAdd(n){
  var lg = pokRaiseLegal();
  if(!lg) return;
  var from = pok.raiseTo === null ? lg.minRaiseTo : pok.raiseTo;
  pok.raiseTo = pokSnapRaise(from + n, lg);
  $("pokRaiseCustom").value = "";                    /* the typed figure no longer applies */
  playChip();
  pokRenderActions();
}
function pokRaiseSet(n){
  var lg = pokRaiseLegal();
  if(!lg) return null;
  pok.raiseTo = pokSnapRaise(n, lg);
  pokRenderActions();
  return pok.raiseTo;
}
function pokRaiseReset(){
  var lg = pokRaiseLegal();
  if(!lg) return;
  pok.raiseTo = lg.minRaiseTo;
  $("pokRaiseCustom").value = "";
  playClick();
  pokRenderActions();
}
function pokRenderActions(){
  var lg = pok.T && pok.T.toAct === 0 ? pokLegal(pok.T) : null;
  var on = !!lg;
  $("pokFold").disabled  = !on;
  $("pokCheck").disabled = !on || !lg.check;
  $("pokCall").disabled  = !on || !lg.call;
  $("pokRaise").disabled = !on || !lg.raise;
  $("pokCheck").style.display = on && !lg.check ? "none" : "";
  $("pokCall").style.display  = on && lg.call ? "" : "none";
  if(on && lg.call) $("pokCall").textContent = "Call " + fmt(lg.callAmount) + " (C)";

  var canRaise = on && lg.raise;
  if(canRaise){
    /* A new decision -- a new street, or somebody re-raised -- starts the
       amount over at the minimum rather than carrying the last one forward
       into a range where it no longer means the same thing. */
    var key = pok.T.stage + ":" + lg.minRaiseTo + ":" + lg.maxRaiseTo;
    if(pok.raiseKey !== key){
      pok.raiseKey = key;
      pok.raiseTo = lg.minRaiseTo;
      $("pokRaiseCustom").value = "";
    }
    pok.raiseTo = pokSnapRaise(pok.raiseTo === null ? lg.minRaiseTo : pok.raiseTo, lg);
    $("pokRaise").textContent = pok.raiseTo >= lg.maxRaiseTo
      ? "All in " + fmt(pok.raiseTo) + " (R)"
      : "Raise to " + fmt(pok.raiseTo) + " (R)";
  }else{
    pok.raiseKey = null;
    pok.raiseTo = null;
    $("pokRaise").textContent = "Raise (R)";
  }
  pokTuneRaiseChips();
  Array.prototype.forEach.call(document.querySelectorAll("#pokRaiseChips .pok-chip"), function(b){
    /* a chip that could not be added without going past all-in is spent */
    b.disabled = !canRaise || (pok.raiseTo >= lg.maxRaiseTo);
  });
  $("pokRaiseCustom").disabled = !canRaise;
  $("pokRaiseClear").disabled  = !canRaise;

  /* Nothing may leave the table mid-hand: chips already in the pot are not
     yours to take back. Standing up waits for the hand to finish, or for you
     to be out of it. */
  /* Once seated the felt carries the commentary, so the one at the top of the
     card stands down rather than saying it twice. */
  $("pokMsg").hidden = !!pok.seated || !!pokRemote;

  var handOver = !!(pok.T && pok.T.stage === "done");
  var foldedOut = !!(pok.T && !pok.T.players[0].inHand);

  /* At an online table three of these mean something else, so they are set
     from the same facts but by a different rule:
       Next hand  -- the dealer starts the next one on their own clock, so
                     there is nothing here to press.
       Stand up   -- you may go at any point. The chips in front of you come
                     home either way, and nobody else is waiting on a hand of
                     yours to finish.
       Skip       -- it hurries a table full of bots along. There is no
                     hurrying four other people. */
  if(pokRemote){
    $("pokNext").style.display = "none";
    $("pokLeave").disabled = false;
    $("pokLeave").textContent = "Leave the game";
    $("pokSkip").hidden = true;
    return;
  }
  $("pokNext").style.display = handOver ? "" : "none";
  $("pokLeave").disabled = !(handOver || foldedOut);
  $("pokLeave").textContent = "Stand up & cash out";

  /* Only while you are out of a hand that is still being played: before the
     fold there are decisions to make, and once it is over there is nothing
     left to hurry. */
  var canSkip = !!(pok.seated && foldedOut && !handOver);
  $("pokSkip").hidden = !canSkip;
  $("pokSkip").classList.toggle("on", pok.speed > 1);
  $("pokSkip").textContent = pok.speed > 1 ? "\u25B6\u25B6 " + POK_SKIP + "\u00D7" : "\u23E9 Skip";
}
/* The scene repaints itself every frame; only the buttons need telling. */
function pokRender(){ pokRenderActions(); }

function pokSay(text, kind){ msg($("pokMsg"), text, kind || "info"); }

function pokSit(){
  if(pok.seated) return;
  /* The felt may be out on loan to the online game. Sitting down here takes
     it back -- that screen notices on its next paint and falls back to its
     written-out view rather than the two of them fighting over pok.T. */
  if(typeof pokLent !== "undefined" && pokLent) pokUnlend();
  if(pok.buyin < 20){ pokSay("The minimum buy-in is 20 chips.", "lose"); return; }
  if(pok.buyin > bank){ pokSay("Not enough chips for that buy-in.", "lose"); return; }
  var bl = pokBlinds(pok.buyin);
  wager(pok.buyin, "poker");
  var cast = pokDrawCast();
  pok.who = cast.who;
  /* One player at every table smokes. Chosen as the table opens and kept for
     as long as it runs, so it reads as something about them rather than
     something that keeps happening to different people. */
  pok.cigar = pokPickSmoker();
  pok.T = pokTable(cast.names, pok.buyin, bl.sb, bl.bb);
  pok.seated = true;
  pokSetPokerStack(pok.buyin);
  $("pokBuyBar").hidden = true;
  $("pokTableView").hidden = false;
  /* The table is the tallest thing on this card and it was display:none when
     the tab was last measured, so fitGame sized the card without it and left
     the zoom at maximum. Re-fit now that the canvas is actually on the page. */
  fitGame();
  playChip();
  pokSay("Seated for " + fmt(pok.buyin) + ". Blinds are " + bl.sb + "/" + bl.bb + ".", "info");
  pokDeal();
}
function pokLeave(){
  if(!pok.seated) return;
  /* Drop out of fullscreen first. The element being shown fullscreen is
     #pokStage, which sits inside #pokTableView -- and the lines below hide
     #pokTableView. A fullscreen element inside a hidden ancestor has nothing
     left to draw, so standing up, or being sent away with an empty stack,
     left the player staring at a broken fullscreen with no table in it and
     no obvious way back. Both routes out of a seat come through here.
     Leaving is asynchronous; pokFsChanged re-fits the card when it lands. */
  if(pokFsEl()) pokFsExit();
  clearTimeout(pok.timer);
  clearTimeout(pok.endTimer);
  /* Only what is still in front of you. Chips already pushed into the pot are
     not yours to take back -- counting them here refunded the bet of anyone
     who folded and stood up, which cancelled the loss entirely. */
  var stack = pok.T.players[0].stack;
  var net = stack - pok.buyin;
  if(stack > 0) payout(stack, "poker");
  pokHushCards();                                    /* nothing lands after you have gone */
  pok.seated = false; pok.T = null;
  pokSetPokerStack(0);
  $("pokBuyBar").hidden = false;
  $("pokTableView").hidden = true;
  fitGame();                                         /* the card just lost its tallest child */
  pokRender();
  if(net > 0){ playWin(net > pok.buyin ? "big" : "small"); pokSay("Stood up with " + fmt(stack) + " chips (+" + fmt(net) + ").", "win"); }
  else if(net < 0){ playLose(); pokSay("Stood up with " + fmt(stack) + " chips (" + fmt(net) + ").", "lose"); }
  else { playClick(); pokSay("Stood up level at " + fmt(stack) + " chips.", "info"); }
}
function pokDeal(){
  if(!pok.seated) return;
  pokRebuyBots(pok.T, pok.buyin);
  if(pok.T.players[0].stack <= 0){
    pokSay("You are out of chips. Standing up.", "lose");
    pokLeave();
    return;
  }
  pok.revealed = false;
  pok.speed = 1;                                     /* a new hand is yours again */
  pok.say = {}; pokChipFly = [];
  pokCurDeg = {};                                    /* everyone is back in the hand */
  pokHandInfoKey = null;
  if(!pokStartHand(pok.T)){ pokLeave(); return; }
  pokQueueDeal(pok.T);
  stats.hands++;
  pokSetPokerStack(pok.T.players[0].stack);
  pokSay("Your move.", "info");
  pokRender();
  pokStep();
}
/* Drives whoever is next: the player gets the buttons enabled, a bot gets a
   pause so the table does not resolve itself faster than it can be read. */
function pokStep(){
  clearTimeout(pok.timer);
  if(!pok.T) return;
  if(pok.T.stage === "done"){ pokShowdown(); return; }
  pokRender();
  if(pok.T.toAct === 0) return;
  var seat = pok.T.toAct;
  pok.timer = setTimeout(function(){
    if(!pok.T || pok.T.toAct !== seat) return;
    var mv = pokBotAction(pok.T, seat, pok.who[seat]);
    if(!mv){ pokStep(); return; }
    pokSpeak(seat, pokMoveText(pok.T, mv.action, mv.raiseTo));
    var putIn = pokLegal(pok.T);
    var spend = mv.action === "call" ? putIn.callAmount
              : mv.action === "raise" ? Math.max(putIn.minRaiseTo, Math.min(mv.raiseTo, putIn.maxRaiseTo)) - pok.T.players[seat].bet
              : 0;
    var wasStage = pok.T.stage, snap = pokBetSnapshot(pok.T, seat, spend);
    pokAct(pok.T, mv.action, mv.raiseTo);
    if(spend > 0){
      pokChipMove(pokSeatStackPt(seat), pokSeatBetPt(seat), pokStackH(spend)+1, POK_CHIPCOL[seat-1]);
      playChip();
    }
    if(pok.T.stage !== wasStage && pok.T.stage !== "done") pokSweepBets(snap);
    pokStep();
  }, pokMs(pokThinkMs(pok.T, pok.who[seat])));
}
function pokHeroAct(action, amount){
  if(!pok.T || pok.T.toAct !== 0) return;
  /* Driven from elsewhere: the move is sent rather than applied. Nothing is
     changed here on the way out -- the table this screen is showing is a copy
     of somebody else's, and it is their engine that decides what happened. */
  if(pokRemote && pokRemote.send){ pokRemote.send(action, amount); return; }
  var say = pokMoveText(pok.T, action, amount), lg = pokLegal(pok.T);
  var spend = action === "call" ? lg.callAmount
            : action === "raise" ? Math.max(lg.minRaiseTo, Math.min(amount, lg.maxRaiseTo)) - pok.T.players[0].bet
            : 0;
  var wasStage = pok.T.stage, snap = pokBetSnapshot(pok.T, 0, spend);
  if(!pokAct(pok.T, action, amount)) return;
  pokSpeak(0, say);
  if(spend > 0) pokChipMove(pokSeatStackPt(0), pokSeatBetPt(0), pokStackH(spend)+1, "#c9a227");
  if(pok.T.stage !== wasStage && pok.T.stage !== "done") pokSweepBets(snap);
  if(action === "raise" || action === "call") playChip(); else playClick();
  pokSetPokerStack(pok.T.players[0].stack);
  pokStep();
}
/* ---- the pot coming in ----
   One flying stack is a payment; a pot is a sweep, so it goes as a handful of
   them, each leaving a different corner of the pile and landing a little
   apart, staggered so it arrives as a stream rather than a single lump. The
   till rings as the first of them lands, not as they set off.

   Shared with the online table, which has to do exactly what this one does
   and until now did neither. */
var POK_SWEEP_MAX = 9;
function pokPayPot(T){
  if(!T || !T.lastWinners || !T.lastWinners.length) return;
  var mine = null;
  T.lastWinners.forEach(function(w, wi){
    if(w.id === 0) mine = w;
    var from = pokPotPt(), to = pokSeatStackPt(w.id);
    var many = Math.max(4, Math.min(POK_SWEEP_MAX, 3 + pokStackH(w.won)));
    for(var i = 0; i < many; i++){
      var a = (i / many) * Math.PI * 2 + wi;
      pokChipMove({x: from.x + Math.cos(a) * 14, y: from.y + Math.sin(a) * 5},
                  {x: to.x   + Math.cos(a) * 10, y: to.y   + Math.sin(a) * 4},
                  2 + (i % 3), "#c9a227", 200 + wi * 120 + i * 46);
    }
  });
  if(mine && typeof playCash === "function") setTimeout(playCash, pokMs(330));
}
function pokShowdown(){
  pok.revealed = pokLive(pok.T).length > 1;
  pokPayPot(pok.T);
  pokRender();
  pokSetPokerStack(pok.T.players[0].stack);
  var mine = null;
  pok.T.lastWinners.forEach(function(w){ if(w.id === 0) mine = w; });
  var names = pok.T.lastWinners.map(function(w){
    return pok.T.players[w.id].name + " " + fmt(w.won);
  }).join(", ");
  if(mine){
    /* No playWin here: pokPayPot rings the till, and the two together are
       just noise on top of each other. */
    pokSay("You win " + fmt(mine.won) + " with " + mine.how + ".", "win");
  }else{
    playLose();
    pokSay(names ? names + (pok.T.lastWinners[0].how ? " — " + pok.T.lastWinners[0].how : "") : "Hand over.", "lose");
  }
  if(pok.T.players[0].stack <= 0){
    /* Its own handle. pokStep clears pok.timer on every call, so sharing one
       here meant the next bot action cancelled the stand-up and left the
       player sat at the table with an empty stack. */
    clearTimeout(pok.endTimer);
    pok.endTimer = setTimeout(function(){
      pokSay("You are out of chips.", "lose");
      pokLeave();
    }, pokMs(1600));
  }
}

/* ---- wiring ---- */
var pokBuyBtns = chipRow($("pokBuyBar"), null, function(v){
  pok.buyin = v;
  $("pokBuyin").textContent = fmt(v);
}, null, 5);                                         /* poker buys in in fives */
pokBuyBtns[1].classList.add("sel");
$("pokSit").addEventListener("click", function(){ playClick(); pokSit(); });
$("pokLeave").addEventListener("click", function(){
  playClick();
  if(pokRemote && pokRemote.leave) pokRemote.leave();
  else pokLeave();
});

/* ---- fullscreen ----
   Prefixed names are still what Safari answers to, so both are tried. If the
   browser offers neither, the button is removed rather than left there doing
   nothing. */
var pokStage = $("pokStage"), pokFullBtn = $("pokFull");
function pokFsEl(){ return document.fullscreenElement || document.webkitFullscreenElement || null; }
function pokFsGo(el){
  var fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if(fn) try{ fn.call(el); }catch(e){}
}
function pokFsExit(){
  var fn = document.exitFullscreen || document.webkitExitFullscreen;
  if(fn) try{ fn.call(document); }catch(e){}
}
if(!(pokStage.requestFullscreen || pokStage.webkitRequestFullscreen)){
  pokFullBtn.hidden = true;
}else{
  pokFullBtn.addEventListener("click", function(){
    playClick();
    if(pokFsEl()) pokFsExit(); else pokFsGo(pokStage);
  });
}
function pokFsChanged(){
  var on = pokFsEl() === pokStage;
  pokFullBtn.innerHTML = on ? "&#9974; Exit fullscreen" : "&#9974; Fullscreen";
  /* The canvas has just been handed a completely different box, and the scene
     is laid out from the box it is given, so it has to be measured again. */
  pokCssW = 0;
  pokResize();
  if(!on && typeof fitGame === "function") fitGame();
}
document.addEventListener("fullscreenchange", pokFsChanged);
document.addEventListener("webkitfullscreenchange", pokFsChanged);
$("pokNext").addEventListener("click", function(){ playClick(); pokDeal(); });

/* Speeding up the pause that is already running matters as much as the ones
   after it: the bot whose turn it is was scheduled at full length before the
   click, so without re-arming the timer the first thing you see after pressing
   Skip is the same wait you pressed Skip to avoid. */
$("pokSkip").addEventListener("click", function(){
  if(pok.speed > 1) return;
  playClick();
  pok.speed = POK_SKIP;
  pokRender();
  pokStep();
});
$("pokFold").addEventListener("click",  function(){ pokHeroAct("fold"); });
$("pokCheck").addEventListener("click", function(){ pokHeroAct("check"); });
$("pokCall").addEventListener("click",  function(){ pokHeroAct("call"); });
$("pokRaise").addEventListener("click", function(){ pokHeroAct("raise", pokRaiseValue()); });
Array.prototype.forEach.call(document.querySelectorAll("#pokRaiseChips .pok-chip"), function(b){
  b.addEventListener("click", function(){ pokRaiseAdd(Number(b.dataset.r)); });
});
$("pokRaiseClear").addEventListener("click", pokRaiseReset);
/* Typed amounts go in fives like every other stake in the game. The text is
   left alone while it is being typed and corrected on the way out, so what is
   written and what would actually be raised agree. */
(function(){
  var box = $("pokRaiseCustom");
  box.addEventListener("input", function(){
    var v = Math.floor(Number(box.value));
    if(!v || v < 1) return;
    pokRaiseSet(Math.max(5, Math.round(v / 5) * 5));
  });
  box.addEventListener("change", function(){
    var v = Math.floor(Number(box.value));
    if(!v || v < 1){ box.value = ""; return; }
    var set = pokRaiseSet(Math.max(5, Math.round(v / 5) * 5));
    if(set !== null) box.value = set;
  });
})();

document.addEventListener("keydown", function(e){
  if(!pok.seated || !pok.T) return;
  var sec = document.querySelector(".game.on");
  if(!sec || sec.id !== "tab-poker") return;
  var t = e.target.tagName;
  if(t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
  var k = e.key.toLowerCase();
  if(pok.T.stage === "done"){ if(k === "n"){ e.preventDefault(); pokDeal(); } return; }
  if(pok.T.toAct !== 0) return;
  var lg = pokLegal(pok.T);
  if(!lg) return;
  if(k === "f"){ e.preventDefault(); pokHeroAct("fold"); }
  else if(k === "c"){ e.preventDefault(); pokHeroAct(lg.check ? "check" : "call"); }
  else if(k === "r" && lg.raise){ e.preventDefault(); pokHeroAct("raise", pokRaiseValue()); }
});
