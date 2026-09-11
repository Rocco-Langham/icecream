"use strict";

var VERSION = "v1.5";

/* ============ cloud (Supabase) ============ */
/* The anon key is meant to ship in the page — row level security decides what
   it can actually reach, so publishing it grants nobody anything. */
var SB_URL = "https://zrxapphxtboaezbuugfi.supabase.co";
var SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyeGFwcGh4dGJvYWV6YnV1Z2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzgzMDIsImV4cCI6MjEwNDQ1NDMwMn0.Dl4XQjHwsGeNLgIkjt6PTO3YcyCwXFfFb7DH3TTabs8";

/* Allow-list http(s) rather than blocking file:. Anything with an opaque origin
   — file:, data:, blob: — can't hold an auth session, and previews serve local
   copies as data: URLs. If the CDN script is missing the game just runs offline,
   exactly as it always has. */
var CLOUD_OK = (location.protocol === "https:" || location.protocol === "http:") &&
               typeof supabase !== "undefined";
var sb = CLOUD_OK ? supabase.createClient(SB_URL, SB_KEY) : null;
var sbUser = null;

/* ============ persistence ============ */
var KEY = "sparxmaths-casino-v1";
var mem = null;                       // fallback when localStorage is blocked (some file:// setups)
function load(){
  try{
    var raw = localStorage.getItem(KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return null;
}
function save(){
  var data = {
    bank:bank, stats:stats, gameNet:gameNet, streak:streak,
    flappyBest:flappyBest, snakeBest:snakeBest,
    theme:currentTheme, font:currentFont, soundOn:soundOn,
    soundVolume:soundVolume, casinoName:CASINO_NAME,
    rigUser:rigUser, rigHost:rigHost,
    pokerStack:pokerStack
  };
  mem = data;
  try{ localStorage.setItem(KEY, JSON.stringify(data)); }catch(e){}
  if(typeof cloudPushSoon === "function") cloudPushSoon();
}

/* Running profit/loss per table for the leaderboard: every chip staked counts
   against a game and every chip returned counts for it, so the figure is what
   the player is actually up or down there. Keyed by the games' data-tab ids. */
var GAMES = [
  {key:"slots",     name:"Slots",      icon:"&#127920;"},
  {key:"blackjack", name:"Blackjack",  icon:"&#127183;"},
  {key:"roulette",  name:"Roulette",   icon:"&#127919;"},
  {key:"horse",     name:"Racing",     icon:"&#127895;"},
  {key:"plinko",    name:"Plinko",     icon:"&#128315;"},
  {key:"flappy",    name:"Flappy",     icon:"&#128038;"},
  {key:"snake",     name:"Snake",      icon:"&#128013;"},
  {key:"poker",     name:"Poker",      icon:"&#9824;&#65039;"}
];

var saved        = load() || mem;
var bank         = saved && typeof saved.bank === "number" ? saved.bank : 1000;
var stats        = (saved && saved.stats) || {hands:0, won:0, big:0, peak:1000};
var gameNet      = (saved && saved.gameNet) || {};
/* Chips sitting on the poker table. Held here so a refresh mid-session hands
   them back instead of quietly eating the buy-in. */
var pokerStack   = saved && typeof saved.pokerStack === "number" ? saved.pokerStack : 0;
GAMES.forEach(function(g){ if(typeof gameNet[g.key] !== "number") gameNet[g.key] = 0; });
var streak       = (saved && saved.streak) || {count:0, best:0, last:null, claimed:null};
/* Most pipes cleared in a single Flappy run, ever. Pipes rather than chips won,
   so a 5-chip run and a 500-chip run rank on the same scale. */
var flappyBest   = (saved && typeof saved.flappyBest === "number") ? saved.flappyBest : 0;
var snakeBest    = (saved && typeof saved.snakeBest  === "number") ? saved.snakeBest  : 0;
/* Display only, and no longer cached locally: the redemptions table is the one
   source of truth, fetched on sign-in. A stale local copy could only ever
   disagree with it. */
var redeemed     = [];
var soundOn      = saved && typeof saved.soundOn === "boolean" ? saved.soundOn : true;
var soundVolume  = saved && typeof saved.soundVolume === "number" ? saved.soundVolume : 45;
var CASINO_NAME  = saved && typeof saved.casinoName === "string" ? saved.casinoName : "SparxMaths";

/* ============ rigging (dev console) ============ */
/* 0 = untouched RNG, 100 = every round forced. Values in between are the
   percentage chance that a given round gets forced. User rig wins ties. */
var rigUser = saved && typeof saved.rigUser === "number" ? saved.rigUser : 0;
var rigHost = saved && typeof saved.rigHost === "number" ? saved.rigHost : 0;

function rigRoll(){
  if(rigUser > 0 && Math.random()*100 < rigUser) return "user";
  if(rigHost > 0 && Math.random()*100 < rigHost) return "host";
  return null;
}

/* ============ sound engine ============ */
/* Tiny synthesized SFX via Web Audio — keeps the file dependency-free (no audio assets to ship). */
var audioCtx = null;
function getCtx(){
  var AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return null;
  if(!audioCtx) audioCtx = new AC();
  if(audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function tone(ctx, freq, start, dur, type, peak){
  peak = Math.max(0.0001, peak * (soundVolume / 100));
  var o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(peak, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(start); o.stop(start + dur + 0.02);
}
function noiseBurst(ctx, start, dur, peak, hpFreq){
  peak = Math.max(0.0001, peak * (soundVolume / 100));
  var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  var buf = ctx.createBuffer(1, n, ctx.sampleRate);
  var d = buf.getChannelData(0);
  for(var i=0; i<n; i++) d[i] = (Math.random()*2 - 1) * (1 - i/n);
  var src = ctx.createBufferSource();
  src.buffer = buf;
  var g = ctx.createGain();
  g.gain.setValueAtTime(peak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  var f = ctx.createBiquadFilter();
  f.type = "highpass"; f.frequency.value = hpFreq || 1500;
  src.connect(f); f.connect(g); g.connect(ctx.destination);
  src.start(start);
}
function sfx(fn){
  if(!soundOn) return;
  var ctx = getCtx();
  if(!ctx) return;
  try{ fn(ctx, ctx.currentTime); }catch(e){}
}
var playClick    = function(){ sfx(function(ctx, t){ tone(ctx, 720, t, 0.05, "square", 0.032); }); };
var playChip     = function(){ sfx(function(ctx, t){ tone(ctx, 1100, t, 0.045, "triangle", 0.045); tone(ctx, 1650, t + 0.02, 0.05, "triangle", 0.028); }); };
var playDeal     = function(){ sfx(function(ctx, t){ noiseBurst(ctx, t, 0.07, 0.11, 2200); }); };
var playSpinTick = function(){ sfx(function(ctx, t){ noiseBurst(ctx, t, 0.025, 0.038, 3200); }); };
var playReelStop = function(){ sfx(function(ctx, t){ tone(ctx, 200, t, 0.09, "square", 0.055); }); };
var playCoin     = function(){ sfx(function(ctx, t){ tone(ctx, 1568, t, 0.11, "sine", 0.05); tone(ctx, 2093, t + 0.05, 0.13, "sine", 0.035); }); };
var playLose     = function(){ sfx(function(ctx, t){ tone(ctx, 220, t, 0.18, "sawtooth", 0.032); tone(ctx, 155, t + 0.12, 0.24, "sawtooth", 0.032); }); };
var playWin      = function(size){
  sfx(function(ctx, t){
    var notes = size === "jackpot" ? [523,659,784,1047,1319,1568]
              : size === "big"     ? [523,659,784,1047]
              :                       [659,880];
    notes.forEach(function(f, i){ tone(ctx, f, t + i*0.09, 0.16, "triangle", 0.055); });
  });
};

/* ============ helpers ============ */
function $(id){ return document.getElementById(id); }
function fmt(n){ return n.toLocaleString("en-US"); }
function rnd(n){ return Math.floor(Math.random()*n); }

var bankEl = $("bank");
function setBank(next, delta){
  bank = next;
  if(bank > stats.peak) stats.peak = bank;
  bankEl.textContent = fmt(bank);
  bankEl.classList.remove("flash-up","flash-dn");
  if(delta){
    void bankEl.offsetWidth;                       // restart the animation
    bankEl.classList.add(delta > 0 ? "flash-up" : "flash-dn");
  }
  renderStats();
  save();
}
function wager(amount, game){                       // amount = chips staked, straight off the balance
  gameNet[game] = (gameNet[game] || 0) - amount;
  touchStreak();                                     /* the one choke point every game stakes through */
  renderLeaderboard();
  setBank(bank - amount, -1);
}

/* ---- daily play streak ---- */
/* Local-calendar day number. Comparing plain integers keeps "was that
   yesterday?" to last === today - 1, with no timezone or DST arithmetic. */
function dayNum(d){
  d = d || new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
/* A streak is only alive if it was fed today or yesterday; older than that and
   it reads 0 rather than showing a number the player no longer has. */
function liveStreak(){
  if(streak.last === null) return 0;
  var gap = dayNum() - streak.last;
  return gap <= 1 ? streak.count : 0;
}
/* What each day of a streak pays. Day five is the prize; past it the ladder
   holds there rather than starting over, so a long streak is never worth less
   than the day before it. */
var STREAK_REWARDS = [50, 100, 150, 200, 500];
function streakReward(n){
  return n < 1 ? 0 : STREAK_REWARDS[Math.min(n, STREAK_REWARDS.length) - 1];
}
/* Today's chips are sitting there unopened. Tied to the calendar day rather
   than to a flag, so it cannot survive midnight or be claimed twice. */
function streakClaimable(){
  var today = dayNum();
  return liveStreak() > 0 && streak.last === today && streak.claimed !== today;
}
function renderStreak(){
  var n = liveStreak(), ready = streakClaimable();
  $("streak").hidden = n === 0;
  $("streakNum").textContent = n;
  $("streak").classList.toggle("ready", ready);
  /* What tomorrow is worth, so the ladder is visible without having to climb it
     blind. */
  $("streak").title = ready
    ? "Day " + n + " — " + fmt(streakReward(n)) + " chips waiting. Click to claim."
    : n === 0
      ? "Play today for 50 chips and start a streak"
      : n + " day streak — best " + streak.best +
        " · play tomorrow for " + fmt(streakReward(n + 1)) + " chips";
}
var toastTimer = 0;
function toast(title, sub){
  $("toastTitle").textContent = title;
  $("toastSub").textContent = sub || "";
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ $("toast").classList.remove("on"); }, 4200);
}
function touchStreak(){
  var today = dayNum();
  if(streak.last === today) return;                  /* already counted, idempotent per day */
  streak.count = streak.last === today - 1 ? streak.count + 1 : 1;
  streak.last = today;
  if(streak.count > streak.best) streak.best = streak.count;
  renderStreak();

  /* Today's door is now unlocked, but nothing is paid until it is opened — see
     claimStreak(). The calendar deliberately does not appear here: this fires
     from inside wager(), and a modal landing over a spinning reel is the one
     thing a daily bonus should not do. The toast points at the flame instead,
     and the flame carries a dot until the chips are taken. */
  save();
  setTimeout(function(){
    playCoin();
    toast("Day " + streak.count + " unlocked", fmt(streakReward(streak.count)) + " chips — tap the flame");
  }, 420);
}

/* ---- the calendar ---- */
function renderCalendar(){
  var n = liveStreak(), ready = streakClaimable();
  var rung = Math.min(Math.max(n, 1), STREAK_REWARDS.length);   /* past day five the top rung stays today's */
  $("calendarGrid").innerHTML = STREAK_REWARDS.map(function(chips, i){
    var day = i + 1;
    /* Today's door is the current rung, and only while it is unopened. The ones
       below it read as behind you whether or not this streak literally started
       at day one, which is what stops a day-nine streak showing five locks. */
    var cls = n === 0                                ? "locked"   /* nothing is behind you yet */
            : day < rung || (day === rung && !ready) ? "done"
            : day === rung                          ? "today"
            :                                         "locked";
    return '<div class="cal-day ' + cls + '">' +
             '<span class="n">Day ' + (day === STREAK_REWARDS.length && n > day ? n : day) + '</span>' +
             '<span class="v">' + fmt(chips) + '</span>' +
             (cls === "done" ? '<span class="tick">&#10003;</span>' : '<span class="n">chips</span>') +
           '</div>';
  }).join("");

  $("calendarActions").hidden = !ready;
  $("calendarClaim").textContent = "Claim " + fmt(streakReward(n)) + " chips";
  $("calendarSub").textContent = n === 0
    ? "Place a bet to start a streak."
    : ready ? "Day " + n + " is ready to open."
            : "Day " + n + " collected. Play again tomorrow to keep it going.";
  $("calendarNote").textContent = n === 0
    ? "A day counts once you have placed a bet on it."
    : "Miss a day and the streak starts again at day one. Past day five it stays at "
      + fmt(STREAK_REWARDS[STREAK_REWARDS.length - 1]) + " chips.";
}
function openCalendar(){
  renderCalendar();
  $("calendar").classList.add("on");
}
function closeCalendar(){
  $("calendar").classList.remove("on");
  openingSequence();                                 /* rejoin the queue after the detour */
}
/* The one place the chips are actually paid. It re-checks rather than trusting
   the button's state, so a stale modal left open across midnight — or a second
   click landing before the first re-render — cannot pay twice. */
function claimStreak(){
  if(!streakClaimable()){ renderCalendar(); return; }
  var day = liveStreak(), reward = streakReward(day);
  streak.claimed = dayNum();
  /* Credited straight to the balance rather than through payout(): a daily
     bonus is not something you won at a table, and running it through there
     would inflate the win stats and the table's leaderboard line. */
  setBank(bank + reward, 1);
  renderStreak();
  renderCalendar();
  playWin("big");
  setTimeout(playCoin, 90);
  toast("Day " + day + " streak", "+" + fmt(reward) + " chips");
}
$("calendarClaim").addEventListener("click", claimStreak);
$("calendarClose").addEventListener("click", closeCalendar);
$("calendar").addEventListener("click", function(e){ if(e.target === $("calendar")) closeCalendar(); });
$("streak").addEventListener("click", function(){ playClick(); openCalendar(); });
function payout(amount, game){                      // amount = chips returned to the player
  if(amount > stats.big) stats.big = amount;
  stats.won += amount;
  if(game){ gameNet[game] = (gameNet[game] || 0) + amount; renderLeaderboard(); }
  setBank(bank + amount, 1);
}
function signed(n){ return (n > 0 ? "+" : n < 0 ? "-" : "") + fmt(Math.abs(n)); }
function renderLeaderboard(){
  var board = $("leaderboard");
  if(!board) return;                                 /* not mounted until boot finishes wiring the DOM */
  var ranked = GAMES.map(function(g){ return {g:g, net:gameNet[g.key] || 0}; })
                     .sort(function(a, b){ return b.net - a.net; });
  var span = 0;                                      /* bars scale to the biggest swing either way */
  ranked.forEach(function(r){ span = Math.max(span, Math.abs(r.net)); });
  var medals = ["&#129351;", "&#129352;", "&#129353;"];
  board.innerHTML = ranked.map(function(r, i){
    /* a medal means real profit — never award one for breaking even or losing,
       however high the row happens to sort */
    var medal = r.net > 0 && i < 3 ? medals[i] : (i + 1) + ".";
    var pct = span > 0 ? Math.max(1.5, Math.abs(r.net) / span * 50) : 0;
    var fill = r.net === 0 ? "" :
      '<span class="board-fill ' + (r.net > 0 ? "pos" : "neg") + '" style="width:' + pct + '%"></span>';
    return '<div class="board-row' + (i === 0 && r.net > 0 ? " lead" : "") + '">' +
             '<span class="board-rank">' + medal + '</span>' +
             '<span class="board-game">' + r.g.icon + ' ' + r.g.name + '</span>' +
             '<span class="board-bar">' + fill + '</span>' +
             '<b class="board-amt ' + (r.net > 0 ? "up" : r.net < 0 ? "down" : "flat") + '">' + signed(r.net) + '</b>' +
           '</div>';
  }).join("") + (span > 0 ? "" : '<p class="modal-note">Nothing staked yet &mdash; play a table to get on the board.</p>');
}
function renderStats(){
  $("stHands").textContent = fmt(stats.hands);
  $("stWon").textContent   = fmt(stats.won);
  $("stBig").textContent   = fmt(stats.big);
  $("stPeak").textContent  = fmt(stats.peak);
}
function msg(el, text, kind){
  el.textContent = text;
  el.className = "msg " + (kind || "info");
}

/* Wires a row of chip buttons to a stake value. */
function chipRow(container, get, set, onChange){
  var btns = container.querySelectorAll(".chipbtn");
  var custom = container.querySelector(".custom-bet");
  Array.prototype.forEach.call(btns, function(b){
    b.addEventListener("click", function(){
      playChip();
      set(Number(b.dataset.v));
      Array.prototype.forEach.call(btns, function(o){ o.classList.toggle("sel", o === b); });
      if(custom){ custom.classList.remove("sel"); custom.value = ""; }
      if(onChange) onChange();
    });
  });
  if(custom){
    custom.addEventListener("input", function(){
      var v = Math.floor(Number(custom.value));
      if(!v || v < 1) return;
      set(v);
      Array.prototype.forEach.call(btns, function(o){ o.classList.remove("sel"); });
      custom.classList.add("sel");
      if(onChange) onChange();
    });
  }
  return btns;
}

/* ============ tabs ============ */
/* One switcher for both navs — the sidebar rail on desktop and the mobile
   sheet — so neither can drift out of sync with the other. */
function showTab(name){
  Array.prototype.forEach.call(document.querySelectorAll(".sidebar-link[data-tab]"), function(o){
    o.classList.toggle("on", o.dataset.tab === name);
  });
  Array.prototype.forEach.call(document.querySelectorAll(".game"), function(o){
    o.classList.toggle("on", o.id === "tab-" + name);
  });
  fitGame();                                         /* each game fills its space by a different amount */
}

/* ---- fill the space a game is given ---- */
/* The playfields are deliberately fixed-size, which stopped the page resizing
   itself mid-play but also meant a game sat in the middle of a lot of empty
   card on a big screen. So the card is scaled up by a single factor until it
   fills the height it has been handed — the pieces keep their proportions, and
   because the scale is only recomputed on a tab or window change, nothing moves
   while you play. The canvases fold the same factor into their draw transform
   (see hrResize/pkResize/fbResize) so they zoom rather than reveal more board. */
var GZ = 1;                                          /* current zoom, 1 on mobile */
var GZ_MAX = 1.8;                                    /* past this the chips look like dinner plates */
var GZ_MIN = 0.72;                                    /* and below this the labels stop being readable */
var GZ_FILL = 0.99;                                  /* a hair of slack so rounding can't summon a scrollbar */

/* Height of the children themselves, which is what we are fitting — the card's
   own scrollHeight can't tell us, since it reports the box when content is
   smaller than it and free space is exactly what we are looking for.
   The playfields are counted separately because they behave differently under
   zoom: their width comes from the card, so zooming the card in leaves them
   exactly the same size on screen while everything around them grows. Solving
   for the zoom without knowing which is which put the tall tables a pixel or
   two over and put the scrollbar back. */
function gzMeasure(card){
  var top = Infinity, bot = -Infinity, play = 0, found = false;
  for(var i = 0; i < card.children.length; i++){
    var el = card.children[i];
    if(el.hidden) continue;
    var r = el.getBoundingClientRect();
    if(!r.height) continue;
    if(getComputedStyle(el).position === "absolute") continue;   /* pinned corners are out of flow */
    top = Math.min(top, r.top); bot = Math.max(bot, r.bottom); found = true;
    if(el.classList.contains("playfield")) play += r.height;
  }
  return {h: found ? bot - top : 0, play: play};
}
function setGZ(z){
  GZ = z;
  document.documentElement.style.setProperty("--gz", z);
}
/* How tall the playfield is allowed to be — the racecourse's own height, which
   the other tables take their share of. It is the dial fitGame() turns first,
   because it is the one piece of a table that can give up height without
   anything becoming unreadable. */
var PLAY_MIN = 150, PLAY_MAX = 900;
function setPlay(px){
  document.documentElement.style.setProperty("--play-h", Math.round(px) + "px");
}
function fitGame(){
  var sec = document.querySelector(".game.on");
  if(!sec) return;
  var card = sec.querySelector(".table");
  /* The leaderboard is as tall as however many rows came back from the server,
     so there is no settled size to fit to — it stays at 1. */
  if(!card || sec.id === "tab-leaderboard" || !window.matchMedia("(min-width:761px)").matches){
    setGZ(1); setPlay(PLAY_MAX); return;
  }
  setGZ(1);                                          /* measure unzoomed, then scale from that */
  setPlay(PLAY_MAX);                                 /* start as wide as allowed and give width back only if we must */
  /* A scrollbar appearing mid-measurement narrows the card by its own width and
     changes the very numbers being measured, so it is held off until the sums
     are done. */
  card.style.overflowY = "hidden";
  var cs = getComputedStyle(card);
  var room = card.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if(room <= 0) return;

  /* Too tall to fit, and the playfield is the first thing to give: bisect its
     height down until the table clears the fold. This is what removes the
     scrollbar on the deep tables — they used to be stuck at one height with
     nowhere to give. Tables with no playfield fall straight past it to the
     zoom below. */
  var target = room * GZ_FILL;
  if(card.querySelector(".playfield") && gzMeasure(card).h > target){
    var lo = PLAY_MIN, hi = PLAY_MAX;
    for(var i = 0; i < 10; i++){
      var mid = (lo + hi) / 2;
      setPlay(mid);
      if(gzMeasure(card).h <= target) lo = mid; else hi = mid;
    }
    setPlay(lo);
  }

  /* Whatever height is left over goes into the zoom, which scales the table
     whole — playfield included, since its height is a length of its own rather
     than something the card's width dictates. */
  var content = gzMeasure(card).h;
  if(content <= 0){ card.style.overflowY = ""; return; }
  var z = Math.max(GZ_MIN, Math.min(GZ_MAX, target / content));
  setGZ(z);
  /* Zooming shrinks the card's width in its own coordinates, which can wrap a
     control row and leave the table taller than the sum allowed for. Correcting
     off the real overflow settles it in a pass or two. */
  for(var n = 0; n < 4 && z > GZ_MIN; n++){
    var over = Math.max(card.scrollHeight / card.clientHeight,
                        card.scrollWidth  / card.clientWidth);
    if(over <= 1.002) break;
    z = Math.max(GZ_MIN, z / over);
    setGZ(z);
  }
  card.style.overflowY = "";
}
/* Re-fit on a window change, once the resize has stopped rather than on every
   intermediate pixel. */
var gzTimer = 0;
window.addEventListener("resize", function(){
  clearTimeout(gzTimer);
  gzTimer = setTimeout(fitGame, 120);
});
Array.prototype.forEach.call(document.querySelectorAll(".sidebar-link[data-tab]"), function(b){
  b.addEventListener("click", function(){
    playClick();
    showTab(b.dataset.tab);
  });
});

/* ---- mobile nav sheet ---- */
var NAV_ITEMS = GAMES.concat([{key:"leaderboard", name:"Leaderboard", icon:"&#127942;"}]);
var navSheet = $("navSheet"), menuBtn = $("menuBtn");

function renderNavSheet(){
  var active = (document.querySelector(".sidebar-link.on") || {dataset:{}}).dataset.tab;
  $("navSheetList").innerHTML = '<div class="navsheet-label">Games</div>' +
    NAV_ITEMS.map(function(n){
      /* the leaderboard sits under its own heading, mirroring the desktop rail */
      return (n.key === "leaderboard" ? '<div class="navsheet-label">Other</div>' : "") +
             '<button class="navsheet-link' + (n.key === active ? " on" : "") + '" data-nav="' + n.key + '">' +
               '<span class="ic">' + n.icon + '</span>' + n.name +
             '</button>';
    }).join("");
}
function openNav(){
  renderNavSheet();                                  /* rebuilt each time so the tick follows the current tab */
  navSheet.classList.add("on");
  menuBtn.setAttribute("aria-expanded", "true");
}
function closeNav(){
  navSheet.classList.remove("on");
  menuBtn.setAttribute("aria-expanded", "false");
}
menuBtn.addEventListener("click", function(){
  playClick();
  if(navSheet.classList.contains("on")) closeNav(); else openNav();
});
navSheet.addEventListener("click", function(e){
  if(e.target === navSheet){ closeNav(); return; }   /* backdrop */
  var link = e.target.closest && e.target.closest(".navsheet-link");
  if(link){
    playClick();
    showTab(link.dataset.nav);
    closeNav();
  }
});

/* ============ settings ============ */
var settingsOverlay = $("settingsOverlay");

/* ---- sound toggle ---- */
function syncSoundUI(){
  $("soundToggle").checked = soundOn;
  $("muteBtn").innerHTML = soundOn ? "&#128266;" : "&#128263;";
  $("muteBtn").title = soundOn ? "Mute sound" : "Unmute sound";
}
function setSound(on){
  soundOn = on;
  syncSoundUI();
  save();
}
$("muteBtn").addEventListener("click", function(){
  setSound(!soundOn);
  if(soundOn) playClick();
});
$("soundToggle").addEventListener("change", function(){
  setSound(this.checked);
  if(soundOn) playClick();
});

/* ---- volume ---- */
var volumeSlider = $("volumeSlider");
volumeSlider.value = soundVolume;
volumeSlider.addEventListener("input", function(){
  soundVolume = Number(this.value);
  save();
});
volumeSlider.addEventListener("change", function(){ playClick(); });

/* ---- subtab switching ---- */
function switchSubtab(name){
  Array.prototype.forEach.call(document.querySelectorAll(".subtab"), function(o){ o.classList.toggle("on", o.dataset.subtab === name); });
  Array.prototype.forEach.call(document.querySelectorAll(".subpanel"), function(o){ o.classList.toggle("on", o.id === "sub-" + name); });
}

$("settingsBtn").addEventListener("click", function(){
  playClick();
  switchSubtab("general");
  devCodeInput.value = "";
  devNote.textContent = "";
  devNote.style.color = "";
  renderStatsPanel();
  settingsOverlay.classList.add("on");
});
$("settingsClose").addEventListener("click", function(){
  settingsOverlay.classList.remove("on");
});
settingsOverlay.addEventListener("click", function(e){
  if(e.target === settingsOverlay) settingsOverlay.classList.remove("on");
});

Array.prototype.forEach.call(document.querySelectorAll(".subtab"), function(b){
  b.addEventListener("click", function(){
    playClick();
    switchSubtab(b.dataset.subtab);
  });
});

/* ---- beta notice ---- */
var betaOverlay = $("betaOverlay");
/* The beta notice and the welcome gate both want the screen on load, so they
   queue: the gate waits its turn rather than stacking on top. */
function closeBeta(){
  betaOverlay.classList.remove("on");
  if(typeof gateFlush === "function") gateFlush();
  if(typeof openingSequence === "function") openingSequence();
}
$("betaClose").addEventListener("click", closeBeta);
$("betaOk").addEventListener("click", function(){ playClick(); closeBeta(); });
betaOverlay.addEventListener("click", function(e){
  if(e.target === betaOverlay) closeBeta();
});

/* ---- friends ---- */
/* Two round trips rather than an embed: friendships points at profiles twice
   (requester and addressee), which PostgREST can only disambiguate by naming
   the exact FK constraint. Fetching the names separately does not care what
   those constraints are called. */
function friendsSay(text, kind){
  var n = $("friendsNote");
  n.textContent = text || "";
  n.style.color = kind === "bad" ? "var(--bad)" : kind === "good" ? "var(--good)" : "";
}
function namesFor(ids, done){
  if(!ids.length) return done({});
  sb.from("profiles").select("id, username").in("id", ids).then(function(res){
    var map = {};
    (res.data || []).forEach(function(p){ map[p.id] = p.username; });
    done(map);
  });
}
function openFriends(){
  var live = CLOUD_OK && sbUser;
  $("friendsSignedOut").hidden = !!live;
  $("friendsBody").hidden = !live;
  friendsSay("");
  $("friends").classList.add("on");
  if(live) loadFriends();
}
function closeFriends(){ $("friends").classList.remove("on"); }

/* RLS returns only rows where you are one of the two sides, so no filter is
   needed here — the policy is the query. */
function loadFriends(){
  if(!CLOUD_OK || !sbUser) return;
  sb.from("friendships").select("requester, addressee, status").then(function(res){
    if(res.error){ friendsSay(res.error.message, "bad"); return; }
    var rows = res.data || [];
    var ids = [];
    rows.forEach(function(r){
      var other = r.requester === sbUser.id ? r.addressee : r.requester;
      if(ids.indexOf(other) === -1) ids.push(other);
    });
    namesFor(ids, function(names){
      var reqs = [], mates = [];
      rows.forEach(function(r){
        var other = r.requester === sbUser.id ? r.addressee : r.requester;
        var entry = {id:other, name:names[other] || "unknown", row:r};
        if(r.status === "accepted") mates.push(entry);
        else if(r.addressee === sbUser.id) reqs.push(entry);   /* only theirs to accept */
        else mates.push({id:other, name:(names[other] || "unknown"), pending:true, row:r});
      });
      renderFriends(reqs, mates);
    });
  });
}
function renderFriends(reqs, mates){
  $("friendReqWrap").hidden = reqs.length === 0;
  $("friendReqs").innerHTML = reqs.map(function(f){
    return '<div class="person"><span class="who">' + f.name + '</span>' +
             '<span class="acts">' +
               '<button class="btn sm" data-accept="' + f.id + '">Accept</button>' +
               '<button class="btn ghost sm" data-remove="' + f.id + '">Decline</button>' +
             '</span></div>';
  }).join("");
  $("friendList").innerHTML = mates.length
    ? mates.map(function(f){
        return '<div class="person"><span class="who">' + f.name +
                 (f.pending ? ' <small style="opacity:.55">requested</small>' : '') + '</span>' +
                 '<span class="acts"><button class="btn ghost sm" data-remove="' + f.id + '">Remove</button></span>' +
               '</div>';
      }).join("")
    : '<div class="people-empty">Nobody yet — add someone by username.</div>';
}
function addFriend(){
  var name = $("friendName").value.trim();
  if(!name) return friendsSay("Enter a username.", "bad");
  friendsSay("Looking…");
  sb.from("profiles").select("id, username").ilike("username", name).limit(1).then(function(res){
    if(res.error) return friendsSay(res.error.message, "bad");
    var them = (res.data || [])[0];
    if(!them) return friendsSay("No player with that username.", "bad");
    if(them.id === sbUser.id) return friendsSay("That is you.", "bad");

    sb.from("friendships").select("requester, addressee, status").then(function(f){
      var rows = (f.data || []).filter(function(r){
        return r.requester === them.id || r.addressee === them.id;
      });
      var existing = rows[0];
      if(existing && existing.status === "accepted") return friendsSay("You are already friends.", "bad");
      /* they asked first — accept theirs instead of creating a mirrored row */
      if(existing && existing.addressee === sbUser.id) return acceptFriend(them.id);
      if(existing) return friendsSay("Request already sent.", "bad");

      sb.from("friendships").insert({requester: sbUser.id, addressee: them.id, status: "pending"})
        .then(function(ins){
          if(ins.error) return friendsSay(ins.error.message, "bad");
          $("friendName").value = "";
          friendsSay("Request sent to " + them.username + ".", "good");
          loadFriends();
        });
    });
  });
}
function acceptFriend(otherId){
  sb.from("friendships").update({status:"accepted"})
    .eq("requester", otherId).eq("addressee", sbUser.id)
    .then(function(res){
      if(res.error) return friendsSay(res.error.message, "bad");
      friendsSay("Friend added.", "good");
      loadFriends();
      renderFriendsBoard();
    });
}
function removeFriend(otherId){
  sb.from("friendships").delete()
    .or("and(requester.eq." + sbUser.id + ",addressee.eq." + otherId + ")," +
        "and(requester.eq." + otherId + ",addressee.eq." + sbUser.id + ")")
    .then(function(res){
      if(res.error) return friendsSay(res.error.message, "bad");
      friendsSay("Removed.", "good");
      loadFriends();
      renderFriendsBoard();
    });
}
$("friendsBtn").addEventListener("click", function(){ playClick(); openFriends(); });
$("friendsClose").addEventListener("click", closeFriends);
$("friends").addEventListener("click", function(e){ if(e.target === $("friends")) closeFriends(); });
$("friendAdd").addEventListener("click", function(){ playClick(); addFriend(); });
$("friendName").addEventListener("keydown", function(e){ if(e.key === "Enter") addFriend(); });
$("friends").addEventListener("click", function(e){
  var a = e.target.closest && e.target.closest("[data-accept]");
  var r = e.target.closest && e.target.closest("[data-remove]");
  if(a){ playClick(); acceptFriend(a.dataset.accept); }
  else if(r){ playClick(); removeFriend(r.dataset.remove); }
});

/* ---- friends leaderboard ---- */
/* Ranked on total profit: the sum of the per-table nets, which excludes chips
   that arrived from codes or the dev console. */
function totalProfit(net){
  var sum = 0;
  for(var k in net){ if(typeof net[k] === "number") sum += net[k]; }
  return sum;
}
/* done() fires once the board has actually been painted, whichever way it got
   there, so the refresh button knows when to stop spinning. */
function renderFriendsBoard(done){
  var fin = function(){ if(done) done(); };
  var board = $("friendsBoard");
  if(!board){ fin(); return; }
  if(!CLOUD_OK || !sbUser){
    board.innerHTML = '<div class="people-empty">Sign in to see your friends here.</div>';
    fin();
    return;
  }
  /* no filter: the scores policy already returns your row and your accepted
     friends' rows, and nothing else */
  sb.from("scores").select("user_id, net").then(function(res){
    if(res.error){ board.innerHTML = '<div class="people-empty">' + res.error.message + '</div>'; fin(); return; }
    var rows = res.data || [];
    namesFor(rows.map(function(r){ return r.user_id; }), function(names){
      var ranked = rows.map(function(r){
        return {id:r.user_id, name:names[r.user_id] || "player", profit:totalProfit(r.net || {})};
      }).sort(function(a, b){ return b.profit - a.profit; });

      var span = 0;
      ranked.forEach(function(r){ span = Math.max(span, Math.abs(r.profit)); });
      var medals = ["&#129351;", "&#129352;", "&#129353;"];
      board.innerHTML = ranked.length < 2
        ? '<div class="people-empty">Add a friend to start comparing.</div>'
        : ranked.map(function(r, i){
            var pct = span > 0 ? Math.max(1.5, Math.abs(r.profit) / span * 50) : 0;
            var fill = r.profit === 0 ? "" :
              '<span class="board-fill ' + (r.profit > 0 ? "pos" : "neg") + '" style="width:' + pct + '%"></span>';
            return '<div class="board-row' + (r.id === sbUser.id ? " you" : "") + '">' +
                     '<span class="board-rank">' + (r.profit > 0 && i < 3 ? medals[i] : (i + 1) + ".") + '</span>' +
                     '<span class="board-game">' + r.name + (r.id === sbUser.id ? " (you)" : "") + '</span>' +
                     '<span class="board-bar">' + fill + '</span>' +
                     '<b class="board-amt ' + (r.profit > 0 ? "up" : r.profit < 0 ? "down" : "flat") + '">' + signed(r.profit) + '</b>' +
                   '</div>';
          }).join("");
      fin();
    });
  });
}
/* Flappy high scores — same people as the profit board, ranked on pipes cleared.
   Signed out there is nobody to compare against, so it shows your own best. */
function renderFlappyBoard(done){
  var fin = function(){ if(done) done(); };
  var board = $("flappyBoard");
  if(!board){ fin(); return; }

  var solo = function(note){
    board.innerHTML =
      '<div class="board-row you">' +
        '<span class="board-rank">1.</span>' +
        '<span class="board-game">You</span>' +
        '<span class="board-bar"></span>' +
        '<b class="board-amt ' + (flappyBest > 0 ? "up" : "flat") + '">' + fmt(flappyBest) + '</b>' +
      '</div>' +
      '<div class="people-empty">' + note + '</div>';
    fin();
  };
  if(!CLOUD_OK || !sbUser){ solo("Sign in to compare with friends."); return; }

  sb.from("scores").select("user_id, flappy_best").then(function(res){
    if(res.error){ board.innerHTML = '<div class="people-empty">' + res.error.message + '</div>'; fin(); return; }
    var rows = res.data || [];
    namesFor(rows.map(function(r){ return r.user_id; }), function(names){
      var ranked = rows.map(function(r){
        var best = r.flappy_best || 0;
        /* our own row can be ahead of the last cloud push */
        if(r.user_id === sbUser.id) best = Math.max(best, flappyBest);
        return {id:r.user_id, name:names[r.user_id] || "player", best:best};
      }).sort(function(a, b){ return b.best - a.best; });

      if(ranked.length < 2){ solo("Add a friend to start comparing."); return; }

      var span = 0;
      ranked.forEach(function(r){ span = Math.max(span, r.best); });
      var medals = ["&#129351;", "&#129352;", "&#129353;"];
      board.innerHTML = ranked.map(function(r, i){
        var pct = span > 0 ? Math.max(1.5, r.best / span * 50) : 0;
        var fill = r.best === 0 ? "" : '<span class="board-fill pos" style="width:' + pct + '%"></span>';
        return '<div class="board-row' + (r.id === sbUser.id ? " you" : "") + '">' +
                 '<span class="board-rank">' + (r.best > 0 && i < 3 ? medals[i] : (i + 1) + ".") + '</span>' +
                 '<span class="board-game">' + r.name + (r.id === sbUser.id ? " (you)" : "") + '</span>' +
                 '<span class="board-bar">' + fill + '</span>' +
                 '<b class="board-amt ' + (r.best > 0 ? "up" : "flat") + '">' + fmt(r.best) + '</b>' +
               '</div>';
      }).join("");
      fin();
    });
  });
}

/* Spins the button and hands back the stopper. maxMs is a dead-request guard:
   if a fetch never comes back the button still frees itself. */
var lbSpinTimer = null;
function lbSpin(maxMs){
  var btn = $("lbRefresh"), stopped = false;
  btn.classList.add("spin");
  btn.disabled = true;
  clearTimeout(lbSpinTimer);
  var stop = function(){
    if(stopped) return;
    stopped = true;
    clearTimeout(lbSpinTimer);
    btn.classList.remove("spin");
    btn.disabled = false;
  };
  lbSpinTimer = setTimeout(stop, maxMs);
  return stop;
}
$("lbRefresh").addEventListener("click", function(){
  playClick();
  renderLeaderboard();                        /* local, and free */
  if(!$("friendsBoard").hidden){
    renderFriendsBoard(lbSpin(6000));         /* the ones that actually go to the network */
  }else if(!$("flappyBoard").hidden){
    renderFlappyBoard(lbSpin(6000));
  }else{
    lbSpin(400);                              /* nothing to wait for — just show it happened */
  }
});
var LB_SUBS = {
  tables:  "Every chip staked and won, per table — up is profit, down is loss",
  friends: "You and your friends, ranked on total profit across every table",
  flappy:  "Most pipes cleared in a single run — your best ever, and your friends'"
};
Array.prototype.forEach.call(document.querySelectorAll("#lbSeg button"), function(b){
  b.addEventListener("click", function(){
    playClick();
    var which = b.dataset.lb;
    Array.prototype.forEach.call(document.querySelectorAll("#lbSeg button"), function(o){ o.classList.toggle("on", o === b); });
    $("leaderboard").hidden  = which !== "tables";
    $("friendsBoard").hidden = which !== "friends";
    $("flappyBoard").hidden  = which !== "flappy";
    $("lbSub").textContent = LB_SUBS[which];
    if(which === "friends") renderFriendsBoard();
    if(which === "flappy")  renderFlappyBoard();
  });
});

/* ---- changelog ---- */
var CHANGELOG_KEY = "sparxmaths-casino-changelog";
var CHANGELOG = {
  version: VERSION,
  notes: [
    "New table: Snake &mdash; every bite compounds, cash out before you run out of room.",
    "Daily streak calendar &mdash; open a door a day, 50 chips up to 500 on day five.",
    "New code BROKE123 &mdash; 15 chips, any time you run out. Reusable.",
    "Every table now scales to fill your screen &mdash; playfield, chips and all.",
    "The games spread out sideways on a wide screen instead of leaving gutters.",
    "No more scrollbar on the taller tables.",
    "Sound has moved into its own section in Settings.",
    "Settings shows who you are signed in as, with sign out beside it.",
    "The changelog now sits beside the General heading."
  ]
};
function renderChangelog(){
  $("changelogVersion").textContent = CHANGELOG.version;
  $("settingsChangelogVer").textContent = CHANGELOG.version;
  $("changelogBody").innerHTML = CHANGELOG.notes.map(function(n){ return "<li>" + n + "</li>"; }).join("");
}
/* Once per version: a changelog on every launch is noise, which is also why
   Settings carries its own way into the codes popup. */
function maybeShowChangelog(){
  var seen = null;
  try{ seen = localStorage.getItem(CHANGELOG_KEY); }catch(e){}
  if(seen === CHANGELOG.version) return false;
  renderChangelog();
  $("changelog").classList.add("on");
  return true;
}
function closeChangelog(){
  $("changelog").classList.remove("on");
  try{ localStorage.setItem(CHANGELOG_KEY, CHANGELOG.version); }catch(e){}
  openingSequence();                                 /* the warning is next in the queue */
}

/* ---- one-device warning ---- */
var MULTIWARN_KEY = "sparxmaths-casino-multiwarn";
function maybeShowMultiWarn(){
  var seen = null;
  try{ seen = localStorage.getItem(MULTIWARN_KEY); }catch(e){}
  if(seen === CHANGELOG.version) return false;
  $("multiWarn").classList.add("on");
  return true;                                       /* so the queue knows to stop here */
}
function closeMultiWarn(){
  $("multiWarn").classList.remove("on");
  try{ localStorage.setItem(MULTIWARN_KEY, CHANGELOG.version); }catch(e){}
  openingSequence();                                 /* the calendar is next in the queue */
}
/* Signing in re-arms the opening popups, so the changelog and the one-device
   warning are seen on every login rather than once per version. Cleared before
   the request, not after it: the auth listener closes the gate and runs the
   queue while signInWithPassword is still resolving, so clearing in .then()
   would land too late to matter. */
function rearmOpeningPopups(){
  try{
    localStorage.removeItem(CHANGELOG_KEY);
    localStorage.removeItem(MULTIWARN_KEY);
  }catch(e){}
}
$("multiWarnClose").addEventListener("click", closeMultiWarn);
$("multiWarnOk").addEventListener("click", function(){ playClick(); closeMultiWarn(); });
$("multiWarn").addEventListener("click", function(e){ if(e.target === $("multiWarn")) closeMultiWarn(); });
/* The opening popups are a queue, not a stack: each one only runs once the
   ones before it are out of the way. */
function openingSequence(){
  if($("betaOverlay").classList.contains("on")) return;
  if(gatePending || $("gate").classList.contains("on")) return;
  if($("changelog").classList.contains("on") || $("codes").classList.contains("on")) return;
  if($("calendar").classList.contains("on")) return;
  if(maybeShowChangelog()) return;                   /* warning waits its turn */
  if(maybeShowMultiWarn()) return;
  /* Last in the queue, and only when there is something to open. Yesterday's
     unclaimed chips are still here, because the claim is stamped with the day
     it was made rather than cleared at launch. */
  if(streakClaimable()) openCalendar();
}
$("changelogClose").addEventListener("click", function(){ closeChangelog(); });
$("changelogOk").addEventListener("click", function(){ playClick(); closeChangelog(); });
$("changelog").addEventListener("click", function(e){ if(e.target === $("changelog")) closeChangelog(); });
/* Open codes BEFORE closing the changelog: closing advances the queue, and the
   queue only defers to codes if codes is already marked open. */
$("changelogCodes").addEventListener("click", function(){ playClick(); openCodes(); closeChangelog(); });
/* Opened deliberately from Settings, so it ignores the once-per-version rule
   that governs the automatic showing. */
$("settingsChangelog").addEventListener("click", function(){
  playClick();
  renderChangelog();
  $("changelog").classList.add("on");
});

/* ---- redeemable codes ---- */
var CODES = {
  "RELEASE26!": {chips: 500, label: "Release bonus"},
  /* The balance condition and the repeat are enforced by redeem_code(), not
     here. These flags only decide what the noticeboard says and whether the
     balance is flushed to the server before claiming — see tryRedeem. */
  "BROKE123":   {chips: 15,  label: "Emergency top-up", when: "whenever you hit 0 chips",
                 onBroke: true, repeat: true}
};
function openCodes(){
  renderCodes();
  $("codes").classList.add("on");
}
function closeCodes(){
  $("codes").classList.remove("on");
  openingSequence();                                 /* rejoin the queue after the detour */
}
/* A noticeboard: it lists what exists and what has been taken. Redeeming is
   done in the Code box in Settings, so there is only one place to type one. */
function renderCodes(){
  $("codesList").innerHTML = Object.keys(CODES).map(function(c){
    /* A repeatable code is never spent, so it never greys out — what limits it
       is its condition, and that is what the row says instead. */
    var reward = CODES[c], claimed = !reward.repeat && redeemed.indexOf(c) !== -1;
    return '<div class="code-row' + (claimed ? " claimed" : "") + '">' +
             '<span class="code-name">' + c +
               '<span class="code-what">' + reward.label + " &middot; " + fmt(reward.chips) + " chips" +
                 (reward.when ? " &middot; " + reward.when : "") + '</span>' +
             '</span>' +
             '<span class="code-state' + (claimed ? "" : " open") + '">' +
               (claimed ? "Claimed" : reward.repeat ? "Repeatable" : "Available") +
             '</span>' +
           '</div>';
  }).join("");
}
/* Returns a message for the Code box, or null when the text is not a reward
   code at all — which is how the dev unlock keeps sharing the same input. */
/* Claiming is the database's decision, not this page's. redeem_code() checks
   the code, records the claim and pays out in one transaction, and a primary
   key on (user_id, code) is what actually stops a second claim — emptying the
   local list in dev tools no longer buys anything.

   Returns null when the text is not a code at all, so the dev unlock can keep
   sharing the same input. Otherwise it reports through the callback, because
   the answer now comes back over the network. */
function tryRedeem(code, done){
  if(!CODES[code]) return null;

  if(!CLOUD_OK || !sbUser){
    done({ok:false, msg:"Sign in to claim codes — they are tied to your account."});
    return true;
  }

  done({pending:true, msg:"Claiming…"});
  /* A code whose condition is your balance needs the server to be looking at
     the current one. save() only syncs every couple of seconds, so going broke
     and typing this straight away would otherwise be judged against the balance
     from before the last bet. */
  var ready = CODES[code].onBroke ? Promise.resolve(cloudPush()) : Promise.resolve();
  ready.catch(function(){}).then(function(){
    return sb.rpc("redeem_code", {p_code: code});
  }).then(function(res){
    /* the function is a separate migration, so say something useful rather than
       surfacing "function not found" from Postgres */
    if(res.error){
      done({ok:false, msg:/function|schema cache/i.test(res.error.message)
        ? "Codes are not switched on yet. Try again later."
        : res.error.message});
      return;
    }
    var r = res.data || {};
    if(!r.ok){
      done({ok:false, msg:
        r.error === "already"       ? "You have already claimed that code." :
        r.error === "not_signed_in" ? "Sign in to claim codes." :
        r.error === "not_eligible"  ? "That one is for when you are out of chips — spend what you have first." :
                                      "That code is not valid."});
      return;
    }
    if(redeemed.indexOf(code) === -1) redeemed.push(code);
    /* the server already added the chips, so take its balance rather than
       adding them again here */
    setBank(r.bank, 1);
    playWin("big");
    setTimeout(playCoin, 90);
    renderCodes();
    done({ok:true, msg:r.label + " — " + fmt(r.chips) + " chips added." +
      (r.times > 1 ? " (claim " + fmt(r.times) + ")" : "")});
  });
  return true;
}
/* The claim history lives in its own table now, so it is read on sign-in
   rather than carried on the scores row. */
function loadRedemptions(){
  if(!CLOUD_OK || !sbUser) return;
  sb.from("redemptions").select("code").then(function(res){
    if(res.error) return;
    redeemed = (res.data || []).map(function(r){ return r.code; });
    renderCodes();
  });
}
$("codesClose").addEventListener("click", closeCodes);
$("codes").addEventListener("click", function(e){ if(e.target === $("codes")) closeCodes(); });

/* ---- stats panel + two-step reset ---- */
function renderStatsPanel(){
  $("statsHands").textContent = fmt(stats.hands);
  $("statsWon").textContent   = fmt(stats.won);
  $("statsBig").textContent   = fmt(stats.big);
  $("statsPeak").textContent   = fmt(stats.peak);
  $("statsStreak").textContent = fmt(streak.best);
}

var resetStats1 = $("resetStats1"), resetStats2 = $("resetStats2");
function closeReset1(){ resetStats1.classList.remove("on"); }
function closeReset2(){ resetStats2.classList.remove("on"); }

$("statsResetBtn").addEventListener("click", function(){
  playClick();
  resetStats1.classList.add("on");
});
$("resetStatsClose1").addEventListener("click", closeReset1);
$("resetStatsCancel1").addEventListener("click", function(){ playClick(); closeReset1(); });
resetStats1.addEventListener("click", function(e){ if(e.target === resetStats1) closeReset1(); });

$("resetStatsNext").addEventListener("click", function(){
  playClick();
  closeReset1();
  $("resetStatsSummary").textContent =
    "Clearing " + fmt(stats.hands) + " hands, " + fmt(stats.won) + " won, " +
    fmt(stats.big) + " biggest hit, " + fmt(stats.peak) + " peak bank.";
  /* Step 2 replaces step 1 in the same tick, so the second click of a
     double-click would land on whatever now occupies those pixels. Button order
     keeps that from being the destructive one; this makes it true regardless of
     how the labels measure under a different font. */
  var go = $("resetStatsGo");
  go.disabled = true;
  setTimeout(function(){ go.disabled = false; }, 500);
  resetStats2.classList.add("on");
});
$("resetStatsClose2").addEventListener("click", closeReset2);
$("resetStatsCancel2").addEventListener("click", function(){ playClick(); closeReset2(); });
resetStats2.addEventListener("click", function(e){ if(e.target === resetStats2) closeReset2(); });

$("resetStatsGo").addEventListener("click", function(){
  playClick();
  stats.hands = 0;
  stats.won = 0;
  stats.big = 0;
  stats.peak = bank;                 /* a high-water mark restarts from today's balance, not 0 */
  flappyBest = 0;
  snakeBest = 0;
  GAMES.forEach(function(g){ gameNet[g.key] = 0; });
  renderStats();
  renderStatsPanel();
  renderLeaderboard();
  if(typeof syncFlappyUI === "function") syncFlappyUI();
  save();
  closeReset2();
});

/* ---- account / cloud save ---- */
function acctSay(text, kind){
  var n = $("acctNote");
  n.textContent = text || "";
  n.style.color = kind === "bad" ? "var(--bad)" : kind === "good" ? "var(--good)" : "";
}
/* Whatever the profile row says you are called, remembered so the rail can show
   it without going back to the server every time the panel re-renders. */
var sbName = "";
function renderAccount(){
  $("acctOffline").hidden = CLOUD_OK;
  $("acctOut").hidden     = !CLOUD_OK || !!sbUser;
  $("acctIn").hidden      = !CLOUD_OK || !sbUser;
  /* the same state, mirrored under the Account tab in the rail. Off the file://
     build entirely, where there is no account to be signed in to. */
  $("railAcct").hidden = !CLOUD_OK;
  if(!CLOUD_OK) return;
  $("railWho").textContent  = sbUser ? (sbName || sbUser.email) : "Playing as guest";
  $("railAuth").textContent = sbUser ? "Sign out" : "Log in";
}
function applyCloudRow(row){
  stats.hands = row.hands; stats.won = row.won; stats.big = row.big; stats.peak = row.peak;
  gameNet = row.net || {};
  GAMES.forEach(function(g){ if(typeof gameNet[g.key] !== "number") gameNet[g.key] = 0; });
  streak = {
    count: row.streak_count || 0,
    best:  row.streak_best  || 0,
    last:  typeof row.streak_last === "number" ? row.streak_last : null,
    /* a claim made on another device has to come back with the rest of it, or
       the same day pays twice */
    claimed: typeof row.streak_claimed === "number" ? row.streak_claimed : null
  };
  /* taken verbatim like every other stat here: this branch only runs when the
     cloud save has won, and max()-ing instead would leak one account's best
     onto the next account signed in on the same device */
  flappyBest = row.flappy_best || 0;
  setBank(row.bank, 0);                              /* re-renders the footer stats and saves locally */
  renderStatsPanel();
  renderLeaderboard();
  renderStreak();
}
function cloudPush(){
  if(!sbUser) return;
  $("acctSync").textContent = "Saving…";
  return sb.from("scores").upsert({                  /* returned so a caller can wait for the balance to land */
    user_id: sbUser.id, bank: bank, hands: stats.hands, won: stats.won,
    big: stats.big, peak: stats.peak, net: gameNet,
    streak_count: streak.count, streak_best: streak.best, streak_last: streak.last,
    streak_claimed: streak.claimed,
    flappy_best: flappyBest,
    updated_at: new Date().toISOString()
  }).then(function(res){
    $("acctSync").textContent = res.error ? "Failed" : "Saved";
    if(res.error) acctSay(res.error.message, "bad");
  });
}
/* setBank fires on every chip movement, so coalesce the writes */
var cloudTimer = null;
function cloudPushSoon(){
  if(!sbUser) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(cloudPush, 2000);
}
/* On sign-in one side has to win. hands only ever counts up, so the bigger
   count is the more-played save — that keeps a fresh device from wiping a
   real one, and a real one from being wiped by a fresh cloud row.
   A tie goes to the cloud. hands increments on every hand played, so equal
   counts mean this device has done nothing since it last synced, and the cloud
   is at least as current. Letting the device win a tie cost real chips: claim a
   code (which the server pays, without touching hands), then sign in somewhere
   else, and the device's untouched 1000 was written over the 1500 on file. */
/* Signing out has to clear the progress still sitting in memory. Without this,
   signing in as somebody else on the same device carries the previous player's
   figures along, and "whoever has more hands wins" then pushes them straight
   over the new account's cloud save. The signed-out player loses nothing: their
   progress is already in their own row. */
function resetLocalProgress(){
  stats = {hands:0, won:0, big:0, peak:1000};
  gameNet = {};
  GAMES.forEach(function(g){ gameNet[g.key] = 0; });
  streak = {count:0, best:0, last:null, claimed:null};
  flappyBest = 0;
  snakeBest = 0;
  setBank(1000, 0);
  renderStatsPanel();
  renderLeaderboard();
  renderStreak();
}
/* Set the moment a signup is attempted, cleared the moment it is used or the
   signup fails. A brand-new account has no history, so it must not adopt the
   figures already sitting on this device: its cloud row starts at 0 hands, the
   "more hands wins" rule below would hand it the device's whole save, and the
   new player would appear on the friends board with somebody else's profit. */
var freshSignup = false;
function cloudSync(){
  if(!sbUser) return;
  if(freshSignup){ freshSignup = false; resetLocalProgress(); }
  sb.from("scores").select("*").eq("user_id", sbUser.id).maybeSingle().then(function(res){
    if(res.error){ acctSay(res.error.message, "bad"); return; }
    var row = res.data;
    if(row && row.hands >= stats.hands){
      applyCloudRow(row);
      acctSay("Loaded your cloud save (" + fmt(row.hands) + " hands).", "good");
      $("acctSync").textContent = "Loaded";
    }else{
      cloudPush();
      acctSay("This device was further ahead, so the cloud was updated.", "good");
    }
  });
  sb.from("profiles").select("username").eq("id", sbUser.id).maybeSingle().then(function(res){
    sbName = (res.data && res.data.username) || sbUser.email;
    $("acctName").textContent = sbName;
    renderAccount();                                 /* the rail shows the name too */
  });
  loadRedemptions();
}
/* ---- welcome gate ---- */
var GATE_VIEWS = ["gateChoice", "gateLogin", "gateSignup", "gateReset", "gateNewPass"];
var AUTH_AT_KEY = "sparxmaths-casino-authat";
var AUTH_MAX_AGE = 2 * 24 * 60 * 60 * 1000;          /* stay signed in for two days */

function gateSay(text, kind){
  var n = $("gateNote");
  n.textContent = text || "";
  n.style.color = kind === "bad" ? "var(--bad)" : kind === "good" ? "var(--good)" : "";
}
/* Wired outside the CLOUD_OK block so the control works wherever it renders. */
function pwHideAll(){
  Array.prototype.forEach.call(document.querySelectorAll(".pw-toggle"), function(b){
    $(b.dataset.pw).type = "password";
    b.classList.remove("on");
    b.setAttribute("aria-label", "Show password");
  });
}
Array.prototype.forEach.call(document.querySelectorAll(".pw-toggle"), function(b){
  b.addEventListener("click", function(){
    var input = $(b.dataset.pw), show = input.type === "password";
    input.type = show ? "text" : "password";
    b.classList.toggle("on", show);
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
  });
});

function gateShow(view){
  GATE_VIEWS.forEach(function(v){ $(v).hidden = v !== view; });
  pwHideAll();                                       /* never leave one revealed behind a view switch */
  gateSay("");
  $("gate").classList.add("on");
}
function gateClose(){
  $("gate").classList.remove("on");
  gateSay("");
  openingSequence();                                 /* the changelog is next in the queue */
}

/* Defer to the beta notice if it is still up; closeBeta() calls gateFlush(). */
var gatePending = false;
function gateQueue(){
  if($("betaOverlay").classList.contains("on")){ gatePending = true; return; }
  gateShow("gateChoice");
}
function gateFlush(){
  if(!gatePending) return;
  gatePending = false;
  gateShow("gateChoice");
}

function authStamp(){ try{ localStorage.setItem(AUTH_AT_KEY, String(Date.now())); }catch(e){} }
function authAge(){
  try{
    var t = Number(localStorage.getItem(AUTH_AT_KEY));
    return t ? Date.now() - t : Infinity;
  }catch(e){ return Infinity; }
}

if(CLOUD_OK){
  sb.auth.onAuthStateChange(function(evt, session){
    /* arriving back from a reset link: Supabase signs you in just long enough
       to set a new password */
    if(evt === "PASSWORD_RECOVERY"){ gateShow("gateNewPass"); return; }

    sbUser = session ? session.user : null;
    renderAccount();
    if(sbUser){
      if(evt === "SIGNED_IN") authStamp();
      gateClose();
      cloudSync();
    }else{
      $("acctSync").textContent = "—";
      redeemed = [];                                 /* claims belong to the account, not the device */
      renderCodes();
      /* Only on a real sign-out, never on the null session every guest gets at
         startup — that would wipe a guest's progress on arrival. */
      if(evt === "SIGNED_OUT") resetLocalProgress();
    }
  });

  /* Two days is a cap, not a default: the client would otherwise keep refreshing
     the session indefinitely. Checked once on load, before the gate decides. */
  sb.auth.getSession().then(function(res){
    var session = res.data && res.data.session;
    if(session && authAge() > AUTH_MAX_AGE){
      sb.auth.signOut().then(function(){
        gateQueue();
        gateSay("It has been a while — please sign in again.");
      });
    }else if(!session && !location.hash.match(/type=recovery/)){
      gateQueue();
    }
  });

  $("gateGoLogin").addEventListener("click", function(){ playClick(); gateShow("gateLogin"); });
  $("gateGoSignup").addEventListener("click", function(){ playClick(); gateShow("gateSignup"); });
  $("gateGoReset").addEventListener("click", function(e){ e.preventDefault(); playClick(); gateShow("gateReset"); });
  $("gateGuest").addEventListener("click", function(e){ e.preventDefault(); playClick(); gateClose(); });
  $("gateClose").addEventListener("click", function(){ gateClose(); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-gate-back]"), function(b){
    b.addEventListener("click", function(){ playClick(); gateShow("gateChoice"); });
  });
  $("acctOpenGate").addEventListener("click", function(){ playClick(); gateShow("gateChoice"); });

  $("gateDoLogin").addEventListener("click", function(){
    playClick();
    var ident = $("gateIdent").value.trim(), pass = $("gateLoginPass").value;
    if(!ident || !pass){ gateSay("Enter your username or email and your password.", "bad"); return; }
    gateSay("Signing in…");
    rearmOpeningPopups();

    /* Supabase only signs in with an email, so a username has to be translated
       first via the email_for_username function. */
    var resolve = ident.indexOf("@") !== -1
      ? Promise.resolve(ident)
      : sb.rpc("email_for_username", {u: ident}).then(function(r){
          /* the lookup is a separate migration, so say something useful rather
             than surfacing "function not found" from Postgres */
          if(r.error) throw new Error("Username lookup is unavailable — log in with your email instead.");
          if(!r.data) throw new Error("No account with that username.");
          return r.data;
        });

    resolve.then(function(email){
      return sb.auth.signInWithPassword({email: email, password: pass});
    }).then(function(res){
      if(res.error) throw new Error(res.error.message);
      $("gateLoginPass").value = "";
      gateSay("");
    }).catch(function(err){ gateSay(err.message, "bad"); });
  });

  $("gateDoSignup").addEventListener("click", function(){
    playClick();
    var user = $("gateUser").value.trim();
    if(user.length < 3 || user.length > 20){ gateSay("Pick a username of 3-20 characters.", "bad"); return; }
    gateSay("Creating account…");
    rearmOpeningPopups();
    freshSignup = true;                              /* start the new account clean */
    sb.auth.signUp({
      email: $("gateEmail").value.trim(),
      password: $("gateSignupPass").value,
      options: { data: { username: user } }
    }).then(function(res){
      if(res.error){ freshSignup = false; gateSay(res.error.message, "bad"); return; }
      $("gateSignupPass").value = "";
      /* with "Confirm email" left on there is no session yet, only a posted mail */
      if(!res.data.session) gateSay("Account created — check your email to confirm, then log in.", "good");
    });
  });

  $("gateDoReset").addEventListener("click", function(){
    playClick();
    var email = $("gateResetEmail").value.trim();
    if(email.indexOf("@") === -1){ gateSay("Enter the email address on the account.", "bad"); return; }
    gateSay("Sending…");
    sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname})
      .then(function(res){
        gateSay(res.error ? res.error.message
                          : "If that address has an account, a reset link is on its way.",
                res.error ? "bad" : "good");
      });
  });

  $("gateDoNewPass").addEventListener("click", function(){
    playClick();
    var pass = $("gateNewPassVal").value;
    if(pass.length < 6){ gateSay("Use at least 6 characters.", "bad"); return; }
    gateSay("Saving…");
    sb.auth.updateUser({password: pass}).then(function(res){
      if(res.error){ gateSay(res.error.message, "bad"); return; }
      $("gateNewPassVal").value = "";
      authStamp();
      gateClose();
      history.replaceState(null, "", location.pathname);   /* drop the recovery token */
    });
  });

  $("acctSignOut").addEventListener("click", function(){
    playClick();
    sb.auth.signOut().then(function(){
      try{ localStorage.removeItem(AUTH_AT_KEY); }catch(e){}
      sbName = "";
      acctSay("Signed out. Your chips stay on this device.", "good");
    });
  });

  /* One button under the Account tab, doing whichever of those two you need. */
  $("railAuth").addEventListener("click", function(){
    if(sbUser) $("acctSignOut").click();
    else{ playClick(); gateShow("gateChoice"); }
  });
}
renderAccount();

/* ---- dev mode (unlocked by the Code field in General settings) ---- */
var devCodeInput = $("devCode"), devNote = $("devNote");

function applyCasinoName(name){
  CASINO_NAME = name;
  document.title = name.toUpperCase() + " Casino";
  $("brandName").textContent = name;
}

function openDevPopup(){
  var html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>xyz — dev console</title><style>',
    '*{box-sizing:border-box}',
    'html,body{margin:0;height:100%}',
    'body{',
    '  display:flex;align-items:center;justify-content:center;height:100%;',
    '  background:radial-gradient(700px 500px at 50% 0%, #3d0a63 0%, transparent 60%), linear-gradient(180deg,#150726,#050109);',
    '  font-family:"Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;',
    '}',
    '.term{',
    '  width:100%;height:100%;display:flex;flex-direction:column;',
    '  border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;',
    '  background:rgba(18,10,28,.92);backdrop-filter:blur(18px);',
    '  box-shadow:0 30px 70px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.05);',
    '}',
    '.term-titlebar{',
    '  display:flex;align-items:center;gap:8px;padding:11px 14px;flex:0 0 auto;',
    '  border-bottom:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);',
    '}',
    '.dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto}',
    '.dot.red{background:#ff5f57;cursor:pointer}',
    '.dot.yellow{background:#febc2e}',
    '.dot.green{background:#28c840}',
    '.term-title{',
    '  flex:1;text-align:center;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;',
    '  color:rgba(236,251,255,.4);margin-right:35px;',
    '}',
    '.term-body{',
    '  flex:1;overflow-y:auto;padding:16px 18px;',
    '  font:13px/1.7 "Cascadia Code","SF Mono",Consolas,"Courier New",monospace;',
    '  color:#e7e9f7;',
    '}',
    '.term-line{white-space:pre-wrap;word-break:break-word;margin-bottom:2px}',
    '.out-ok{color:#5df2b0}',
    '.out-err{color:#ff6f91}',
    '.out-info{color:#7ce4ff}',
    '.out-dim{color:rgba(231,233,247,.45)}',
    '.prompt-echo{color:#ff2e9e;font-weight:700;margin-right:6px}',
    '.term-inputrow{',
    '  display:flex;align-items:center;gap:10px;flex:0 0 auto;',
    '  padding:12px 18px;border-top:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.2);',
    '}',
    '.prompt{color:#ff2e9e;font-weight:700;font:13px/1 "Cascadia Code","SF Mono",Consolas,monospace;user-select:none}',
    '.term-inputrow input{',
    '  flex:1;background:transparent;border:none;outline:none;',
    '  color:#e7e9f7;caret-color:#22e8ff;',
    '  font:13px/1 "Cascadia Code","SF Mono",Consolas,"Courier New",monospace;',
    '}',
    '.term-body::-webkit-scrollbar{width:10px}',
    '.term-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:99px}',
    'b{color:#ffd76a}',
    '</style></head><body>',
    '<div class="term">',
    '  <div class="term-titlebar">',
    '    <span class="dot red" id="closeDot" title="Close"></span>',
    '    <span class="dot yellow"></span>',
    '    <span class="dot green"></span>',
    '    <span class="term-title">xyz — dev console</span>',
    '  </div>',
    '  <div class="term-body" id="termBody">',
    '    <div class="term-line out-info">XYZ dev console connected to the casino window.</div>',
    '    <div class="term-line out-dim">Type <b>help</b> to see available commands.</div>',
    '  </div>',
    '  <div class="term-inputrow">',
    '    <span class="prompt">xyz&gt;</span>',
    '    <input id="termInput" autocomplete="off" spellcheck="false" autofocus>',
    '  </div>',
    '</div>',
    '<script>',
    '  var body = document.getElementById("termBody");',
    '  var input = document.getElementById("termInput");',
    '  var cmdHistory = [], hIndex = -1;',
    '  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }',
    '  function print(text, cls){',
    '    var d = document.createElement("div");',
    '    d.className = "term-line" + (cls ? " " + cls : "");',
    '    d.innerHTML = text;',
    '    body.appendChild(d);',
    '    body.scrollTop = body.scrollHeight;',
    '  }',
    '  function run(raw){',
    '    var parts = raw.trim().split(/\\s+/);',
    '    var cmd = (parts[0] || "").toLowerCase();',
    '    var args = parts.slice(1);',
    '    if(!cmd) return;',
    '    if(cmd === "help"){',
    '      print("Available commands:");',
    '      print("&nbsp;&nbsp;<b>chips</b> &mdash; show current balance");',
    '      print("&nbsp;&nbsp;<b>chips add</b> &lt;n&gt; &mdash; add chips");',
    '      print("&nbsp;&nbsp;<b>chips set</b> &lt;n&gt; &mdash; set balance");',
    '      print("&nbsp;&nbsp;<b>rig user</b> &lt;0-100&gt; &mdash; rig rounds for the player");',
    '      print("&nbsp;&nbsp;<b>rig host</b> &lt;0-100&gt; &mdash; rig rounds for the house");',
    '      print("&nbsp;&nbsp;<b>rig</b> &mdash; show current rig levels");',
    '      print("&nbsp;&nbsp;<b>rig off</b> &mdash; back to fair odds");',
    '      print("&nbsp;&nbsp;<b>reset codes</b> &mdash; make every code claimable again");',
    '      print("&nbsp;&nbsp;<b>clear</b> &mdash; clear this console");',
    '      print("&nbsp;&nbsp;<b>exit</b> &mdash; close this window");',
    '      print("Chip amounts take k/m/b &mdash; e.g. chips add 1.5m", "out-dim");',
    '      return;',
    '    }',
    '    if(cmd === "clear"){ body.innerHTML = ""; return; }',
    '    if(cmd === "exit" || cmd === "close"){',
    '      print("Closing…", "out-dim");',
    '      setTimeout(function(){ window.close(); }, 250);',
    '      return;',
    '    }',
    '    if(cmd !== "chips" && cmd !== "rig" && cmd !== "reset" && cmd !== "codes"){',
    '      print("Unknown command: " + esc(cmd) + " (try \\"help\\")", "out-err");',
    '      return;',
    '    }',
    '    var op = window.opener;',
    '    if(!op || op.closed){',
    '      print("Connection to the casino window was lost.", "out-err");',
    '      return;',
    '    }',
    '    op.postMessage({type:"xyz-cmd", cmd:cmd, args:args}, "*");',
    '  }',
    '  window.addEventListener("message", function(e){',
    '    var data = e.data;',
    '    if(!data || data.type !== "xyz-out") return;',
    '    print(data.text, data.kind ? "out-" + data.kind : undefined);',
    '  });',
    '  input.addEventListener("keydown", function(e){',
    '    if(e.key === "Enter"){',
    '      var val = input.value;',
    '      if(val.trim()){',
    '        print(\'<span class="prompt-echo">xyz&gt;</span>\' + esc(val));',
    '        cmdHistory.push(val); hIndex = cmdHistory.length;',
    '        run(val);',
    '      }',
    '      input.value = "";',
    '    }else if(e.key === "ArrowUp"){',
    '      if(hIndex > 0){ hIndex--; input.value = cmdHistory[hIndex]; }',
    '      e.preventDefault();',
    '    }else if(e.key === "ArrowDown"){',
    '      if(hIndex < cmdHistory.length - 1){ hIndex++; input.value = cmdHistory[hIndex]; }',
    '      else{ hIndex = cmdHistory.length; input.value = ""; }',
    '      e.preventDefault();',
    '    }',
    '  });',
    '  document.getElementById("closeDot").addEventListener("click", function(){ window.close(); });',
    '  document.body.addEventListener("click", function(){ input.focus(); });',
    '  input.focus();',
    '<\/script>',
    '</body></html>'
  ].join("\n");

  var blob = new Blob([html], {type: "text/html"});
  var url = URL.createObjectURL(blob);
  var win = window.open(url, "xyzDevConsole", "width=560,height=440,resizable=yes");
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  return !!win;
}

/* Runs dev-console commands sent from the popup via postMessage — keeps the
   popup a pure UI with no direct cross-window property access, since a
   blob: URL popup and a file:// opener can't be relied on to stay same-origin
   across browsers. */
/* "1m" -> 1000000, also k and b, any case, decimals allowed ("1.5k").
   Anchored, so junk like "1x" or "abc" is NaN rather than a silent 1. Rounded
   and finite-checked because setBank does no clamping and an Infinity balance
   would JSON.stringify to null and wipe the save on reload. */
function parseAmount(s){
  if(typeof s !== "string") return NaN;
  var m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([kmb])?$/i.exec(s.trim().replace(/,/g, ""));
  if(!m) return NaN;
  var mult = {k:1e3, m:1e6, b:1e9}[(m[2] || "").toLowerCase()] || 1;
  var v = Math.round(parseFloat(m[1]) * mult);
  return isFinite(v) ? v : NaN;
}
window.addEventListener("message", function(e){
  var data = e.data;
  if(!data || data.type !== "xyz-cmd" || !e.source) return;
  var reply = function(text, kind){ e.source.postMessage({type:"xyz-out", text:text, kind:kind}, "*"); };
  var cmd = data.cmd, args = data.args || [];

  if(cmd === "chips"){
    if(args[0] === "add"){
      var n = parseAmount(args[1]);
      if(isNaN(n) || n === 0){ reply("Usage: chips add &lt;n&gt; &mdash; accepts 1k, 1.5m, 2b", "err"); return; }
      setBank(bank + n, 1);
      reply("Added " + fmt(n) + " chips. Balance: " + fmt(bank), "ok");
    }else if(args[0] === "set"){
      var n2 = parseAmount(args[1]);
      if(isNaN(n2)){ reply("Usage: chips set &lt;n&gt; &mdash; accepts 1k, 1.5m, 2b", "err"); return; }
      setBank(n2, 1);
      reply("Balance set to " + fmt(bank), "ok");
    }else{
      reply("Balance: " + fmt(bank) + " chips", "info");
    }
  }else if(cmd === "rig"){
    var who = (args[0] || "").toLowerCase();
    if(who === "off" || who === "reset"){
      rigUser = 0; rigHost = 0;
      save();
      reply("Rigging cleared. Everything back to fair odds.", "ok");
      return;
    }
    if(who !== "user" && who !== "host"){
      reply("Rig &mdash; user: " + rigUser + ", host: " + rigHost, "info");
      if(who) reply("Usage: rig user|host &lt;0-100&gt; | rig off", "err");
      return;
    }
    if(args.length < 2){
      reply("Usage: rig " + who + " &lt;0-100&gt;", "err");
      return;
    }
    var pct = Math.round(Number(args[1]));
    if(isNaN(pct) || pct < 0 || pct > 100){
      reply("Value must be a number from 0 to 100.", "err");
      return;
    }
    if(who === "user") rigUser = pct; else rigHost = pct;
    save();
    reply("Rig " + who + " set to " + pct + "%" +
          (pct === 0 ? " (normal odds)." : pct === 100 ? " (every round forced)." : "."), "ok");
    reply("Now &mdash; user: " + rigUser + ", host: " + rigHost, "info");
  }else if(cmd === "reset" || cmd === "codes"){
    /* Written either way round, because "reset codes" reads like English and
       "codes reset" matches the verb-second shape of the commands above it. */
    var sub = (args[0] || "").toLowerCase();
    if(!(cmd === "reset" && sub === "codes") && !(cmd === "codes" && sub === "reset")){
      reply("Usage: reset codes", "err"); return;
    }
    /* A claim is a row in the database, not a note in this browser, so this
       cannot be done locally — and that is the whole reason the claim was moved
       there in the first place. */
    if(!CLOUD_OK || !sbUser){
      reply("Sign in first &mdash; claims are recorded against your account, not this browser.", "err");
      return;
    }
    reply("Clearing…", "info");
    sb.rpc("reset_redemptions").then(function(res){
      if(res.error){
        reply(/function|schema cache/i.test(res.error.message)
          ? "reset_redemptions is not installed. Run supabase/10-reset-codes.sql."
          : res.error.message, "err");
        return;
      }
      var r = res.data || {};
      if(!r.ok){
        /* not_dev only comes back from the gated version in 10. Kept so the
           console works against either that or the open one in 11. */
        reply(r.error === "not_dev"
          ? "Your account is not on the dev list. Add it in 10-reset-codes.sql."
          : "Sign in first.", "err");
        return;
      }
      redeemed = [];
      renderCodes();
      reply("Cleared " + fmt(r.cleared) + " claim" + (r.cleared === 1 ? "" : "s") +
            ". Every code is claimable again.", "ok");
    });
  }
});

/* One box, two jobs. Reward codes are tried first; the dev unlock is only
   reached by text that is not a reward code, so neither can shadow the other. */
function submitDevCode(){
  var raw = devCodeInput.value.trim();

  var isCode = tryRedeem(raw.toUpperCase(), function(claim){
    if(claim.ok) devCodeInput.value = "";
    else if(!claim.pending) playLose();
    devNote.textContent = claim.msg;
    devNote.style.color = claim.pending ? "" : claim.ok ? "var(--good)" : "var(--bad)";
  });
  if(isCode) return;

  if(raw.toLowerCase() === "xyz"){
    playWin("big");
    applyCasinoName("xyz");
    save();
    var opened = openDevPopup();
    devNote.textContent = opened
      ? "Code accepted — casino renamed. Check the pop-up window."
      : "Code accepted — casino renamed. (Your browser blocked the pop-up.)";
    devNote.style.color = "var(--good)";
    setTimeout(function(){ settingsOverlay.classList.remove("on"); }, 900);
  }else{
    playLose();
    devNote.textContent = "Incorrect code.";
    devNote.style.color = "var(--bad)";
  }
}
$("devSubmit").addEventListener("click", submitDevCode);
devCodeInput.addEventListener("keydown", function(e){
  if(e.key === "Enter") submitDevCode();
});

/* ---- appearance / themes ---- */
var THEMES = [
  {id:"emerald", name:"Emerald Classic", tag:"The original felt & gold", vars:{
    "--gold":"#e8c264", "--gold-dim":"#a8863a", "--gold-rgb":"232,194,100",
    "--cream":"#f4ead7", "--cream-rgb":"244,234,215", "--ink":"#050807",
    "--bg-glow":"#145b41", "--bg1":"#0b3d2c", "--bg2":"#062419", "--bg3":"#030d09",
    "--bg1-rgb":"11,61,44", "--bg3-rgb":"3,13,9",
    "--modal-a":"#0e4632", "--modal-b":"#062419", "--pop":"#a8863a", "--panel-tint-rgb":"0,0,0"
  }},
  {id:"neon", name:"Neon Nights", tag:"Cyberpunk strip lights", vars:{
    "--gold":"#ff2e9e", "--gold-dim":"#7d1656", "--gold-rgb":"255,46,158",
    "--cream":"#ecfbff", "--cream-rgb":"236,251,255", "--ink":"#0a0014",
    "--bg-glow":"#4d1478", "--bg1":"#1c0736", "--bg2":"#0d0320", "--bg3":"#05010c",
    "--bg1-rgb":"28,7,54", "--bg3-rgb":"5,1,12",
    "--modal-a":"#3a0f63", "--modal-b":"#0d0320", "--pop":"#22e8ff", "--panel-tint-rgb":"0,0,0"
  }},
  {id:"amethyst", name:"Royal Amethyst", tag:"Velvet purple & gold", vars:{
    "--gold":"#c9a6ff", "--gold-dim":"#7a55b8", "--gold-rgb":"201,166,255",
    "--cream":"#f3ecff", "--cream-rgb":"243,236,255", "--ink":"#0d0616",
    "--bg-glow":"#3d2166", "--bg1":"#26123f", "--bg2":"#150a24", "--bg3":"#0a0512",
    "--bg1-rgb":"38,18,63", "--bg3-rgb":"10,5,18",
    "--modal-a":"#3a1c5e", "--modal-b":"#150a24", "--pop":"#ffd76a", "--panel-tint-rgb":"0,0,0"
  }},
  {id:"inferno", name:"Inferno", tag:"Fire on the felt", vars:{
    "--gold":"#ffb238", "--gold-dim":"#a5480f", "--gold-rgb":"255,178,56",
    "--cream":"#fff1e0", "--cream-rgb":"255,241,224", "--ink":"#160400",
    "--bg-glow":"#7a1409", "--bg1":"#3d0d06", "--bg2":"#1f0603", "--bg3":"#0d0201",
    "--bg1-rgb":"61,13,6", "--bg3-rgb":"13,2,1",
    "--modal-a":"#5c1206", "--modal-b":"#1f0603", "--pop":"#ff3d3d", "--panel-tint-rgb":"0,0,0"
  }},
  {id:"sapphire", name:"Sapphire Frost", tag:"Ice-cold high roller", vars:{
    "--gold":"#7cd6ff", "--gold-dim":"#2f6fa0", "--gold-rgb":"124,214,255",
    "--cream":"#eaf7ff", "--cream-rgb":"234,247,255", "--ink":"#020912",
    "--bg-glow":"#0d3a66", "--bg1":"#08213d", "--bg2":"#041224", "--bg3":"#020a14",
    "--bg1-rgb":"8,33,61", "--bg3-rgb":"2,10,20",
    "--modal-a":"#0c3a5e", "--modal-b":"#041224", "--pop":"#c9f2ff", "--panel-tint-rgb":"0,0,0"
  }},
  {id:"blackout", name:"Blackout Gold", tag:"Midnight high-limit room", vars:{
    "--gold":"#f0c94a", "--gold-dim":"#8a6e1e", "--gold-rgb":"240,201,74",
    "--cream":"#f6f0dd", "--cream-rgb":"246,240,221", "--ink":"#050505",
    "--bg-glow":"#1a1a1a", "--bg1":"#111111", "--bg2":"#080808", "--bg3":"#000000",
    "--bg1-rgb":"17,17,17", "--bg3-rgb":"0,0,0",
    "--modal-a":"#1c1c1c", "--modal-b":"#080808", "--pop":"#ffffff", "--panel-tint-rgb":"0,0,0"
  }},
  {id:"light", name:"Light", tag:"Plain & bright, no accent color", vars:{
    "--gold":"#333333", "--gold-dim":"#777777", "--gold-rgb":"51,51,51",
    "--cream":"#181818", "--cream-rgb":"24,24,24", "--ink":"#ffffff",
    "--bg-glow":"#ffffff", "--bg1":"#fbfbfb", "--bg2":"#eeeeee", "--bg3":"#dddddd",
    "--bg1-rgb":"251,251,251", "--bg3-rgb":"221,221,221",
    "--modal-a":"#ffffff", "--modal-b":"#eeeeee", "--pop":"#555555", "--panel-tint-rgb":"255,255,255"
  }},
  {id:"dark", name:"Dark", tag:"Plain & deep, no accent color", vars:{
    "--gold":"#e8e8e8", "--gold-dim":"#999999", "--gold-rgb":"232,232,232",
    "--cream":"#f0f0f0", "--cream-rgb":"240,240,240", "--ink":"#111111",
    "--bg-glow":"#2a2a2a", "--bg1":"#1c1c1c", "--bg2":"#111111", "--bg3":"#000000",
    "--bg1-rgb":"28,28,28", "--bg3-rgb":"0,0,0",
    "--modal-a":"#232323", "--modal-b":"#101010", "--pop":"#bbbbbb", "--panel-tint-rgb":"0,0,0"
  }}
];
var currentTheme = "emerald";

function applyTheme(id){
  var theme = null;
  for(var i=0; i<THEMES.length; i++){ if(THEMES[i].id === id) theme = THEMES[i]; }
  if(!theme) theme = THEMES[0];
  var root = document.documentElement.style;
  for(var k in theme.vars){ root.setProperty(k, theme.vars[k]); }
  /* Lets a stylesheet target a specific theme. The dark themes all share the
     same depth treatment; light needs its own, since shadows and translucent
     white panels behave completely differently on a pale background. */
  document.documentElement.setAttribute("data-theme", theme.id);
  currentTheme = theme.id;
  renderThemeGrid();
}

function renderThemeGrid(){
  var grid = $("themeGrid");
  grid.innerHTML = THEMES.map(function(t){
    var bg = "radial-gradient(circle at 75% 15%, " + t.vars["--gold"] + " 0%, transparent 45%), " +
             "linear-gradient(135deg, " + t.vars["--bg1"] + ", " + t.vars["--bg3"] + ")";
    var on = t.id === currentTheme;
    return '<button class="theme-card' + (on ? ' on' : '') + '" data-theme-id="' + t.id + '" style="background:' + bg + '">' +
             (on ? '<span class="check">&#10003;</span>' : '') +
             '<span class="swatch-label">' + t.name + '<span class="swatch-tag">' + t.tag + '</span></span>' +
           '</button>';
  }).join("");
  Array.prototype.forEach.call(grid.querySelectorAll(".theme-card"), function(card){
    card.addEventListener("click", function(){
      playClick();
      applyTheme(card.dataset.themeId);
      save();
    });
  });
}

/* ---- appearance / fonts ---- */
/* All system stacks — the file ships nothing and fetches nothing. Only the
   original is the block-capitals casino signage; the other two read as normal
   sentence case and pull the letter-spacing in to suit lowercase. */
/* Family names are single-quoted so a stack can sit inside a double-quoted
   style="" attribute on the picker cards without terminating it early. */
var FONTS = [
  {id:"segoe", name:"Segoe UI", note:"The house style",
   stack:"'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif", caps:true,  track:1},
  {id:"georgia", name:"Georgia", note:"Serif, sentence case",
   stack:"Georgia,'Iowan Old Style','Times New Roman',Times,serif", caps:false, track:0.4},
  {id:"trebuchet", name:"Trebuchet MS", note:"Rounded, sentence case",
   stack:"'Trebuchet MS','Lucida Grande','Lucida Sans Unicode',Verdana,sans-serif", caps:false, track:0.4}
];
var currentFont = "segoe";

function applyFont(id){
  var font = null;
  for(var i=0; i<FONTS.length; i++){ if(FONTS[i].id === id) font = FONTS[i]; }
  if(!font) font = FONTS[0];
  var root = document.documentElement.style;
  root.setProperty("--ui-font", font.stack);
  root.setProperty("--ui-case", font.caps ? "uppercase" : "none");
  root.setProperty("--ui-track", String(font.track));
  currentFont = font.id;
  renderFontGrid();
  if(typeof fitGame === "function") fitGame();        /* a wider typeface leaves less room to zoom into */
}

function renderFontGrid(){
  var grid = $("fontGrid");
  grid.innerHTML = FONTS.map(function(f){
    var on = f.id === currentFont;
    return '<button class="font-card' + (on ? ' on' : '') + '" data-font-id="' + f.id + '" style="font-family:' + f.stack + '">' +
             (on ? '<span class="check">&#10003;</span>' : '') +
             '<span class="face">' + f.name + '</span>' +
             '<span class="sample">' + f.note + '</span>' +
           '</button>';
  }).join("");
  Array.prototype.forEach.call(grid.querySelectorAll(".font-card"), function(card){
    card.addEventListener("click", function(){
      playClick();
      applyFont(card.dataset.fontId);
      save();
    });
  });
}
