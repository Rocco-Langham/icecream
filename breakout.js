"use strict";
/* ================= BREAKOUT ================= */
/* Snake's sibling: stake on the serve, a multiplier that compounds with every
   brick, cash out whenever you like or lose the lot. Here the thing that ends
   the round is the one ball getting past the paddle -- there are no spare
   lives, so every brick is bought with the risk of the next return.

   The multiplier starts under 1x, as Snake's does, and BO_STEP is tuned so it
   is the fifteenth brick that first carries it past break-even. Cashing out
   before that hands back less than the stake. */
var boCanvas = $("breakoutCanvas"), boCtx = boCanvas.getContext("2d");
var BO_VIEW_H = 300;                                   // the height the board is drawn for
var BO_MULT0 = 0.5;
/* 0.5 x 1.049^14 = 0.977x and 0.5 x 1.049^15 = 1.025x: brick fifteen is the
   first one that is worth more than the stake. */
var BO_STEP = 1.049;
var BO_PROFIT_AT = 15;
var BO_ROWS = 6;
var BO_TOP = 60;                                       // wall top, leaving a band for the readout above it
var BO_SIDE = 10;                                      // wall inset from the sides
var BO_BRICK_H = 13, BO_GAP = 4;
var BO_PAD_W = 58, BO_PAD_H = 9, BO_PAD_LIFT = 28;     // paddle top sits this far off the floor
var BO_PAD_KEY_SPEED = 430;                            // units per second with a key held
var BO_R = 5;                                          // ball radius
var BO_SPEED0 = 185, BO_SPEED_MAX = 400;               // units per second
var BO_HIT_RAMP = 1.008;                               // each paddle return
var BO_WALL_RAMP = 1.12;                               // each wall cleared
var BO_MAX_ANG = Math.PI / 3;                          // 60 degrees off vertical at the paddle's edge
/* The ball never travels flatter than about 20 degrees off horizontal. Without
   a floor on it a glancing hit can leave it crossing and re-crossing the board
   for half a minute without coming anywhere near a brick or the paddle. */
var BO_MIN_VY = 0.34;
var BO_SERVE = 0.7;                                    // seconds on the paddle before it launches itself
var BO_WALL_PAUSE = 1.0;                               // the "wall cleared" moment before the next serve
/* Top to bottom. Saturated but not neon, so they read on the night-blue board
   whatever the page theme is -- the board paints its own backdrop, like
   Snake's and Flappy's, so the light theme does not reach in here. */
var BO_ROW_COLS = ["#ff6b6b", "#ff9f43", "#ffd43b", "#69db7c", "#38d9c9", "#74a7ff"];

var boW = 500, boH = BO_VIEW_H, boCssW = 0, boCssH = 0, boZ = 1;
var boStake = 25, boState = "idle";                    // idle | live | dead
var boBricks = [], boCols = 10, boLeft = 0;
var boBall = {x:0, y:0, vx:0, vy:0}, boSpeed = BO_SPEED0;
var boPadX = 250, boAim = null, boKeyL = false, boKeyR = false;
var boServe = 0, boWallMsg = 0, boDrop = 0;
var boBroken = 0, boMult = BO_MULT0, boWalls = 0;
var boRig = null, boLoseAt = 0, boAssistOff = 0;
var boDeadAt = 0, boClock = 0, boLast = 0;
var boSndWall = 0, boSndBrick = 0;
var boRect = {x:0, y:0, w:0, h:0};                     // reused, so a hit test allocates nothing

/* A fixed pool rather than an array that grows and shrinks, so a burst costs
   no allocation and a long rally cannot pile them up. */
var BO_PARTS = 96;
var boParts = [];
for(var boI = 0; boI < BO_PARTS; boI++) boParts.push({x:0, y:0, vx:0, vy:0, life:0, col:""});
var boPartNext = 0;

