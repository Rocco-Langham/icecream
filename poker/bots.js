"use strict";
/* ==========================================================================
   Poker, part 2 of 3: the opponents.

   How the other four decide. Strength comes from rolling the hand out against
   random opponents rather than from a table of hunches, so they answer the
   board actually in front of them; personality then decides what to do with
   that number. Pure like the engine: it reads a table and returns a move.

   Loads after part 1. Nothing here may read or write the page either.
   ========================================================================== */

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
    /* Through the same snap the player's own raises go through, so a bot never
       pushes out a figure the table could not otherwise produce. The two legal
       exceptions still stand: the smallest legal raise, and all-in for exactly
       what is left. */
    return pokSnapRaise(Math.max(Math.min(want, ceiling, lg.maxRaiseTo), lg.minRaiseTo), lg);
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
