"use strict";
/* ==========================================================================
   Poker Online, part 1: the lobby.

   Opening a table, joining one, and watching people arrive. Playing the hand
   itself is next door in online-game.js; this gets everybody seated, keeps
   every screen in step, and hands over when the host starts.

   HOW A TABLE IS SHARED. Whoever opens it hosts it: their browser owns the
   deck, deals, applies the moves and publishes the result. There is no
   referee on the server, which is the same honour system the rest of this
   app runs on. What IS enforced, by the database rather than by good
   manners, is that a player's two cards go in a row only that player can
   read (see supabase/13-multiplayer-poker.sql) -- so an opponent's cards
   never reach your browser at all.

   TWO RULES THIS FILE MUST KEEP, because the database cannot keep them:
     1. Never write a card anybody is holding into poker_rooms.state. That
        row goes to everyone at the table.
     2. Close the room when the game starts. A room left open can be joined
        by anyone with the code, and joining is what grants read access.
   ========================================================================== */

/* Five, because that is what the felt is drawn for: four seats around the
   arc plus the one at the bottom. See POK_SEAT_DEG in table.js. */
var MP_MAX_SEATS = 5;
var MP_CODE_LEN = 6;
/* No O/0 or I/1 -- a code gets read aloud or typed off someone's screen. */
var MP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

var mpRoom = null;                                   /* the room row we are in */
var mpSeats = [];                                    /* everyone sat at it */
var mpChan = null;                                   /* realtime subscription */
var mpBuyin = 250;
var mpBusy = false;

function mpOn(){ return typeof CLOUD_OK !== "undefined" && CLOUD_OK && sb && sbUser; }
function mpSay(id, text, kind){
  var n = document.getElementById(id);
  if(!n) return;
  n.textContent = text || "";
  n.style.color = kind === "bad" ? "var(--bad)" : kind === "good" ? "var(--good)" : "";
}

/* PostgREST answers a missing table with its own code rather than anything a
   player could act on, so it is caught here and turned into a sentence that
   says what actually needs doing. */
function mpMissingTables(err){
  if(!err) return false;
  var m = (err.message || "") + " " + (err.code || "") + " " + (err.details || "");
  return /does not exist|PGRST205|42P01|schema cache/i.test(m);
}
function mpFail(noteId, err){
  if(mpMissingTables(err)){ mpShow("mpNoTables"); return; }
  mpSay(noteId, (err && err.message) || "Something went wrong.", "bad");
}

function mpCode(){
  var out = "";
  for(var i = 0; i < MP_CODE_LEN; i++) out += MP_ALPHABET.charAt(rnd(MP_ALPHABET.length));
  return out;
}

/* ---- which of the four views is on screen ---- */
function mpShow(which){
  ["mpSignedOut", "mpNoTables", "mpLobby", "mpRoom", "mpGame"].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.hidden = id !== which;
  });
}
function mpRender(){
  if(!mpOn()){ mpShow("mpSignedOut"); return; }
  if(mpRoom && mpInPlay()){ mpShow("mpGame"); mpRenderGame(); return; }
  if(mpRoom){ mpShow("mpRoom"); mpRenderRoom(); return; }
  mpShow("mpLobby");
}
/* A game is under way once the host has published a state with players in it.
   Until then the room is still a waiting room. */
function mpInPlay(){
  return !!(typeof mpState !== "undefined" && mpState && mpState.players && mpState.players.length);
}
/* Your buy-in leaves your own bank, once, when the game starts -- and comes
   back when you leave. Nobody can move chips in anybody else's browser, which
   is the honest shape of this: each player's balance is theirs to keep. */
var mpPaid = false;
function mpPayIn(){
  if(mpPaid || !mpRoom) return;
  mpPaid = true;
  wager(mpRoom.buyin, "poker");
}
function mpCashOut(){
  if(!mpPaid) return;
  mpPaid = false;
  var me = (typeof mpMySeat === "function") ? mpMySeat() : -1;
  var left = (me >= 0 && mpState) ? mpState.players[me].stack : 0;
  if(left > 0) payout(left, "poker");
}

