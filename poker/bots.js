"use strict";
/* ==========================================================================
   Poker, part 2 of 3: the opponents.

   Everything about the players who are not people: who they are, what they
   are called, how they decide, and how long they take about it. Both tables
   draw their opponents from here -- the one against the house and the online
   one, where the host fills empty seats from the same fifteen.

   Strength comes from rolling the hand out against random opponents rather
   than from a table of hunches, so they answer the board actually in front of
   them; personality then decides what to do with that number.

   Loads after part 1. Pure like the engine: nothing here reads or writes the
   page, and nothing reaches forward into either table -- a caller says which
   personality is acting rather than this file going to look.
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
     here - 45% is a monster four-handed and a fold heads-up.

     callShare multiplies the pot odds a call has to beat, so LOWER calls wider.
     raiseShare is the share needed to raise, so LOWER raises more often. think
     is the pause before acting, in ms: the deliberate players run long and the
     wild ones snap it in, which is a tell in itself.

     Fifteen of them, four drawn per table, so the same seat is a different
     opponent each time you sit down. The keys are never shown -- you only get
     the play to read. */

  /* --- tight and passive: fold a lot, believe them when they bet --- */
  rock:       {callShare:1.05, raiseShare:1.95, bluff:0.03, sizing:0.50, think: 260, tag:"tight, passive"},
  nit:        {callShare:1.20, raiseShare:2.20, bluff:0.01, sizing:0.55, think: 300, tag:"folds almost everything"},

  /* --- tight and aggressive: selective, and punishing once they commit --- */
  shark:      {callShare:0.95, raiseShare:1.60, bluff:0.14, sizing:0.70, think:  40, tag:"tight, aggressive"},
  accountant: {callShare:1.00, raiseShare:1.75, bluff:0.05, sizing:0.60, think: 180, tag:"pot-odds purist"},
  surgeon:    {callShare:0.98, raiseShare:1.50, bluff:0.11, sizing:0.80, think:  90, tag:"rare spots, big bets"},

  /* --- balanced: the middle of the range, hardest to pin down --- */
  grinder:    {callShare:0.85, raiseShare:1.55, bluff:0.09, sizing:0.65, think:   0, tag:"balanced"},
  veteran:    {callShare:0.90, raiseShare:1.65, bluff:0.08, sizing:0.60, think: 140, tag:"balanced, cautious"},
  needler:    {callShare:0.78, raiseShare:1.35, bluff:0.15, sizing:0.35, think: -60, tag:"small-ball, raises often"},

  /* --- loose and aggressive: they will run you over if you only play premiums --- */
  maniac:     {callShare:0.62, raiseShare:1.25, bluff:0.22, sizing:0.85, think:-230, tag:"loose, aggressive"},
  bully:      {callShare:0.80, raiseShare:1.40, bluff:0.18, sizing:0.95, think:-120, tag:"overbets relentlessly"},
  hothead:    {callShare:0.65, raiseShare:1.30, bluff:0.25, sizing:0.75, think:-180, tag:"bluffs the most"},
  showman:    {callShare:0.72, raiseShare:1.45, bluff:0.20, sizing:0.90, think: -90, tag:"plays for big pots"},

  /* --- loose and passive: they come along for the ride. The archetype that
         punishes bluffing, because there is no point firing at someone who
         will not fold. --- */
  station:    {callShare:0.55, raiseShare:2.30, bluff:0.02, sizing:0.45, think: 120, tag:"calls anything"},
  tourist:    {callShare:0.60, raiseShare:1.85, bluff:0.06, sizing:0.40, think:  60, tag:"loose, timid bets"},
  dreamer:    {callShare:0.58, raiseShare:2.00, bluff:0.04, sizing:0.50, think: 200, tag:"chases every draw"}
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

/* ==========================================================================
   Casting a table
   ========================================================================== */

/* The felt is drawn for four seats around the arc, so that is how many the
   single-player game draws. The online table asks for however many the host
   left empty. */
var POK_BOTS = 4;

/* Plain first names, and deliberately nothing more. The seats used to be
   labelled Rock and Maniac, which handed you the read before a card was dealt
   -- the whole point of a personality is that you have to work it out from how
   they play. Neutral names, so the table is people rather than strategies. */
var POK_NAMES = ["Alex","Sam","Jordan","Casey","Riley","Morgan","Jamie","Taylor",
                 "Avery","Quinn","Reese","Rowan","Skyler","Charlie","Frankie",
                 "Emerson","Harper","Sage","Drew","Noor"];

/* n distinct items, drawn without replacement so no two seats are the same
   person twice over. */
function pokPick(list, n){
  var pool = list.slice(), out = [];
  while(out.length < n && pool.length) out.push(pool.splice(rnd(pool.length), 1)[0]);
  return out;
}

/* Seat 0 is left empty for whoever is being dealt to -- the player at the
   single-player table, and nobody at the online one, where the host slots
   these in behind the people who turned up. Names and personalities are drawn
   independently, so a name tells you nothing about the style behind it even
   across sessions. */
function pokDrawCast(n){
  var want = typeof n === "number" ? n : POK_BOTS;
  return {
    names: ["You"].concat(pokPick(POK_NAMES, want)),
    who:   [null].concat(pokPick(Object.keys(POK_PERSONAS), want))
  };
}

/* How long one of them sits there before acting.

   Long enough to read as somebody deciding rather than a script firing. A bet
   to answer and a later street both add to it, and then the personality's own
   think offset lands on top: the careful ones deliberate, the wild ones snap
   it in. That pause is a tell in itself, and the only one they give away for
   free -- everything else you have to work out from the betting.

   The persona is passed in rather than looked up. It used to reach into the
   single-player table's own cast, which was right for that table and silently
   wrong for the online one -- an online bot got the base pause and none of its
   personality, because the cast it was being looked up in belonged to a game
   that was not being played. */
function pokThinkMs(T, persona){
  var lg = pokLegal(T), ms = 950 + rnd(850);
  if(lg && lg.callAmount > 0) ms += 320;
  if(T.stage !== "preflop") ms += 220;
  var style = POK_PERSONAS[persona];
  if(style) ms += style.think;
  return Math.max(620, ms);
}
