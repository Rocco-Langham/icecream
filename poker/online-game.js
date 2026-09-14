"use strict";
/* ==========================================================================
   Poker Online, part 2: playing the hand.

   The host's browser is the only one running the engine. It shuffles, deals,
   applies everyone's moves and publishes what happened. Everyone else reads
   what was published, sees their own two cards and nobody else's, and sends
   their moves back as rows in a table.

   THE ONE FUNCTION TO GET RIGHT is mpPublic. It is the gate between what the
   host knows and what the table is told, and everything the host knows
   includes the undealt deck and every player's hand. It builds the published
   state from scratch, field by field, rather than copying the table and
   deleting the secret parts -- a copy-then-delete leaks the day somebody adds
   a field and forgets to delete it, and the failure is silent.
   ========================================================================== */

var MP_ACT_MS   = 30000;                             /* act, or the table moves on without you */
var MP_NEXT_MS  = 4500;                              /* how long the finished hand stays up */

var mpT = null;                                      /* HOST ONLY: the real table, deck and all */
var mpOrder = [];                                    /* seat index -> user id */
var mpLastSeen = 0;                                  /* HOST: highest action row already applied */
var mpClock = null;                                  /* HOST: the act-or-fold timer */
var mpNextTimer = null;
var mpState = null;                                  /* EVERYONE: the published state */
var mpMyCards = null;                                /* EVERYONE: your own two cards */
var mpGameChan = null;
var mpWho = [];                                      /* HOST: seat -> persona, null for a person */
var mpBotTimer = null;

/* ---- the gate ----
   Built up, never copied down. Each player gets the figures the table can see
   anyway -- what they have left, what they have put in, whether they are still
   in the hand -- and their cards only once the hand is over and they have been
   shown. */
function mpPublic(T, msg, reveal){
  return {
    hand: mpRoom ? mpRoom.hand_no : 0,
    stage: T.stage,
    board: T.board.map(mpCardOut),
    pot: pokPot(T),
    currentBet: T.currentBet,
    minRaise: T.minRaise,
    dealer: T.dealer,
    toAct: T.stage === "done" ? -1 : T.toAct,
    deadline: T.stage === "done" ? 0 : Date.now() + MP_ACT_MS,
    sb: T.sb, bb: T.bb,
    /* Carried through rather than left behind in the lobby's version of this
       row, which this replaces wholesale. It costs one number and keeps the
       state able to describe itself -- a host who reloads mid-game finds the
       table as they set it up. */
    bots: mpOrder.filter(function(u){ return !u; }).length,
    msg: msg || "",
    winners: (T.lastWinners || []).map(function(w){
      return {seat:w.id, won:w.won, how:w.how || ""};
    }),
    players: T.players.map(function(p, i){
      return {
        seat: i,
        uid: mpOrder[i] || null,
        name: p.name,
        stack: p.stack,
        bet: p.bet,
        committed: p.committed,
        inHand: p.inHand,
        allIn: p.allIn,
        hasActed: p.hasActed,
        /* Only at a showdown, and only for someone still in the hand. A player
           who folded keeps their cards, exactly as they would at a real
           table. */
        cards: (reveal && p.inHand && p.hole.length) ? p.hole.map(mpCardOut) : null
      };
    })
  };
}
/* Cards travel as rank and suit symbol. Rebuilt against the shared SUITS
   objects on the way back in, because the engine compares suits by identity
   and a look-alike breaks flush detection without saying so. */
function mpCardOut(c){ return {r:c.r, s:c.su.s}; }
function mpCardIn(c){
  var su = SUITS.filter(function(x){ return x.s === c.s; })[0] || SUITS[0];
  return {r:c.r, su:su};
}

/* ==========================================================================
   HOST
   ========================================================================== */

function mpIsHost(){ return !!(mpRoom && sbUser && mpRoom.host === sbUser.id); }