/* ---- the room you are sitting in ---- */
function mpRenderRoom(){
  document.getElementById("mpRoomCode").textContent = mpRoom.code;
  document.getElementById("mpRoomStakes").textContent =
    fmt(mpRoom.buyin) + " to sit down" + (mpRoom.is_open ? "" : " — table closed, game under way");

  var host = mpRoom.host;
  var list = document.getElementById("mpSeatList");
  list.innerHTML = mpSeats.length
    ? mpSeats.map(function(s){
        var me = s.user_id === sbUser.id;
        return '<div class="person"><span class="who">' + mpEsc(s.name || "player") +
          (s.user_id === host ? ' <small style="opacity:.55">dealing</small>' : '') +
          (me ? ' <small style="opacity:.55">you</small>' : '') +
          '</span><span class="acts">seat ' + (s.seat_no + 1) + '</span></div>';
      }).join("")
    : '<div class="people-empty">Nobody sat down yet.</div>';

  var iHost = sbUser.id === host;
  document.getElementById("mpHostWarn").hidden = !iHost;
  var start = document.getElementById("mpStart");
  start.hidden = !iHost || !mpRoom.is_open;
  start.disabled = mpSeats.length < 2;
  start.textContent = mpSeats.length < 2 ? "Waiting for another player…" : "Start the game";
  document.getElementById("mpLeave").textContent = iHost ? "Close the table" : "Leave table";
}
function mpEsc(t){
  return String(t).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];
  });
}

/* ---- opening one ---- */
function mpCreate(){
  if(!mpOn() || mpBusy) return;
  if(mpBuyin < 20) return mpSay("mpLobbyNote", "The minimum buy-in is 20 chips.", "bad");
  if(mpBuyin > bank) return mpSay("mpLobbyNote", "Not enough chips for that buy-in.", "bad");
  mpBusy = true;
  mpSay("mpLobbyNote", "Opening a table…");

  var code = mpCode();
  sb.from("poker_rooms").insert({
    code: code, host: sbUser.id, buyin: mpBuyin, is_open: true, hand_no: 0, state: {}
  }).select().then(function(res){
    mpBusy = false;
    if(res.error){
      /* The only collision that matters is the code, and the answer to it is
         simply another code. */
      if(/duplicate key/i.test(res.error.message || "")) return mpCreate();
      return mpFail("mpLobbyNote", res.error);
    }
    mpRoom = (res.data || [])[0];
    mpTakeSeat(code, function(ok){
      if(!ok) return;
      mpWatch(code);
      mpSay("mpLobbyNote", "");
      mpRender();
    });
  });
}

/* ---- sitting down ---- */
/* Seats are claimed, not handed out, so two people joining together can pick
   the same number. The unique constraint in the schema is what actually
   settles it: the loser of the race is told, and tries the next one down. */
function mpTakeSeat(code, done){
  var taken = {};
  mpSeats.forEach(function(s){ taken[s.seat_no] = 1; });
  var seat = -1;
  for(var i = 0; i < MP_MAX_SEATS; i++) if(!taken[i]){ seat = i; break; }
  if(seat < 0){ mpSay("mpLobbyNote", "That table is full.", "bad"); return done(false); }

  sb.from("poker_seats").insert({
    code: code, user_id: sbUser.id, seat_no: seat, name: (sbName || "player")
  }).then(function(res){
    if(res.error){
      if(/duplicate key|unique/i.test(res.error.message || "")){
        return mpRefreshSeats(code, function(){ mpTakeSeat(code, done); });
      }
      mpFail("mpLobbyNote", res.error);
      return done(false);
    }
    mpRefreshSeats(code, function(){ done(true); });
  });
}