function boResize(){
  if(!boCanvas) return;
  var rect = boCanvas.getBoundingClientRect();
  if(!rect.width) return;
  var dpr = window.devicePixelRatio || 1;
  /* As on the other boards: past the height it is drawn for, extra pixels
     magnify the board rather than showing more of it. */
  var z = Math.max(0.7, rect.height / BO_VIEW_H);
  var oldW = boW;
  boW = rect.width / z; boH = rect.height / z; boZ = z;
  boCssW = rect.width; boCssH = rect.height;
  boCanvas.width  = Math.round(rect.width*dpr);
  boCanvas.height = Math.round(rect.height*dpr);
  boCtx.setTransform(dpr*z, 0, 0, dpr*z, 0, 0);
  /* The bricks are laid out from the width every frame, so they follow a resize
     on their own; the things with a position of their own are scaled across
     with them, or a rotated phone would leave the ball inside a brick. */
  if(oldW > 0 && Math.abs(oldW - boW) > 0.5){
    var k = boW / oldW;
    boBall.x *= k; boPadX *= k;
    if(boAim !== null) boAim *= k;
  }
  boPadX = boClampPad(boPadX);
  /* The first wall is built at load, before the tab has ever been on screen
     and so before the board has a real width. An untouched wall is rebuilt to
     suit the width it actually got; one in play is left as it is. */
  if(boState !== "live" && boLeft === boBricks.length && boCols !== boColsFor(boW)) boNewWall();
}
function boPadY(){ return boH - BO_PAD_LIFT; }
function boClampPad(x){ return Math.max(BO_PAD_W/2, Math.min(boW - BO_PAD_W/2, x)); }
/* Two decimals while every brick matters, fewer once the numbers stop meaning
   much. A round the rig will not let end can run on for wall after wall, so
   past a million it goes to M, B and T with three figures at most -- the box
   is fixed-width and clips, and this way the widest it can ever be asked to
   hold is "999,999x". */
var BO_BIG = [[1e12, "T"], [1e9, "B"], [1e6, "M"]];
function boMultText(m){
  for(var i = 0; i < BO_BIG.length; i++){
    if(m >= BO_BIG[i][0]){
      var v = m / BO_BIG[i][0];
      return (v >= 99.95 ? Math.round(v) : v >= 9.995 ? v.toFixed(1) : v.toFixed(2)) + BO_BIG[i][1] + "x";
    }
  }
  return (m >= 100 ? fmt(Math.round(m)) : m >= 10 ? m.toFixed(1) : m.toFixed(2)) + "x";
}
function boCashValue(){ return Math.floor(boStake * boMult); }

/* A wide board gets more, narrower columns and a phone fewer, wider ones, so a
   brick is never a sliver. Fixed for the life of a wall -- the count is what
   the player is working through. */
function boColsFor(w){ return Math.max(8, Math.min(12, Math.floor(w / 48))); }
function boBrickAt(i){
  var c = i % boCols, r = (i / boCols) | 0;
  var bw = (boW - BO_SIDE*2 - BO_GAP*(boCols - 1)) / boCols;
  boRect.x = BO_SIDE + c*(bw + BO_GAP);
  boRect.y = BO_TOP + r*(BO_BRICK_H + BO_GAP) - boDrop*(BO_TOP + BO_ROWS*(BO_BRICK_H + BO_GAP));
  boRect.w = bw; boRect.h = BO_BRICK_H;
  return boRect;
}
function boNewWall(){
  boCols = boColsFor(boW);
  boBricks.length = 0;
  for(var i = 0; i < boCols*BO_ROWS; i++) boBricks.push(true);
  boLeft = boBricks.length;
}
function boPark(){
  boBall.x = boPadX;
  boBall.y = boPadY() - BO_R - 0.5;
  boBall.vx = 0; boBall.vy = 0;
}
function boReset(){
  boBroken = 0; boMult = BO_MULT0; boWalls = 0;
  boSpeed = BO_SPEED0; boServe = 0; boWallMsg = 0; boDrop = 0;
  boPadX = boClampPad(boW/2); boAim = null;
  boNewWall();
  boPark();
}
function boStart(){
  if(boState !== "idle") return;
  if(boStake > bank){ msg($("boMsg"), "Not enough chips for that bet.", "lose"); return; }
  wager(boStake, "breakout");
  stats.hands++;

  /* Rolled once, here, and it decides the round outright. The player's round
     cannot be lost -- the paddle always gets there. The house's slips past the
     paddle somewhere short of break-even, at a brick count picked now. */
  boRig = rigRoll();
  boLoseAt = boRig === "host" ? 1 + rnd(14) : 0;
  boAssistOff = 0;

  boReset();
  boServe = BO_SERVE;
  boState = "live";
  playChip();
  msg($("boMsg"), "Serving — every brick compounds, and you only get the one ball.", "info");
  syncBreakoutUI();
}