/* Called once, when the host closes the table and starts the game. */
function mpHostBegin(){
  if(!mpIsHost()) return;
  var sorted = mpSeats.slice().sort(function(a,b){ return a.seat_no - b.seat_no; });
  mpOrder = sorted.map(function(s){ return s.user_id; });
  var names = sorted.map(function(s){ return s.name || "player"; });
  mpWho = sorted.map(function(){ return null; });     /* a person plays these */

  /* Seats nobody took can be played by the house. They are the same opponents
     the single-player table uses -- the same personalities, drawn the same
     way, no two alike -- and they are marked by having no user id, which is
     what tells the loop below to act for them. */
  var free = Math.max(0, MP_MAX_SEATS - sorted.length);
  var want = Math.min(typeof mpBots === "number" ? mpBots : 0, free);
  if(want > 0){
    var cast = pokDrawCast(want);                     /* distinct names and personas */
    for(var i = 0; i < want; i++){
      mpOrder.push(null);
      names.push(cast.names[i + 1] || ("player " + (i + 1)));
      mpWho.push(cast.who[i + 1] || "grinder");
    }
  }

  var bl = pokBlinds(mpRoom.buyin);
  mpT = pokTable(names, mpRoom.buyin, bl.sb, bl.bb);
  mpLastSeen = 0;
  mpHostDeal();
}
function mpIsBot(seat){ return !mpOrder[seat]; }

function mpHostDeal(){
  if(!mpIsHost() || !mpT) return;
  clearTimeout(mpNextTimer);
  /* Anyone with nothing left is out, and if that leaves one player the game
     is over rather than stuck waiting for a hand that cannot be dealt. */
  if(!pokStartHand(mpT)){
    mpPush(mpPublic(mpT, "Not enough players left with chips.", true));
    return;
  }
  var hand = (mpRoom.hand_no || 0) + 1;
  var rows = mpT.players.map(function(p, i){
    return {code: mpRoom.code, hand_no: hand, user_id: mpOrder[i], cards: p.hole.map(mpCardOut)};
  }).filter(function(r){ return r.user_id; });

  sb.from("poker_hole").insert(rows).then(function(res){
    if(res.error) return mpSay("mpGameNote", res.error.message, "bad");
    mpRoom.hand_no = hand;
    sb.from("poker_rooms").update({hand_no: hand}).eq("code", mpRoom.code).then(function(){
      mpPush(mpPublic(mpT, "Hand " + hand + ".", false));
    });
  });
}

/* The published state is the only thing the other players ever see. */
function mpPush(state){
  if(!mpIsHost()) return;
  mpState = state;
  mpArmClock(state);
  mpBotStep();                                       /* a house seat plays itself */
  mpRenderGame();
  sb.from("poker_rooms").update({state: state}).eq("code", mpRoom.code).then(function(res){
    if(res.error) mpSay("mpGameNote", res.error.message, "bad");
  });
}

/* ---- taking moves ---- */
/* Read from the table rather than from the notification, in id order, so a
   host whose tab was asleep catches up in the order things actually happened
   instead of in the order the messages turned up. */
function mpDrain(){
  if(!mpIsHost() || !mpT) return;
  sb.from("poker_actions").select("*").eq("code", mpRoom.code)
    .eq("hand_no", mpRoom.hand_no).order("id").then(function(res){
      if(res.error || !res.data) return;
      var applied = false;
      res.data.forEach(function(row){
        if(row.id <= mpLastSeen) return;
        mpLastSeen = row.id;
        if(mpHostApply(row)) applied = true;
      });
      if(applied) mpAfterAction();
    });
}

function mpHostApply(row){
  if(mpT.stage === "done") return false;
  var seat = mpOrder.indexOf(row.user_id);
  /* Out of turn, or in somebody else's name -- the database already stops you
     signing another player's move, and this stops you making your own early. */
  if(seat < 0 || seat !== mpT.toAct) return false;
  var lg = pokLegal(mpT);
  if(!lg) return false;
  var a = row.action;
  if(a === "check" && !lg.check) a = "call";         /* a stale button on a slow screen */
  if(a === "call" && !lg.call)  a = "check";
  /* Raises land on fives here, the same as everywhere else in this casino.
     The buttons already snap, but the amount arrives as a plain number in a
     row anybody can write, so the house rule is applied where it cannot be
     talked around rather than where it is merely displayed. */
  var amt = a === "raise" ? pokSnapRaise(row.amount, lg) : row.amount;
  return pokAct(mpT, a, amt);
}

