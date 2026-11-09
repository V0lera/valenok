import * as N from './net.js';

/* ================= Правила и данные ================= */
const RANKS=['6','7','8','9','10','J','Q','K','A'];
const RL={J:'В',Q:'Д',K:'К',A:'Т'};
const SUITS=['S','H','C','D'];
const SYM={S:'♠︎',C:'♣︎',D:'♦︎',H:'♥︎'};
const SNAME={S:'пики',C:'крести',D:'буби',H:'черви'};
const BOT_NAMES=['Миша','Оля','Петрович'];
const SAVE_KEY='valenok-save-v1', HOST_KEY='valenok-host-v1', GUEST_KEY='valenok-guest-v1';
const isRed=s=>s==='H'||s==='D';
const isKH=c=>c.r==='K'&&c.s==='H';
const rl=r=>RL[r]||r;
const ctxt=c=>rl(c.r)+SYM[c.s];
const $=id=>document.getElementById(id);

function val(c){
  if(c.r==='J')return 2;
  if(c.r==='Q')return {D:10,H:20,S:30,C:40}[c.s];
  if(c.r==='K')return c.s==='H'?50:4;
  if(c.r==='A')return 11;
  return +c.r;
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];}return a;}
function newDeck(){const d=[];for(const s of SUITS)for(const r of RANKS)d.push({r,s,id:r+s});return shuffle(d);}

/* G — состояние игры. В онлайне его ведёт только хозяин комнаты;
   у гостя G собирается из опубликованного состояния и своей руки. */