/* Straight up the middle of the paddle, up to 60 degrees off vertical at its
   edges, so where you catch it is how you aim. */
function boLaunch(ang){
  boBall.vx = boSpeed*Math.sin(ang);
  boBall.vy = -boSpeed*Math.cos(ang);
}
function boKeepSteep(){
  var sp = Math.sqrt(boBall.vx*boBall.vx + boBall.vy*boBall.vy) || boSpeed;
  var min = sp*BO_MIN_VY;
  if(Math.abs(boBall.vy) < min){
    boBall.vy = boBall.vy < 0 ? -min : min;
    var vx = Math.sqrt(sp*sp - min*min);
    boBall.vx = boBall.vx < 0 ? -vx : vx;
  }
}
/* Where the ball will cross the paddle's line, walls folded in. The rig uses
   it to put the paddle under the ball, or just out of its way. */
function boLandingX(){
  if(boBall.vy <= 0) return boBall.x;
  var t = (boPadY() - BO_R - boBall.y) / boBall.vy;
  var x = boBall.x + boBall.vx*Math.max(0, t);
  var lo = BO_R, span = boW - BO_R*2;
  if(span <= 0) return boW/2;
  var m = (x - lo) % (span*2);
  if(m < 0) m += span*2;
  return lo + (m <= span ? m : span*2 - m);
}
function boMovePadToward(x, maxStep){
  var d = x - boPadX;
  boPadX = boClampPad(boPadX + Math.max(-maxStep, Math.min(maxStep, d)));
}
function boDoomed(){ return boRig === "host" && boBroken >= boLoseAt; }

function boStep(dt){
  boStepParts(dt);
  if(boDrop > 0) boDrop = Math.max(0, boDrop - dt*2.4);
  if(boWallMsg > 0) boWallMsg = Math.max(0, boWallMsg - dt);
  if(boState === "dead"){
    if(boClock - boDeadAt > 1.1){ boState = "idle"; boReset(); syncBreakoutUI(); }
    return;
  }

  /* The rig leans on the paddle, never on the ball, so the ball's flight is
     always the honest one. While the ball comes down on a rigged round the
     paddle stops taking orders: a player's round has it slide under the ball,
     a doomed one has it shy away at the last moment, which reads as a near
     miss rather than the ball passing through it. */
  var live = boState === "live" && boServe <= 0;
  var near = live && boBall.vy > 0 && boBall.y > boPadY() - 90;
  var steer = near && (boRig === "user" || boDoomed());

  /* Otherwise the paddle answers the player whether or not a round is on, so
     you can get a feel for it before you stake anything. */
  if(steer){
    boAim = null;
  }else if(boKeyL !== boKeyR){
    boAim = null;
    boPadX = boClampPad(boPadX + (boKeyR ? 1 : -1)*BO_PAD_KEY_SPEED*dt);
  }else if(boAim !== null){
    boPadX = boClampPad(boAim);
  }

  if(boState !== "live" || boServe > 0){
    boPark();
    if(boState === "live"){
      boServe -= dt;
      if(boServe <= 0){
        boServe = 0;
        var a = (0.15 + Math.random()*0.3) * (Math.random() < 0.5 ? -1 : 1);
        boLaunch(a);
      }
    }
    return;
  }

  if(steer && boRig === "user"){
    boMovePadToward(boLandingX() - boAssistOff, 900*dt);
  }else if(steer){
    /* It chases the ball from whichever side it is on and arrives a few units
       short -- a lunge that just fails, rather than a paddle that stops dead. */
    var land = boLandingX(), clear = BO_PAD_W/2 + BO_R + 6;
    var to = land + (boPadX >= land ? clear : -clear);
    if(to > boW - BO_PAD_W/2 || to < BO_PAD_W/2) to = land + (boPadX >= land ? -clear : clear);
    boMovePadToward(to, 600*dt);
  }

  /* Sub-stepped so no step moves the ball more than about half its radius: at
     the top speed a whole frame would otherwise carry it clean through a brick
     or the paddle without ever overlapping either. */
  var dist = boSpeed*dt;
  var n = Math.max(1, Math.ceil(dist / (BO_R*0.5)));
  var h = dt / n;
  for(var s = 0; s < n; s++){
    if(!boSub(h)) return;
  }
}

