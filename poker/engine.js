"use strict";
/* ==========================================================================
   Poker, part 1 of 3: the engine.

   The rules and nothing else -- a deck, ranking a hand, building side pots,
   and the betting state machine. No bots, no drawing, no page: everything
   here is a pure function of the cards and the chips, which is exactly what
   let it be tested on its own. It was -- hand rankings against the published
   frequencies of 7-card hands, and chip conservation across tens of thousands
   of randomised hands.

   Nothing in this file may read or write the page.
   ========================================================================== */

var POK_RV = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};
var POK_CATS = ["High card","Pair","Two pair","Three of a kind","Straight",
               "Flush","Full house","Four of a kind","Straight flush"];

/* ==========================================================================
   Hand-strength readout: what the hero has right now, and what it could
   still turn into. Runs from the hero's own two cards, never from anything
   about the bots -- exactly what a player at the table actually knows.
   ========================================================================== */
var POK_RANK_NAME    = {2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven",8:"Eight",
                         9:"Nine",10:"Ten",11:"Jack",12:"Queen",13:"King",14:"Ace"};
var POK_RANK_NAME_PL = {2:"Twos",3:"Threes",4:"Fours",5:"Fives",6:"Sixes",7:"Sevens",8:"Eights",
                         9:"Nines",10:"Tens",11:"Jacks",12:"Queens",13:"Kings",14:"Aces"};

function pokDescribeHole(hole){
  var rA = POK_RV[hole[0].r], rB = POK_RV[hole[1].r];
  if(rA === rB) return "Pocket " + POK_RANK_NAME_PL[rA];
  var hi = Math.max(rA,rB), lo = Math.min(rA,rB);
  return POK_RANK_NAME[hi] + "-" + POK_RANK_NAME[lo] + (hole[0].su === hole[1].su ? " suited" : " offsuit");
}
function pokDescribeHand(score){
  var tb = score.tb;
  switch(score.cat){
    case 8: return "Straight flush, " + POK_RANK_NAME[tb[0]] + "-high";
    case 7: return "Four of a kind, " + POK_RANK_NAME_PL[tb[0]];
    case 6: return POK_RANK_NAME_PL[tb[0]] + " full of " + POK_RANK_NAME_PL[tb[1]];
    case 5: return "Flush, " + POK_RANK_NAME[tb[0]] + "-high";
    case 4: return "Straight, " + POK_RANK_NAME[tb[0]] + "-high";
    case 3: return "Three of a kind, " + POK_RANK_NAME_PL[tb[0]];
    case 2: return "Two pair, " + POK_RANK_NAME_PL[tb[0]] + " and " + POK_RANK_NAME_PL[tb[1]];
    case 1: return "Pair of " + POK_RANK_NAME_PL[tb[0]];
    default: return POK_RANK_NAME[tb[0]] + "-high";
  }
}
/* Every card still in the deck (from the hero's own point of view -- the
   bots' hidden hole cards are not excluded, because the hero cannot see them
   either) is tried as the very next card. Whichever ones beat the current
   hand are tallied by the category they would complete: the classic meaning
   of "outs", not a full multi-street run-out. On the river there is no next
   card, so there is nothing left to draw to. */
function pokOuts(hole, board){
  if(board.length < 3 || board.length > 5) return null;
  var current = pokBest(hole.concat(board));
  if(board.length === 5) return {current:current, outs:[]};

  var known = {};
  hole.concat(board).forEach(function(c){ known[c.r + c.su.s] = 1; });
  var remaining = pokDeck().filter(function(c){ return !known[c.r + c.su.s]; });

  var tally = {};
  remaining.forEach(function(c){
    var next = pokBest(hole.concat(board).concat([c]));
    /* Strictly a better-NAMED hand, not a better kicker within the one the
       hero already has -- otherwise a card that only improves the kicker on
       an already-made two pair would show up as an "out" toward two pair,
       which is a hand the player already holds. */
    if(next.cat <= current.cat) return;

    /* On the river card, the five community cards are a hand of their own --
       one every player at the table is dealt for free. A card that only
       completes THAT hand is not an out: it does not distinguish the hero
       from anyone else at the table, whatever it does to the hero's own
       category. This only arises turning the river, since a four-card board
       cannot make a five-card hand by itself -- pokBest returns null and the
       comparison below is skipped everywhere else. */
    if(board.length === 4){
      var boardOnly = pokBest(board.concat([c]));
      if(boardOnly && pokCmp(boardOnly, next) >= 0) return;
    }
    tally[next.cat] = (tally[next.cat] || 0) + 1;
  });
  var outs = Object.keys(tally).map(Number).sort(function(a,b){ return b - a; })
    .map(function(cat){ return {cat:cat, name:POK_CATS[cat], outs:tally[cat]}; });
  return {current:current, outs:outs};
}
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
/* Every raise in this game lands on a multiple of five, whoever makes it, so
   clamp to the legal window first and only then snap. Going all-in is the one
   exception: a short stack's whole remaining pile is legal whatever it is. */
function pokSnapRaise(v, lg){
  if(!lg) return v;
  if(v >= lg.maxRaiseTo) return lg.maxRaiseTo;
  var snapped = Math.round(v / 5) * 5;
  if(snapped < lg.minRaiseTo) snapped = lg.minRaiseTo;
  if(snapped > lg.maxRaiseTo) snapped = lg.maxRaiseTo;
  return snapped;
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
