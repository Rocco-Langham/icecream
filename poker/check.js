"use strict";
/* ==========================================================================
   Poker Check — the same engine, pointed at a real table.

   You tap the cards as the dealer turns them over and it tells you what you
   have, what it could still become, and how often a hand like this wins. It
   reads the engine and nothing else: no chips move, no stats change, and no
   game state is touched, so it can be used while sitting somewhere else
   entirely with a real deck on the table.

   Reached from Other -> Poker Check in the menu, which only appears once
   irlpoker has been typed into the dev console.
   ========================================================================== */

var PC_MAX_HOLE = 2, PC_MAX_BOARD = 5;
/* Your cards and the board are kept apart, not sliced out of one list. They
   were one list to begin with, and correcting a mis-tap then slid the first
   board card up into your hand without a word -- take back a king with a flop
   showing and you were suddenly holding one of the community cards, reading
   odds for a hand nobody had. A gap in your hand now stays a gap until you
   fill it. pcSeq is tap order, and exists only so Undo knows what was last. */
var pcHoleCards = [], pcBoardCards = [], pcSeq = [];
var pcOpps = 1;

/* The engine compares suits by identity, not by their symbol, so every card
   built here has to carry one of the four shared SUITS objects. Minting a
   look-alike breaks flush detection in a way that is invisible until a flush
   quietly fails to be a flush. */
function pcCard(rank, suit){ return {r:rank, su:suit}; }
function pcKey(c){ return c.r + c.su.s; }
function pcTaken(c){
  return pcSeq.some(function(p){ return pcKey(p) === pcKey(c); });
}
function pcHole(){ return pcHoleCards.slice(); }
function pcBoard(){ return pcBoardCards.slice(); }
function pcCount(){ return pcHoleCards.length + pcBoardCards.length; }
/* Your hand first, then the board -- and after taking a card back out of your
   hand, the next tap fills that gap rather than going to the board. */
function pcAdd(card){
  if(pcTaken(card)) return false;
  if(pcHoleCards.length < PC_MAX_HOLE) pcHoleCards.push(card);
  else if(pcBoardCards.length < PC_MAX_BOARD) pcBoardCards.push(card);
  else return false;
  pcSeq.push(card);
  return true;
}

/* ---- rank buttons, one row of thirteen ---- */
function pcBuildRanks(){
  var wrap = document.getElementById("pcRanks");
  if(!wrap) return;
  var html = "";
  RANKS.forEach(function(r, ri){
    html += '<button class="pc-rank" data-r="' + ri + '">' + r +
            '<span class="pc-rank-badge" hidden></span></button>';
  });
  wrap.innerHTML = html;
  Array.prototype.forEach.call(wrap.querySelectorAll(".pc-rank"), function(b){
    b.addEventListener("click", function(){
      if(typeof playClick === "function") playClick();
      pcOpenSuitPopup(+b.dataset.r);
    });
  });
}
/* How many of a rank are already down -- a rank can appear more than once in
   one hand (a paired board, trips on the flop), so this is a count, not a
   yes/no, and shows on the rank button as a small badge. */
function pcRankCount(ri){
  var r = RANKS[ri];
  return pcHoleCards.concat(pcBoardCards).filter(function(c){ return c.r === r; }).length;
}

/* ---- the suit popup ----
   A rank alone does not say which card was dealt, so tapping one opens this
   for the suit. Picking a suit places the card immediately and closes the
   popup; tapping a suit already down takes that card back instead, straight
   from here, without needing to find it in the slots above. */
var pcOpenRank = null;
function pcOpenSuitPopup(ri){
  pcOpenRank = ri;
  document.getElementById("pcSuitTitle").textContent = RANKS[ri];
  var html = "";
  SUITS.forEach(function(su, si){
    var card = pcCard(RANKS[ri], su), used = pcTaken(card);
    var disabled = !used && pcCount() >= PC_MAX_HOLE + PC_MAX_BOARD;
    html += '<button class="pc-suitbtn' + (su.red ? " red" : "") + (used ? " used" : "") + '"' +
            (disabled ? " disabled" : "") + ' data-s="' + si + '">' + su.s + "</button>";
  });
  document.getElementById("pcSuitButtons").innerHTML = html;
  Array.prototype.forEach.call(document.querySelectorAll("#pcSuitButtons .pc-suitbtn"), function(b){
    b.addEventListener("click", function(){
      var c = pcCard(RANKS[pcOpenRank], SUITS[+b.dataset.s]);
      if(pcTaken(c)) pcRemove(c);
      else if(!pcAdd(c)) return;
      if(typeof playClick === "function") playClick();
      pcCloseSuitPopup();
      pcRender();
    });
  });
  document.getElementById("pcSuitOverlay").hidden = false;
}
function pcCloseSuitPopup(){
  pcOpenRank = null;
  document.getElementById("pcSuitOverlay").hidden = true;
}
function pcRemove(card){
  var gone = function(list){ return list.filter(function(p){ return pcKey(p) !== pcKey(card); }); };
  pcHoleCards = gone(pcHoleCards);
  pcBoardCards = gone(pcBoardCards);
  pcSeq = gone(pcSeq);
}