/* One sub-step. False once the round has ended or the board has changed under
   the ball, and the rest of the frame is skipped. */
function boSub(h){
  var b = boBall, prevY = b.y;
  b.x += b.vx*h;
  b.y += b.vy*h;

  if(b.x - BO_R < 0){ b.x = BO_R; b.vx = Math.abs(b.vx); boWallSound(); }
  else if(b.x + BO_R > boW){ b.x = boW - BO_R; b.vx = -Math.abs(b.vx); boWallSound(); }
  if(b.y - BO_R < 0){ b.y = BO_R; b.vy = Math.abs(b.vy); boWallSound(); }

  if(b.y - BO_R < BO_TOP + BO_ROWS*(BO_BRICK_H + BO_GAP) && boDrop === 0){
    for(var i = 0; i < boBricks.length; i++){
      if(!boBricks[i]) continue;
      var r = boBrickAt(i);
      var cx = Math.max(r.x, Math.min(b.x, r.x + r.w));
      var cy = Math.max(r.y, Math.min(b.y, r.y + r.h));
      var dx = b.x - cx, dy = b.y - cy;
      if(dx*dx + dy*dy >= BO_R*BO_R) continue;
      /* Which face it came through is the axis it is least far into. With the
         ball moving half a radius a step that is always the side it hit. */
      var ox = Math.min(b.x + BO_R - r.x, r.x + r.w - (b.x - BO_R));
      var oy = Math.min(b.y + BO_R - r.y, r.y + r.h - (b.y - BO_R));
      if(ox < oy){
        if(b.x < r.x + r.w/2){ b.x = r.x - BO_R; b.vx = -Math.abs(b.vx); }
        else                 { b.x = r.x + r.w + BO_R; b.vx = Math.abs(b.vx); }
      }else{
        if(b.y < r.y + r.h/2){ b.y = r.y - BO_R; b.vy = -Math.abs(b.vy); }
        else                 { b.y = r.y + r.h + BO_R; b.vy = Math.abs(b.vy); }
      }
      boKeepSteep();
      /* A doomed round is meant to end short of break-even, but the ball can
         still be up in the wall when the doom starts and take a few more on its
         way down. Past the brick before the profit one it only bounces, so
         the round the house was handed is never one the player can cash out
         ahead on. */
      if(boRig === "host" && boBroken >= BO_PROFIT_AT - 1){ boWallSound(); break; }
      boBreak(i, r);
      if(!boLeft){ boClearWall(); return false; }
      break;                                           /* one brick a step; the bounce takes it clear of the next */
    }
  }

  var py = boPadY();
  if(b.vy > 0 && b.y + BO_R >= py && prevY + BO_R <= py + 1){
    var reach = BO_PAD_W/2 + BO_R;
    var hit = Math.abs(b.x - boPadX) <= reach;
    /* The player's round is caught whatever the paddle was doing, and the
       paddle is put where it would have had to be. */
    if(!hit && boRig === "user"){
      boPadX = boClampPad(b.x);
      hit = Math.abs(b.x - boPadX) <= reach;
    }
    if(hit && !boDoomed()){
      b.y = py - BO_R;
      boSpeed = Math.min(BO_SPEED_MAX, boSpeed*BO_HIT_RAMP);
      var off = Math.max(-1, Math.min(1, (b.x - boPadX) / reach));
      boLaunch(off*BO_MAX_ANG);
      boPaddleSound();
      /* Where the assisted paddle meets the ball next time, rolled fresh each
         return. Always the dead centre and the ball goes straight up and down
         forever the moment it finds a cleared column. */
      boAssistOff = (Math.random()*2 - 1) * reach * 0.7;
    }
  }

  if(b.y - BO_R > boH){ boLose(); return false; }
  return true;
}

