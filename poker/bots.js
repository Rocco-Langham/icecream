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
var POK_ARCHETYPES = {
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
   A hundred of them
   --------------------------------------------------------------------------
   The fifteen above are hand-tuned and measurably distinct: fold rate tracks
   the calling threshold across all of them in order. Writing three hundred by
   hand would not add that many ways to play -- it would add near-duplicates
   and quietly lose the one property worth having. So each archetype seeds a
   share of the total instead.

   Every parameter is nudged by a fixed amount derived from the seat's own
   name, so two players from the same archetype are recognisably the same
   school and never the same person: one rock calls a fraction wider than
   another, one maniac fires a little bigger. Variant zero is the archetype
   untouched, so the originals are all still in the deck exactly as tuned.

   Deterministic on purpose. The same key always gives the same player, so a
   personality can be looked up, tested and argued about rather than being a
   different opponent every time the page loads.
   ========================================================================== */

/* How many opponents there are in total. Fifteen archetypes will not divide
   into it evenly, so the remainder is handed out one apiece from the top
   rather than piled on one school: at a hundred, ten archetypes field seven
   players and five field six. Change this number and the rest follows. */
var POK_TOTAL = 100;

/* A small fixed hash: same string in, same number out, spread across -1..1 to
   push a parameter either way.

   The mixing at the end is not decoration. FNV on its own leaves short, very
   similar strings sitting close together, and taking it modulo a small number
   then threw most of what little spread there was away: "dreamer2" and
   "dreamer8" came out identical on every one of the five parameters, so two
   of the three hundred were the same player. The finalising rounds scatter
   the low bits properly, and the whole 32-bit range is used rather than two
   thousand buckets of it. */
function pokJitter(key, salt){
  var h = 2166136261;
  var s = key + "#" + salt;
  for(var i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0; h = (h * 2246822519) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = (h * 3266489917) >>> 0;
  /* >>> 0 after every xor: ^ in JavaScript hands back a SIGNED 32-bit number,
     so without it the last step can go negative and the result lands outside
     -1..1 -- which quietly pushes a parameter harder than the band intends. */
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967295) * 2 - 1;                   /* -1 .. 1 */
}
function pokClamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }

var POK_PERSONAS = (function(){
  var out = {};
  var names = Object.keys(POK_ARCHETYPES);
  var each = Math.floor(POK_TOTAL / names.length);
  var spare = POK_TOTAL % names.length;
  names.forEach(function(name, n){
    var base = POK_ARCHETYPES[name];
    var howMany = each + (n < spare ? 1 : 0);
    for(var i = 0; i < howMany; i++){
      var key = i === 0 ? name : name + i;
      if(i === 0){ out[key] = base; continue; }      /* the tuned original, untouched */
      out[key] = {
        /* Bands rather than free rein: a variant is a shade of its archetype,
           not a new one, and none of them may drift into a player who folds
           everything or calls everything. */
        callShare:  +pokClamp(base.callShare  + pokJitter(key, "c") * 0.07, 0.50, 1.28).toFixed(4),
        raiseShare: +pokClamp(base.raiseShare + pokJitter(key, "r") * 0.14, 1.18, 2.40).toFixed(4),
        bluff:      +pokClamp(base.bluff      + pokJitter(key, "b") * 0.035, 0.01, 0.30).toFixed(4),
        sizing:     +pokClamp(base.sizing     + pokJitter(key, "s") * 0.08, 0.30, 1.00).toFixed(4),
        think: Math.round(base.think + pokJitter(key, "t") * 70),
        tag: base.tag
      };
    }
  });
  return out;
})();

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
var POK_NAMES = [
  "Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Jamie", "Taylor", "Avery", "Quinn",
  "Reese", "Rowan", "Skyler", "Charlie", "Frankie", "Emerson", "Harper", "Sage", "Drew", "Noor",
  "Aria", "Beau", "Cleo", "Dara", "Eden", "Flynn", "Greer", "Hollis", "Indigo", "Jules",
  "Kai", "Lane", "Marlow", "Nico", "Oakley", "Paz", "Quill", "Remy", "Sasha", "Tatum",
  "Uma", "Vesper", "Wren", "Xan", "Yuki", "Zephyr", "Adair", "Blair", "Cameron", "Dallas",
  "Ellis", "Finley", "Gray", "Haven", "Ira", "Jesse", "Kendall", "Lennon", "Marley", "Nova",
  "Oscar", "Payton", "Rory", "Shea", "Tanner", "Val", "Winter", "Yael", "Ziggy", "Arden",
  "Bailey", "Corey", "Devon", "Emery", "Frances", "Glenn", "Hayden", "Iris", "Joss", "Kit",
  "Logan", "Micah", "Noel", "Orion", "Parker", "Quincy", "Robin", "Sloane", "Toby", "Vega",
  "Wade", "Yara", "Zane", "Ainsley", "Brett", "Cassidy", "Darcy", "Elliot", "Fern", "Gale",
  "Hunter", "Isa", "Jody", "Keegan", "Linden", "Maddox", "Nash", "Odin", "Presley", "Reagan",
  "Sawyer", "Teagan", "Ulric", "Verity", "Wesley", "Xiomara", "Yosef", "Zara", "Amari", "Bodhi",
  "Cove", "Delta", "Echo", "Fable", "Gia", "Hale", "Ivo", "Juno", "Kaya", "Leith",
  "Mabel", "Niko", "Ozzy", "Pilar", "Quinnley", "Rain", "Sol", "Tova", "Ute", "Viv",
  "Wilder", "Xena", "Yanis", "Zia", "Abel", "Bryn", "Colby", "Dove", "Esme", "Fox",
  "Gideon", "Hollie", "Ines", "Jarvis", "Kira", "Lior", "Mira", "Neel", "Ola", "Perry",
  "Rhys", "Sidonie", "Thea", "Uri", "Vidal", "Wray", "Ximena", "Yves", "Zuri", "Anwen",
  "Bram", "Caelan", "Dermot", "Effie", "Fionn", "Gwen", "Hadley", "Ilse", "Jonty", "Kester",
  "Lark", "Merrin", "Nia", "Orla", "Piers", "Rafe", "Saoirse", "Torin", "Una", "Vaughn",
  "Wynn", "Yannick", "Zinnia", "Arlo", "Blythe", "Caspian", "Dune", "Elio", "Fenn", "Goldie",
  "Halcyon", "Ilia", "Jove", "Kestrel", "Lyra", "Maeve", "Nyx", "Onyx", "Peregrine", "Quorra",
  "Roan", "Selkie", "Tamsin", "Ursa", "Vale", "Willa", "Xanthe", "Yarrow", "Zephyrine", "Ansel",
  "Bex", "Cyrus", "Della", "Emrys", "Faye", "Gus", "Hattie", "Idris", "Jonah", "Keira",
  "Lachlan", "Mose", "Nell", "Otto", "Posy", "Rune", "Shiloh", "Tobias", "Verona", "Wilf",
  "Yolanda", "Zeb", "Astrid", "Bly", "Clemmie", "Dax", "Etta", "Freya", "Grover", "Hugo",
  "Ivy", "Jarek", "Kofi", "Lumi", "Mateo", "Nadia", "Oren", "Pax", "Rosalind", "Soren",
  "Tilly", "Umberto", "Viveca", "Wendell", "Xiu", "Yusuf", "Zola", "Beckett", "Calla", "Dashiell",
  "Elowen", "Fintan", "Gita", "Hesper", "Imre", "Jinx", "Kanoa", "Linus", "Moss", "Noa",
  "Ottoline", "Pip", "Quilla", "Rilla", "Stellan", "Tycho", "Ulla", "Vidar", "Yseult", "Zarek",
  "Bo", "Cricket", "Dew", "Fennec", "Guthrie", "Hazel", "Isolde", "Jem", "Kip", "Zephyrus"
];

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