/* ---- the slots along the top ---- */
function pcSlotHtml(card, i, kind){
  if(!card) return '<span class="pc-slot empty"></span>';
  return '<button class="pc-slot filled' + (card.su.red ? " red" : "") +
         '" data-drop="' + kind + i + '">' + card.r +
         '<span class="pc-s">' + card.su.s + "</span></button>";
}
function pcRenderSlots(){
  var hole = pcHole(), board = pcBoard(), i, html = "";
  for(i = 0; i < PC_MAX_HOLE; i++) html += pcSlotHtml(hole[i], i, "h");
  document.getElementById("pcHole").innerHTML = html;
  html = "";
  for(i = 0; i < PC_MAX_BOARD; i++) html += pcSlotHtml(board[i], i, "b");
  document.getElementById("pcBoard").innerHTML = html;

  /* Tapping a card that is already down takes it back, which is what you reach
     for after a mis-tap mid-hand. */
  Array.prototype.forEach.call(document.querySelectorAll("#pcHole .pc-slot.filled, #pcBoard .pc-slot.filled"),
    function(b){
      b.addEventListener("click", function(){
        var which = b.dataset.drop, idx = +which.slice(1);
        var card = which.charAt(0) === "h" ? pcHole()[idx] : pcBoard()[idx];
        if(!card) return;
        pcRemove(card);
        if(typeof playClick === "function") playClick();
        pcRender();
      });
    });
}

/* ---- how often a hand like this wins ----
   Run in slices off the main thread's back, because a full count against eight
   opponents is tens of thousands of seven-card evaluations and doing it in one
   go locks the page up mid-tap. The figure sharpens as the slices land, and a
   run is abandoned the moment the cards change under it. */
var pcEqRun = 0, pcEqTimer = null;
function pcEquityStart(hole, board, opponents, onUpdate){
  clearTimeout(pcEqTimer);
  var run = ++pcEqRun;
  /* No more cards are coming after the river, so it is the one board where a
     player is likely to sit looking at the figure rather than glance and move
     on -- worth the extra time to settle tighter. Everywhere else the sample
     stays as it was. */
  var TOTAL = board.length === 5 ? 30000 : 6000, SLICE = 300, done = 0, sum = 0;
  (function step(){
    if(run !== pcEqRun) return;                      /* the cards moved on */
    var n = Math.min(SLICE, TOTAL - done);
    sum += pokEquity(hole, board, opponents, n) * n;
    done += n;
    onUpdate(sum / done, done / TOTAL);
    if(done < TOTAL) pcEqTimer = setTimeout(step, 0);
  })();
}
/* Called from outside this file whenever the tab changes -- leaving Poker
   Check must not leave a background run still chewing through slices behind
   whatever screen the player switched to. */
function pcEquityCancel(){
  pcEqRun++;
  clearTimeout(pcEqTimer);
}