function boBreak(i, r){
  boBricks[i] = false;
  boLeft--;
  boBroken++;
  boMult *= BO_STEP;
  var col = BO_ROW_COLS[((i / boCols) | 0) % BO_ROW_COLS.length];
  for(var k = 0; k < 8; k++){
    var p = boParts[boPartNext];
    boPartNext = (boPartNext + 1) % BO_PARTS;
    var a = Math.random()*Math.PI*2, v = 30 + Math.random()*70;
    p.x = r.x + Math.random()*r.w; p.y = r.y + Math.random()*r.h;
    p.vx = Math.cos(a)*v; p.vy = Math.sin(a)*v - 20;
    p.life = 0.45 + Math.random()*0.25; p.col = col;
  }
  boBrickSound();
  syncBreakoutUI();
}
function boStepParts(dt){
  for(var i = 0; i < BO_PARTS; i++){
    var p = boParts[i];
    if(p.life <= 0) continue;
    p.life -= dt;
    p.vy += 220*dt;
    p.x += p.vx*dt; p.y += p.vy*dt;
  }
}
function boClearWall(){
  boWalls++;
  boSpeed = Math.min(BO_SPEED_MAX, boSpeed*BO_WALL_RAMP);
  boNewWall();
  boDrop = 1;
  boWallMsg = BO_WALL_PAUSE;
  boServe = BO_WALL_PAUSE;
  boPark();
  boWallClearSound();
  msg($("boMsg"), "Wall cleared at " + boMultText(boMult) + " — a fresh one, and a faster ball.", "win");
  syncBreakoutUI();
}
function boLose(){
  boState = "dead";
  boDeadAt = boClock;
  playLose();
  msg($("boMsg"), "Dropped it after " + fmt(boBroken) + " " + (boBroken === 1 ? "brick" : "bricks") +
                  " — " + fmt(boStake) + " chips gone.", "lose");
  boRecordBest();
  syncBreakoutUI();
}
function boRecordBest(){
  if(boBroken <= breakoutBest) return false;
  breakoutBest = boBroken;
  save();
  return true;
}
function boCashOut(){
  if(boState !== "live") return;
  var ret = boCashValue(), net = ret - boStake;
  var best = boRecordBest();
  boState = "idle";
  if(ret > 0) payout(ret, "breakout");
  if(net > 0){
    playWin(boMult >= 20 ? "jackpot" : boMult >= 3 ? "big" : "small");
    if(boMult >= 3) setTimeout(playCoin, 90);
    msg($("boMsg"), "Cashed out at " + boMultText(boMult) + " — " + fmt(ret) + " chips (+" + fmt(net) + ").", "win");
  }else if(net < 0){
    playLose();
    msg($("boMsg"), "Stopped early at " + boMultText(boMult) + " — " + fmt(ret) + " chips back (" + fmt(net) +
                    "). The 15th brick is where it turns a profit.", "lose");
  }else{
    playClick();
    msg($("boMsg"), "Stopped at " + boMultText(boMult) + " — " + fmt(ret) + " chips back.", "info");
  }
  if(best) msg($("boMsg"), $("boMsg").textContent + " New best: " + boBroken + "!", "win");
  boReset();
  syncBreakoutUI();
}
function boToggle(){ if(boState === "live") boCashOut(); else boStart(); }

/* ---- sound ---- */
/* All of these can fire many times a second in a good rally, so they sit at
   the very bottom of the table's levels, and the two that can come fastest --
   a ball rattling along the top wall or chewing through a row -- are
   rate-limited as well. */
function boPaddleSound(){
  sfx(function(ctx, t){ tone(ctx, 260, t, 0.06, "sine", 0.007); });
}
function boBrickSound(){
  if(boClock - boSndBrick < 0.05) return;
  boSndBrick = boClock;
  /* Climbs by up to a fifth over the first sixty bricks, so a long run is
     audibly going somewhere without turning into a whistle. */
  var f = 520 * Math.pow(2, Math.min(boBroken, 60) / 60 * 7/12);
  sfx(function(ctx, t){ tone(ctx, f, t, 0.07, "triangle", 0.009); });
}
function boWallSound(){
  if(boClock - boSndWall < 0.08) return;
  boSndWall = boClock;
  sfx(function(ctx, t){ tone(ctx, 900, t, 0.03, "sine", 0.003); });
}
function boWallClearSound(){
  sfx(function(ctx, t){
    [523, 659, 784, 1047].forEach(function(f, i){ tone(ctx, f, t + i*0.07, 0.16, "triangle", 0.015); });
  });
}