function mpJoin(){
  if(!mpOn() || mpBusy) return;
  var code = (document.getElementById("mpCodeIn").value || "").trim().toUpperCase();
  if(code.length !== MP_CODE_LEN) return mpSay("mpLobbyNote", "A table code is six characters.", "bad");
  mpBusy = true;
  mpSay("mpLobbyNote", "Looking for that table…");

  sb.from("poker_rooms").select("*").eq("code", code).maybeSingle().then(function(res){
    mpBusy = false;
    if(res.error) return mpFail("mpLobbyNote", res.error);
    var room = res.data;
    /* A closed room reads as missing rather than refused, because to somebody
       typing a code those are the same thing and the difference is only
       useful to somebody guessing codes. */
    if(!room) return mpSay("mpLobbyNote", "No open table with that code.", "bad");
    if(room.buyin > bank) return mpSay("mpLobbyNote", "You need " + fmt(room.buyin) + " chips to sit down there.", "bad");
    mpRoom = room;
    mpRefreshSeats(code, function(){
      mpTakeSeat(code, function(ok){
        if(!ok){ mpRoom = null; mpRender(); return; }
        mpWatch(code);
        mpSay("mpLobbyNote", "");
        mpRender();
      });
    });
  });
}

/* ---- leaving ---- */
function mpLeave(){
  if(!mpRoom) return;
  var code = mpRoom.code, iHost = sbUser.id === mpRoom.host;
  mpCashOut();
  mpUnwatch();
  if(typeof mpUnwatchGame === "function") mpUnwatchGame();
  /* Closing the room takes the seats and the hands with it, on delete cascade
     -- nobody is left sitting at a table that is no longer there. */
  var q = iHost
    ? sb.from("poker_rooms").delete().eq("code", code)
    : sb.from("poker_seats").delete().eq("code", code).eq("user_id", sbUser.id);
  q.then(function(){
    mpRoom = null; mpSeats = [];
    mpRender();
    mpLoadOpenTables();
  });
}

/* ---- starting ---- */
function mpStart(){
  if(!mpRoom || sbUser.id !== mpRoom.host) return;
  if(mpSeats.length < 2) return;
  mpSay("mpRoomNote", "Closing the table…");
  /* Closing it is a security step, not a tidy-up: an open room can be joined
     by anyone holding the code, and a seat is what grants read access to the
     game. Nothing is dealt until this lands. */
  sb.from("poker_rooms").update({ is_open: false }).eq("code", mpRoom.code).select()
    .then(function(res){
      if(res.error) return mpFail("mpRoomNote", res.error);
      mpRoom = (res.data || [])[0] || mpRoom;
      mpPayIn();
      mpWatchGame(mpRoom.code);
      mpHostBegin();
      mpRender();
    });
}

/* ---- keeping every screen in step ---- */
function mpRefreshSeats(code, done){
  sb.from("poker_seats").select("*").eq("code", code).order("seat_no").then(function(res){
    if(!res.error) mpSeats = res.data || [];
    if(done) done();
    else mpRender();
  });
}
function mpWatch(code){
  mpUnwatch();
  mpChan = sb.channel("poker:" + code)
    .on("postgres_changes", {event:"*", schema:"public", table:"poker_seats", filter:"code=eq." + code},
      function(){ mpRefreshSeats(code); })
    .on("postgres_changes", {event:"*", schema:"public", table:"poker_rooms", filter:"code=eq." + code},
      function(payload){
        /* The host closing the table, or dropping it entirely -- either way
           everybody else finds out here rather than by pressing something
           and being told no. */
        if(payload.eventType === "DELETE"){
          mpUnwatch();
          mpRoom = null; mpSeats = [];
          mpRender();
          mpSay("mpLobbyNote", "The host closed that table.", "bad");
          return;
        }
        if(payload.new){
          var was = mpRoom;
          mpRoom = payload.new;
          /* The host closing the table is the starting gun: everyone pays in
             and starts watching for hands. */
          if(was && was.is_open && !mpRoom.is_open){
            mpPayIn();
            mpWatchGame(code);
          }
          if(mpRoom.state && mpRoom.state.players) mpOnState(mpRoom.state);
        }
        mpRender();
      })
    .subscribe();
}
function mpUnwatch(){
  if(mpChan){ sb.removeChannel(mpChan); mpChan = null; }
}

/* ---- your friends' tables ---- */
/* Only friends'. Every open room is readable by anyone signed in, because you
   have to see a table before you can sit at it, but a list of strangers'
   games is not what this is for. */