let G=null, timer=null, ME=0;
// NET.role: 'local' — игра с ботами, 'host' — хозяин комнаты, 'guest' — гость
const NET={role:'local',code:null,lobby:null,presence:{},pub:null,hand:[],lastV:-1,ev:[],evN:0,pubCache:'',handCache:{},hostUid:null};
function lsGet(k){try{return JSON.parse(localStorage.getItem(k)||'null');}catch(e){return null;}}
function lsSet(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
const ui={bots:2,mode:'bots',score:false,confirmNew:false,flash:'',lastPile:0,known:new Set(),fx:[],hold:new Set(),
  sound:lsGet('valenok-sound-on')!==false,sim:false,timer:20,exit:false,lastSec:null,gsel:[]};

const P=i=>G.players[i];
const topCard=()=>G.pile[G.pile.length-1];
const nextOf=i=>(i+1)%G.n;
const now=()=>NET.role==='local'?Date.now():N.now();
function log(m){G.log.push(m);if(G.log.length>40)G.log.shift();}
function schedule(f,ms){clearTimeout(timer);timer=setTimeout(f,ms);}
function toast(m){const b=$('toastBox');b.innerHTML='';const t=document.createElement('div');t.className='toast';t.textContent=m;b.appendChild(t);}
// событие для анимаций: показываем у себя и отправляем гостям
function emit(e){if(NET.role==='host'){NET.ev.push(e.t==='play'?{t:'play',pi:e.pi,cards:e.cards}:e);}}
function say(m){log(m);toast(m);emit({t:'toast',m});}
function snd(n){sfx(n);emit({t:'snd',n});}

// Кто управляет местом i: 'me' — этот экран, 'bot' — бот (или отключившийся друг), 'remote' — друг
function ctrl(i){
  const p=P(i);
  if(p.bot)return 'bot';
  if(i===ME)return 'me';
  if(NET.role==='host'&&p.online===false)return 'bot';
  return 'remote';
}

/* Можно ли положить карту c первой */
function canStart(c){
  const t=topCard();
  if(t.r==='Q'){                        // после дамы — только заказанная масть
    if(c.r==='Q'||isKH(c))return false;  // дама на даму и К♥ на даму нельзя
    return c.s===G.namedSuit;
  }
  if(c.r==='Q')return !isKH(t);          // дама — на любую, кроме К♥
  return c.s===t.s||c.r===t.r;
}
function validSeq(seq){return seq.length>0&&seq.every(Boolean)&&canStart(seq[0])&&seq.every(c=>c.r===seq[0].r);}
const legal=pi=>P(pi).hand.filter(canStart);

function sortHand(h){h.sort((a,b)=>SUITS.indexOf(a.s)-SUITS.indexOf(b.s)||RANKS.indexOf(a.r)-RANKS.indexOf(b.r));}
function refill(){
  if(G.pile.length<=2)return;
  const keep=G.pile.splice(-2);
  G.deck=shuffle(G.pile);G.pile=keep;ui.lastPile=G.pile.length;
  say('Колода кончилась — сброс перемешан');snd('shuffle');
}
function draw(pi,k){
  let got=0;
  for(let i=0;i<k;i++){if(!G.deck.length)refill();if(!G.deck.length)break;P(pi).hand.push(G.deck.pop());got++;}
  if(!P(pi).bot)sortHand(P(pi).hand);
  if(got){ui.fx.push({t:'draw',pi,n:got});emit({t:'draw',pi,n:got});if(pi===ME)bump('drawn',got);}
  return got;
}
function penal(i,k){
  const got=draw(i,k);P(i).skips++;
  ui.fx.push({t:'shake',pi:i});emit({t:'shake',pi:i});setTimeout(()=>snd('penalty'),150);
  say(`${P(i).name}: +${got} и пропуск хода`);
}

/* ================= Ход игры (у хозяина или в игре с ботами) ================= */
function mkPlayer(o){return {name:o.name,bot:!!o.bot,uid:o.uid||null,online:true,hand:[],score:0,skips:0};}
function newGame(players,timerSec){
  G={timer:timerSec,deadline:null,n:players.length,players:players.map(mkPlayer),
     deck:[],pile:[],namedSuit:null,eightOwner:null,suitBy:null,cur:0,dealer:Math.random()*players.length|0,
     phase:'play',drew:false,sel:[],round:0,log:[],result:null};
  ui.known=new Set();deal();
}
function deal(){
  G.deck=newDeck();G.pile=[];G.namedSuit=null;G.eightOwner=null;G.suitBy=null;G.round++;G.phase='play';G.result=null;G.sel=[];G.drew=false;
  G.players.forEach(p=>{p.hand=[];p.skips=0});
  ui.fx=[];ui.hold.clear();snd('shuffle');
  for(let k=0;k<6;k++)for(let j=1;j<=G.n;j++)P((G.dealer+j)%G.n).hand.push(G.deck.pop());
  G.players.forEach(p=>sortHand(p.hand));
  ui.known=new Set(P(ME).hand.map(c=>c.id));ui.lastPile=0;
  const c=G.deck.pop();G.pile.push(c);
  const d=G.dealer,nx=nextOf(d);
  log(`Раунд ${G.round}. Сдаёт ${P(d).name}, открыта ${ctxt(c)}`);
  if(c.r==='8'){G.eightOwner=d;G.cur=d;startClock();render();if(ctrl(d)==='bot')schedule(botTurn,1000);return;}
  if(c.r==='6')penal(nx,1);else if(c.r==='7')penal(nx,2);else if(isKH(c))penal(nx,5);
  else if(c.r==='A'){P(nx).skips++;say(`${P(nx).name} пропускает ход`);}
  if(c.r==='Q'){
    if(ctrl(d)==='bot'){setSuit(SUITS[Math.random()*4|0],d,true);}
    else{G.phase='blind';G.deadline=null;render();return;}
  }
  G.cur=nx;beginTurn();
}
function setSuit(s,pi,blind){
  G.namedSuit=s;
  say(`${P(pi).name} заказывает ${SYM[s]} ${SNAME[s]}${blind?' (вслепую)':''}`);snd('suit');
}
function beginTurn(){
  const p=P(G.cur);
  if(p.skips>0){
    p.skips--;log(`${p.name} пропускает ход`);snd('skip');
    G.cur=nextOf(G.cur);G.deadline=null;render();schedule(beginTurn,650);return;
  }
  G.drew=false;G.sel=[];startClock();render();
  const c=ctrl(G.cur);
  if(c==='bot')schedule(botTurn,850);else if(c==='me')sfx('turn');
}
function playFrom(pi,seq){
  if(ui.sim||RM)return [];
  if(pi===ME)return seq.map(c=>{const e=document.querySelector(`#hand [data-cid="${c.id}"]`);return e?e.getBoundingClientRect():null;});
  const s=seatEl(pi);return seq.map(()=>s?s.getBoundingClientRect():null);
}
function doPlay(pi,seq){
  const p=P(pi);
  if(!ui.sim&&!RM){ui.fx.push({t:'play',pi,cards:seq.slice(),from:playFrom(pi,seq)});seq.forEach(c=>ui.hold.add(c.id));}
  else sfx('card');
  emit({t:'play',pi,cards:seq.slice()});
  for(const c of seq){p.hand.splice(p.hand.findIndex(x=>x.id===c.id),1);G.pile.push(c);}
  G.namedSuit=null;G.sel=[];
  const last=seq[seq.length-1];
  log(`${p.name}: ${seq.map(ctxt).join(' ')}`);
  if(pi===ME){bump('thrown',seq.reduce((a,c)=>a+val(c),0));if(isKH(last)&&p.hand.length)bump('khGiven');}
  if(last.r==='8'){                       // восьмёрку кроет тот же игрок
    G.eightOwner=pi;G.drew=false;startClock();render();
    if(ctrl(pi)==='bot')schedule(botTurn,850);
    return;
  }
  G.eightOwner=null;
  if(p.hand.length===0){endRound(pi,seq);return;}
  const nx=nextOf(pi),k=seq.length;
  if(last.r==='6')penal(nx,k);
  else if(last.r==='7')penal(nx,2*k);
  else if(isKH(last))penal(nx,5);
  else if(last.r==='K'&&seq.some(isKH))say('Король червей отменён');
  else if(last.r==='A'){
    let i=pi;const names=[];
    for(let j=0;j<k;j++){i=nextOf(i);if(i===pi)i=nextOf(i);P(i).skips++;names.push(P(i).name);}
    say(`Пропуск: ${[...new Set(names)].join(', ')}`);
  }
  if(last.r==='Q'){
    if(ctrl(pi)==='bot')setSuit(botSuit(pi),pi);
    else{G.phase='suit';G.suitBy=pi;G.deadline=null;render();return;}
  }
  G.cur=nx;beginTurn();
}
function pass(pi){
  log(`${P(pi).name}: пас`);
  if(G.eightOwner===pi)G.eightOwner=null;
  G.cur=nextOf(pi);beginTurn();
}
// Применить действие игрока (своё или пришедшее от друга)
function applyAction(pi,a){
  if(!G||pi<0)return;
  if(a.t==='play'){
    if(G.phase!=='play'||G.cur!==pi||!Array.isArray(a.ids))return;
    const seq=a.ids.map(id=>P(pi).hand.find(c=>c.id===id));
    if(new Set(a.ids).size!==a.ids.length||!validSeq(seq))return;
    doPlay(pi,seq);
  }else if(a.t==='draw'){
    if(G.phase!=='play'||G.cur!==pi||G.drew||legal(pi).length)return;
    const got=draw(pi,1);G.drew=true;log(got?`${P(pi).name} берёт карту`:'Карт в колоде нет');render();
  }else if(a.t==='pass'){
    if(G.phase!=='play'||G.cur!==pi||!G.drew)return;
    pass(pi);
  }else if(a.t==='suit'){
    if(G.phase!=='suit'||G.suitBy!==pi||!SUITS.includes(a.s))return;
    setSuit(a.s,pi);G.phase='play';G.suitBy=null;G.cur=nextOf(pi);beginTurn();
  }else if(a.t==='blind'){
    if(G.phase!=='blind'||G.dealer!==pi||!SUITS.includes(a.s))return;
    setSuit(a.s,pi,true);G.phase='play';G.cur=nextOf(G.dealer);beginTurn();
  }
}
// Ход с этого экрана: в онлайне гость отправляет его хозяину
function act(a){
  if(NET.role==='guest'){ui.gsel=[];N.send(NET.code,a).catch(()=>flash('Нет связи с сервером'));render();}
  else applyAction(ME,a);
}

/* ================= Таймер хода ================= */
function startClock(){G.deadline=(G.timer&&G.phase==='play'&&ctrl(G.cur)!=='bot')?now()+G.timer*1000:null;}
let lastTick=performance.now();
setInterval(()=>{
  const t=performance.now(),dt=Math.min(t-lastTick,500);lastTick=t;
  if(!G||ui.sim)return;
  // в игре с ботами таймер ждёт, пока открыто окно или свёрнута вкладка
  if(NET.role==='local'&&G.deadline&&(ui.score||ui.exit||document.hidden)){G.deadline+=dt;return;}
  updateClock();
  if(G.phase==='play'&&G.cur===ME&&G.deadline){
    const sec=Math.ceil((G.deadline-now())/1000);
    if(sec!==ui.lastSec&&sec<=5&&sec>0)sfx('tick');
    ui.lastSec=sec;
  }
  if(NET.role!=='guest'&&G.phase==='play'&&G.deadline&&now()>=G.deadline)timeUp(G.cur);
},100);
function timeUp(pi){
  G.deadline=null;if(pi===ME)G.sel=[];
  const got=draw(pi,1);
  say(`${pi===ME&&NET.role==='local'?'Время вышло':P(pi).name+': время вышло'}: ${got?'+1 карта и ':''}пропуск хода`);
  snd('penalty');ui.fx.push({t:'shake',pi});emit({t:'shake',pi});
  if(G.eightOwner===pi)G.eightOwner=null;
  G.cur=nextOf(pi);beginTurn();
}
function updateClock(){
  const el=$('clock');if(!el)return;
  const on=G&&G.timer&&G.phase==='play'&&G.deadline;
  el.style.visibility=on?'visible':'hidden';
  if(!on)return;
  const left=Math.max(0,G.deadline-now());
  el.querySelector('i').style.transform=`scaleX(${Math.min(1,left/(G.timer*1000))})`;
  el.querySelector('b').textContent=Math.ceil(left/1000);
  el.classList.toggle('low',left<=5000);
  el.classList.toggle('other',G.cur!==ME);
}
function endRound(wi,seq){
  const last=seq[seq.length-1];let bonus=0;
  if(last.r==='Q')bonus=-seq.reduce((a,c)=>a+val(c),0);
  else if(isKH(last))bonus=-50;
  const rows=G.players.map((p,i)=>{
    const d=i===wi?bonus:p.hand.reduce((a,c)=>a+val(c),0);
    let after=p.score+d,reset=false;
    if(after===100){after=0;reset=true;}
    const r={name:p.name,cards:p.hand.map(ctxt).join(' '),d,before:p.score,after,reset};
    p.score=after;return r;
  });
  const over=G.players.some(p=>p.score>100);
  G.result={wi,rows,over,finish:seq.map(ctxt).join(' ')};
  G.phase=over?'over':'round';G.deadline=null;
  log(`${P(wi).name} избавился от всех карт`);
  render();
}
function endSound(){
  if(!G||!G.result)return;
  const r=G.result,lost=r.over&&r.rows[ME].after>100;
  setTimeout(()=>sfx(lost?'lose':(r.wi===ME||r.over)?'win':'lose'),500);
}
function nextRound(){G.dealer=nextOf(G.dealer);deal();}
function rematch(){G.players.forEach(p=>p.score=0);G.round=0;G.dealer=Math.random()*G.n|0;deal();}

/* ================= Боты ================= */
function botSuit(pi){
  const cnt={S:0,C:0,D:0,H:0};
  P(pi).hand.forEach(c=>{if(c.r!=='Q')cnt[c.s]+=1+val(c)/20;});
  let best=SUITS[Math.random()*4|0],b=-1;
  for(const s of SUITS)if(cnt[s]>b){b=cnt[s];best=s;}
  return best;
}
function orderRest(h,first,rest){
  const remain=h.filter(x=>x.r!==first.r);
  const cnt=s=>remain.filter(x=>x.s===s).length;
  let r=[...rest];
  if(first.r==='K'){const kh=r.find(isKH);if(kh){r=r.filter(x=>x!==kh);r.push(kh);return r;}}
  r.sort((a,b)=>cnt(a.s)-cnt(b.s));     // сверху — масть, которой больше всего на руке
  return r;
}
function scoreSeq(pi,seq){
  const h=P(pi).hand,last=seq[seq.length-1],after=h.length-seq.length;
  const sum=seq.reduce((a,c)=>a+val(c),0);
  if(after===0&&last.r!=='8')return 10000+(last.r==='Q'?sum:0)+(isKH(last)?50:0);
  const danger=P(nextOf(pi)).hand.length<=2?2:1;
  let s=sum*.6+seq.length*4;
  if(last.r==='6')s+=10*seq.length*danger;
  if(last.r==='7')s+=16*seq.length*danger;
  if(last.r==='A')s+=8*seq.length*danger;
  if(isKH(last))s+=40*danger;
  if(last.r==='Q')s-=35;
  if(last.r==='8'){
    const remain=h.filter(x=>!seq.includes(x));
    s+=remain.some(x=>x.s===last.s||x.r==='Q'||x.r==='8')?6:-25;
  }
  return s;
}
function bestMove(pi){
  const h=P(pi).hand,starts=h.filter(canStart);
  if(!starts.length)return null;
  const cands=[];
  for(const c of starts){
    cands.push([c]);
    const rest=h.filter(x=>x.r===c.r&&x.id!==c.id);
    if(rest.length)cands.push([c,...orderRest(h,c,rest)]);
  }
  let best=null,bs=-1e9;
  for(const seq of cands){const s=scoreSeq(pi,seq)+Math.random()*3;if(s>bs){bs=s;best=seq;}}
  return best;
}
function botTurn(){
  if(!G||G.phase!=='play'||NET.role==='guest')return;
  const pi=G.cur,p=P(pi);if(ctrl(pi)!=='bot')return;
  const mv=bestMove(pi);
  if(!mv){
    if(!G.drew){draw(pi,1);G.drew=true;log(`${p.name} берёт карту`);render();schedule(botTurn,700);return;}
    pass(pi);return;
  }
  doPlay(pi,mv);
}
// Друг отключился посреди своего хода — за него доигрывает бот
function takeOverIfAway(i){
  if(!G||ctrl(i)!=='bot'||P(i).bot)return;
  if(G.phase==='play'&&G.cur===i){G.deadline=null;schedule(botTurn,900);}
  else if(G.phase==='suit'&&G.suitBy===i){setSuit(botSuit(i),i);G.phase='play';G.suitBy=null;G.cur=nextOf(i);beginTurn();}
  else if(G.phase==='blind'&&G.dealer===i){setSuit(SUITS[Math.random()*4|0],i,true);G.phase='play';G.cur=nextOf(i);beginTurn();}
}

/* ================= Действия на этом экране ================= */
const byId=id=>P(ME).hand.find(c=>c.id===id);
const myTurn=()=>G&&G.phase==='play'&&G.cur===ME;
const sel=()=>NET.role==='guest'?ui.gsel:G.sel;
function setSel(v){if(NET.role==='guest')ui.gsel=v;else G.sel=v;}
function flash(m){ui.flash=m;renderStatus();clearTimeout(flash.t);flash.t=setTimeout(()=>{ui.flash='';if(G)renderStatus();},1600);}
function tapCard(id){
  if(!myTurn())return;
  const c=byId(id);if(!c)return;const s=sel().slice();const k=s.indexOf(id);
  if(k>=0){s.splice(k,1);setSel(s.length&&!validSeq(s.map(byId))?[]:s);}
  else if(!s.length){if(canStart(c))setSel([id]);else flash('Эту карту сюда положить нельзя');}
  else if(c.r===byId(s[0]).r)setSel([...s,id]);
  else if(canStart(c))setSel([id]);
  else flash('Добавлять можно только карты того же значения');
  render();
}
function myName(){return $('nameIn').value.trim().slice(0,14);}
function pressed(segId,el){document.querySelectorAll(`#${segId} button`).forEach(b=>b.setAttribute('aria-pressed',b===el));}
const ACTS={
  mode(el){ui.mode=el.dataset.m;pressed('modeSeg',el);$('panelBots').hidden=ui.mode!=='bots';$('panelFriends').hidden=ui.mode!=='friends';},
  bots(el){ui.bots=+el.dataset.n;pressed('botSeg',el);},
  timer(el){ui.timer=+el.dataset.t;pressed('timerSeg',el);},
  start(){
    NET.role='local';ME=0;lsSet('valenok-name',myName());
    const pl=[{name:myName()||'Вы'}];for(let i=0;i<ui.bots;i++)pl.push({name:BOT_NAMES[i],bot:true});
    newGame(pl,ui.timer);
  },
  continue(){const s=lsGet(SAVE_KEY);if(s&&s.players&&s.phase!=='over'){NET.role='local';ME=0;G=s;resume();}},
  create(){hostCreate();},
  join(){guestJoin($('codeIn').value.trim());},
  rejoin(){rejoin();},
  play(){if(!myTurn())return;const seq=sel().map(byId);if(validSeq(seq))act({t:'play',ids:sel().slice()});},
  draw(){
    if(!myTurn()||G.drew)return;
    if(legal(ME).length){flash('Вам есть чем ходить');return;}
    act({t:'draw'});
  },
  pass(){if(myTurn()&&G.drew)act({t:'pass'});},
  suit(el){
    const s=el.dataset.s;
    if(G.phase==='suit'&&G.suitBy===ME)act({t:'suit',s});
    else if(G.phase==='blind'&&G.dealer===ME)act({t:'blind',s});
  },
  next(){if(NET.role!=='guest')nextRound();},
  rematch(){if(NET.role==='host')rematch();},
  score(){ui.score=true;ui.confirmNew=false;render();},
  close(){ui.score=false;render();},
  newgame(){
    if(G&&G.phase!=='over'&&!ui.confirmNew){ui.confirmNew=true;render();return;}
    clearTimeout(timer);G=null;ui.score=false;ui.confirmNew=false;lsSet(SAVE_KEY,null);showSetup();
  },
  card(el){tapCard(el.dataset.id);},
  exit(){ui.exit=true;ui.score=false;render();},
  stay(){ui.exit=false;render();},
  leave(){ui.exit=false;leaveGame();},
  addbot(){lobbyAddBot();},
  kick(el){lobbyRemove(+el.dataset.i);},
  begin(){hostStart();},
  lobbyleave(){leaveGame();},
  sound(el){
    ui.sound=!ui.sound;el.setAttribute('aria-pressed',ui.sound);lsSet('valenok-sound-on',ui.sound);
    if(ui.sound)sfx('turn');
  }
};
$('sndBtn').setAttribute('aria-pressed',ui.sound);
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el||el.disabled)return;
  const f=ACTS[el.dataset.act];if(f)f(el);
});
$('codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')ACTS.join();});