/* The house seats act on the host's clock, since the host is the only one
   running an engine. Same pause as the single-player table, so a bot reads as
   somebody deciding rather than a script firing, and the same personality
   decides what it does with the hand. */
function mpBotStep(){
  clearTimeout(mpBotTimer);
  if(!mpIsHost() || !mpT || mpT.stage === "done") return;
  var seat = mpT.toAct;
  if(seat < 0 || !mpIsBot(seat)) return;
  var hand = mpRoom.hand_no;
  mpBotTimer = setTimeout(function(){
    /* The table may have moved on while this was waiting. */
    if(!mpT || mpT.stage === "done" || mpT.toAct !== seat) return;
    if(mpRoom.hand_no !== hand) return;
    var lg = pokLegal(mpT);
    if(!lg) return;
    var mv = pokBotAction(mpT, seat, mpWho[seat]);
    if(!mv) return;
    var amt = mv.action === "raise" ? pokSnapRaise(mv.raiseTo, lg) : 0;
    if(!pokAct(mpT, mv.action, amt)) return;
    mpAfterAction();
  }, pokThinkMs(mpT, mpWho[seat]));           /* its own personality, not the other table's */
}

function mpAfterAction(){
  if(mpT.stage === "done"){
    mpPush(mpPublic(mpT, mpWinnerLine(mpT), true));
    /* The hand stays up long enough to be read, then the next one starts. */
    clearTimeout(mpNextTimer);
    mpNextTimer = setTimeout(mpHostDeal, MP_NEXT_MS);
    return;
  }
  mpPush(mpPublic(mpT, "", false));
}

function mpWinnerLine(T){
  if(!T.lastWinners || !T.lastWinners.length) return "Hand over.";
  return T.lastWinners.map(function(w){
    return T.players[w.id].name + " wins " + fmt(w.won) + (w.how ? " with " + w.how : "");
  }).join(", ");
}

/* ---- the act-or-fold clock ----
   One player leaving their phone in a pocket must not freeze the table for
   everyone else. Checking is free, so a silent player checks rather than
   folding when nothing is owed. */
function mpArmClock(state){
  clearTimeout(mpClock);
  if(!mpIsHost() || !mpT || mpT.stage === "done" || state.toAct < 0) return;
  if(mpIsBot(state.toAct)) return;                   /* it has its own, shorter clock */
  var seat = state.toAct, hand = state.hand;
  mpClock = setTimeout(function(){
    if(!mpT || mpT.stage === "done" || mpT.toAct !== seat) return;
    if(mpRoom.hand_no !== hand) return;
    var lg = pokLegal(mpT);
    if(!lg) return;
    pokAct(mpT, lg.check ? "check" : "fold", 0);
    mpAfterAction();
  }, MP_ACT_MS + 700);                               /* a little slack for a slow connection */
}

/* ==========================================================================
   EVERYBODY
   ========================================================================== */

function mpSend(action, amount){
  if(!mpRoom || !mpState) return;
  var me = mpMySeat();
  if(me < 0 || mpState.toAct !== me) return;
  mpSetActions(false);                               /* no second press while it is in flight */
  sb.from("poker_actions").insert({
    code: mpRoom.code, hand_no: mpState.hand,
    user_id: sbUser.id, action: action, amount: amount || 0
  }).then(function(res){
    if(res.error){ mpSay("mpGameNote", res.error.message, "bad"); mpSetActions(true); }
  });
}
function mpMySeat(){
  if(!mpState || !sbUser) return -1;
  for(var i = 0; i < mpState.players.length; i++)
    if(mpState.players[i].uid === sbUser.id) return i;
  return -1;
}