function mpLoadOpenTables(){
  if(!mpOn()) return;
  var list = document.getElementById("mpOpenList");
  if(!list) return;
  list.innerHTML = '<div class="people-empty">Looking…</div>';

  sb.from("friendships").select("requester, addressee, status").eq("status", "accepted").then(function(fres){
    if(fres.error){ list.innerHTML = '<div class="people-empty">' + mpEsc(fres.error.message) + "</div>"; return; }
    var mates = {};
    (fres.data || []).forEach(function(f){
      mates[f.requester === sbUser.id ? f.addressee : f.requester] = 1;
    });
    sb.from("poker_rooms").select("code, host, buyin").eq("is_open", true).then(function(res){
      if(res.error){
        if(mpMissingTables(res.error)) return mpShow("mpNoTables");
        list.innerHTML = '<div class="people-empty">' + mpEsc(res.error.message) + "</div>";
        return;
      }
      var rooms = (res.data || []).filter(function(r){ return mates[r.host]; });
      if(!rooms.length){
        list.innerHTML = '<div class="people-empty">No friends have a table open right now.</div>';
        return;
      }
      namesFor(rooms.map(function(r){ return r.host; }), function(names){
        list.innerHTML = rooms.map(function(r){
          return '<div class="person"><span class="who">' + mpEsc(names[r.host] || "player") +
            ' <small style="opacity:.55">' + fmt(r.buyin) + '</small></span>' +
            '<span class="acts"><button class="btn ghost sm" data-join="' + r.code + '">Join</button></span></div>';
        }).join("");
        Array.prototype.forEach.call(list.querySelectorAll("[data-join]"), function(b){
          b.addEventListener("click", function(){
            document.getElementById("mpCodeIn").value = b.dataset.join;
            mpJoin();
          });
        });
      });
    });
  });
}

/* ---- coming back to a table you are already sat at ---- */
/* A reload should not cost you your seat, and it does not: the seat lives in
   the database, so the page just has to go and look for it. */
function mpResume(){
  if(!mpOn()) return;
  sb.from("poker_seats").select("code").eq("user_id", sbUser.id).limit(1).then(function(res){
    if(res.error || !(res.data || []).length){
      if(res.error && mpMissingTables(res.error)) mpShow("mpNoTables");
      return;
    }
    var code = res.data[0].code;
    sb.from("poker_rooms").select("*").eq("code", code).maybeSingle().then(function(r2){
      if(r2.error || !r2.data) return;
      mpRoom = r2.data;
      mpRefreshSeats(code, function(){
        mpWatch(code);
        if(!mpRoom.is_open){
          /* Back at a game already running. The buy-in was taken when it
             started, so it is not taken again. */
          mpPaid = true;
          mpWatchGame(code);
          if(mpRoom.state && mpRoom.state.players) mpOnState(mpRoom.state);
        }
        mpRender();
      });
    });
  });
}

/* ---- wiring ---- */
chipRow(document.getElementById("mpBuyRow"), null, function(v){
  mpBuyin = v;
  document.getElementById("mpBuyin").textContent = fmt(v);
}, null);
document.getElementById("mpCreate").addEventListener("click", function(){ playClick(); mpCreate(); });
document.getElementById("mpJoin").addEventListener("click", function(){ playClick(); mpJoin(); });
document.getElementById("mpLeave").addEventListener("click", function(){ playClick(); mpLeave(); });
document.getElementById("mpStart").addEventListener("click", function(){ playClick(); mpStart(); });
document.getElementById("mpRefresh").addEventListener("click", function(){ playClick(); mpLoadOpenTables(); });
document.getElementById("mpCodeIn").addEventListener("keydown", function(e){
  if(e.key === "Enter") mpJoin();
});
/* Codes are shown in capitals, so they are typed in capitals whatever the
   keyboard does. */
document.getElementById("mpCodeIn").addEventListener("input", function(e){
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

/* Nobody is signed in yet when this file loads -- cloudSync decides that a
   moment later -- so the lobby is drawn once now for the signed-out case and
   filled in by mpAuthChanged when an account turns up. */
function mpAuthChanged(){
  if(!mpOn()){
    mpUnwatch();
    mpRoom = null; mpSeats = [];
    mpRender();
    return;
  }
  mpRender();
  mpLoadOpenTables();
  mpResume();
}
mpRender();