/* ---- the readout ---- */
function pcRender(){
  pcRenderSlots();
  pcRenderOpps();
  Array.prototype.forEach.call(document.querySelectorAll("#pcRanks .pc-rank"), function(b){
    var n = pcRankCount(+b.dataset.r);
    var badge = b.querySelector(".pc-rank-badge");
    b.classList.toggle("has", n > 0);
    badge.hidden = n === 0;
    if(n > 0) badge.textContent = n;
  });
  /* The popup can be open while a card lands from elsewhere -- it never is
     in this build, since selecting a suit closes it, but a stale count here
     would be a silent trap for whoever adds a second way to place a card. */
  if(pcOpenRank !== null) pcOpenSuitPopup(pcOpenRank);

  var el = document.getElementById("pcResult");
  var hole = pcHole(), board = pcBoard();

  if(hole.length < PC_MAX_HOLE){
    pcEqRun++;                                       /* stop anything still running */
    /* The board can already be entered when a hole card is taken back to fix
       a mis-tap. Telling the player to "begin" over a live board reads as
       though it was cleared -- it was not, and it is still there underneath. */
    el.innerHTML = board.length > 0
      ? '<div class="pc-hint">Add your other hole card to read this hand.</div>'
      : '<div class="pc-hint">Tap your two cards to begin. Add the flop, turn and river as they come.</div>';
    /* This branch returns early, so the fitGame call at the bottom of the
       function never runs for it -- and Clear is the one action that shrinks
       the card back to its smallest content, which needs the same re-fit as
       every path that grows it. */
    if(typeof fitGame === "function") fitGame();
    return;
  }

  var html = '<div class="pc-line"><span>Your hand</span><b>' + pokDescribeHole(hole) + "</b></div>";

  /* A real board is never one or two cards -- the flop lands as three at
     once. Those counts only exist here because the cards are entered one tap
     at a time, so they get a plain "still waiting" line and nothing else:
     no hand to describe yet, and no win rate for a board that cannot occur. */
  if(board.length >= 3){
    var info = pokOuts(hole, board);
    html += '<div class="pc-line"><span>Best right now</span><b>' + pokDescribeHand(info.current) + "</b></div>";
    if(info.outs.length){
      html += '<div class="pc-sub">Still could become</div><ul class="pc-outs">' +
        info.outs.map(function(o){
          return "<li><span>" + o.name + "</span><b>" + o.outs + " card" + (o.outs === 1 ? "" : "s") + "</b></li>";
        }).join("") + "</ul>";
    }else if(board.length < 5){
      /* Not "nothing improves this" -- pokOuts only counts a jump to a better
         NAMED hand (see its own comment), so a made flush with a low kicker
         genuinely has no listed outs here even though a higher kicker is
         still live. The category is what is settled; the kicker is not. */
      html += '<div class="pc-sub">No stronger type of hand is left in the deck</div>';
    }
  }else if(board.length > 0){
    var need = 3 - board.length;
    html += '<div class="pc-sub">' + need + ' more board card' + (need === 1 ? "" : "s") +
            ' needed before this is a hand</div>';
  }

  if(board.length === 0 || board.length >= 3){
    html += '<div class="pc-line pc-eq"><span>Wins about</span><b id="pcEq">…</b></div>';
  }else{
    pcEqRun++;                                       /* a 1- or 2-card board is not a real state -- no figure for it */
  }
  el.innerHTML = html;

  if(board.length === 0 || board.length >= 3){
    pcEquityStart(hole, board, pcOpps, function(share, progress){
      var out = document.getElementById("pcEq");
      if(!out) return;
      var pct = Math.round(share * 100);
      /* Never claim certainty a 6000-trial sample cannot back up. A hand that
         loses one time in two hundred still rounds to 100 at these odds, and
         "wins about 100%" reads as "cannot lose" -- the one thing this figure
         must never say when it is not quite true. */
      var label = pct <= 0 ? "&lt;1%" : pct >= 100 ? "&gt;99%" : pct + "%";
      out.innerHTML = (progress < 1 ? "~" : "") + label;
      out.classList.toggle("settling", progress < 1);
    });
  }

  if(typeof fitGame === "function") fitGame();       /* this card is the one screen whose height changes on every tap */
}

/* ---- how many people you are up against ---- */
function pcRenderOpps(){
  var wrap = document.getElementById("pcOpps");
  if(!wrap) return;
  if(!wrap.children.length){
    var html = "";
    for(var n = 1; n <= 8; n++) html += '<button class="chipbtn pc-opp" data-n="' + n + '">' + n + "</button>";
    wrap.innerHTML = html;
    Array.prototype.forEach.call(wrap.querySelectorAll(".pc-opp"), function(b){
      b.addEventListener("click", function(){
        pcOpps = +b.dataset.n;
        if(typeof playClick === "function") playClick();
        pcRender();
      });
    });
  }
  Array.prototype.forEach.call(wrap.querySelectorAll(".pc-opp"), function(b){
    b.classList.toggle("sel", +b.dataset.n === pcOpps);
  });
}

/* ---- wiring ---- */
document.getElementById("pcClear").addEventListener("click", function(){
  pcHoleCards = []; pcBoardCards = []; pcSeq = [];
  if(typeof playClick === "function") playClick();
  pcRender();
});
document.getElementById("pcUndo").addEventListener("click", function(){
  var last = pcSeq[pcSeq.length - 1];                /* tap order, not board-then-hand */
  if(last) pcRemove(last);
  if(typeof playClick === "function") playClick();
  pcRender();
});
document.getElementById("pcSuitClose").addEventListener("click", function(){
  if(typeof playClick === "function") playClick();
  pcCloseSuitPopup();
});
/* Tapping the dimmed backdrop closes it too, same as every other overlay in
   the app -- but only the backdrop itself, so a tap that lands on the suits
   or the title never gets mistaken for one that missed. */
document.getElementById("pcSuitOverlay").addEventListener("click", function(e){
  if(e.target === e.currentTarget) pcCloseSuitPopup();
});
pcBuildRanks();
pcRender();