/* Your own two cards, from the row only you can read. */
function mpFetchMyCards(hand){
  if(!mpRoom || !sbUser) return;
  sb.from("poker_hole").select("cards").eq("code", mpRoom.code)
    .eq("hand_no", hand).eq("user_id", sbUser.id).maybeSingle().then(function(res){
      mpMyCards = (res.data && res.data.cards) || null;
      mpRenderGame();
    });
}

/* The published state landing, for host and guest alike. */
function mpOnState(state){
  if(!state || !state.players) return;
  var fresh = !mpState || mpState.hand !== state.hand;
  /* Nobody announces a fold: it shows up as a seat that was in the hand and
     now is not. Worth listening for only within a hand -- at the start of the
     next one everybody is back in, and that is a deal, not four folds. Read
     before the new state replaces the old one, since it is the difference
     between them that says what happened. Your own is skipped: it was heard
     as you sent it. */
  if(!fresh && mpState){
    var mine = mpMySeat(), was = {}, wasBet = {}, wasAllIn = {}, allInNow = {};
    mpState.players.forEach(function(p){
      was[p.seat] = p.inHand; wasBet[p.seat] = p.bet; wasAllIn[p.seat] = p.allIn;
    });
    /* All in first, and the seat is then left out of everything below: it is
       a raise or a call as well, and only the bigger of the two should be
       heard. The state says so outright, so nothing has to be inferred. */
    state.players.forEach(function(p){
      if(!wasAllIn[p.seat] && p.allIn){
        allInNow[p.seat] = true;
        if(p.seat !== mine && typeof playAllIn === "function") playAllIn(true);
      }
    });
    state.players.forEach(function(p){
      if(was[p.seat] && !p.inHand && p.seat !== mine && typeof playFold === "function") playFold(true);
    });
    /* A raise is not announced either: the table's bet to call simply goes up.
       Whoever is now matching that figure, having put more in than they had,
       is the one who put it there. */
    if(state.currentBet > mpState.currentBet && typeof playRaise === "function"){
      var by = null;
      state.players.forEach(function(p){
        if(p.bet === state.currentBet && p.bet > (wasBet[p.seat] || 0)) by = p.seat;
      });
      if(by !== null && by !== mine && !allInNow[by]) playRaise(true);
    }
    /* A check leaves almost no mark at all. What gives it away is the player
       whose turn it was: still in the hand, the turn moved on, nothing more
       put in, and the bet to call no higher. `committed` is the figure to
       read rather than `bet`, because bets are swept to nothing when a
       betting round closes and a check is often what closes it. */
    /* A bot's turn coming round online. The state says outright which seats
       are bots -- they are the ones with nobody's id against them -- so this
       is only ever the machine thinking, never a person. */
    if(state.toAct >= 0 && state.toAct !== mpState.toAct && state.toAct !== mine &&
       typeof playThink === "function"){
      var upNext = null;
      state.players.forEach(function(p){ if(p.seat === state.toAct) upNext = p; });
      if(upNext && !upNext.uid && typeof pokSoundAt === "function")
        pokSoundAt(700, function(){
          if(mpState && mpState.toAct === upNext.seat) playThink(true);
        });
    }
    var actor = mpState.toAct;
    if(actor >= 0 && actor !== mine && state.toAct !== actor && !allInNow[actor]){
      var before = null, after = null;
      mpState.players.forEach(function(p){ if(p.seat === actor) before = p; });
      state.players.forEach(function(p){ if(p.seat === actor) after = p; });
      /* Neither of these is a raise: the bet to call is no higher than it
         was. What separates them is whether he put anything in. */
      if(before && after && after.inHand && state.currentBet <= mpState.currentBet){
        if(after.committed === before.committed){
          if(typeof playCheck === "function") playCheck(true);
        }else if(after.committed > before.committed){
          if(typeof playCall === "function") playCall(true);
        }
      }
    }
  }
  mpState = state;
  if(fresh){
    mpMyCards = null; mpFetchMyCards(state.hand);
    /* This screen does not throw the hole cards one at a time -- they arrive
       with the state, already dealt -- so the deal is heard rather than seen:
       one card for each that went out, round the table twice. */
    if(typeof pokCardSound === "function"){
      var inHand = (state.players || []).filter(function(p){ return p.inHand; }).length;
      var cards = Math.max(2, Math.min(12, inHand * 2));
      for(var c = 0; c < cards; c++) pokCardSound(c * 80);
    }
  }
  mpRenderGame();
}