/* ================= Отрисовка ================= */
/* Рисованные карты: SVG 100×140, углы, пипсы по классической раскладке, фигуры В/Д/К */
const PIP6=[[33,30],[67,30],[33,70],[67,70],[33,110],[67,110]];
const PIP4=[[33,28],[67,28],[33,56],[67,56],[33,84],[67,84],[33,112],[67,112]];
const PIPS={'6':PIP6,'7':[...PIP6,[50,50]],'8':[...PIP6,[50,50],[50,90]],'9':[...PIP4,[50,70]],'10':[...PIP4,[50,42],[50,98]]};
const FACE_COL={S:'--c1:#2b3f6b;--c3:#b3263a',C:'--c1:#2f5d3a;--c3:#b3263a',H:'--c1:#b3263a;--c3:#2b3f6b',D:'--c1:#c0702a;--c3:#2b3f6b'};
const use=(s,x,y,z)=>`<use href="#s-${s}" x="${x-z/2}" y="${y-z/2}" width="${z}" height="${z}"/>`;
function corner(c){
  const lab=rl(c.r),ul=c.r==='6'||c.r==='9',two=lab.length>1;
  return `<text x="12.5" y="22" text-anchor="middle" font-size="${two?18:21}"${two?' letter-spacing="-1.5"':''}>${lab}</text>`+
    (ul?'<rect x="7.5" y="25" width="10" height="2.2" rx="1"/>':'')+use(c.s,12.5,ul?36:34,13);
}
function faceBody(c){
  let b='';
  if(PIPS[c.r]){
    for(const [x,y] of PIPS[c.r]) b+= y>70?`<g transform="rotate(180 ${x} ${y})">${use(c.s,x,y,17)}</g>`:use(c.s,x,y,17);
  }else if(c.r==='A'){
    b=`<circle cx="50" cy="70" r="31" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/><circle cx="50" cy="70" r="27" fill="none" stroke="currentColor" stroke-width=".6" stroke-dasharray="2 2.5" opacity=".35"/>`+use(c.s,50,70,40);
  }else{
    const half=`<use href="#f-${c.r}" x="21" y="21" width="58" height="49"/>${use(c.s,27,24,10)}`;
    b=`<g style="${FACE_COL[c.s]};--c2:#d9a43a"><rect x="20" y="16" width="60" height="108" rx="3" fill="#fbf6ea" stroke="currentColor" stroke-width="1.2"/>
      ${half}<g transform="rotate(180 50 70)">${half}</g>
      <line x1="20" y1="70" x2="80" y2="70" stroke="currentColor" stroke-width=".8"/></g>`;
  }
  return b;
}
function cardHTML(c,cls='',extra=''){
  return `<div class="card ${isRed(c.s)?'red':''} ${cls}" data-cid="${c.id}"><svg viewBox="0 0 100 140" fill="currentColor" aria-hidden="true">
    ${corner(c)}${faceBody(c)}<g transform="rotate(180 50 70)">${corner(c)}</g></svg>${extra}</div>`;
}