/* ---- drawing ---- */
function boRoundRect(x, y, w, h, r){
  r = Math.min(r, w/2, h/2);
  boCtx.beginPath();
  boCtx.moveTo(x + r, y);
  boCtx.arcTo(x + w, y, x + w, y + h, r);
  boCtx.arcTo(x + w, y + h, x, y + h, r);
  boCtx.arcTo(x, y + h, x, y, r);
  boCtx.arcTo(x, y, x + w, y, r);
  boCtx.closePath();
}
function boRender(){
  var c = boCtx;
  c.clearRect(0, 0, boW, boH);
  var bg = c.createLinearGradient(0, 0, 0, boH);
  bg.addColorStop(0, "#10223a"); bg.addColorStop(1, "#050b14");
  c.fillStyle = bg;
  c.fillRect(0, 0, boW, boH);

  /* Bricks: one gradient per row rather than per brick, lighter along the top
     edge so each reads as a tile and not a flat swatch. */
  for(var row = 0; row < BO_ROWS; row++){
    var y0 = boBrickAt(row*boCols).y;
    if(y0 + BO_BRICK_H < 0) continue;
    var col = BO_ROW_COLS[row % BO_ROW_COLS.length];
    var g = c.createLinearGradient(0, y0, 0, y0 + BO_BRICK_H);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.18, col);
    g.addColorStop(1, boShade(col));
    c.fillStyle = g;
    for(var k = 0; k < boCols; k++){
      var i = row*boCols + k;
      if(!boBricks[i]) continue;
      var r = boBrickAt(i);
      boRoundRect(r.x, r.y, r.w, r.h, 3.5);
      c.fill();
    }
  }

  for(var p = 0; p < BO_PARTS; p++){
    var q = boParts[p];
    if(q.life <= 0) continue;
    c.globalAlpha = Math.min(1, q.life*2.2);
    c.fillStyle = q.col;
    c.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
  }
  c.globalAlpha = 1;

  /* Paddle, with a soft glow under it. The glow is a blur, and a canvas blur is
     measured in device pixels whatever the transform, so it is scaled up by the
     same factor the board is. */
  var py = boPadY();
  c.save();
  c.shadowColor = boState === "dead" ? "rgba(255,107,107,.7)" : "rgba(255,214,120,.65)";
  c.shadowBlur = 14 * boZ * (window.devicePixelRatio || 1);
  var pg = c.createLinearGradient(0, py, 0, py + BO_PAD_H);
  pg.addColorStop(0, "#fff6df"); pg.addColorStop(1, "#d9b25a");
  c.fillStyle = pg;
  boRoundRect(boPadX - BO_PAD_W/2, py, BO_PAD_W, BO_PAD_H, BO_PAD_H/2);
  c.fill();
  c.restore();

  if(boState !== "dead"){
    c.fillStyle = "#ffffff";
    c.beginPath(); c.arc(boBall.x, boBall.y, BO_R, 0, Math.PI*2); c.fill();
  }

  /* Pinned to the band above the wall, as Snake's is to the top of its board. */
  c.textAlign = "center";
  if(boWallMsg > 0){
    c.font = "700 24px system-ui, sans-serif";
    c.fillStyle = "#7ef2a8";
    c.fillText("WALL CLEARED", boW/2, boH*0.62);
  }
  if(boState === "live"){
    c.font = "700 24px system-ui, sans-serif";
    c.fillStyle = "rgba(255,255,255,.92)";
    c.fillText(boMultText(boMult), boW/2, 28);
    c.font = "600 10px system-ui, sans-serif";
    c.fillStyle = "rgba(255,255,255,.5)";
    c.fillText(fmt(boCashValue()) + " CHIPS IF YOU STOP NOW", boW/2, 45);
  }else if(boState === "dead"){
    c.font = "700 24px system-ui, sans-serif";
    c.fillStyle = "#ff6b6b";
    c.fillText("DROPPED", boW/2, 32);
  }
  c.textAlign = "left";
}
/* The bottom of each brick's gradient: the row colour at about 60%. Worked out
   once per colour and kept, since render asks for it every frame. */
var boShades = {};
function boShade(hex){
  if(boShades[hex]) return boShades[hex];
  var n = parseInt(hex.slice(1), 16);
  var r = Math.round(((n >> 16) & 255)*0.6), g = Math.round(((n >> 8) & 255)*0.6), b = Math.round((n & 255)*0.6);
  return (boShades[hex] = "rgb(" + r + "," + g + "," + b + ")");
}