function mpWatchGame(code){
  if(mpGameChan) sb.removeChannel(mpGameChan);
  mpGameChan = sb.channel("pokergame:" + code)
    .on("postgres_changes", {event:"INSERT", schema:"public", table:"poker_actions", filter:"code=eq." + code},
      function(){ if(mpIsHost()) mpDrain(); })
    .on("postgres_changes", {event:"*", schema:"public", table:"poker_hole", filter:"code=eq." + code},
      function(payload){
        /* Only ever your own row reaches this, because the policy will not
           send anybody else's. */
        if(payload.new && payload.new.cards) { mpMyCards = payload.new.cards; mpRenderGame(); }
      })
    .subscribe();
}
function mpUnwatchGame(){
  mpFeltStop();
  if(mpGameChan){ sb.removeChannel(mpGameChan); mpGameChan = null; }
  clearTimeout(mpClock); clearTimeout(mpNextTimer); clearTimeout(mpBotTimer);
  mpT = null; mpState = null; mpMyCards = null; mpLastSeen = 0; mpWho = []; mpPaidHand = -1;
}

/* ==========================================================================
   Drawing it
   ========================================================================== */

function mpCardHtml(c){
  if(!c) return '<span class="mp-card back"></span>';
  var red = /[♥♦]/.test(c.s);
  return '<span class="mp-card' + (red ? " red" : "") + '">' + c.r +
         '<span class="mp-cs">' + c.s + "</span></span>";
}

function mpRenderGame(){
  if(!mpState) return;
  var me = mpMySeat();
  mpFeltStart();
  mpFeltUpdate();

  document.getElementById("mpMsg").textContent = mpState.msg || "";

  document.getElementById("mpBoard").innerHTML =
    mpState.board.length ? mpState.board.map(mpCardHtml).join("")
                         : '<span class="mp-note">Waiting for the flop</span>';
  document.getElementById("mpPot").textContent =
    "Pot " + fmt(mpState.pot) + "  ·  blinds " + mpState.sb + "/" + mpState.bb;

  document.getElementById("mpPlayers").innerHTML = mpState.players.map(function(p){
    var bits = [];
    if(!p.inHand) bits.push("folded");
    else if(p.allIn) bits.push("all in");
    if(p.bet) bits.push(fmt(p.bet) + " in");
    var turn = mpState.toAct === p.seat;
    return '<div class="person' + (turn ? " mp-turn" : "") + (p.inHand ? "" : " mp-folded") + '">' +
      '<span class="who">' + mpEsc(p.name) +
        (p.seat === me ? ' <small style="opacity:.55">you</small>' : "") +
        (p.cards ? " " + p.cards.map(mpCardHtml).join("") : "") +
        (bits.length ? ' <small style="opacity:.55">' + bits.join(", ") + "</small>" : "") +
      '</span><span class="acts">' + fmt(p.stack) + "</span></div>";
  }).join("");

  /* Your own two cards, and what they add up to -- the same readout the
     single-player table gives, from the same engine. */
  if(mpFeltOn) return;                               /* the real table draws all of this */
  var mine = document.getElementById("mpMine");
  mine.innerHTML = mpMyCards ? mpMyCards.map(mpCardHtml).join("")
                             : '<span class="mp-note">Not in this hand</span>';
  var note = "";
  if(mpMyCards && mpMyCards.length === 2){
    var hole = mpMyCards.map(mpCardIn), board = mpState.board.map(mpCardIn);
    note = pokDescribeHole(hole);
    if(board.length >= 3){
      var info = pokOuts(hole, board);
      if(info) note += " — " + pokDescribeHand(info.current);
    }
  }
  document.getElementById("mpMyHand").textContent = note;

  mpSetActions(me >= 0 && mpState.toAct === me);
}