/* ================= Анимации ================= */
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const seatEl=i=>document.querySelector(`#seats .seat[data-seat="${i}"]`);
function flyer(html,at){
  const el=document.createElement('div');el.className='flyer';el.innerHTML=html;
  Object.assign(el.style,{left:at.left+'px',top:at.top+'px',width:at.width+'px',height:at.height+'px'});
  const k=el.firstElementChild;k.style.width='100%';k.style.height='100%';
  document.body.appendChild(el);return el;
}
const center=r=>[r.left+r.width/2,r.top+r.height/2];
function runFx(){
  const list=ui.fx;ui.fx=[];
  if(RM||ui.sim){ui.hold.clear();document.querySelectorAll('#pile [data-hold]').forEach(e=>e.style.visibility='');return;}
  let drawDelay=0;
  for(const f of list){
    if(f.t==='play'){
      const to=$('pile').getBoundingClientRect();
      const fromSeat=f.pi!==ME;
      f.cards.forEach((c,k)=>{
        const fr=(f.from&&f.from[k])||to;const [fx,fy]=center(fr),[tx,ty]=center(to);
        const s0=fromSeat?.35:fr.width/to.width;
        const el=flyer(cardHTML(c),to);
        const a=el.animate([
          {transform:`translate(${fx-tx}px,${fy-ty}px) scale(${s0}) rotate(${fromSeat?-25:0}deg)`,opacity:fromSeat?.3:1},
          {transform:`translate(0,0) scale(1) rotate(${rot(c.id)}deg)`,opacity:1}],
          {duration:340,delay:k*120,easing:'cubic-bezier(.2,.7,.3,1)',fill:'backwards'});
        let done=false;
        const finish=()=>{if(done)return;done=true;el.remove();ui.hold.delete(c.id);const w=document.querySelector(`#pile [data-hold="${c.id}"]`);if(w)w.style.visibility='';sfx('card');};
        a.onfinish=finish;setTimeout(finish,340+k*120+120);   // страховка, если кадры не рисуются (свёрнутая вкладка)
      });
    }else if(f.t==='draw'){
      const from=$('deck').getBoundingClientRect();
      const tgt=(f.pi===ME?$('handWrap'):seatEl(f.pi));if(!tgt)continue;
      const tr=tgt.getBoundingClientRect();const [fx,fy]=center(from),[tx,ty]=center(tr);
      for(let i=0;i<Math.min(f.n,6);i++){
        const el=flyer('<div class="back" style="width:100%;height:100%;border-radius:8px"></div>',from);
        const a=el.animate([{transform:'translate(0,0)',opacity:1},{transform:`translate(${tx-fx}px,${ty-fy}px) scale(${f.pi===ME?.8:.35})`,opacity:.15}],
          {duration:380,delay:drawDelay,easing:'ease-in-out',fill:'backwards'});
        setTimeout(()=>sfx('draw'),drawDelay);drawDelay+=110;
        a.onfinish=()=>el.remove();setTimeout(()=>el.remove(),drawDelay+500);
      }
    }else if(f.t==='shake'){
      const el=f.pi===ME?$('handWrap'):seatEl(f.pi);
      if(el){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');el.addEventListener('animationend',()=>el.classList.remove('shake'),{once:true});}
    }
  }
}

/* ================= Звуки (синтез, без файлов) ================= */
let AC=null;
function actx(){
  if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){return null;}}
  if(AC.state==='suspended')AC.resume();return AC;
}
function tone(ctx,f,t0,dur,type='sine',vol=.15){
  const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,t0);
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.01);g.gain.exponentialRampToValueAtTime(.001,t0+dur);
  o.connect(g).connect(ctx.destination);o.start(t0);o.stop(t0+dur+.05);
}
function swish(ctx,t0,freq,dur,vol){
  const b=ctx.createBuffer(1,Math.max(1,ctx.sampleRate*dur|0),ctx.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
  const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();
  s.buffer=b;f.type='bandpass';f.frequency.value=freq;f.Q.value=.9;g.gain.value=vol;
  s.connect(f).connect(g).connect(ctx.destination);s.start(t0);
}
function sfx(kind){
  if(!ui.sound||ui.sim)return;const ctx=actx();if(!ctx)return;const t=ctx.currentTime;
  switch(kind){
    case 'card':swish(ctx,t,1800,.08,.9);tone(ctx,120,t,.07,'sine',.18);break;
    case 'draw':swish(ctx,t,3800,.13,.45);break;
    case 'penalty':tone(ctx,392,t,.15,'triangle',.14);tone(ctx,262,t+.14,.25,'triangle',.14);break;
    case 'skip':tone(ctx,196,t,.12,'square',.04);tone(ctx,165,t+.1,.16,'square',.04);break;
    case 'suit':[784,1047].forEach((f,i)=>tone(ctx,f,t+i*.09,.3,'sine',.09));break;
    case 'turn':tone(ctx,880,t,.1,'sine',.05);break;
    case 'tick':tone(ctx,1250,t,.045,'square',.035);break;
    case 'shuffle':for(let i=0;i<7;i++)swish(ctx,t+i*.045,2600+i*150,.06,.5);break;
    case 'join':[660,880].forEach((f,i)=>tone(ctx,f,t+i*.08,.18,'sine',.07));break;
    case 'win':[523,659,784,1047].forEach((f,i)=>tone(ctx,f,t+i*.1,.32,'triangle',.11));break;
    case 'lose':[392,330,262,196].forEach((f,i)=>tone(ctx,f,t+i*.15,.38,'triangle',.11));break;
  }
}
function rot(id){let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))%997;return (h%15)-7;}
function esc(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

function showScreen(id){for(const s of ['setup','lobby','app','profile'])$(s).hidden=s!==id;if(id!=='app')$('overlay').hidden=true;}
let prevPhase=null;
function render(){
  if(!G)return;
  showScreen('app');
  $('roundLbl').textContent=NET.code?`Раунд ${G.round} · комната ${NET.code}`:`Раунд ${G.round}`;
  if((G.phase==='round'||G.phase==='over')&&prevPhase!==G.phase){endSound();roundStats(G.result);}
  prevPhase=G.phase;
  renderSeats();renderTable();renderHand();renderStatus();renderModal();updateClock();save();runFx();
  if(NET.role==='host')queuePublish();
}
function renderSeats(){
  const box=$('seats');let h='';
  for(let k=1;k<G.n;k++){
    const i=(ME+k)%G.n,p=P(i);
    const away=!p.bot&&p.online===false;
    h+=`<div class="seat ${G.cur===i&&G.phase==='play'?'turn':''}" data-seat="${i}">
      <div class="seat-top"><span class="seat-name">${esc(p.name)}</span>${!p.bot&&NET.role!=='local'?`<i class="dot ${away?'off':''}" title="${away?'не в сети':'в сети'}"></i>`:''}${i===G.dealer?'<span class="chip">сдаёт</span>':''}</div>
      <div class="seat-mid"><div class="fan">${'<i></i>'.repeat(Math.min(p.hand.length,7))}</div><b class="cnt">${p.hand.length}</b></div>
      <div class="seat-score">${p.score} очк.</div>
      <div class="badges">${away?'<span class="chip">играет бот</span>':''}${p.skips?`<span class="chip warn">пропуск${p.skips>1?' ×'+p.skips:''}</span>`:''}${G.eightOwner===i?'<span class="chip gold">кроет 8</span>':''}</div>
    </div>`;
  }
  box.innerHTML=h;
}
function renderTable(){
  const pile=$('pile');
  const show=G.pile.slice(-4);const grew=G.pile.length!==ui.lastPile;
  pile.innerHTML=show.map((c,k)=>{
    const held=ui.hold.has(c.id);
    return `<div data-hold="${c.id}" style="position:absolute;inset:0;transform:rotate(${rot(c.id)}deg)${held?';visibility:hidden':''}">${cardHTML(c,(k===show.length-1&&grew&&!held&&G.pile.length===1)?'fresh':'')}</div>`;
  }).join('');
  ui.lastPile=G.pile.length;
  $('deckN').textContent=`${G.deck.length} в колоде`;
  const deck=$('deck');
  deck.classList.toggle('can',myTurn()&&!G.drew&&!legal(ME).length);
  deck.style.visibility=G.deck.length?'visible':'hidden';
  $('suitBadge').innerHTML=G.namedSuit&&topCard().r==='Q'?`<div class="suitorder">Заказ: ${SYM[G.namedSuit]} ${SNAME[G.namedSuit]}</div>`:'';
}
function renderHand(){
  const hand=P(ME).hand,el=$('hand');
  const mine=myTurn(),s=sel();
  if(G.phase==='blind'&&G.dealer===ME){el.innerHTML='<div class="back"></div>'.repeat(hand.length);fitHand();return;}
  const first=s.length?byId(s[0]):null;
  el.innerHTML=hand.map(c=>{
    let cls='';
    if(mine){const ok=first?c.r===first.r:canStart(c);cls=ok?'ok':'dim';}
    const k=s.indexOf(c.id);if(k>=0)cls+=' sel';
    if(!ui.known.has(c.id))cls+=' fresh';
    return `<button class="cardbtn" data-act="card" data-id="${c.id}" aria-label="${ctxt(c)}" style="all:unset;flex:none;position:relative">${cardHTML(c,cls,k>=0&&s.length>1?`<span class="ord">${k+1}</span>`:'')}</button>`;
  }).join('');
  ui.known=new Set(hand.map(c=>c.id));
  fitHand();
}
function fitHand(){
  const el=$('hand'),wrap=$('handWrap');
  const kids=[...el.children];if(!kids.length)return;
  const cw=kids[0].getBoundingClientRect().width||60;const W=wrap.clientWidth-10;
  let step=kids.length>1?Math.min(cw+6,(W-cw)/(kids.length-1)):0;step=Math.max(step,26);
  kids.forEach((k,i)=>k.style.marginLeft=i?`${step-cw}px`:'0');
}
function renderStatus(){
  const st=$('status');
  let m='';
  if(ui.flash)m=ui.flash;
  else if(G.phase==='play'){
    if(G.cur!==ME)m=`Ходит ${P(G.cur).name}…`;
    else if(G.eightOwner===ME&&topCard().r==='8')m=G.drew&&!legal(ME).length?'Покрыть нечем — нажмите «Пас»':`Покройте восьмёрку: ${SYM[topCard().s]}, восьмёрка или дама`;
    else if(legal(ME).length)m=sel().length?'Можно добавить карты того же значения':'Ваш ход — выберите карту';
    else m=G.drew?'Ходить нечем — нажмите «Пас»':'Нечем ходить — возьмите карту';
  }
  else if(G.phase==='suit'&&G.suitBy!==ME)m=`${P(G.suitBy).name} выбирает масть…`;
  else if(G.phase==='blind'&&G.dealer!==ME)m=`${P(G.dealer).name} называет масть вслепую…`;
  st.textContent=m;st.classList.toggle('flash',!!ui.flash);
  $('log').textContent=G.log.slice(-2).join('  ·  ');
  const me=P(ME);
  $('me').innerHTML=`<span><b>${esc(me.name)}</b>${G.dealer===ME?' · сдаёте':''}${me.skips?' · пропуск хода':''}</span><span>${me.hand.length} карт · <b>${me.score}</b> очк.</span>`;
  const mine=myTurn();
  $('drawBtn').disabled=!(mine&&!G.drew&&!legal(ME).length);
  $('passBtn').disabled=!(mine&&G.drew);
  const pb=$('playBtn');const seq=sel().map(byId);
  pb.disabled=!(mine&&validSeq(seq));
  pb.textContent=pb.disabled?'Сходить':`Сходить ${seq.map(ctxt).join(' ')}`;
}
const MEMO=`<summary>Памятка по правилам</summary><ul>
<li>Ходите <b>в масть или в значение</b>. Нечем — возьмите одну карту, затем сходите или пас.</li>
<li><b>Таймер</b>: на ход 20 секунд. Не успели — берёте 1 карту, и ход переходит следующему.</li>
<li>Можно выложить <b>сразу несколько карт одного значения</b>: первая должна подходить, последняя ляжет сверху. Нажимайте карты по порядку.</li>
<li><b>6</b> — следующий берёт 1 карту и пропускает ход. <b>7</b> — берёт 2 и пропускает. Несколько — суммируются.</li>
<li><b>8</b> — кроете её сами: той же мастью, восьмёркой или дамой. Нечем — ход переходит дальше.</li>
<li><b>Дама</b> — на любую карту, кроме дамы и короля червей. Вы заказываете масть.</li>
<li><b>Король ♥</b> — следующий берёт 5 и пропускает ход. Положите поверх него другого короля — эффект отменится. На даму не кладётся.</li>
<li><b>Туз</b> — следующий пропускает ход. Несколько тузов — пропускают несколько игроков.</li>
<li><b>Очки</b>: 6–10 по номиналу, В 2, К 4, Т 11, Д♦ 10, Д♥ 20, Д♠ 30, Д♣ 40, К♥ 50. Закончили дамой или К♥ — минус их стоимость. Ровно 100 — счёт обнуляется, больше 100 — вы валенок.</li></ul>`;
function suitButtons(){return `<div class="suits">${SUITS.map(s=>`<button data-act="suit" data-s="${s}" class="${isRed(s)?'red':''}"><b>${SYM[s]}</b>${SNAME[s]}</button>`).join('')}</div>`;}
function scoreTable(){
  return `<table class="score"><thead><tr><th>Игрок</th><th>Очки</th></tr></thead><tbody>${G.players.map(p=>`<tr><td>${esc(p.name)}<div class="bar100"><i style="width:${Math.max(0,Math.min(100,p.score))}%"></i></div></td><td>${p.score}</td></tr>`).join('')}</tbody></table>`;
}
function renderModal(){
  const ov=$('overlay'),sh=$('sheet');let h='';
  const guest=NET.role==='guest',online=NET.role!=='local';
  if(G.phase==='suit'&&G.suitBy===ME){h=`<h2>Назовите масть</h2><p>Следующий игрок должен будет ходить этой мастью.</p>${suitButtons()}`;}
  else if(G.phase==='blind'&&G.dealer===ME){h=`<h2>Открылась дама</h2><p>Вы раздавали — назовите масть вслепую. Карты покажутся после выбора.</p>${suitButtons()}`;}
  else if((G.phase==='round'||G.phase==='over')&&!ui.exit){
    const r=G.result;const w=P(r.wi);
    const loserIdx=r.over?G.players.reduce((b,p,i)=>p.score>P(b).score?i:b,0):-1;
    let btn;
    if(r.over)btn=guest?`<p>Ждём, начнёт ли хозяин новую партию.</p><button class="btn" data-act="exit">Выйти в меню</button>`
               :online?`<div class="row"><button class="btn" data-act="exit">Выйти</button><button class="btn primary" data-act="rematch">Ещё партию</button></div>`
               :`<button class="btn primary" data-act="newgame">Новая игра</button>`;
    else btn=guest?`<p>Ждём, когда хозяин комнаты начнёт следующий раунд.</p>`:`<button class="btn primary" data-act="next">Следующий раунд</button>`;
    h=`<h2>${r.over?`Валенок — ${esc(P(loserIdx).name)}!`:`${esc(w.name)} ${r.wi===ME?'выиграли':'выиграл'} раунд`}</h2>
      <p>Последний ход: ${r.finish}${r.rows[r.wi].d<0?` — минус ${-r.rows[r.wi].d} очков`:''}.</p>
      <table class="score"><thead><tr><th>Игрок</th><th>За раунд</th><th>Итого</th></tr></thead><tbody>
      ${r.rows.map(x=>`<tr><td>${esc(x.name)}${x.cards?`<small>${x.cards}</small>`:''}</td><td class="${x.d<0?'neg':''}">${x.d>0?'+':''}${x.d}</td><td class="${x.after>100?'lose':''}">${x.after}${x.reset?'<small>ровно 100 — обнуление</small>':''}</td></tr>`).join('')}
      </tbody></table>${btn}`;
  }
  else if(ui.exit){
    const txt=NET.role==='host'?'Комната закроется, и друзья вернутся в меню.'
            :guest?'Вместо вас будет играть бот. Вернуться можно по тому же коду.'
            :'Партия сохранится: продолжить можно будет с главного экрана кнопкой «Продолжить партию».';
    h=`<h2>Выйти из партии?</h2><p>${txt}</p>
      <div class="row"><button class="btn" data-act="stay">Остаться</button><button class="btn primary" data-act="leave">Выйти в меню</button></div>`;
  }
  else if(ui.score){
    h=`<h2>Счёт</h2>${scoreTable()}<details class="memo" open>${MEMO}</details>
      <div class="row">${online?'':`<button class="btn" data-act="newgame">${ui.confirmNew?'Точно? Счёт сбросится':'Новая игра'}</button>`}<button class="btn primary" data-act="close">Вернуться</button></div>`;
  }
  ov.hidden=!h;if(h)sh.innerHTML=h;
}

/* ================= Сохранение ================= */
function save(){
  if(!G||ui.sim)return;
  if(NET.role==='local')lsSet(SAVE_KEY,G);
  else if(NET.role==='host')lsSet(HOST_KEY,{code:NET.code,G,at:Date.now()});
}
function showSetup(){
  showScreen('setup');
  const s=lsGet(SAVE_KEY);$('contBtn').hidden=!(s&&s.players&&s.phase!=='over');
  const h=lsGet(HOST_KEY),g=lsGet(GUEST_KEY),rb=$('rejoinBtn');
  const r=(h&&Date.now()-h.at<6*3600e3)?h:(g&&Date.now()-g.at<6*3600e3)?g:null;
  rb.hidden=!r;if(r)rb.textContent=`Вернуться в комнату ${r.code}`;
}
function resume(){
  ui.known=new Set(P(ME).hand.map(c=>c.id));ui.lastPile=G.pile.length;prevPhase=G.phase;
  if(NET.role==='local'&&G.phase==='play'&&G.deadline)G.deadline=Date.now()+(G.tRemain!=null?G.tRemain:G.timer*1000);
  render();
  if(G.phase==='play'){
    if(P(G.cur).skips>0)schedule(beginTurn,700);      // прерванный пропуск хода
    else if(ctrl(G.cur)==='bot')schedule(botTurn,700);
  }
}
// при уходе в меню в игре с ботами запоминаем остаток таймера
function stashClock(){if(G&&NET.role==='local')G.tRemain=G.deadline?Math.max(0,G.deadline-Date.now()):null;}
window.addEventListener('pagehide',()=>{stashClock();save();});

/* ================= Статистика игрока ================= */
// Приращения копятся на телефоне (работает и без интернета) и складываются в облако.
const PEND_KEY='valenok-stats-pending', CLOUD_KEY='valenok-stats-cloud';
const statMode=()=>NET.role==='local'?'bots':'online';
function addInto(dst,src){
  for(const [k,v] of Object.entries(src||{})){
    if(k==='bestMinus')dst[k]=Math.min(dst[k]??0,v);else dst[k]=(dst[k]||0)+v;
  }
  return dst;
}
function bump(k,v=1){
  if(ui.sim||!v)return;
  const P=lsGet(PEND_KEY)||{},m=statMode();
  P[m]=addInto(P[m]||{},{[k]:v});lsSet(PEND_KEY,P);
}
function roundStats(r){
  if(!r||!r.rows||ui.sim)return;
  const rows=r.rows,me=rows[ME];if(!me)return;
  const add={rounds:1};
  if(r.wi===ME){add.roundWins=1;if(me.d<0){add.minusCount=1;add.minusSum=-me.d;add.bestMinus=me.d;}}
  if(me.reset)add.resets=1;
  if(r.over){
    const sc=rows.map(x=>x.after),lo=Math.min(...sc),hi=Math.max(...sc);
    add.games=1;
    if(me.after===lo)add.wins=1;
    if(me.after===hi&&hi>100)add.valenki=1;
  }
  const P=lsGet(PEND_KEY)||{},m=statMode();P[m]=addInto(P[m]||{},add);lsSet(PEND_KEY,P);
  flushStats();
}
let flushing=false;
async function flushStats(){
  const P=lsGet(PEND_KEY);
  if(flushing||!P||!Object.keys(P).length)return;
  flushing=true;lsSet(PEND_KEY,null);
  try{
    await N.addStats(P,myName()||null);
    const C=lsGet(CLOUD_KEY)||{};for(const m of Object.keys(P))C[m]=addInto(C[m]||{},P[m]);lsSet(CLOUD_KEY,C);
  }catch(e){
    const now=lsGet(PEND_KEY)||{};for(const m of Object.keys(P))now[m]=addInto(now[m]||{},P[m]);lsSet(PEND_KEY,now);
  }
  flushing=false;
}

/* ================= Экран профиля ================= */
const STAT_ROWS=[
  ['games','Сыграно партий'],['wins','Побед в партиях'],['valenki','Был валенком'],
  ['rounds','Сыграно раундов'],['roundWins','Первым вышел из раунда'],['thrown','Очков выкинуто на стол'],
  ['minusCount','Закончил в минус'],['minusSum','Ушло в минус всего'],['bestMinus','Рекорд минуса'],
  ['khGiven','Дал соперникам +5 (К♥)'],['drawn','Взял карт'],['resets','Обнулился на 100']];
function statsView(mode){
  const C=lsGet(CLOUD_KEY)||{},P=lsGet(PEND_KEY)||{};
  const pick=m=>addInto(addInto({},C[m]),P[m]);
  return mode==='all'?addInto(pick('bots'),pick('online')):pick(mode);
}
function fmtStat(k,s){
  const v=s[k]||0;
  if(k==='wins')return s.games?`${v} <small>${Math.round(v/s.games*100)}%</small>`:`${v}`;
  if(k==='roundWins')return s.rounds?`${v} <small>${Math.round(v/s.rounds*100)}%</small>`:`${v}`;
  if(k==='minusSum')return v?`−${v}`:'0';
  if(k==='bestMinus')return v?`−${-v}`:'—';
  return `${v}`;
}
function renderProfile(){
  const s=statsView(ui.ptab),mail=ui.pmail;
  const name=myName()||'Игрок';
  $('profName').textContent=name;$('profAva').textContent=name.slice(0,1).toUpperCase();
  $('profSub').textContent=mail?`Профиль привязан к ${mail}`:'Профиль на этом телефоне';
  document.querySelectorAll('#profTabs button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===ui.ptab));
  $('profStats').innerHTML=STAT_ROWS.map(([k,l])=>`<div class="stat ${['wins','valenki','bestMinus'].includes(k)?'key':''}"><b>${fmtStat(k,s)}</b><span>${l}</span></div>`).join('');
  $('profAcc').innerHTML=mail
    ?`<p>Войдите с этой почтой на другом телефоне, и статистика будет там же.</p>
      <button class="btn" data-act="plogout">Выйти из профиля</button>`
    :`<p>Статистика хранится в облаке. Чтобы не потерять её при переустановке приложения или смене телефона, привяжите почту и пароль.</p>
      <input type="email" id="pMail" placeholder="почта" autocomplete="email">
      <input type="password" id="pPw" placeholder="пароль, от 6 символов" autocomplete="current-password">
      <div class="row"><button class="btn" data-act="plogin">Войти</button><button class="btn primary" data-act="plink">Привязать</button></div>`;
}
async function openProfile(){
  ui.ptab=ui.ptab||'all';showScreen('profile');renderProfile();netMsg('Обновляем…','profMsg');
  try{
    await flushStats();
    lsSet(CLOUD_KEY,await N.getStats());ui.pmail=N.email();
    renderProfile();netMsg('','profMsg');
  }catch(e){netMsg(N.errText(e)+' Показаны данные, сохранённые на телефоне.','profMsg');}
}
async function profAuth(kind){
  const mail=($('pMail')||{}).value?.trim(),pw=($('pPw')||{}).value||'';
  if(kind!=='out'&&(!mail||!pw)){netMsg('Введите почту и пароль.','profMsg');return;}
  netMsg('Подождите…','profMsg');
  try{
    if(kind==='link')await N.linkEmail(mail,pw);
    else if(kind==='in'){await flushStats();await N.signInEmail(mail,pw);lsSet(CLOUD_KEY,null);lsSet(HOST_KEY,null);lsSet(GUEST_KEY,null);}
    else{await flushStats();await N.signOutToAnon();lsSet(CLOUD_KEY,null);lsSet(HOST_KEY,null);lsSet(GUEST_KEY,null);}
    lsSet(CLOUD_KEY,await N.getStats());ui.pmail=N.email();renderProfile();
    netMsg(kind==='link'?'Готово: профиль привязан к почте.':kind==='in'?'Вы вошли в профиль.':'Вы вышли. На телефоне начат новый профиль.','profMsg');
  }catch(e){netMsg(N.authErrText(e),'profMsg');}
}
Object.assign(ACTS,{
  profile(){openProfile();},
  pback(){showSetup();},
  ptab(el){ui.ptab=el.dataset.m;renderProfile();},
  plink(){profAuth('link');},
  plogin(){profAuth('in');},
  plogout(){profAuth('out');}
});
setTimeout(()=>{if(lsGet(PEND_KEY))flushStats();},3000);

/* ================= Игра с друзьями ================= */
function netMsg(m,id='netMsg'){$(id).textContent=m||'';}
function busy(on){document.querySelectorAll('#panelFriends button').forEach(b=>b.disabled=on);}

async function hostCreate(){
  const name=myName()||'Хозяин';lsSet('valenok-name',myName());
  busy(true);netMsg('Создаём комнату…');
  try{
    const code=await N.createRoom(name,ui.timer);
    NET.role='host';NET.code=code;ME=0;NET.lobby={seats:[{uid:N.net.uid,name,kind:'human'}],timer:ui.timer};
    lsSet(HOST_KEY,{code,G:null,at:Date.now()});
    hostSubscribe();renderLobby();netMsg('');
  }catch(e){netMsg(N.errText(e));}
  busy(false);
}
function hostSubscribe(){
  const code=NET.code;
  N.watchAdded(`rooms/${code}/joins`,(uid,v)=>{
    N.del(`rooms/${code}/joins/${uid}`).catch(()=>{});
    const L=NET.lobby;if(!L||G)return;
    if(L.seats.some(s=>s.uid===uid)||L.seats.length>=4)return;
    L.seats.push({uid,name:String(v&&v.name||'Игрок').slice(0,14)||'Игрок',kind:'human'});
    sfx('join');N.write(`rooms/${code}/seats`,L.seats);renderLobby();
  });
  N.watch(`rooms/${code}/presence`,v=>{
    NET.presence=v||{};
    if(G){
      G.players.forEach((p,i)=>{
        if(p.bot||i===ME)return;
        const on=!!NET.presence[p.uid];
        if(p.online!==on){p.online=on;say(`${p.name} ${on?'вернулся в игру':'отключился — за него играет бот'}`);if(!on)takeOverIfAway(i);else if(G.phase==='play'&&G.cur===i)startClock();render();}
      });
    }else renderLobby();
  });
  N.watchAdded(`rooms/${code}/actions`,(k,a)=>{
    N.del(`rooms/${code}/actions/${k}`).catch(()=>{});
    if(!G||!a)return;
    const seat=G.players.findIndex(p=>!p.bot&&p.uid===a.uid);
    if(seat>0)applyAction(seat,a);
  });
}
function lobbyAddBot(){
  const L=NET.lobby;if(!L||L.seats.length>=4)return;
  const used=new Set(L.seats.map(s=>s.name));const name=BOT_NAMES.find(n=>!used.has(n))||'Бот';
  L.seats.push({kind:'bot',name});N.write(`rooms/${NET.code}/seats`,L.seats);renderLobby();
}
function lobbyRemove(i){
  const L=NET.lobby;if(!L||i<=0||!L.seats[i])return;
  L.seats.splice(i,1);N.write(`rooms/${NET.code}/seats`,L.seats);renderLobby();
}
async function hostStart(){
  const L=NET.lobby;if(!L||L.seats.length<2)return;
  ME=0;
  newGameOnline(L.seats);
  await N.write(`rooms/${NET.code}/status`,'playing').catch(()=>{});
}
function newGameOnline(seats){
  const pl=seats.map(s=>({name:s.name,bot:s.kind==='bot',uid:s.uid}));
  newGame(pl,NET.lobby.timer);
  G.players.forEach((p,i)=>{if(!p.bot&&i!==ME)p.online=!!NET.presence[p.uid];});
}
function renderLobby(){
  showScreen('lobby');
  const L=NET.lobby||{seats:[]};const host=NET.role==='host';
  $('lobbyCode').textContent=NET.code;
  $('lobbyHint').textContent=host?'Скажите друзьям этот код: они выбирают «С друзьями» и вводят его.':'Вы в комнате. Ждём, когда хозяин начнёт игру.';
  let h='';
  for(let i=0;i<4;i++){
    const s=L.seats[i];
    if(!s){h+=`<li class="empty">Свободное место</li>`;continue;}
    const me=s.uid&&s.uid===N.net.uid,on=s.kind==='bot'||!!NET.presence[s.uid];
    const tag=s.kind==='bot'?'бот':i===0?'хозяин':me?'вы':'';
    h+=`<li>${s.kind==='bot'?'':`<i class="dot ${on?'':'off'}"></i>`}<b>${esc(s.name)}${me&&i!==0?' (вы)':''}</b><span class="chip">${tag||'игрок'}</span>${host&&i>0?`<button class="x" data-act="kick" data-i="${i}" aria-label="Убрать">×</button>`:''}</li>`;
  }
  $('lobbySeats').innerHTML=h;
  $('lobbyBtns').innerHTML=host
    ?`<button class="btn" data-act="addbot" ${L.seats.length>=4?'disabled':''}>Добавить бота</button>
      <button class="btn primary" data-act="begin" ${L.seats.length<2?'disabled':''}>Начать игру (${L.seats.length})</button>
      <button class="btn" data-act="lobbyleave">Закрыть комнату</button>`
    :`<button class="btn" data-act="lobbyleave">Выйти из комнаты</button>`;
}
let pubQueued=false;
function queuePublish(){if(pubQueued)return;pubQueued=true;setTimeout(publish,0);}
function publish(){
  pubQueued=false;if(NET.role!=='host'||!G)return;
  const code=NET.code;
  const pub={n:G.n,round:G.round,dealer:G.dealer,cur:G.cur,phase:G.phase,namedSuit:G.namedSuit,eightOwner:G.eightOwner,
    suitBy:G.suitBy,drew:G.drew,timer:G.timer,deadline:G.deadline,pile:G.pile.slice(-4),deckLen:G.deck.length,
    log:G.log.slice(-4),result:G.result,
    players:G.players.map(p=>({name:p.name,score:p.score,skips:p.skips,count:p.hand.length,bot:p.bot,uid:p.uid,online:p.online}))};
  const s=JSON.stringify(pub);
  const upd={};
  if(s!==NET.pubCache||NET.ev.length){
    NET.pubCache=s;NET.evN++;
    upd[`rooms/${code}/pub`]={...pub,v:NET.evN,ev:NET.ev.slice(-30)};NET.ev=[];
  }
  G.players.forEach(p=>{
    if(p.bot||!p.uid||p.uid===N.net.uid)return;
    const hs=JSON.stringify(p.hand);
    if(NET.handCache[p.uid]!==hs){NET.handCache[p.uid]=hs;upd[`hands/${code}/${p.uid}`]=p.hand;}
  });
  if(Object.keys(upd).length)N.patchRoot(upd).catch(e=>flash(N.errText(e)));
}

async function guestJoin(code,silent){
  if(!/^\d{4}$/.test(code)){netMsg('Код комнаты — 4 цифры.');return;}
  const name=myName()||'Игрок';lsSet('valenok-name',myName());
  busy(true);netMsg('Подключаемся…');
  try{
    const room=await N.joinRoom(code,name);
    NET.role='guest';NET.code=code;NET.hostUid=room.host;NET.lobby={seats:room.seats||[],timer:room.timer};
    NET.pub=null;NET.hand=[];NET.lastV=-1;NET.firstPub=true;ui.gsel=[];G=null;
    lsSet(GUEST_KEY,{code,at:Date.now()});
    guestSubscribe();netMsg('');
    if(room.status==='lobby')renderLobby();
  }catch(e){netMsg(N.errText(e));}
  busy(false);
}
function guestSubscribe(){
  const code=NET.code;
  N.watch(`rooms/${code}/seats`,v=>{NET.lobby.seats=v||[];if(!G&&NET.status!=='playing')renderLobby();});
  N.watch(`rooms/${code}/presence`,v=>{NET.presence=v||{};if(!G)renderLobby();else{NET.hostAway=!NET.presence[NET.hostUid];guestRender();}});
  N.watch(`rooms/${code}/status`,v=>{
    NET.status=v;
    if(v==='closed'){guestClosed('Хозяин закрыл комнату.');return;}
    if(v==='lobby'&&!G)renderLobby();
  });
  N.watch(`rooms/${code}/pub`,v=>{if(v){NET.pub=v;guestRender();}});
  N.watch(`hands/${code}/${N.net.uid}`,v=>{NET.hand=Array.isArray(v)?v:[];guestRender();});
}
function guestClosed(m){
  N.leave();NET.role='local';NET.code=null;G=null;lsSet(GUEST_KEY,null);showSetup();
  ACTS.mode(document.querySelector('#modeSeg [data-m="friends"]'));netMsg(m);
}
let gRenderQueued=false;
function guestRender(){if(gRenderQueued)return;gRenderQueued=true;setTimeout(guestApply,0);}
function guestApply(){
  gRenderQueued=false;
  const pub=NET.pub;if(!pub||NET.role!=='guest')return;
  const me=pub.players.findIndex(p=>p.uid===N.net.uid);if(me<0)return;
  // анимации — до перерисовки, пока карты ещё на своих местах
  if(pub.v!==NET.lastV){
    const first=NET.lastV<0;NET.lastV=pub.v;
    if(!first&&G)for(const e of pub.ev||[]){
      if(e.t==='play'&&e.pi===me){bump('thrown',e.cards.reduce((a,c)=>a+val(c),0));if(isKH(e.cards[e.cards.length-1])&&NET.hand.length)bump('khGiven');}
      if(e.t==='draw'&&e.pi===me)bump('drawn',e.n);
      if(e.t==='play'){
        const from=e.pi===me?e.cards.map(c=>{const el=document.querySelector(`#hand [data-cid="${c.id}"]`);return el?el.getBoundingClientRect():null;}):(()=>{const s=seatEl(e.pi);const r=s?s.getBoundingClientRect():null;return e.cards.map(()=>r);})();
        if(!RM){ui.fx.push({t:'play',pi:e.pi,cards:e.cards,from});e.cards.forEach(c=>ui.hold.add(c.id));}else sfx('card');
      }else if(e.t==='draw'||e.t==='shake')ui.fx.push(e);
      else if(e.t==='snd')sfx(e.n);
      else if(e.t==='toast')toast(e.m);
    }
  }
  const wasMyTurn=G&&G.phase==='play'&&G.cur===ME;
  ME=me;
  const hand=NET.hand.slice();
  G={n:pub.n,round:pub.round,dealer:pub.dealer,cur:pub.cur,phase:pub.phase,namedSuit:pub.namedSuit??null,eightOwner:pub.eightOwner??null,
     suitBy:pub.suitBy??null,drew:!!pub.drew,timer:pub.timer,deadline:pub.deadline||null,pile:pub.pile||[],deck:new Array(pub.deckLen||0),
     log:pub.log||[],result:pub.result||null,sel:[],
     players:pub.players.map((p,i)=>({...p,hand:i===me?hand:new Array(p.count||0).fill(0)}))};
  if(G.result&&!Array.isArray(G.result.rows))G.result.rows=Object.values(G.result.rows||{});
  ui.gsel=ui.gsel.filter(id=>hand.some(c=>c.id===id));
  if(NET.firstPub){NET.firstPub=false;prevPhase=G.phase;}  // зашли посреди итогов раунда — не считаем его повторно
  if(!wasMyTurn&&G.phase==='play'&&G.cur===ME)sfx('turn');
  render();
  if(NET.hostAway)$('status').textContent='Хозяин комнаты отключился — ждём его возвращения…';
}

async function rejoin(){
  const h=lsGet(HOST_KEY),g=lsGet(GUEST_KEY);
  if(h&&Date.now()-h.at<6*3600e3){
    busy(true);netMsg('Возвращаемся в комнату…');
    try{
      const room=await N.getRoom(h.code);
      if(!room||room.host!==N.net.uid||room.status==='closed')throw new Error('Комната больше не существует.');
      NET.role='host';NET.code=h.code;ME=0;NET.lobby={seats:room.seats||[],timer:room.timer};
      await N.hostRejoin(h.code);
      hostSubscribe();netMsg('');
      if(h.G){G=h.G;NET.pubCache='';NET.handCache={};resume();}else renderLobby();
    }catch(e){netMsg(N.errText(e));lsSet(HOST_KEY,null);showSetup();}
    busy(false);
  }else if(g)guestJoin(g.code);
}

async function leaveGame(){
  clearTimeout(timer);
  document.querySelectorAll('.flyer').forEach(e=>e.remove());ui.hold.clear();ui.fx=[];
  if(NET.role==='host'){
    try{await N.write(`rooms/${NET.code}/status`,'closed');}catch(e){}
    await N.leave();lsSet(HOST_KEY,null);
  }else if(NET.role==='guest'){await N.leave();lsSet(GUEST_KEY,null);}
  else{stashClock();save();}
  const wasOnline=NET.role!=='local';
  NET.role='local';NET.code=null;NET.lobby=null;G=null;ME=0;
  showSetup();
  if(wasOnline)ACTS.mode(document.querySelector('#modeSeg [data-m="friends"]'));
}

/* ================= Убранство стола (рисуется один раз) ================= */
function ring(cx,cy,rx,ry,n,f){let s='';for(let i=0;i<n;i++){const a=i/n*Math.PI*2;s+=f((cx+rx*Math.cos(a)).toFixed(1),(cy+ry*Math.sin(a)).toFixed(1),(a*180/Math.PI).toFixed(1));}return s;}
function doilySVG(){
  const solid=`<ellipse cx="150" cy="110" rx="134" ry="94"/>`+ring(150,110,137,97,46,(x,y)=>`<circle cx="${x}" cy="${y}" r="8"/>`);
  const holes=ring(150,110,137,97,46,(x,y)=>`<circle cx="${x}" cy="${y}" r="2.4"/>`)
    +ring(150,110,121,84,38,(x,y,a)=>`<ellipse cx="${x}" cy="${y}" rx="3.2" ry="6" transform="rotate(${a} ${x} ${y})"/>`)
    +ring(150,110,101,70,26,(x,y,a)=>`<ellipse cx="${x}" cy="${y}" rx="9" ry="4" transform="rotate(${a} ${x} ${y})"/>`)
    +ring(150,110,81,56,32,(x,y)=>`<circle cx="${x}" cy="${y}" r="2.3"/>`)
    +`<ellipse cx="150" cy="110" rx="66" ry="45" fill="none" stroke="#000" stroke-width="2.6"/>`
    +ring(150,110,42,28,12,(x,y,a)=>`<ellipse cx="${x}" cy="${y}" rx="8" ry="3.2" transform="rotate(${a} ${x} ${y})"/>`)
    +`<circle cx="150" cy="110" r="5"/>`;
  return `<svg class="doily" viewBox="0 0 300 220"><defs><mask id="dm"><rect width="300" height="220" fill="#000"/><g fill="#fff">${solid}</g><g fill="#000">${holes}</g></mask></defs>
    <rect width="300" height="220" fill="#9eacb8" mask="url(#dm)"/>
    <g fill="none" stroke="rgba(52,66,80,.4)" stroke-width=".7" mask="url(#dm)"><ellipse cx="150" cy="110" rx="111" ry="77"/><ellipse cx="150" cy="110" rx="90" ry="62"/><ellipse cx="150" cy="110" rx="54" ry="37"/></g></svg>`;
}
function mugSVG(){
  return `<svg class="mug" viewBox="0 0 100 110"><defs><radialGradient id="tea" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#a8621f"/><stop offset="1" stop-color="#4f270a"/></radialGradient></defs>
    <path d="M76 62h10a9 9 0 0 1 9 9v2a9 9 0 0 1-9 9H76" fill="none" stroke="#ece5d8" stroke-width="7"/>
    <circle cx="48" cy="72" r="32" fill="#f1ece2"/><circle cx="48" cy="72" r="31" fill="none" stroke="#2b5aa8" stroke-width="3"/>
    <circle cx="48" cy="72" r="25.5" fill="url(#tea)"/>
    <circle cx="56" cy="66" r="9" fill="#e9c234"/><circle cx="56" cy="66" r="7.4" fill="#f8e58a"/>
    <g stroke="#e9c234" stroke-width="1">${ring(56,66,7,7,8,(x,y)=>`<line x1="56" y1="66" x2="${x}" y2="${y}"/>`)}</g>
    <ellipse cx="37" cy="61" rx="8" ry="3.5" fill="rgba(255,255,255,.22)" transform="rotate(-30 37 61)"/>
    <g class="steam"><path d="M40 64c-6-8 6-14 0-22s6-14 0-20"/><path d="M50 62c6-8-6-14 0-22s-6-14 0-20"/><path d="M58 66c-6-8 6-14 0-22s6-14 0-20"/></g></svg>`;
}
function bagelsSVG(){
  const bagel=(x,y)=>`<circle cx="${x}" cy="${y}" r="16.5" fill="none" stroke="#a9652a" stroke-width="12"/>
    <circle cx="${x-1.5}" cy="${y-1.5}" r="16.5" fill="none" stroke="#d99c55" stroke-width="5"/>
    <circle cx="${x}" cy="${y}" r="10.5" fill="none" stroke="#7a431a" stroke-width="1"/>
    ${ring(x,y,16.5,16.5,9,(a,b)=>`<circle cx="${a}" cy="${b}" r=".9" fill="#2a2018"/>`)}`;
  return `<svg class="bagels" viewBox="0 0 120 110"><ellipse cx="60" cy="56" rx="56" ry="51" fill="#f7f4ee"/>
    <ellipse cx="60" cy="56" rx="54.5" ry="49.5" fill="none" stroke="#2a4f9c" stroke-width="3"/>
    <ellipse cx="60" cy="56" rx="46" ry="41.5" fill="none" stroke="#2a4f9c" stroke-width="1.1" stroke-dasharray="3 4"/>
    <g fill="#2a4f9c">${ring(60,56,50.5,45.5,18,(x,y,a)=>`<ellipse cx="${x}" cy="${y}" rx="3.2" ry="1.4" transform="rotate(${+a+90} ${x} ${y})"/>`)}</g>
    ${bagel(44,46)}${bagel(77,50)}${bagel(58,78)}</svg>`;
}
function seedsSVG(){
  let r=12345;const rnd=()=>(r=(r*16807)%2147483647)/2147483647;
  const seed=(x,y,a,s)=>`<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})"><path d="M0-7C4-6 4.5 3 0 7-4.5 3-4-6 0-7z" fill="#1f1b1a"/><path d="M-1.6-5L-2.2 5M1.6-5L2.2 5" stroke="#9a958d" stroke-width=".8"/></g>`;
  const husk=(x,y,a)=>`<g transform="translate(${x} ${y}) rotate(${a})"><path d="M-1 -7C-5-6-5.5 3-1 7z" fill="#2a2522" transform="rotate(-14)"/><path d="M1 -7C5-6 5.5 3 1 7z" fill="#2a2522" transform="rotate(16) translate(3 0)"/><path d="M1.6 -5.5C4-4.5 4 2.5 1.6 5.5z" fill="#d9cdb8" transform="rotate(16) translate(3 0)"/></g>`;
  let s='';
  for(let i=0;i<15;i++)s+=seed((14+rnd()*100).toFixed(1),(18+rnd()*62).toFixed(1),(rnd()*360|0),(.85+rnd()*.3).toFixed(2));
  for(let i=0;i<6;i++)s+=husk((10+rnd()*108).toFixed(1),(14+rnd()*66).toFixed(1),(rnd()*360|0));
  return `<svg class="seeds" viewBox="0 0 130 90">${s}</svg>`;
}
function matchesSVG(){
  const match=(x1,y1,x2,y2)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ead6ab" stroke-width="2.4" stroke-linecap="round"/><circle cx="${x2}" cy="${y2}" r="2.7" fill="#7b1f1f"/>`;
  return `<svg class="matches" viewBox="0 0 70 64"><rect x="6" y="6" width="50" height="34" rx="2" fill="#c9a46a"/>
    <rect x="6" y="6" width="50" height="4" fill="#6b3d1f"/><rect x="6" y="36" width="50" height="4" fill="#6b3d1f"/>
    <rect x="13" y="13" width="36" height="20" rx="1.5" fill="#b3263a"/><text x="31" y="26.5" text-anchor="middle" font-size="7" font-weight="700" fill="#f7f2e8" font-family="Golos Text,sans-serif" letter-spacing=".5">СПИЧКИ</text>
    ${match(8,52,48,47)}${match(22,59,60,56)}</svg>`;
}

/* ================= Запуск ================= */
$('memo1').innerHTML=MEMO;
$('decor').innerHTML=doilySVG()+mugSVG()+bagelsSVG()+seedsSVG()+matchesSVG();
$('nameIn').value=lsGet('valenok-name')||'';
window.addEventListener('resize',()=>{if(G)fitHand();});
if('serviceWorker' in navigator&&location.protocol==='https:'&&!window.Capacitor)navigator.serviceWorker.register('sw.js').catch(()=>{});
// для автотестов
window.__valenok={get G(){return G;},set G(v){G=v;},NET,ui,ACTS,newGame,nextRound,beginTurn,botTurn,applyAction,
  setSchedule(f){schedule=f;},sim(on){ui.sim=on;}};
showSetup();