function syncBreakoutUI(){
  var live = boState === "live";
  $("boMultVal").textContent  = boMultText(boMult);
  $("boBrickVal").textContent = fmt(boBroken);
  $("boBestVal").textContent  = fmt(breakoutBest);
  var go = $("boGo");
  go.textContent = live ? "Cash out " + fmt(boCashValue()) + keyTag("breakout.go") : "Play" + keyTag("breakout.go");
  /* Green only once stopping would be a win; under 1x it is a way out, not a
     payday, and turning green is how you know you have got past the 15th. */
  go.classList.toggle("cash", live && boCashValue() > boStake);
  go.disabled = boState === "dead";
  Array.prototype.forEach.call(boBtns, function(b){ b.disabled = live; });
  $("boCustom").disabled = live;
  $("boClear").disabled  = live;
  var k = keyName("breakout.go");
  $("boKeyHint").textContent = "Mouse, arrows or A/D to move" + (k ? " · " + k + " to bet & cash out" : "");
  /* The paddle is the pointer while a ball is in play; a cursor on top of it
     only hides what you are aiming with. */
  boCanvas.style.cursor = live ? "none" : "";
}

var boBtns = chipRow($("tab-breakout"), null, function(v){
  boStake = v;
  $("boStake").textContent = fmt(boStake);
}, null);
boBtns[1].classList.add("sel");

$("boClear").addEventListener("click", function(){
  playClick();
  boStake = 5;
  $("boStake").textContent = "5";
  Array.prototype.forEach.call(boBtns, function(o){ o.classList.toggle("sel", o.dataset.v === "5"); });
  $("boCustom").value = "";
  $("boCustom").classList.remove("sel");
});
$("boGo").addEventListener("click", function(){ boToggle(); });

/* The paddle's centre follows the pointer: a mouse just by moving over the
   board, a finger by dragging on it. Mapped through the canvas's own on-screen
   box, which is measured through the same zoom the pointer is reported
   through, so fitGame's scaling needs no undoing of its own. */
function boPointer(e){
  var rect = boCanvas.getBoundingClientRect();
  if(!rect.width) return;
  boAim = (e.clientX - rect.left) / rect.width * boW;
}
boCanvas.addEventListener("pointerdown", function(e){ e.preventDefault(); boPointer(e); });
boCanvas.addEventListener("pointermove", boPointer);

/* Fixed keys for moving, as Snake's steering is; only the bet key is in
   Settings > Keybinds. Held, not tapped, so both a down and an up are heard. */
var BO_LEFT = {ArrowLeft:1, KeyA:1}, BO_RIGHT = {ArrowRight:1, KeyD:1};
document.addEventListener("keydown", function(e){
  if(!$("tab-breakout").classList.contains("on") || keyBlocked(e)) return;
  if(keyIs(e, "breakout.go")){
    e.preventDefault();
    if(e.repeat) return;                                     /* holding the bet key must not re-bet */
    boToggle();
    return;
  }
  if(BO_LEFT[e.code]){ e.preventDefault(); boKeyL = true; }  /* arrows must not scroll the page */
  else if(BO_RIGHT[e.code]){ e.preventDefault(); boKeyR = true; }
});
document.addEventListener("keyup", function(e){
  if(BO_LEFT[e.code]) boKeyL = false;
  if(BO_RIGHT[e.code]) boKeyR = false;
});
/* A key let go while the window was elsewhere never sends its keyup here, and
   the paddle would carry on sliding into the wall on its own. */
window.addEventListener("blur", function(){ boKeyL = boKeyR = false; });

/* Its own frame loop, run only while the tab is on screen -- exactly as Snake's
   is. Switch away mid-rally, or hide the page, and the ball waits where it was
   rather than playing out, and losing, where nobody can see it. dt is capped so
   coming back is a normal frame, not one enormous jump. */
function boFrame(now){
  var dt = Math.min(0.05, (now - boLast) / 1000 || 0);
  boLast = now;
  if($("tab-breakout").classList.contains("on")){
    if(boCssW < 5 || stale(boCanvas, boCssW, boCssH)) boResize();
    boClock += dt;
    boStep(dt);
    boRender();
  }
  requestAnimationFrame(boFrame);
}

boResize();
boReset();
syncBreakoutUI();
requestAnimationFrame(boFrame);