/* The buttons only mean anything on your own turn, and what they say depends
   on what is owed -- worked out from the published state with the same
   function the single-player table uses. */
function mpSetActions(on){
  var bar = document.getElementById("mpActions");
  var me = mpMySeat();
  var lg = (on && mpState) ? pokLegal(mpFakeT()) : null;
  bar.hidden = !on || !lg;
  if(!lg) return;

  document.getElementById("mpCheck").hidden = !lg.check;
  document.getElementById("mpCall").hidden  = !lg.call;
  if(lg.call) document.getElementById("mpCall").textContent = "Call " + fmt(lg.callAmount);
  var raise = document.getElementById("mpRaise"), box = document.getElementById("mpRaiseTo");
  raise.hidden = !lg.raise; box.hidden = !lg.raise;
  if(lg.raise){
    box.min = lg.minRaiseTo; box.max = lg.maxRaiseTo;
    if(!box.value || +box.value < lg.minRaiseTo) box.value = lg.minRaiseTo;
    raise.textContent = (+box.value >= lg.maxRaiseTo ? "All in " : "Raise to ") + fmt(+box.value);
  }
}
/* pokLegal wants a table, and the published state is one in all the ways that
   function cares about -- whose turn, what is owed, who can still act. */
function mpFakeT(){
  return {
    players: mpState.players.map(function(p){
      return {id:p.seat, stack:p.stack, bet:p.bet, inHand:p.inHand, allIn:p.allIn, hasActed:p.hasActed};
    }),
    stage: mpState.stage, toAct: mpState.toAct,
    currentBet: mpState.currentBet, minRaise: mpState.minRaise
  };
}

/* ---- wiring ---- */
document.getElementById("mpFold").addEventListener("click", function(){ playClick(); mpSend("fold", 0); });
document.getElementById("mpCheck").addEventListener("click", function(){ playClick(); mpSend("check", 0); });
document.getElementById("mpCall").addEventListener("click", function(){ playClick(); mpSend("call", 0); });
document.getElementById("mpRaise").addEventListener("click", function(){
  var box = document.getElementById("mpRaiseTo");
  var lg = mpState ? pokLegal(mpFakeT()) : null;
  if(!lg) return;
  playChip();
  mpSend("raise", pokSnapRaise(+box.value || lg.minRaiseTo, lg));
});
document.getElementById("mpRaiseTo").addEventListener("input", function(){
  mpSetActions(mpState && mpState.toAct === mpMySeat());
});
document.getElementById("mpQuit").addEventListener("click", function(){ playClick(); mpLeave(); });

/* ==========================================================================
   The felt
   --------------------------------------------------------------------------
   The single-player table draws whatever is in pok.T, with seat 0 at the
   bottom of the screen. So the published state is turned into a table of that
   shape, rotated so that YOUR seat is seat 0 -- otherwise everyone would see
   themselves sitting in whichever chair the host happened to deal them, and
   only one player would ever be at the front.
   ========================================================================== */

var mpFeltOn = false;
var mpPaidHand = -1;                                 /* the last hand whose pot we have swept in */

/* Two face-down stand-ins. The renderer only looks at a card's face when the
   hand is over and the cards have been turned over, so anything with the
   right length draws a pair of backs. */
function mpBacks(){ return [{r:"?", su:SUITS[0]}, {r:"?", su:SUITS[0]}]; }

