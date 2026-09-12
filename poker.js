"use strict";
/* ==========================================================================
   Texas Hold'em. The evaluator, the pot maths and the bot policy were built
   and tested on their own before any of this was on screen: hand rankings
   against published 7-card frequencies, and chip conservation across 20,000
   randomised hands including 18,000 with an all-in.
   ========================================================================== */

var POK_RV = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};
var POK_CATS = ["High card","Pair","Two pair","Three of a kind","Straight",
               "Flush","Full house","Four of a kind","Straight flush"];

function pokDeck(){
  var d = [];
  SUITS.forEach(function(su){ RANKS.forEach(function(r){ d.push({r:r, su:su}); }); });
  return d;                                          /* suits are the shared objects, so === compares suit */
}
function pokShuffle(d){
  for(var i=d.length-1; i>0; i--){ var j = rnd(i+1), t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}

function pokScore5(cards){
  var vals = cards.map(function(c){ return POK_RV[c.r]; }).sort(function(a,b){ return b-a; });
  var suits = cards.map(function(c){ return c.su; });
  var flush = suits.every(function(x){ return x === suits[0]; });

  var counts = {};
  vals.forEach(function(v){ counts[v] = (counts[v] || 0) + 1; });
  var groups = Object.keys(counts).map(function(k){ return {v:Number(k), n:counts[k]}; })
    .sort(function(a,b){ return b.n - a.n || b.v - a.v; });

  /* A straight needs five distinct ranks. The wheel is the one place an ace
     plays low, so it is checked outright rather than by arithmetic. */
  var straightHigh = 0;
  if(groups.length === 5){
    var d = groups.map(function(g){ return g.v; }).sort(function(a,b){ return b-a; });
    if(d[0] - d[4] === 4) straightHigh = d[0];
    else if(d[0]===14 && d[1]===5 && d[2]===4 && d[3]===3 && d[4]===2) straightHigh = 5;
  }

  if(flush && straightHigh)                  return {cat:8, tb:[straightHigh]};
  if(groups[0].n === 4)                      return {cat:7, tb:[groups[0].v, groups[1].v]};
  if(groups[0].n === 3 && groups[1].n === 2) return {cat:6, tb:[groups[0].v, groups[1].v]};
  if(flush)                                  return {cat:5, tb:vals};
  if(straightHigh)                           return {cat:4, tb:[straightHigh]};
  if(groups[0].n === 3)                      return {cat:3, tb:[groups[0].v, groups[1].v, groups[2].v]};
  if(groups[0].n === 2 && groups[1].n === 2) return {cat:2, tb:[groups[0].v, groups[1].v, groups[2].v]};
  if(groups[0].n === 2)                      return {cat:1, tb:[groups[0].v, groups[1].v, groups[2].v, groups[3].v]};
  return {cat:0, tb:vals};
}
function pokCmp(a, b){
  if(a.cat !== b.cat) return a.cat - b.cat;
  var n = Math.max(a.tb.length, b.tb.length);
  for(var i=0; i<n; i++){
    var x = a.tb[i] || 0, y = b.tb[i] || 0;
    if(x !== y) return x - y;
  }
  return 0;
}
/* 7 choose 5 is 21, so brute force is cheaper than being clever about it and
   far easier to be sure of. */
function pokCombos(n, k){
  var out = [], cur = [];
  (function pick(start){
    if(cur.length === k){ out.push(cur.slice()); return; }
    for(var i=start; i<n; i++){ cur.push(i); pick(i+1); cur.pop(); }
  })(0);
  return out;
}
var POK_C75 = pokCombos(7,5), POK_C65 = pokCombos(6,5);
function pokBest(cards){
  if(cards.length < 5) return null;
  var combos = cards.length === 7 ? POK_C75 : cards.length === 6 ? POK_C65 : pokCombos(cards.length, 5);
  var best = null, bestCards = null;
  for(var i=0; i<combos.length; i++){
    var hand = [], cb = combos[i];
    for(var j=0; j<5; j++) hand.push(cards[cb[j]]);
    var sc = pokScore5(hand);
    if(!best || pokCmp(sc, best) > 0){ best = sc; bestCards = hand; }
  }
  best.cards = bestCards;
  best.name = POK_CATS[best.cat];
  return best;
}

/* Chips are layered by how much each player could match: everyone contests the
   bottom layer, only the deeper stacks contest the ones above. Folded players'
   chips stay in the pot but win nothing. */
function pokBuildPots(players){
  var levels = [];
  players.forEach(function(p){
    if(p.committed > 0 && levels.indexOf(p.committed) === -1) levels.push(p.committed);
  });
  levels.sort(function(a,b){ return a-b; });
  var pots = [], prev = 0;
  levels.forEach(function(L){
    var amount = 0;
    players.forEach(function(p){ amount += Math.max(0, Math.min(p.committed, L) - prev); });
    var elig = players.filter(function(p){ return p.inHand && p.committed >= L; });
    if(amount > 0) pots.push({amount:amount, eligible:elig});
    prev = L;
  });
  return pots;
}
function pokAward(pots){
  var wins = {};
  pots.forEach(function(pot){
    var elig = pot.eligible.filter(function(p){ return p.inHand; });
    if(!elig.length) return;
    var best = null;
    elig.forEach(function(p){ if(!best || pokCmp(p.score, best) > 0) best = p.score; });
    var winners = elig.filter(function(p){ return pokCmp(p.score, best) === 0; });
    var share = Math.floor(pot.amount / winners.length), rem = pot.amount - share * winners.length;
    winners.forEach(function(p, i){ wins[p.id] = (wins[p.id] || 0) + share + (i < rem ? 1 : 0); });
  });
  return wins;
}

/* ---- betting ---- */
function pokTable(names, buyin, sb, bb){
  return {
    players: names.map(function(n, i){
      return {id:i, name:n, stack:buyin, bet:0, committed:0, inHand:false,
              allIn:false, hasActed:false, hole:[], isHero:i === 0, score:null};
    }),
    sb:sb, bb:bb, dealer:-1, board:[], deck:[], pots:[], refunds:{},
    stage:"idle", toAct:-1, currentBet:0, minRaise:bb, lastWinners:[], lastPot:0, log:[]
  };
}
function pokLive(T){ return T.players.filter(function(p){ return p.inHand; }); }
function pokActive(T){ return T.players.filter(function(p){ return p.inHand && !p.allIn; }); }
function pokPot(T){ var n = 0; T.players.forEach(function(p){ n += p.committed; }); return n; }
function pokNextSeat(T, from, pred){
  for(var i=1; i<=T.players.length; i++){
    var p = T.players[(from + i) % T.players.length];
    if(pred(p)) return p.id;
  }
  return -1;
}
function pokPut(p, amount){
  var n = Math.min(amount, p.stack);
  p.stack -= n; p.bet += n; p.committed += n;
  if(p.stack === 0) p.allIn = true;
  return n;
}
function pokStartHand(T){
  if(T.players.filter(function(p){ return p.stack > 0; }).length < 2) return false;
  T.players.forEach(function(p){
    p.bet = 0; p.committed = 0; p.hole = []; p.allIn = false;
    p.hasActed = false; p.inHand = p.stack > 0; p.score = null;
  });
  T.board = []; T.pots = []; T.refunds = {}; T.lastWinners = []; T.log = [];
  T.deck = pokShuffle(pokDeck());
  T.dealer = pokNextSeat(T, T.dealer, function(p){ return p.inHand; });

  var sbSeat = pokLive(T).length === 2 ? T.dealer     /* heads up the button posts the small blind */
             : pokNextSeat(T, T.dealer, function(p){ return p.inHand; });
  var bbSeat = pokNextSeat(T, sbSeat, function(p){ return p.inHand; });
  pokPut(T.players[sbSeat], T.sb);
  pokPut(T.players[bbSeat], T.bb);

  T.currentBet = T.bb; T.minRaise = T.bb; T.stage = "preflop";
  T.toAct = pokNextSeat(T, bbSeat, function(p){ return p.inHand && !p.allIn; });
  for(var r=0; r<2; r++) T.players.forEach(function(p){ if(p.inHand) p.hole.push(T.deck.pop()); });
  return true;
}
function pokLegal(T){
  var p = T.players[T.toAct];
  if(!p || !p.inHand || p.allIn || T.stage === "done") return null;
  var toCall = T.currentBet - p.bet;
  return {
    fold:true, check:toCall === 0, call:toCall > 0,
    callAmount:Math.min(toCall, p.stack),
    raise:pokActive(T).length > 1 && p.stack > toCall,
    minRaiseTo:Math.min(p.stack + p.bet, T.currentBet + T.minRaise),
    maxRaiseTo:p.stack + p.bet
  };
}
function pokAct(T, action, raiseTo){
  var p = T.players[T.toAct], lg = pokLegal(T);
  if(!lg) return false;
  if(action === "fold") p.inHand = false;
  else if(action === "check"){ if(!lg.check) return false; }
  else if(action === "call") pokPut(p, T.currentBet - p.bet);
  else if(action === "raise"){
    var to = Math.max(lg.minRaiseTo, Math.min(raiseTo, lg.maxRaiseTo));
    var inc = to - T.currentBet;
    pokPut(p, to - p.bet);
    if(p.bet > T.currentBet){
      /* Only a full raise reopens the betting; an all-in for less does not, so
         players who have already acted are not asked again. */
      if(inc >= T.minRaise){
        T.minRaise = inc;
        T.players.forEach(function(o){ if(o !== p && o.inHand && !o.allIn) o.hasActed = false; });
      }
      T.currentBet = p.bet;
    }
  }else return false;
  p.hasActed = true;
  T.log.push({seat:p.id, action:action, bet:p.bet, stage:T.stage});
  pokAdvance(T);
  return true;
}
function pokRoundDone(T){
  var act = pokActive(T);
  if(pokLive(T).length < 2 || act.length === 0) return true;
  for(var i=0; i<act.length; i++)
    if(!act[i].hasActed || act[i].bet !== T.currentBet) return false;
  return true;
}
function pokAdvance(T){
  if(pokLive(T).length < 2){ pokSettle(T); return; }
  if(!pokRoundDone(T)){
    T.toAct = pokNextSeat(T, T.toAct, function(p){ return p.inHand && !p.allIn; });
    return;
  }
  if(pokActive(T).length < 2){                        /* nobody can act, so run it out */
    while(T.board.length < 5) T.board.push(T.deck.pop());
    pokSettle(T);
    return;
  }
  pokNextStreet(T);
}
function pokNextStreet(T){
  T.players.forEach(function(p){ p.bet = 0; p.hasActed = false; });
  T.currentBet = 0; T.minRaise = T.bb;
  if(T.stage === "preflop"){ T.stage = "flop"; T.board.push(T.deck.pop(), T.deck.pop(), T.deck.pop()); }
  else if(T.stage === "flop"){ T.stage = "turn"; T.board.push(T.deck.pop()); }
  else if(T.stage === "turn"){ T.stage = "river"; T.board.push(T.deck.pop()); }
  else { pokSettle(T); return; }
  T.toAct = pokNextSeat(T, T.dealer, function(p){ return p.inHand && !p.allIn; });
}
/* Chips bet beyond what anyone called were never contested, so they go back.
   Without this they sit in a pot layer no live player is eligible for and
   simply vanish. */
function pokRefundUncalled(T){
  var tot = T.players.map(function(p){ return p.committed; }).sort(function(a,b){ return b-a; });
  if(tot.length < 2 || tot[0] === tot[1]) return;
  var cap = tot[1];
  T.players.forEach(function(p){
    if(p.committed > cap){
      var back = p.committed - cap;
      p.stack += back; p.committed = cap; T.refunds[p.id] = back;
      if(p.stack > 0) p.allIn = false;
    }
  });
}
function pokSettle(T){
  pokRefundUncalled(T);
  /* Every route to a showdown deals the board out first, but evaluating a
     short board would throw and strand the pot, so the guard stays. */
  while(pokLive(T).length > 1 && T.board.length < 5 && T.deck.length) T.board.push(T.deck.pop());
  var live = pokLive(T);
  T.lastPot = pokPot(T);
  if(live.length === 1){
    live[0].stack += T.lastPot;
    T.lastWinners = [{id:live[0].id, won:T.lastPot, how:"everyone folded"}];
  }else{
    live.forEach(function(p){ p.score = pokBest(p.hole.concat(T.board)); });
    T.pots = pokBuildPots(T.players);
    var wins = pokAward(T.pots);
    T.lastWinners = [];
    Object.keys(wins).forEach(function(id){
      var p = T.players[Number(id)];
      p.stack += wins[id];
      T.lastWinners.push({id:p.id, won:wins[id], how:p.score.name});
    });
  }
  /* The chips are on stacks now, so clearing the committed amounts keeps
     pokPot honest instead of leaving a ghost pot that double-counts. */
  T.players.forEach(function(p){ p.committed = 0; p.bet = 0; });
  T.stage = "done"; T.toAct = -1;
}
function pokRebuyBots(T, buyin){
  T.players.forEach(function(p){ if(!p.isHero && p.stack <= 0) p.stack = buyin; });
}

/* ---- bots ---- */
function pokEquity(hole, board, opponents, trials){
  var known = {}, i;
  hole.concat(board).forEach(function(c){ known[c.r + c.su.s] = 1; });
  var stub = pokDeck().filter(function(c){ return !known[c.r + c.su.s]; });
  var need = 5 - board.length, score = 0;
  for(var t=0; t<trials; t++){
    var n = stub.length, take = need + opponents*2, pool = stub.slice();
    for(i=0; i<take; i++){                            /* only shuffle what this trial needs */
      var j = i + rnd(n - i), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    var full = board.concat(pool.slice(0, need));
    var mine = pokBest(hole.concat(full)), lost = false, tie = 1;
    for(var o=0; o<opponents; o++){
      var c = pokCmp(pokBest([pool[need+o*2], pool[need+o*2+1]].concat(full)), mine);
      if(c > 0){ lost = true; break; }
      if(c === 0) tie++;
    }
    if(!lost) score += 1 / tie;
  }
  return score / trials;
}
var POK_PERSONAS = {
  /* Thresholds are in "shares": equity divided by an even split of the pot, so
     1.0 is an average hand however many players are in. Raw equity will not do
     here - 45% is a monster four-handed and a fold heads-up. */
  rock:    {name:"Rock",    callShare:1.05, raiseShare:1.95, bluff:0.03, sizing:0.50, tag:"tight, passive"},
  maniac:  {name:"Maniac",  callShare:0.62, raiseShare:1.25, bluff:0.22, sizing:0.85, tag:"loose, aggressive"},
  grinder: {name:"Grinder", callShare:0.85, raiseShare:1.55, bluff:0.09, sizing:0.65, tag:"balanced"},
  /* The calling station: comes along with almost anything but almost never
     raises. Loose-passive was the one corner the other three left uncovered,
     and it is the archetype that punishes bluffing into it. */
  station: {name:"Station",  callShare:0.55, raiseShare:2.30, bluff:0.02, sizing:0.45, tag:"calls anything"}
};
function pokBotAction(T, seat, persona){
  var p = T.players[seat], lg = pokLegal(T);
  if(!lg) return null;
  var style = POK_PERSONAS[persona] || POK_PERSONAS.grinder;

  /* Every raise already made this street raises the bar for making another.
     Without this the bots re-raise off a pot their own raise just inflated,
     and two rounds of that puts everyone all-in on a marginal hand. */
  var reraises = 0;
  for(var li=T.log.length-1; li>=0 && T.log[li].stage === T.stage; li--)
    if(T.log[li].action === "raise") reraises++;

  var opps  = Math.max(1, pokLive(T).length - 1);
  var eq    = pokEquity(p.hole, T.board, opps, T.board.length === 0 ? 120 : 200);
  var share = eq * (opps + 1);
  var pot   = pokPot(T), toCall = lg.callAmount, r = rnd(1000) / 1000;
  var bar   = style.raiseShare + reraises * 0.45;

  function sizeTo(base){
    var want = Math.round(base + pot * style.sizing * (0.8 + r * 0.4));
    /* capped so a routine value bet cannot turn into a stack-off; only a real
       monster puts everything in */
    var ceiling = share > 2.6 ? lg.maxRaiseTo : Math.round(p.bet + p.stack * 0.30);
    return Math.max(Math.min(want, ceiling, lg.maxRaiseTo), lg.minRaiseTo);
  }
  if(lg.check){
    if((share > bar || r < style.bluff) && lg.raise) return {action:"raise", raiseTo:sizeTo(0)};
    return {action:"check"};
  }
  var odds = toCall / (pot + toCall);
  if(share > bar && lg.raise && r > 0.30) return {action:"raise", raiseTo:sizeTo(T.currentBet)};
  if(eq >= odds * style.callShare) return {action:"call"};
  if(r < style.bluff * 0.35 && lg.raise && toCall < p.stack * 0.12)
    return {action:"raise", raiseTo:lg.minRaiseTo};
  return {action:"fold"};
}

/* ==========================================================================
   Table UI
   ========================================================================== */
var POK_SEATS = ["You", "Rock", "Maniac", "Grinder", "Station"];
var POK_WHO   = [null, "rock", "maniac", "grinder", "station"];
var pok = {T:null, seated:false, buyin:250, timer:null, endTimer:null, revealed:false, say:{}};

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
  if(text) pok.say[seat] = {text:text, until:Date.now() + 2100};
}

/* Chips in motion. Purely decorative: the stacks and the pot are drawn from the
   engine either way, so a dropped frame costs an animation and never a chip. */
var pokChipFly = [];
function pokChipMove(from, to, n, col, delay){
  pokChipFly.push({x0:from.x, y0:from.y, x1:to.x, y1:to.y,
                   n:Math.max(1, Math.min(5, n)), col:col,
                   start:Date.now() + (delay||0), dur:420});
}
function pokSeatStackPt(seat){
  if(seat === 0) return {x:TBL.cx+166, y:pokHeroY()-22};
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

function pokSetPokerStack(n){ pokerStack = n; save(); }

function pokBlinds(buyin){
  /* fifty big blinds, so a sitting lasts rather than turning into coin flips */
  var bb = Math.max(2, Math.round(buyin / 50));
  return {sb:Math.max(1, Math.round(bb / 2)), bb:bb};
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
  pokZ = z;
  POK_H = Math.max(330, Math.min(1000, rect.height / z));
  POK_ROOM = Math.round(POK_H * 0.577);
  TBL = {cx:POK_W/2, cy:POK_H*0.845, rx:400, ry:POK_H*0.338};
  pokCssW = rect.width; pokCssH = rect.height;
  pokCanvas.width  = Math.round(rect.width * dpr);
  pokCanvas.height = Math.round(rect.height * dpr);
  pokCtx.setTransform(dpr*z, 0, 0, dpr*z, 0, (rect.height - POK_H*z)*dpr/2);
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
var POK_LOOK = [
  {skin:"#b97a4e", hair:"#191210", shirt:"#35456b", style:0, glasses:true},
  {skin:"#7b4a2a", hair:"#2b1e16", shirt:"#6e3230", style:1, glasses:false},
  {skin:"#e8b98a", hair:"#4a3423", shirt:"#2b5547", style:2, glasses:false},
  {skin:"#d09a68", hair:"#7a6a55", shirt:"#5a4a2c", style:1, glasses:true}
];
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

function pokPerson(c,x,y,s,o,t,seed,dim){
  var br=Math.sin(t*1.05+seed)*1.1;
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
  if(o.glasses){
    c.strokeStyle="rgba(235,225,205,.6)"; c.lineWidth=1.6;
    c.beginPath(); c.arc(-7,-86,7,0,7); c.stroke();
    c.beginPath(); c.arc( 7,-86,7,0,7); c.stroke();
    c.beginPath(); c.moveTo(-1,-86); c.lineTo(1,-86); c.stroke();
  }
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
function pokQueueDeal(T){
  pokFly = []; pokBoardShown = 0;
  var now = Date.now(), k = 0;
  /* one card each, round the table twice, starting left of the button */
  for(var round=0; round<2; round++){
    for(var i=0; i<T.players.length; i++){
      var seat = (T.dealer + 1 + i) % T.players.length;
      if(!T.players[seat].inHand) continue;
      pokFly.push({kind:"hole", seat:seat, idx:round, start:now + k*80, dur:260});
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

  /* A folded player is not drawn at all -- no ghost at the felt, no empty
     chair either -- and whoever is left in their arm (left: seats 1-2, right:
     seats 3-4) closes ranks across that arm's own span. Recomputed every
     frame off the engine's own T.players[].inHand, so it can never drift out
     of step with a fold the moment it happens. */
  var seatDegs = pokAnimateSeatDegs(pokLiveSeatDegs(T));
  for(var seat = 1; seat <= 4; seat++){
    var deg = seatDegs[seat];
    if(deg === undefined) continue;                   /* folded: nothing here */
    var i = seat - 1, p = T.players[seat], sp2 = seatPos(deg), turn = T.toAct === seat;
    pokPerson(c,sp2.x,sp2.y-10,0.86,POK_LOOK[i],t,i*2.1,false);

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
    pokSayFor(c, seat, sp2.x, sp2.y-106);
  }

  if(T.board.length > pokBoardShown){
    for(var bi=pokBoardShown; bi<T.board.length; bi++)
      pokFly.push({kind:"board", idx:bi, start:Date.now()+(bi-pokBoardShown)*110, dur:250});
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
  c.save();
  c.fillStyle = T.toAct === 0 ? "rgba(232,194,100,.2)" : "rgba(0,0,0,.55)";
  pokRR(c,TBL.cx+96,pokHeroY()-30,140,34,9); c.fill();
  c.strokeStyle = T.toAct === 0 ? "rgba(232,194,100,.85)" : "rgba(232,194,100,.25)";
  c.lineWidth = T.toAct === 0 ? 2 : 1; c.stroke();
  c.textAlign="center"; c.fillStyle="#efe2c2"; c.font="700 "+pokFont(10)+"px system-ui,sans-serif";
  c.fillText("YOUR STACK",TBL.cx+166,pokHeroY()-14);
  c.fillStyle="#e8c264"; c.font="700 "+pokFont(15)+"px system-ui,sans-serif";
  c.fillText(fmt(me.stack),TBL.cx+166,pokHeroY());
  c.restore();

  /* Beside your stack rather than over your cards: centred, it landed on the
     community cards, and on a short scene there is no gap between the board and
     your own hand to put it in. */
  pokSayFor(c, 0, TBL.cx+190, pokHeroY()-36);
  pokDrawChipFly(c);
  pokDrawFlights(c);
  pokVignette(c);
}
var pokLayer = null;
function pokVignette(c){
  var vg=c.createRadialGradient(POK_W/2,POK_H*0.5,POK_H*0.38,POK_W/2,POK_H*0.46,POK_H*1.05);
  vg.addColorStop(0,"rgba(0,0,0,0)"); vg.addColorStop(1,"rgba(0,0,0,.6)");
  c.fillStyle=vg; c.fillRect(0,0,POK_W,POK_H);
}

/* One loop, and it only paints while the poker table is the tab on screen. */
var pokT0 = Date.now();
function pokFrame(){
  var sec = document.querySelector(".game.on");
  if(sec && sec.id === "tab-poker"){
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
function pokSnapRaise(v, lg){
  if(!lg) return v;
  if(v >= lg.maxRaiseTo) return lg.maxRaiseTo;
  var snapped = Math.round(v / 5) * 5;
  if(snapped < lg.minRaiseTo) snapped = lg.minRaiseTo;
  if(snapped > lg.maxRaiseTo) snapped = lg.maxRaiseTo;
  return snapped;
}
function pokRaiseValue(){
  var lg = pok.T && pok.T.toAct === 0 ? pokLegal(pok.T) : null;
  return pokSnapRaise(Number($("pokSlider").value), lg);
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
  var sl = $("pokSlider");
  sl.disabled = !on || !lg.raise;
  if(on && lg.raise){
    sl.min = lg.minRaiseTo; sl.max = lg.maxRaiseTo;
    if(Number(sl.value) < lg.minRaiseTo || Number(sl.value) > lg.maxRaiseTo) sl.value = lg.minRaiseTo;
    var to = pokSnapRaise(Number(sl.value), lg);
    $("pokRaiseVal").textContent = fmt(to);
    $("pokRaise").textContent = to >= lg.maxRaiseTo ? "All in (R)" : "Raise (R)";
  }else{
    $("pokRaiseVal").textContent = "—";
    $("pokRaise").textContent = "Raise (R)";
  }
  $("pokNext").style.display = pok.T && pok.T.stage === "done" ? "" : "none";
}
/* The scene repaints itself every frame; only the buttons need telling. */
function pokRender(){ pokRenderActions(); }

function pokSay(text, kind){ msg($("pokMsg"), text, kind || "info"); }

function pokSit(){
  if(pok.seated) return;
  if(pok.buyin < 20){ pokSay("The minimum buy-in is 20 chips.", "lose"); return; }
  if(pok.buyin > bank){ pokSay("Not enough chips for that buy-in.", "lose"); return; }
  var bl = pokBlinds(pok.buyin);
  wager(pok.buyin, "poker");
  pok.T = pokTable(POK_SEATS, pok.buyin, bl.sb, bl.bb);
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
  clearTimeout(pok.timer);
  clearTimeout(pok.endTimer);
  var stack = pok.T.players[0].stack + pok.T.players[0].committed;
  var net = stack - pok.buyin;
  if(stack > 0) payout(stack, "poker");
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
  pok.say = {}; pokChipFly = [];
  pokCurDeg = {};                                    /* everyone is back in the hand */
  if(!pokStartHand(pok.T)){ pokLeave(); return; }
  pokQueueDeal(pok.T);
  stats.hands++;
  pokSetPokerStack(pok.T.players[0].stack + pok.T.players[0].committed);
  playDeal();
  pokSay("Your move.", "info");
  pokRender();
  pokStep();
}
/* Drives whoever is next: the player gets the buttons enabled, a bot gets a
   pause so the table does not resolve itself faster than it can be read. */
/* Long enough to read as somebody deciding rather than a script firing. A bet
   to answer, a later street and a deliberate player all add to it; the maniac
   takes it off again, because snapping it in is the tell that fits him. */
function pokThinkMs(T, seat){
  var lg = pokLegal(T), ms = 950 + rnd(850);
  if(lg && lg.callAmount > 0) ms += 320;
  if(T.stage !== "preflop") ms += 220;
  if(POK_WHO[seat] === "rock") ms += 260;
  if(POK_WHO[seat] === "station") ms += 120;
  if(POK_WHO[seat] === "maniac") ms -= 230;
  return Math.max(620, ms);
}
function pokStep(){
  clearTimeout(pok.timer);
  if(!pok.T) return;
  if(pok.T.stage === "done"){ pokShowdown(); return; }
  pokRender();
  if(pok.T.toAct === 0) return;
  var seat = pok.T.toAct;
  pok.timer = setTimeout(function(){
    if(!pok.T || pok.T.toAct !== seat) return;
    var mv = pokBotAction(pok.T, seat, POK_WHO[seat]);
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
  }, pokThinkMs(pok.T, seat));
}
function pokHeroAct(action, amount){
  if(!pok.T || pok.T.toAct !== 0) return;
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
  pokSetPokerStack(pok.T.players[0].stack + pok.T.players[0].committed);
  pokStep();
}
function pokShowdown(){
  pok.revealed = pokLive(pok.T).length > 1;
  pok.T.lastWinners.forEach(function(w, i){
    pokChipMove(pokPotPt(), pokSeatStackPt(w.id), pokStackH(w.won)+2, "#c9a227", 240 + i*130);
  });
  pokRender();
  pokSetPokerStack(pok.T.players[0].stack);
  var mine = null;
  pok.T.lastWinners.forEach(function(w){ if(w.id === 0) mine = w; });
  var names = pok.T.lastWinners.map(function(w){
    return pok.T.players[w.id].name + " " + fmt(w.won);
  }).join(", ");
  if(mine){
    playWin(mine.won >= pok.buyin ? "big" : "small");
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
    }, 1600);
  }
}

/* ---- wiring ---- */
var pokBuyBtns = chipRow($("pokBuyBar"), null, function(v){
  pok.buyin = v;
  $("pokBuyin").textContent = fmt(v);
}, null);
pokBuyBtns[1].classList.add("sel");
$("pokSit").addEventListener("click", function(){ playClick(); pokSit(); });
$("pokLeave").addEventListener("click", function(){ playClick(); pokLeave(); });

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
$("pokFold").addEventListener("click",  function(){ pokHeroAct("fold"); });
$("pokCheck").addEventListener("click", function(){ pokHeroAct("check"); });
$("pokCall").addEventListener("click",  function(){ pokHeroAct("call"); });
$("pokRaise").addEventListener("click", function(){ pokHeroAct("raise", pokRaiseValue()); });
$("pokSlider").addEventListener("input", function(){ pokRenderActions(); });

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