function mpFeltTable(){
  var n = mpState.players.length;
  var me = mpMySeat();
  if(me < 0) me = 0;                                 /* watching rather than playing */
  var seatOf = function(display){ return (display + me) % n; };

  var players = [];
  for(var d = 0; d < n; d++){
    var p = mpState.players[seatOf(d)];
    var hole;
    if(d === 0) hole = (mpMyCards || []).map(mpCardIn);
    else if(p.cards) hole = p.cards.map(mpCardIn);    /* turned over at the showdown */
    else hole = p.inHand ? mpBacks() : [];
    players.push({
      id: d, name: p.name, stack: p.stack, bet: p.bet, committed: p.committed,
      inHand: p.inHand, allIn: p.allIn, hasActed: p.hasActed,
      isHero: d === 0, hole: hole, score: null
    });
  }
  /* Everything that names a seat has to be turned by the same amount, or the
     dealer button and the highlight end up on the wrong chairs. */
  var toDisplay = function(seat){ return seat < 0 ? -1 : (seat - me + n) % n; };
  return {
    players: players,
    sb: mpState.sb, bb: mpState.bb,
    dealer: toDisplay(mpState.dealer),
    board: mpState.board.map(mpCardIn),
    deck: [], pots: [], refunds: {},
    stage: mpState.stage,
    toAct: toDisplay(mpState.toAct),
    currentBet: mpState.currentBet,
    minRaise: mpState.minRaise,
    lastWinners: (mpState.winners || []).map(function(w){
      return {id: toDisplay(w.seat), won: w.won, how: w.how};
    }),
    lastPot: mpState.pot, log: []
  };
}

/* Ask for the felt when a hand comes up, and give it back when the game ends
   or the screen is left. */
function mpPlainOnly(on){
  var pl = document.getElementById("mpPlain");      if(pl) pl.hidden = !on;
  var pc = document.getElementById("mpPlainCards"); if(pc) pc.hidden = !on;
  var hd = document.getElementById("mpMsg");
  if(hd) hd.classList.toggle("mp-offscreen", !on);   /* the felt draws it instead */
}
function mpFeltStart(){
  if(mpFeltOn) return;
  if(typeof pokCanLend !== "function" || !pokCanLend()){
    /* Somebody is still sat at the single-player table, which owns pok.T and
       has real chips in it. Said plainly rather than quietly taking it. */
    mpPlainOnly(true);
    mpSay("mpGameNote", "Stand up from the single-player poker table to play here with the full table.", "");
    return;
  }
  /* The whole table comes across -- felt, buttons, raise chips, hand readout,
     fullscreen. The moves go back out through mpSend instead of being applied
     here, and standing up means leaving the game. */
  if(pokLend(document.getElementById("mpStageMount"), "mpMsg", {send: mpSend, leave: mpLeave})){
    mpFeltOn = true;
    mpPlainOnly(false);
    mpSay("mpGameNote", "");
  }
}
function mpFeltStop(){
  if(!mpFeltOn) return;
  mpFeltOn = false;
  if(typeof pokUnlend === "function") pokUnlend();
  mpPlainOnly(true);
}
/* Called on every published state: the felt is driven by handing it a table,
   exactly as the single-player game does. */
function mpFeltUpdate(){
  if(!mpState) return;
  /* The single-player table can take the felt back at any moment by seating
     somebody. Noticing here, rather than assuming it is still ours, is what
     stops this screen writing over a seat that has real chips in it. */
  if(mpFeltOn && (typeof pokLent === "undefined" || !pokLent)){
    mpFeltOn = false;
    mpPlainOnly(true);
    /* Said here as well as in mpFeltStart. Without it the table vanishes for
       one paint with nothing to explain where it went -- mpFeltStart runs
       before this and bows out early while the loan still looks live. */
    mpSay("mpGameNote", "Stand up from the single-player poker table to play here with the full table.", "");
  }
  if(!mpFeltOn) return;
  pok.T = mpFeltTable();
  /* The pot coming in, once per hand. This runs on every state that lands and
     several of them arrive while a hand sits finished, so the sweep is keyed
     to the hand number rather than to the stage. */
  if(mpState.stage === "done" && mpState.winners && mpState.winners.length &&
     mpPaidHand !== mpState.hand){
    mpPaidHand = mpState.hand;
    if(typeof pokPayPot === "function") pokPayPot(pok.T);
  }
  /* Cards are turned over at the showdown and only then, which is the same
     rule the single-player table uses. */
  pok.revealed = mpState.stage === "done" &&
                 mpState.players.some(function(p){ return !!p.cards; });
  /* The scene repaints itself every frame, but the buttons are told. In the
     single-player game pokStep does this after every move; here the published
     state arriving is the equivalent moment. */
  if(typeof pokRender === "function") pokRender();
}
