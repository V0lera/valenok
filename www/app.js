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
  sound:lsGet('valenok-sound-on')!==false,sim:false,timer:20,exit:false,lastSec:null,gsel:[],
  level:lsGet('valenok-level')||'normal',vibro:lsGet('valenok-vibro')!==false,table:lsGet('valenok-table')||'izba',back:lsGet('valenok-back')||'cranberry',
  ava:lsGet('valenok-ava')||{i:5,c:0},ptab:'all',music:lsGet('valenok-music')!==false,bigCards:!!lsGet('valenok-big'),
  dealUntil:0,flipAt:0,hintAt:0,modalAt:0,animRound:null,curScreen:null};

const P=i=>G.players[i];
const topCard=()=>G.pile[G.pile.length-1];
const nextOf=i=>(i+1)%G.n;
const now=()=>NET.role==='local'?Date.now():N.now();
function log(m){G.log.push(m);if(G.log.length>40)G.log.shift();}
function schedule(f,ms){clearTimeout(timer);timer=setTimeout(f,ms);}
function toast(m){const b=$('toastBox');b.innerHTML='';const t=document.createElement('div');t.className='toast';t.textContent=m;b.appendChild(t);
  ui.toastM=m;ui.toastAt=Date.now();clearTimeout(toast.t);toast.t=setTimeout(()=>{if(G&&!$('app').hidden)renderLog();},1900);}
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
  if(got){ui.fx.push({t:'draw',pi,n:got});emit({t:'draw',pi,n:got});if(pi===ME){bump('drawn',got);bump('maxHand',P(ME).hand.length);}}
  return got;
}
function penal(i,k){
  const got=draw(i,k);P(i).skips++;
  {const e={t:'big',pi:i,text:'+'+got};ui.fx.push(e);emit(e);}
  ui.fx.push({t:'shake',pi:i});emit({t:'shake',pi:i});setTimeout(()=>snd('penalty'),150);
  say(`${P(i).name}: +${got} и пропуск хода`);
}

/* ================= Ход игры (у хозяина или в игре с ботами) ================= */
function mkPlayer(o){return {name:o.name,bot:!!o.bot,uid:o.uid||null,ava:o.ava||botAva(o.name),online:true,hand:[],score:0,skips:0};}
function newGame(players,timerSec){
  G={timer:timerSec,deadline:null,n:players.length,players:players.map(mkPlayer),
     deck:[],pile:[],namedSuit:null,eightOwner:null,suitBy:null,cur:0,dealer:ui.tut?1:Math.random()*players.length|0,
     phase:'play',drew:false,sel:[],round:0,log:[],result:null,level:ui.level,voids:{}};
  ui.known=new Set();deal();
}
function deal(){
  G.deck=ui.tut?tutDeck():newDeck();G.pile=[];G.namedSuit=null;G.eightOwner=null;G.suitBy=null;G.round++;G.phase='play';G.result=null;G.sel=[];G.drew=false;
  G.players.forEach(p=>{p.hand=[];p.skips=0});G.voids={};
  ui.fx=[];ui.hold.clear();snd('shuffle');
  for(let k=0;k<6;k++)for(let j=1;j<=G.n;j++)P((G.dealer+j)%G.n).hand.push(G.deck.pop());
  G.players.forEach(p=>sortHand(p.hand));
  ui.known=new Set(P(ME).hand.map(c=>c.id));ui.lastPile=0;bump('maxHand',P(ME).hand.length);
  {const order=[];for(let k=0;k<6;k++)for(let j=1;j<=G.n;j++)order.push((G.dealer+j)%G.n);ui.fx.push({t:'deal',order});emit({t:'deal',order});ui.dealStart=Date.now()+shufMs();ui.dealUntil=ui.dealStart+order.length*55+450;ui.flipAt=ui.dealUntil;}
  const c=G.deck.pop();G.pile.push(c);
  const d=G.dealer,nx=nextOf(d);
  log(`Раунд ${G.round}. Сдаёт ${P(d).name}, открыта ${ctxt(c)}`);
  if(c.r==='8'){G.eightOwner=d;G.cur=d;startClock();render();if(ctrl(d)==='bot')schedule(botTurn,1000);return;}
  if(c.r==='6')penal(nx,1);else if(c.r==='7')penal(nx,2);else if(isKH(c))penal(nx,5);
  else if(c.r==='A'){P(nx).skips++;say(`${P(nx).name} пропускает ход`);}
  if(c.r==='Q'){
    if(ctrl(d)==='bot'){setSuit(SUITS[Math.random()*4|0],d,true);}
    else{G.phase='blind';G.deadline=G.timer?now()+G.timer*1000:null;render();return;}
  }
  G.cur=nx;beginTurn();
}
function setSuit(s,pi,blind){
  G.namedSuit=s;
  {const e={t:'suit',s};ui.fx.push(e);emit(e);}
  say(`${P(pi).name} заказывает ${SYM[s]} ${SNAME[s]}${blind?' (вслепую)':''}`);snd('suit');
}
function beginTurn(){
  const p=P(G.cur);
  if(p.skips>0){
    p.skips--;log(`${p.name} пропускает ход`);snd('skip');if(G.cur===ME)buzz('skip');
    {const e={t:'skip',pi:G.cur};ui.fx.push(e);emit(e);}
    G.cur=nextOf(G.cur);G.deadline=null;G.drew=false;G.skipping=true;render();schedule(beginTurn,650);return;
  }
  G.skipping=false;G.drew=false;G.sel=[];startClock();render();
  const c=ctrl(G.cur);
  if(c==='bot')schedule(botTurn,850);else if(c==='me'){sfx('turn');buzz('turn');ui.hintAt=Date.now();}
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
  if(G.voids&&G.voids[pi])G.voids[pi]=G.voids[pi].filter(su=>!seq.some(c=>c.s===su));
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
  else if(last.r==='K'&&seq.some(isKH)){say('Король червей отменён');const e={t:'crown'};ui.fx.push(e);emit(e);}
  else if(last.r==='A'){
    let i=pi;const names=[];
    for(let j=0;j<k;j++){i=nextOf(i);if(i===pi)i=nextOf(i);P(i).skips++;names.push(P(i).name);}
    say(`Пропуск: ${[...new Set(names)].join(', ')}`);
  }
  if(last.r==='Q'){
    if(ctrl(pi)==='bot')setSuit(botSuit(pi),pi);
    else{G.phase='suit';G.suitBy=pi;G.deadline=G.timer?now()+G.timer*1000:null;render();return;}
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
  if(!G||pi<0||G.skipping)return;
  if(a.t==='play'){
    if(G.phase!=='play'||G.cur!==pi||!Array.isArray(a.ids))return;
    const seq=a.ids.map(id=>P(pi).hand.find(c=>c.id===id));
    if(new Set(a.ids).size!==a.ids.length||!validSeq(seq))return;
    doPlay(pi,seq);
  }else if(a.t==='draw'){
    if(G.phase!=='play'||G.cur!==pi||G.drew||legal(pi).length)return;
    markVoid(pi);const got=draw(pi,1);G.drew=true;log(got?`${P(pi).name} берёт карту`:'Карт в колоде нет');render();
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
  if(NET.role==='local'&&G.deadline&&(ui.score||ui.exit||ui.rules||document.hidden)){if(!document.hidden)G.deadline+=dt;return;}
  updateClock();
  if(G.phase==='play'&&G.cur===ME&&G.deadline){
    const sec=Math.ceil((G.deadline-now())/1000);
    if(sec!==ui.lastSec&&sec<=5&&sec>0)sfx('tick',{loud:sec<=3});
    ui.lastSec=sec;
  }
  if(NET.role!=='guest'&&G.deadline&&now()>=G.deadline){
    if(G.phase==='play'&&!G.skipping)timeUp(G.cur);
    else if(G.phase==='suit'||G.phase==='blind')autoSuit();
  }
},100);
// не успел выбрать масть — выбирается сама
function autoSuit(){
  G.deadline=null;
  if(G.phase==='suit'){const pi=G.suitBy;setSuit(botSuit(pi),pi);G.phase='play';G.suitBy=null;G.cur=nextOf(pi);beginTurn();}
  else if(G.phase==='blind'){const d=G.dealer;setSuit(SUITS[Math.random()*4|0],d,true);G.phase='play';G.cur=nextOf(d);beginTurn();}
}
// свернули приложение — запоминаем остаток хода, вернулись — продолжаем с него
document.addEventListener('visibilitychange',()=>{
  if(!G||NET.role!=='local'||!G.deadline)return;
  if(document.hidden){G.tRemain=Math.max(0,G.deadline-Date.now());save();}
  else if(G.tRemain!=null){G.deadline=Date.now()+G.tRemain;delete G.tRemain;}
});
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
  const on=G&&G.timer&&(G.phase==='play'||G.phase==='suit'||G.phase==='blind')&&G.deadline;
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
    const r={name:p.name,cards:p.hand.map(ctxt).join(' '),list:p.hand.map(c=>({r:c.r,s:c.s,id:c.id})),d,before:p.score,after,reset};
    p.score=after;return r;
  });
  const over=!ui.tut&&G.players.some(p=>p.score>100);   // обучение — всегда один раунд
  G.result={wi,rows,over,finish:seq.map(ctxt).join(' ')};
  // серия побед в раундах подряд; «царский выход» — последней картой К♥
  G.streak=G.players.map((p,i)=>i===wi?((G.streak&&G.streak[i])||0)+1:0);
  if(isKH(last)){G.result.tsar=true;const e={t:'tsar',pi:wi};ui.fx.push(e);emit(e);}
  G.phase=over?'over':'round';G.deadline=null;
  log(`${P(wi).name} избавился от всех карт`);
  render();
}
function endSound(){
  if(!G||!G.result)return;
  const r=G.result,lost=r.over&&r.rows[ME].after>100,won=!lost&&(r.wi===ME||r.over);
  if(r.tsar)setTimeout(()=>sfx('tsar'),250);
  if(!r.tsar||r.over)setTimeout(()=>{sfx(won?'win':'lose');if(won&&SEASON==='ny')sfx('sleigh');},r.tsar?1100:500);
  if(won)setTimeout(()=>buzz('win'),500);
}
function nextRound(){G.dealer=nextOf(G.dealer);deal();}
function rematch(){G.players.forEach(p=>p.score=0);G.streak=[];G.round=0;G.dealer=Math.random()*G.n|0;deal();}

/* ================= Боты ================= */
const lvl=pi=>P(pi).bot?(G.level||'normal'):'normal';
// Запоминаем, какой масти у игрока нет: он брал карту, потому что нечем было ходить
function markVoid(pi){
  if(!G.voids)G.voids={};
  const t=topCard(),su=t.r==='Q'?G.namedSuit:t.s;if(!su)return;
  const v=G.voids[pi]||[];if(!v.includes(su))v.push(su);G.voids[pi]=v;
}
const voidOf=(pi,su)=>!!(G.voids&&G.voids[pi]&&G.voids[pi].includes(su));
function botSuit(pi){
  const L=lvl(pi);
  if(L==='easy')return SUITS[Math.random()*4|0];
  const cnt={S:0,C:0,D:0,H:0},nx=nextOf(pi);
  P(pi).hand.forEach(c=>{if(c.r!=='Q')cnt[c.s]+=1+val(c)/20;});
  if(L==='hard')for(const s of SUITS)if(cnt[s]>0&&voidOf(nx,s))cnt[s]+=2.5;  // заказать то, чего нет у следующего
  let best=SUITS[Math.random()*4|0],b=-1;
  for(const s of SUITS)if(cnt[s]>b){b=cnt[s];best=s;}
  return best;
}
function orderRest(h,first,rest,pi){
  const remain=h.filter(x=>x.r!==first.r);
  const cnt=s=>remain.filter(x=>x.s===s).length+(pi!=null&&lvl(pi)==='hard'&&voidOf(nextOf(pi),s)?3:0);
  let r=[...rest];
  if(first.r==='K'){const kh=r.find(isKH);if(kh){r=r.filter(x=>x!==kh);r.push(kh);return r;}}
  r.sort((a,b)=>cnt(a.s)-cnt(b.s));     // сверху — масть, которой больше всего на руке
  return r;
}
function scoreSeq(pi,seq){
  const h=P(pi).hand,last=seq[seq.length-1],after=h.length-seq.length;
  const sum=seq.reduce((a,c)=>a+val(c),0),hard=lvl(pi)==='hard';
  if(after===0&&last.r!=='8')return 10000+(last.r==='Q'?sum:0)+(isKH(last)?50:0);
  const nxc=P(nextOf(pi)).hand.length;
  const danger=nxc<=2?(hard?3:2):1;
  let s=sum*(hard?.8:.6)+seq.length*4;
  if(last.r==='6')s+=10*seq.length*danger;
  if(last.r==='7')s+=16*seq.length*danger;
  if(last.r==='A')s+=8*seq.length*danger;
  if(isKH(last))s+=40*danger;
  if(last.r==='Q')s-=35;
  if(last.r==='8'){
    const remain=h.filter(x=>!seq.includes(x));
    s+=remain.some(x=>x.s===last.s||x.r==='Q'||x.r==='8')?6:-25;
  }
  if(hard){
    const remain=h.filter(x=>!seq.includes(x));
    // дам бережём на конец раунда: выйти дамой — это минус очки
    if(last.r==='Q'&&remain.length&&h.some(x=>x.r!=='Q'&&canStart(x)))s-=60;
    if(remain.length&&remain.every(x=>x.r==='Q'))s+=45;
    // следующему игроку нечем будет крыть эту масть
    if(last.r!=='Q'&&voidOf(nextOf(pi),last.s))s+=14;
  }
  return s;
}
function bestMove(pi){
  const h=P(pi).hand,starts=h.filter(canStart);
  if(!starts.length)return null;
  const L=lvl(pi);
  if(L==='easy'){                         // лёгкий: случайная подходящая карта, редко пачкой
    const c=starts[Math.random()*starts.length|0];
    const rest=h.filter(x=>x.r===c.r&&x.id!==c.id);
    return rest.length&&Math.random()<.3?[c,...rest]:[c];
  }
  const cands=[];
  for(const c of starts){
    cands.push([c]);
    const rest=h.filter(x=>x.r===c.r&&x.id!==c.id);
    if(rest.length)cands.push([c,...orderRest(h,c,rest,pi)]);
  }
  let best=null,bs=-1e9;
  for(const seq of cands){const s=scoreSeq(pi,seq)+Math.random()*(L==='hard'?1:3);if(s>bs){bs=s;best=seq;}}
  return best;
}
function botTurn(){
  if(!G||G.phase!=='play'||NET.role==='guest'||G.skipping)return;
  const pi=G.cur,p=P(pi);if(ctrl(pi)!=='bot')return;
  const mv=ui.tut?tutBot(pi):bestMove(pi);
  if(!mv){
    if(!G.drew){markVoid(pi);draw(pi,1);G.drew=true;log(`${p.name} берёт карту`);render();schedule(botTurn,700);return;}
    pass(pi);return;
  }
  doPlay(pi,mv);
}
// Друг отключился посреди своего хода — за него доигрывает бот
function takeOverIfAway(i){
  if(!G||ctrl(i)!=='bot'||P(i).bot)return;
  if(G.phase==='play'&&G.cur===i&&!G.skipping){G.deadline=null;schedule(botTurn,900);}
  else if(G.phase==='suit'&&G.suitBy===i){setSuit(botSuit(i),i);G.phase='play';G.suitBy=null;G.cur=nextOf(i);beginTurn();}
  else if(G.phase==='blind'&&G.dealer===i){setSuit(SUITS[Math.random()*4|0],i,true);G.phase='play';G.cur=nextOf(i);beginTurn();}
}

/* ================= Действия на этом экране ================= */
const byId=id=>P(ME).hand.find(c=>c.id===id);
const myTurn=()=>G&&G.phase==='play'&&G.cur===ME&&!G.skipping;
const sel=()=>NET.role==='guest'?ui.gsel:G.sel;
function setSel(v){if(NET.role==='guest')ui.gsel=v;else G.sel=v;}
function flash(m){ui.flash=m;if(G)renderStatus();clearTimeout(flash.t);flash.t=setTimeout(()=>{ui.flash='';if(G)renderStatus();},1600);}
function tapCard(id){
  if(!myTurn())return;
  const c=byId(id);if(!c)return;const s=sel().slice();const k=s.indexOf(id);
  // повторное касание выбранной карты (двойной тап) — сразу ходим
  const dbl=ui.lastTap&&ui.lastTap.id===id&&Date.now()-ui.lastTap.t<350;ui.lastTap={id,t:Date.now()};
  if(k>=0&&dbl&&validSeq(s.map(byId))){ui.lastTap=null;ACTS.play();return;}
  const w=tutWant();if(w&&!w.includes(id)){flash('Обучение: нажмите подсвеченную карту');return;}
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
  next(){if(NET.role!=='guest'&&G&&G.phase==='round')nextRound();},
  rematch(){if(NET.role==='host')rematch();},
  score(){ui.score=true;ui.confirmNew=false;render();},
  close(){ui.score=false;ui.rules=false;render();},
  rules(){ui.rules=true;render();},
  newgame(){
    if(G&&G.phase!=='over'&&!ui.confirmNew){ui.confirmNew=true;render();return;}
    clearTimeout(timer);G=null;ui.score=false;ui.confirmNew=false;lsSet(SAVE_KEY,null);showSetup();
  },
  card(el){tapCard(el.dataset.id);},
  exit(){ui.exit=true;ui.score=false;ui.rules=false;render();},
  stay(){ui.exit=false;render();},
  leave(){ui.exit=false;leaveGame();},
  addbot(){lobbyAddBot();},
  kick(el){lobbyRemove(+el.dataset.i);},
  begin(){hostStart();},
  lobbyleave(){leaveGame();},
  sound(el){
    ui.sound=!ui.sound;el.setAttribute('aria-pressed',ui.sound);lsSet('valenok-sound-on',ui.sound);if(ui.sound)musicStart();else musicStop();
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
  return `<text x="13" y="25" text-anchor="middle" font-size="${two?22:25}" font-weight="800"${two?' letter-spacing="-2"':''}>${lab}</text>`+
    (ul?'<rect x="7.5" y="28" width="11" height="2.4" rx="1"/>':'')+use(c.s,13,ul?40:38,15);
}
function faceBody(c){
  let b='';
  if(PIPS[c.r]){
    for(const [x,y] of PIPS[c.r]) b+= y>70?`<g transform="rotate(180 ${x} ${y})">${use(c.s,x,y,17)}</g>`:use(c.s,x,y,17);
  }else if(c.r==='A'){
    b=`<circle cx="50" cy="70" r="31" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/><circle cx="50" cy="70" r="27" fill="none" stroke="currentColor" stroke-width=".6" stroke-dasharray="2 2.5" opacity=".35"/>`+use(c.s,50,70,40);
  }else{
    // половинки фигур 64×54: плечи (x 2..62 в символе) ложатся ровно в рамку 20..80
    const half=`<use href="#f-${c.r}" x="18" y="16" width="64" height="54"/>${use(c.s,28.4,25.4,10)}`;
    b=`<g style="${FACE_COL[c.s]};--c2:#d9a43a"><rect x="20" y="16" width="60" height="108" rx="3" fill="#f3e7cc" stroke="#9a6c22" stroke-width="2.2"/>
      ${half}<g transform="rotate(180 50 70)">${half}</g>
      <line x1="20" y1="70" x2="80" y2="70" stroke="#9a6c22" stroke-width=".9"/>
      <rect x="20" y="16" width="60" height="108" rx="3" fill="none" stroke="#d9a43a" stroke-width="1.2"/>
      <rect x="22.6" y="18.6" width="54.8" height="102.8" rx="1.8" fill="none" stroke="#d9a43a" stroke-width=".7"/></g>`;
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
  if(list.some(f=>f.t==='shake'&&f.pi===ME))buzz('penalty');
  if(!RM&&!ui.sim&&list.some(f=>f.t==='big'||f.t==='crown'||f.t==='shake'))tableReact();
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
        const finish=()=>{if(done)return;done=true;el.remove();ui.hold.delete(c.id);const w=document.querySelector(`#pile [data-hold="${c.id}"]`);if(w)w.style.visibility='';sfx('card',{k,last:k>0&&k===f.cards.length-1});if(f.pi===ME)buzz('play');};
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
    }else if(['deal','big','skip','suit','crown','tsar'].includes(f.t)){runExtraFx(f);
    }else if(f.t==='shake'){
      const el=f.pi===ME?$('handWrap'):seatEl(f.pi);
      if(el){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');el.addEventListener('animationend',()=>el.classList.remove('shake'),{once:true});}
    }
  }
}

/* ================= Звуки (синтез, без файлов) ================= */
// Общая шина: все звуки и музыка → master → компрессор → динамик
let AC=null,BUS=null;const NOISE=[];
function actx(){
  if(!AC){
    try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){return null;}
    try{
      const comp=AC.createDynamicsCompressor();comp.threshold.value=-14;comp.knee.value=10;comp.ratio.value=4;comp.attack.value=.004;comp.release.value=.2;
      BUS=AC.createGain();BUS.gain.value=1;BUS.connect(comp);comp.connect(AC.destination);
    }catch(e){BUS=null;}
    // три готовых буфера шума — без выделения памяти на каждый звук
    try{for(let k=0;k<3;k++){const b=AC.createBuffer(1,AC.sampleRate*.5|0,AC.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;NOISE.push(b);}}catch(e){}
  }
  if(AC.state==='suspended')AC.resume();return AC;
}
const OUT=ctx=>BUS||ctx.destination;
const rnd=(a,b)=>a+Math.random()*(b-a);
function tone(ctx,f,t0,dur,type='sine',vol=.15){
  const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,t0);
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.01);g.gain.exponentialRampToValueAtTime(.001,t0+dur);
  o.connect(g).connect(OUT(ctx));o.start(t0);o.stop(t0+dur+.05);
}
// шумовой всплеск через фильтр: кусок готового буфера со случайного места
function swish(ctx,t0,freq,dur,vol,type='bandpass',q=.9){
  if(!NOISE.length)return;
  const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();
  s.buffer=NOISE[Math.random()*NOISE.length|0];f.type=type;f.frequency.value=freq;f.Q.value=q;
  g.gain.setValueAtTime(vol,t0);g.gain.exponentialRampToValueAtTime(.001,t0+dur);
  s.connect(f).connect(g).connect(OUT(ctx));s.start(t0,Math.random()*Math.max(0,.45-dur),dur+.02);
}
// приглушить музыку до 40% на время фанфары
function duck(ms=600){
  if(!music.gain||!AC)return;const t=AC.currentTime,g=music.gain.gain;
  g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);g.linearRampToValueAtTime(MUSIC_VOL*.4,t+.06);
  g.setValueAtTime(MUSIC_VOL*.4,t+ms/1000);g.linearRampToValueAtTime(MUSIC_VOL,t+ms/1000+.35);
}
// три победные фанфары по очереди
const WIN_TUNES=[
  (ctx,t)=>[523,659,784,1047].forEach((f,i)=>tone(ctx,f,t+i*.1,.32,'triangle',.11)),                 // мажорное арпеджио
  (ctx,t)=>[[659,0,.14],[784,.13,.14],[880,.26,.22],[784,.46,.12],[880,.58,.12],[988,.7,.16],[880,.86,.42]]  // плясовой наигрыш
    .forEach(([f,d,l])=>{pluck(ctx,OUT(ctx),f,t+d,l+.1,.16);pluck(ctx,OUT(ctx),f*2,t+d,l*.6,.04);}),
  (ctx,t)=>[1568,2093,2349,3136,2637].forEach((f,i)=>{tone(ctx,f,t+i*.07,1.1,'sine',.045);tone(ctx,f*2.76,t+i*.07,.35,'sine',.012);})]; // колокольчики
let winTune=Math.random()*3|0;
function sfx(kind,o={}){
  if(!ui.sound||ui.sim)return;const ctx=actx();if(!ctx)return;const t=ctx.currentTime;
  switch(kind){
    case 'card':{   // o.k — номер карты в серии (каждая выше), o.last — последняя ложится шлепком
      const k=o.k||0,v=rnd(.8,1)*(o.last?1.25:1);
      swish(ctx,t,1800*rnd(.85,1.15),o.last?.1:.08,.9*v);tone(ctx,rnd(110,135)+k*40,t,o.last?.09:.07,'sine',.18*v);break;}
    case 'draw':swish(ctx,t,3800*rnd(.85,1.15),.13*rnd(.85,1.1),.45*rnd(.8,1));break;
    case 'penalty':tone(ctx,392,t,.15,'triangle',.14);tone(ctx,262,t+.14,.25,'triangle',.14);break;
    case 'skip':tone(ctx,196,t,.12,'square',.04);tone(ctx,165,t+.1,.16,'square',.04);break;
    case 'suit':[784,1047].forEach((f,i)=>tone(ctx,f,t+i*.09,.3,'sine',.09));break;
    case 'turn':tone(ctx,880,t,.1,'sine',.05);break;
    case 'tick':{const v=o.loud?1.6:1;tone(ctx,900,t,.05,'sine',.07*v);swish(ctx,t,2500,.018,.25*v,'bandpass',2);break;}   // деревянная коробочка
    case 'shuffle':for(let i=0;i<7;i++)swish(ctx,t+i*.045+rnd(0,.012),(2600+i*150)*rnd(.85,1.15),.06,.5*rnd(.8,1));break;
    case 'join':[660,880].forEach((f,i)=>tone(ctx,f,t+i*.08,.18,'sine',.07));break;
    case 'win':duck();WIN_TUNES[winTune=(winTune+1)%3](ctx,t);break;
    case 'thud':duck();tone(ctx,70,t,.45,'sine',.35);tone(ctx,48,t+.02,.5,'sine',.3);swish(ctx,t,320,.18,.6);break;
    case 'buzz':for(let i=0;i<5;i++)tone(ctx,210+Math.random()*40,t+i*.09,.12,'sawtooth',.012);break;
    case 'lose':duck();[392,330,262,196].forEach((f,i)=>tone(ctx,f,t+i*.15,.38,'triangle',.11));break;
    case 'sleigh':for(let i=0;i<9;i++){const d=t+.25+i*.085+rnd(0,.02);swish(ctx,d,rnd(6500,8000),.07,.3,'bandpass',3);tone(ctx,rnd(2600,2900),d,.09,'sine',.018);}break;  // бубенцы
    case 'tsar':duck(1000);[440,554,659,880,1109,1319].forEach((f,i)=>{const d=t+i*.09;pluck(ctx,OUT(ctx),f,d,.35,.16);pluck(ctx,OUT(ctx),f,d+.045,.14,.07);});break;  // балалайка вверх
    case 'slap':swish(ctx,t,900,.09,1,'lowpass',.7);tone(ctx,170,t,.08,'sine',.2);break;   // «шлёп»
    case 'purr':{   // мурчание: низкий гул, модулированный ~25 Гц
      if(!NOISE.length)break;
      const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain(),am=ctx.createGain(),lfo=ctx.createOscillator(),lg=ctx.createGain();
      s.buffer=NOISE[0];s.loop=true;f.type='lowpass';f.frequency.value=320;
      lfo.frequency.value=25;lg.gain.value=.5;am.gain.value=.5;lfo.connect(lg);lg.connect(am.gain);
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.9,t+.15);g.gain.setValueAtTime(.9,t+.95);g.gain.linearRampToValueAtTime(0,t+1.2);
      s.connect(f).connect(am).connect(g).connect(OUT(ctx));s.start(t);s.stop(t+1.25);lfo.start(t);lfo.stop(t+1.25);
      tone(ctx,50,t,1.2,'sine',.05);break;}
  }
}
function rot(id){let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))%997;return (h%15)-7;}
function esc(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

function showScreen(id){
  if(ui.curScreen!==id&&!RM){const el=$(id);el.classList.remove('enter','enter-back');void el.offsetWidth;el.classList.add(id==='setup'&&ui.curScreen?'enter-back':'enter');}
  if(ui.curScreen!==id)setTimeout(()=>statusNow&&statusNow(),0);
  ui.curScreen=id;
  keepAwake(id==='app'||id==='lobby');for(const s of ['setup','lobby','app','profile','friendsScr','settingsScr'])$(s).hidden=s!==id;if(id!=='app')$('overlay').hidden=true;}
let prevPhase=null;
function render(){
  if(!G)return;
  showScreen('app');
  $('roundLbl').textContent=NET.code?`Раунд ${G.round} · комната ${NET.code}`:`Раунд ${G.round}`;
  if((G.phase==='round'||G.phase==='over')&&prevPhase!==G.phase){endSound();roundStats(G.result);finaleFx();}
  prevPhase=G.phase;
  renderSeats();renderTable();renderHand();renderStatus();streakMarks();renderModal();updateClock();save();runFx();
  if(NET.role==='host')queuePublish();
}
function renderSeats(){
  const box=$('seats');let h='';
  for(let k=1;k<G.n;k++){
    const i=(ME+k)%G.n,p=P(i);
    const away=!p.bot&&p.online===false;
    h+=`<div class="seat ${G.cur===i&&G.phase==='play'?'turn':''}" data-seat="${i}">
      <div class="seat-top">${avaHTML(p.ava,p.name,'sm')}<span class="seat-name">${esc(p.name)}</span>${!p.bot&&NET.role!=='local'?`<i class="dot ${away?'off':''}" title="${away?'не в сети':'в сети'}"></i>`:''}${i===G.dealer?'<span class="chip">сдаёт</span>':''}</div>
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
    const topc=k===show.length-1,flip=topc&&G.pile.length===1&&Date.now()<ui.flipAt;
    const glow=topc&&c.r==='8'&&G.eightOwner!=null&&G.phase==='play';
    return `<div data-hold="${c.id}" class="${glow?'glow8':''}" style="position:absolute;inset:0;transform:rotate(${rot(c.id)}deg)${held?';visibility:hidden':''}">${cardHTML(c,flip?'flipin':(topc&&grew&&!held&&G.pile.length===1)?'fresh':'',flip?'':'').replace('class="card','style="--d:'+Math.max(0,ui.flipAt-Date.now())+'ms" class="card')}</div>`;
  }).join('');
  ui.lastPile=G.pile.length;
  $('deckN').textContent=`${G.deck.length} в колоде`;
  const deck=$('deck');
  deck.classList.toggle('can',myTurn()&&!G.drew&&!legal(ME).length);
  deck.style.visibility=G.deck.length?'visible':'hidden';
  // заказанная масть — крупно в углу сброса; восьмёрку надо покрыть — подсказка на сбросе
  const tc=topCard();$('suitBadge').innerHTML='';
  if(G.namedSuit&&tc&&tc.r==='Q')pile.insertAdjacentHTML('beforeend',`<div class="suitbig ${isRed(G.namedSuit)?'red':''}" role="img" aria-label="Заказ: ${SNAME[G.namedSuit]}">${SYM[G.namedSuit]}</div>`);
  if(G.phase==='play'&&G.eightOwner===ME&&tc&&tc.r==='8')pile.insertAdjacentHTML('beforeend','<div class="ghost8">накройте</div>');
  if(tc&&!ui.sim&&!ui.tut&&G.phase!=='blind')rankTip(tc);
}
function renderHand(){
  const hand=P(ME).hand,el=$('hand');
  const mine=myTurn(),s=sel();
  if(G.phase==='blind'&&G.dealer===ME){el.innerHTML='<div class="back"></div>'.repeat(hand.length);fitHand();return;}
  const first=s.length?byId(s[0]):null;
  const dealing=Date.now()<ui.dealUntil,hinting=mine&&!s.length&&Date.now()-ui.hintAt<700;
  const off=(ME-G.dealer-1+G.n)%G.n,tw=tutWant();
  el.innerHTML=hand.map((c,i)=>{
    let cls='',st='';
    if(mine){let ok=first?c.r===first.r:canStart(c);if(tw)ok=ok&&tw.includes(c.id);cls=ok?(tw?'ok tutpick':'ok'):'dim';if(ok&&hinting){cls+=' hint';st=`--h:${i*45}ms;`;}}
    const k=s.indexOf(c.id);if(k>=0)cls+=' sel';
    if(dealing){cls+=' dealt';st+=`--d:${(i*G.n+off)*55+300-(Date.now()-(ui.dealStart||Date.now()))}ms;`;}
    else if(!ui.known.has(c.id))cls+=' fresh';
    return `<button class="cardbtn" data-act="card" data-id="${c.id}" aria-label="${ctxt(c)}" style="all:unset;flex:none;position:relative;${st}">${cardHTML(c,cls,k>=0&&s.length>1?`<span class="ord">${k+1}</span>`:'')}</button>`;
  }).join('');
  ui.known=new Set(hand.map(c=>c.id));
  fitHand();
}
function fitHand(){
  const el=$('hand'),wrap=$('handWrap');
  el.querySelectorAll('.hbr').forEach(b=>b.remove());
  const kids=[...el.children];if(!kids.length)return;
  const cw=kids[0].getBoundingClientRect().width||60;const W=wrap.clientWidth-10,n=kids.length;
  const fit=k=>k>1?Math.min(cw+6,(W-cw)/(k-1)):0;
  // много карт и тесно — раскладываем в два ряда, второй ряд заходит на первый, углы видны
  const two=n>9&&fit(n)<cw*.6,per=two?Math.ceil(n/2):n;
  const step=Math.max(fit(per),cw*.38);
  el.classList.toggle('two',two);el.style.width=two?Math.ceil(cw+(per-1)*step)+1+'px':'';
  if(two){const b=document.createElement('i');b.className='hbr';el.insertBefore(b,kids[per]);}
  kids.forEach((k,i)=>{k.style.marginLeft=i&&i!==per?`${step-cw}px`:'0';k.style.marginTop=two&&i>=per?`${-cw*1.4*.64}px`:'';});
}
function renderStatus(){
  const st=$('status');
  let m='';
  if(ui.flash)m=ui.flash;
  else if(G.phase==='play'){
    const tc=topCard(),ns=G.namedSuit&&tc&&tc.r==='Q'?G.namedSuit:null;
    if(G.cur!==ME)m=`Ходит ${P(G.cur).name}…${ns?' · заказ '+SYM[ns]:''}`;
    else if(G.eightOwner===ME&&tc.r==='8')m=G.drew&&!legal(ME).length?'Покрыть нечем — нажмите «Пас»':`Покройте восьмёрку: ${SYM[tc.s]}, восьмёрка или дама`;
    else if(legal(ME).length)m=sel().length?'Можно добавить карты того же значения':ns?`Ваш ход — заказ ${SYM[ns]} ${SNAME[ns]}`:'Ваш ход — выберите карту';
    else m=G.drew?'Ходить нечем — нажмите «Пас»':`Нечем ходить${ns?' (заказ '+SYM[ns]+')':''} — возьмите карту`;
  }
  else if(G.phase==='suit'&&G.suitBy!==ME)m=`${P(G.suitBy).name} выбирает масть…`;
  else if(G.phase==='blind'&&G.dealer!==ME)m=`${P(G.dealer).name} называет масть вслепую…`;
  if(st.textContent!==m)st.textContent=m;st.classList.toggle('flash',!!ui.flash);
  // свой ход — статус становится яркой плашкой, в начале хода один раз «вздрагивает»
  const mine=myTurn();
  st.classList.toggle('myturn',mine&&!ui.flash);
  if(mine&&!ui.wasMine&&!RM&&!ui.sim){st.classList.remove('pulse');void st.offsetWidth;st.classList.add('pulse');}
  ui.wasMine=mine;
  renderLog();renderCoach();
  const me=P(ME);
  $('me').classList.toggle('turn',mine);
  $('me').innerHTML=`<span><b>${esc(me.name)}</b>${G.dealer===ME?' · сдаёте':''}${me.skips?' · пропуск хода':''}</span><span>${me.hand.length} карт · <b>${me.score}</b> очк.</span>`;
  const noMove=!legal(ME).length;
  $('drawBtn').disabled=!(mine&&!G.drew&&noMove);
  $('passBtn').disabled=!(mine&&G.drew);
  const pb=$('playBtn');const seq=sel().map(byId);
  pb.disabled=!(mine&&validSeq(seq));
  pb.textContent=pb.disabled?'Сходить':`Сходить ${seq.map(ctxt).join(' ')}`;
  // подсвечиваем только ту кнопку, которую нужно нажать сейчас
  $('drawBtn').classList.toggle('now',!$('drawBtn').disabled);
  $('passBtn').classList.toggle('now',!$('passBtn').disabled&&noMove);
  pb.classList.toggle('now',!pb.disabled);
}
// лента ходов не повторяет текст, который сейчас висит во всплывашке
function renderLog(){
  const t=Date.now()-(ui.toastAt||0)<1900?ui.toastM:null;
  $('log').textContent=G.log.slice(-3).filter(l=>l!==t).slice(-2).join('  ·  ');
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
function suitButtons(only){return `<div class="suits">${SUITS.map(s=>`<button data-act="suit" data-s="${s}" class="${isRed(s)?'red':''}${only===s?' tutpick':''}"${only&&only!==s?' disabled':''}><b>${SYM[s]}</b>${SNAME[s]}</button>`).join('')}</div>`;}
function scoreTable(){
  return `<table class="score"><thead><tr><th>Игрок</th><th>Очки</th></tr></thead><tbody>${G.players.map(p=>`<tr><td>${esc(p.name)}<div class="bar100"><i style="width:${Math.max(0,Math.min(100,p.score))}%"></i></div></td><td>${p.score}</td></tr>`).join('')}</tbody></table>`;
}
// печать-валенок на ленте проигравшего в итогах
const BOOT_STAMP='<svg class="stamp" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="9 1.2 14 1 20 1.4"/><path transform="translate(12 12) scale(.74) translate(-13.2 -11.5)" fill="currentColor" d="M8 3h6v10c0 1.3.9 2 2.3 2.3l2.1.4c1.6.3 2.3 1.4 2 2.6-.3.9-1.2 1.7-2.4 1.7H8.4C7.1 20 6 19.1 6 17.8V5c0-1.1.9-2 2-2z"/></svg>';
function renderModal(){
  const ov=$('overlay'),sh=$('sheet');let h='';
  const guest=NET.role==='guest',online=NET.role!=='local';
  if(G.phase==='suit'&&G.suitBy===ME){h=`<h2>Назовите масть</h2><p>${ui.tut?'Обучение: выберите ♥ черви — у Оли они есть.':'Следующий игрок должен будет ходить этой мастью.'}</p>${suitButtons(ui.tut?'H':null)}`;}
  else if(G.phase==='blind'&&G.dealer===ME){h=`<h2>Открылась дама</h2><p>Вы раздавали — назовите масть вслепую. Карты покажутся после выбора.</p>${suitButtons()}`;}
  else if(ui.tut&&G.phase==='round'&&!ui.exit)h=tutDoneHTML();
  else if((G.phase==='round'||G.phase==='over')&&!ui.exit){
    const r=G.result;const w=P(r.wi);
    const loserIdx=r.over?G.players.reduce((b,p,i)=>p.score>P(b).score?i:b,0):-1;
    let btn;
    if(r.over)btn=guest?`<p>Ждём, начнёт ли хозяин новую партию.</p><button class="btn" data-act="exit">Выйти в меню</button>`
               :online?`<div class="row"><button class="btn" data-act="exit">Выйти</button><button class="btn primary" data-act="rematch">Ещё партию</button></div>`
               :`<button class="btn primary" data-act="newgame">Новая игра</button>`;
    else btn=guest?`<p>Ждём, когда хозяин комнаты начнёт следующий раунд.</p>`:`<button class="btn primary" data-act="next">Следующий раунд</button>`;
    h=`<h2>${r.over?`Валенок — ${esc(P(loserIdx).name)}!`:`${esc(w.name)} ${r.wi===ME?'выиграли':'выиграл'} раунд`}</h2>
      <p>Последний ход: ${esc(r.finish)}${r.rows[r.wi].d<0?` — минус ${-r.rows[r.wi].d} очков`:''}.</p>
      <table class="score"><thead><tr><th>Игрок</th><th>За раунд</th><th>Итого</th></tr></thead><tbody>
      ${r.rows.map((x,i)=>`<tr data-i="${i}"${i===loserIdx?' class="loser"':''}><td>${i===loserIdx?`<span class="ribbon">${esc(x.name)}${BOOT_STAMP}</span>`:`<span class="nm">${esc(x.name)}</span>`}${(x.list&&x.list.length)?`<div class="minis">${x.list.map(c=>cardHTML(c,'mini')).join('')}</div>`:(x.cards?`<small>${esc(x.cards)}</small>`:'')}</td><td class="${x.d<0?'neg':''}" data-d="${x.d}">${x.d>0?'+':''}${x.d}</td><td class="${x.after>100?'lose':''}" data-a="${x.after}" data-b="${x.before}">${x.after}${x.reset?'<small>ровно 100 — обнуление</small>':''}</td></tr>`).join('')}
      </tbody></table>${btn}`;
  }
  else if(ui.exit){
    const txt=NET.role==='host'?'Комната закроется, и друзья вернутся в меню.'
            :guest?'Вместо вас будет играть бот. Вернуться можно по тому же коду.'
            :ui.tut?'Обучение можно пройти заново из главного меню.'
            :'Партия сохранится: продолжить можно будет с главного экрана кнопкой «Продолжить партию».';
    h=`<h2>Выйти из партии?</h2><p>${txt}</p>
      <div class="row"><button class="btn" data-act="stay">Остаться</button><button class="btn primary" data-act="leave">Выйти в меню</button></div>`;
  }
  else if(ui.score){
    h=`<h2>Счёт</h2>${scoreTable()}<details class="memo" open>${MEMO}</details>
      <div class="row">${online||ui.tut?'':`<button class="btn" data-act="newgame">${ui.confirmNew?'Точно? Счёт сбросится':'Новая игра'}</button>`}<button class="btn primary" data-act="close">Вернуться</button></div>`;
  }
  else if(ui.rules){h=`<h2>Правила</h2><details class="memo" open>${MEMO}</details><button class="btn primary" data-act="close">Вернуться к игре</button>`;}
  if((G.phase==='round'||G.phase==='over')&&Date.now()<ui.modalAt&&!ui.exit&&!ui.score)h='';   // сначала падает валенок
  ov.hidden=!h;if(h&&sh.dataset.h!==h){sh.innerHTML=h;sh.dataset.h=h;}
  sh.classList.toggle('scoresheet',!!h&&(G.phase==='round'||G.phase==='over')&&!ui.exit);   // итоги — листок в линейку
  if(h&&(G.phase==='round'||G.phase==='over'))animateScores();
}

/* ================= Сохранение ================= */
function save(){
  if(!G||ui.sim||ui.tut)return;
  if(NET.role==='local')lsSet(SAVE_KEY,G);
  else if(NET.role==='host')lsSet(HOST_KEY,{code:NET.code,G,at:Date.now()});
}
function showSetup(){
  showScreen('setup');ui.tut=null;ui.rules=false;
  const s=lsGet(SAVE_KEY),has=!!(s&&s.players&&s.phase!=='over');$('contBtn').hidden=!has;
  $('startBtn').classList.toggle('primary',!has);   // есть сохранённая партия — главная кнопка «Продолжить»
  $('tutOffer').hidden=has||!!lsGet('valenok-tut-offered');
  const h=lsGet(HOST_KEY),g=lsGet(GUEST_KEY),rb=$('rejoinBtn');
  const r=(h&&Date.now()-h.at<6*3600e3)?h:(g&&Date.now()-g.at<6*3600e3)?g:null;
  rb.hidden=!r;if(r)rb.textContent=`Вернуться в комнату ${r.code}`;
}
function resume(){
  ui.known=new Set(P(ME).hand.map(c=>c.id));ui.lastPile=G.pile.length;prevPhase=G.phase;
  if(NET.role==='local'&&G.deadline)G.deadline=Date.now()+(G.tRemain!=null?G.tRemain:G.timer*1000);
  delete G.tRemain;
  render();
  if(G.phase==='play'){
    if(G.skipping||P(G.cur).skips>0)schedule(beginTurn,700);      // прерванный пропуск хода
    else if(ctrl(G.cur)==='bot')schedule(botTurn,700);
  }
}
// при уходе в меню в игре с ботами запоминаем остаток таймера
function stashClock(){if(G&&NET.role==='local')G.tRemain=G.deadline?Math.max(0,G.deadline-Date.now()):null;}
window.addEventListener('pagehide',()=>{stashClock();save();});

/* ================= Статистика игрока ================= */
// Приращения копятся на телефоне (работает и без интернета) и складываются в облако.
const PEND_KEY='valenok-stats-pending', CLOUD_KEY='valenok-stats-cloud', RIV_PEND='valenok-rivals-pending', RIV_CLOUD='valenok-rivals-cloud', ACH_KEY='valenok-ach';
const MAXK=new Set(['maxHand','bestStreak']);
const statMode=()=>NET.role==='local'?'bots':'online';
function addInto(dst,src){
  for(const [k,v] of Object.entries(src||{})){
    if(k==='bestMinus')dst[k]=Math.min(dst[k]??0,v);else if(MAXK.has(k))dst[k]=Math.max(dst[k]||0,v);else dst[k]=(dst[k]||0)+v;
  }
  return dst;
}
function bump(k,v=1){
  if(ui.sim||!v||ui.tut)return;
  const P=lsGet(PEND_KEY)||{},m=statMode();
  P[m]=addInto(P[m]||{},{[k]:v});lsSet(PEND_KEY,P);
  checkAch();
}
function roundStats(r){
  if(!r||!r.rows||ui.sim||ui.tut)return;
  const rows=r.rows,me=rows[ME];if(!me)return;
  const add={rounds:1};
  if(r.wi===ME){add.roundWins=1;if(me.d<0){add.minusCount=1;add.minusSum=-me.d;add.bestMinus=me.d;}}
  if(me.reset)add.resets=1;
  if(r.over){
    const sc=rows.map(x=>x.after),lo=Math.min(...sc),hi=Math.max(...sc);
    add.games=1;
    const won=me.after===lo;
    if(won)add.wins=1;
    if(me.after===hi&&hi>100)add.valenki=1;
    const st=won?(lsGet('valenok-streak')||0)+1:0;lsSet('valenok-streak',st);add.bestStreak=st;
    // личные встречи с живыми соперниками
    if(NET.role!=='local'&&G){
      const RV=lsGet(RIV_PEND)||{};
      G.players.forEach((p,i)=>{
        if(i===ME||p.bot||!p.uid||!rows[i])return;
        const o=RV[p.uid]||{games:0,w:0,l:0};
        o.name=p.name;o.ava=p.ava||null;o.games++;
        if(me.after<rows[i].after)o.w++;else if(me.after>rows[i].after)o.l++;
        RV[p.uid]=o;
      });
      lsSet(RIV_PEND,RV);
    }
  }
  const P=lsGet(PEND_KEY)||{},m=statMode();P[m]=addInto(P[m]||{},add);lsSet(PEND_KEY,P);
  checkAch();flushStats();
}
// Одна отправка за раз; кто пришёл во время отправки — ждёт её и отправляет остаток
let flushP=null;
function flushStats(){
  if(flushP)return flushP.then(()=>lsGet(PEND_KEY)?flushStats():null);
  flushP=doFlush().finally(()=>{flushP=null;});
  return flushP;
}
async function doFlush(){
  await flushExtras();
  const P=lsGet(PEND_KEY)||{};       // читаем прямо перед отправкой, чтобы ничего не потерять
  if(!Object.keys(P).length)return;
  lsSet(PEND_KEY,null);
  try{
    if(!N.net.connected)throw new Error('offline');
    await N.addStats(P,myName()||null);
  }catch(e){
    const done=new Set(e&&e.done||[]);   // уже записанные режимы обратно не возвращаем
    const now=lsGet(PEND_KEY)||{};for(const m of Object.keys(P))if(!done.has(m))now[m]=addInto(now[m]||{},P[m]);lsSet(PEND_KEY,now);
    return;
  }
  try{lsSet(CLOUD_KEY,await N.getStats());}catch(e){}  // свежие цифры с сервера
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
/* ---------- аватарки ---------- */
const AVA_ICONS=[
  '<use href="#s-H" x="4" y="4" width="16" height="16"/>',
  '<use href="#s-S" x="4" y="4" width="16" height="16"/>',
  '<use href="#s-D" x="4" y="4" width="16" height="16"/>',
  '<use href="#s-C" x="4" y="4" width="16" height="16"/>',
  // 4 — петух городецкий (детали «вырезаны» цветом фона: var(--ab))
  '<path d="M6.4 5.6c-.3-1.2.7-2 1.6-1.4.4-1 1.8-1 2.1 0 .9-.3 1.6.6 1.1 1.5z"/><circle cx="8" cy="8" r="2.6"/><path d="M5.6 7.4L3.4 8.5 5.6 9.3z"/><ellipse cx="6.4" cy="10.9" rx=".8" ry="1.2"/>'+
  '<path d="M6.6 9.6C5 12.2 5.3 15.6 8 17.6c2.2 1.6 6.2 1.5 8.6-.6 1.9-1.7 2.4-4 1.9-6l-4.4 2c-1.5.5-3 .1-3.8-1.3L9.8 9.4z"/>'+
  '<path d="M14.6 12.6c.3-4.4 2.8-7.9 6.4-9.1-1.3 3-1.4 5.6-.6 8.4zM16.4 14.2c1.6-2.8 4.2-4.2 6.6-4.1-1.5 1.5-2.1 3.4-2 5.4zM17.8 16.4c1.6-1.5 3.6-2 5.2-1.4-1.3.9-2 2.2-2.2 3.6z"/>'+
  '<path d="M10.6 18.6l-.4 2.8M13.8 18.8l.3 2.6M8.8 21.6h2.6M12.9 21.6h2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'+
  '<path d="M10.4 13.4c1.6 2.2 4.4 2.4 6.4.6M11.6 15.5c1.2 1 2.8 1 4 .2" fill="none" style="stroke:var(--ab)" stroke-width="1" stroke-linecap="round"/><circle cx="8.4" cy="7.6" r=".75" fill="#1f1b1a"/>',
  '<path d="M8 3h6v10c0 1.3.9 2 2.3 2.3l2.1.4c1.6.3 2.3 1.4 2 2.6-.3.9-1.2 1.7-2.4 1.7H8.4C7.1 20 6 19.1 6 17.8V5c0-1.1.9-2 2-2z"/>',
  // 6 — самовар
  '<rect x="11" y="1.8" width="2" height="1.6" rx=".6"/><path d="M10 3.4h4l-.5 2h-3zM7.4 5.6h9.2l-.8 1.8H8.2zM7 8h10c1.7 2.2 1.9 6.6 0 9H7c-1.9-2.4-1.7-6.8 0-9zM9.6 17h4.8l.6 1.4H9zM7.2 18.4h9.6l1 2H6.2z"/>'+
  '<rect x="6.6" y="20.2" width="2.2" height="1.6" rx=".4"/><rect x="15.2" y="20.2" width="2.2" height="1.6" rx=".4"/>'+
  '<path d="M6.4 9.4c-2.3.1-2.6 3.5-.1 3.7M17.6 9.4c2.3.1 2.6 3.5.1 3.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'+
  '<path d="M6.4 10.6h11.2M6.3 15h11.4" fill="none" style="stroke:var(--ab)" stroke-width=".8"/><path d="M11 12.2h2.4v1.4h1.4v1.2h-2.2v1.4h-1.2v-1.4H11z" style="fill:var(--ab)"/>',
  // 7 — матрёшка
  '<path d="M12 2.4c-2.6 0-4.3 2-4.3 4.6 0 1.1.3 2 .8 2.8-2 1.5-3 3.9-3 6.6 0 3 1.8 5.1 6.5 5.1s6.5-2.1 6.5-5.1c0-2.7-1-5.1-3-6.6.5-.8.8-1.7.8-2.8 0-2.6-1.7-4.6-4.3-4.6z"/>'+
  '<circle cx="12" cy="7.4" r="2.7" style="fill:var(--ab)"/><circle cx="12" cy="7.5" r="2.05"/><circle cx="11.2" cy="7.3" r=".42" fill="#1f1b1a"/><circle cx="12.8" cy="7.3" r=".42" fill="#1f1b1a"/><circle cx="10.9" cy="8.4" r=".45" fill="#e0707e"/><circle cx="13.1" cy="8.4" r=".45" fill="#e0707e"/>'+
  '<path d="M10.5 10.5l1.5 1 1.5-1" fill="none" style="stroke:var(--ab)" stroke-width=".9" stroke-linecap="round"/><ellipse cx="12" cy="16.3" rx="3.4" ry="3.9" style="fill:var(--ab)"/><circle cx="12" cy="16.3" r="1.3"/><path d="M12 13.4v1.2M12 18v1.2M9.6 16.3h1.2M13.2 16.3h1.2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>',
  '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="4.5"/>',
  // 9 — балалайка (была кружка)
  '<path d="M10.5 1.6h3l-.4 2.8h-2.2z"/><rect x="11.25" y="4" width="1.5" height="8"/><path d="M12 10.4 5.3 20.2c-.5.8 0 1.5.9 1.5h11.6c.9 0 1.4-.7.9-1.5z"/>'+
  '<circle cx="12" cy="16.6" r="1.4" style="fill:var(--ab)"/><path d="M9.6 19.6h4.8" style="stroke:var(--ab)" stroke-width="1.1"/><path d="M10 2.6h-.9M10 3.8h-.9M14 2.6h.9M14 3.8h.9" stroke="currentColor" stroke-width=".9" stroke-linecap="round"/>',
  '<path d="M4 4l4.2 4h7.6L20 4v9.5a8 8 0 0 1-16 0z"/><circle cx="9" cy="13" r="1.3" fill="#1f1b1a"/><circle cx="15" cy="13" r="1.3" fill="#1f1b1a"/>',
  // 11 — берёзовый лист
  '<path d="M12 2.6 12.6 3.3 13.2 3.9 13.6 4.6 14.4 5.2 14.6 5.9 15.5 6.5 15.5 7.2 16.5 7.8 16.3 8.5 17.3 9.1 16.9 9.8 17.9 10.4 17.3 11.1 18.4 11.7 17.6 12.4 18.6 13 17.7 13.7 18.6 14.3 17.4 15 17.8 15.6 16.2 16.3 16 16.9 14.2 17.6 12 18.2 9.8 17.6 8 16.9 7.8 16.3 6.2 15.6 6.6 15 5.4 14.3 6.3 13.7 5.4 13 6.4 12.4 5.6 11.7 6.7 11.1 6.1 10.4 7.1 9.8 6.7 9.1 7.7 8.5 7.5 7.8 8.5 7.2 8.5 6.5 9.4 5.9 9.6 5.2 10.4 4.6 10.8 3.9 11.4 3.3 12 2.6z"/>'+
  '<path d="M12 18v3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12 5v12.6M12 9l-2.6-1.6M12 9l2.6-1.6M12 12l-3.6-1.9M12 12l3.6-1.9M12 15l-3.8-1.6M12 15l3.8-1.6" fill="none" style="stroke:var(--ab)" stroke-width=".8" stroke-linecap="round"/>'];
const AVA_COLS=['#b3263a','#2b5aa8','#2f5d3a','#c0702a','#6b3fa0','#1f1b1a','#8a5a2b','#2f7f86'];
function cleanAva(a){return a&&Number.isInteger(a.i)&&Number.isInteger(a.c)&&AVA_ICONS[a.i]&&AVA_COLS[a.c]?{i:a.i,c:a.c}:null;}
function botAva(name){const k={'Миша':{i:10,c:6},'Оля':{i:0,c:4},'Петрович':{i:9,c:2}}[name];return k||{i:4,c:5};}
function avaHTML(a,name,size){
  a=cleanAva(a);
  if(!a)return `<span class="ava ${size||''}">${esc(String(name||'?').slice(0,1).toUpperCase())}</span>`;
  return `<span class="ava ${size||''}" style="background:${AVA_COLS[a.c]};--ab:${AVA_COLS[a.c]}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${AVA_ICONS[a.i]}</svg></span>`;
}

/* ---------- вибрация, «Назад», экран не гаснет ---------- */
const Cap=window.Capacitor;
const native=()=>!!(Cap&&Cap.isNativePlatform&&Cap.isNativePlatform());
const plug=n=>native()&&Cap.Plugins?Cap.Plugins[n]:null;
// виды вибрации: play — своя карта легла, penalty — штраф, win — победа, boot (hit) — валенок, turn — ваш ход
const BUZZ={play:[12],penalty:[40,60,40],win:[30,50,30,50,120],boot:[60,40,140],hit:[60,40,140]};
function buzz(kind){
  if(!ui.vibro||ui.sim)return;
  try{
    const H=plug('Haptics'),pat=BUZZ[kind];
    if(H){
      if(kind==='turn'||kind==='play')H.impact({style:'LIGHT'});
      else if(kind==='boot'||kind==='hit')H.vibrate({duration:280});
      else if(pat){let t=0;pat.forEach((d,i)=>{if(i%2===0)setTimeout(()=>H.vibrate({duration:d}),t);t+=d;});}  // плагин не умеет узоры — собираем сами
      else H.vibrate({duration:120});
    }
    else if(navigator.vibrate)navigator.vibrate(kind==='turn'?30:pat||70);
  }catch(e){}
}
let wakeLock=null;ui.awake=false;
async function keepAwake(on){
  if(ui.awake===on)return;ui.awake=on;
  try{
    const K=plug('KeepAwake');
    if(K){if(on)await K.keepAwake();else await K.allowSleep();return;}
    if(on&&'wakeLock' in navigator){wakeLock=await navigator.wakeLock.request('screen');}
    else if(!on&&wakeLock){await wakeLock.release();wakeLock=null;}
  }catch(e){}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ui.awake&&!plug('KeepAwake')){ui.awake=false;keepAwake(true);}});
let lobbyBackAt=0;
function onBack(){
  const pop=$('pop');if(pop&&!pop.hidden){SOC.queue.shift();showPop();return;}
  if(!$('profile').hidden||!$('friendsScr').hidden||!$('settingsScr').hidden){showSetup();return;}
  if(!$('lobby').hidden){
    if(Date.now()-lobbyBackAt<2500){leaveGame();return;}
    lobbyBackAt=Date.now();netMsg('Нажмите «Назад» ещё раз, чтобы выйти из комнаты.','lobbyMsg');return;
  }
  if(!$('app').hidden&&G){
    if(ui.exit){ui.exit=false;render();return;}
    if(ui.score){ui.score=false;render();return;}
    if(ui.rules){ui.rules=false;render();return;}
    if((G.phase==='suit'&&G.suitBy===ME)||(G.phase==='blind'&&G.dealer===ME))return;
    ui.exit=true;render();return;
  }
  const A=plug('App');if(A)A.exitApp();
}
{const A=plug('App');if(A)A.addListener('backButton',onBack);}

/* ---------- приглашение ---------- */
const WEB_URL='https://v0lera.github.io/valenok/';
const APK_URL='https://github.com/V0lera/valenok/releases/latest/download/Valenok.apk';
async function invite(){
  const url=`${WEB_URL}?room=${NET.code}`;
  const text=`Давай сыграем в «Валенок»! Код комнаты: ${NET.code}\nОткрыть сразу в комнате: ${url}\nПриложение для Android: ${APK_URL}`;
  try{
    const S=plug('Share');
    if(S){await S.share({title:'Валенок',text,dialogTitle:'Позвать друга'});return;}
    if(navigator.share){await navigator.share({title:'Валенок',text});return;}
    await navigator.clipboard.writeText(text);netMsg('Приглашение скопировано — вставьте его в чат с другом.','lobbyMsg');
  }catch(e){
    if(e&&(e.name==='AbortError'||/cancel/i.test(e.message||'')))return;
    netMsg(`Скажите другу код комнаты: ${NET.code}`,'lobbyMsg');
  }
}

/* ---------- достижения ---------- */
const ACH=[
  ['first_game','Первая партия','Сыграть партию до конца',s=>s.games>=1],
  ['first_win','Первая победа','Закончить партию с наименьшим счётом',s=>s.wins>=1],
  ['valenok','Сам ты валенок','Проиграть партию — с кем не бывает',s=>s.valenki>=1],
  ['games10','Завсегдатай','Сыграть 10 партий',s=>s.games>=10],
  ['games50','Ветеран избы','Сыграть 50 партий',s=>s.games>=50],
  ['streak3','Три подряд','Выиграть 3 партии подряд',s=>s.bestStreak>=3],
  ['streak5','Неудержимый','Выиграть 5 партий подряд',s=>s.bestStreak>=5],
  ['lady','Дамский угодник','Закончить раунд дамой или королём червей',s=>s.minusCount>=1],
  ['minus50','Королевский уход','Уйти в минус на 50 одним ходом',s=>(s.bestMinus||0)<=-50],
  ['minus90','Минус девяносто','Уйти в минус на 90 одним ходом',s=>(s.bestMinus||0)<=-90],
  ['reset','С чистого листа','Набрать ровно 100 и обнулиться',s=>s.resets>=1],
  ['kh10','Щедрый король','Дать соперникам +5 десять раз',s=>s.khGiven>=10],
  ['hand15','Обжора','Держать на руке 15 карт',s=>s.maxHand>=15],
  ['online_win','Лучший среди друзей','Выиграть партию онлайн',(s,o)=>o.wins>=1],
  ['swatter','Мухобой','Прихлопнуть муху на столе',()=>!!lsGet('valenok-swat')]];
function checkAch(){
  if(ui.sim)return;
  const got=lsGet(ACH_KEY)||{},all=statsView('all'),on=statsView('online'),fresh=[];
  for(const [id,title,,test] of ACH)if(!got[id]&&test(all,on)){got[id]=Date.now();fresh.push(id);}
  if(!fresh.length)return;
  lsSet(ACH_KEY,got);
  const P=lsGet('valenok-ach-pending')||[];lsSet('valenok-ach-pending',[...P,...fresh]);
  fresh.forEach((id,k)=>setTimeout(()=>{
    const t=ACH.find(a=>a[0]===id)[1];
    if(!$('app').hidden)toast(`Достижение: ${t}`);else netMsg(`Новое достижение: ${t}`,curMsg());
    sfx('suit');
  },900+k*1900));
}
async function flushExtras(){
  try{
    const RV=lsGet(RIV_PEND);
    if(RV&&Object.keys(RV).length){lsSet(RIV_PEND,null);try{await N.addRivals(RV);}catch(e){const n=lsGet(RIV_PEND)||{};for(const[k,v] of Object.entries(RV)){const o=n[k]||{games:0,w:0,l:0};o.name=v.name;o.ava=v.ava;o.games+=v.games;o.w+=v.w;o.l+=v.l;n[k]=o;}lsSet(RIV_PEND,n);throw e;}}
    const A=lsGet('valenok-ach-pending');
    if(A&&A.length){await N.setAch(A);lsSet('valenok-ach-pending',null);}
    if(lsGet('valenok-ava-pending')){await N.setAvatar(ui.ava);lsSet('valenok-ava-pending',null);}
  }catch(e){}
}

/* ---------- оформление ---------- */
function applyTheme(){
  const b=document.body;
  b.classList.remove('t-izba','t-veranda','t-felt','b-cranberry','b-khokhloma','b-gzhel');
  b.classList.add('t-'+ui.table,'b-'+ui.back);
  renderDecor();
}

/* ---------- экран профиля ---------- */
function renderProfile(){
  const s=statsView(ui.ptab),mail=ui.pmail;
  const name=myName()||'Игрок';
  $('profName').textContent=name;$('profAva').innerHTML=avaHTML(ui.ava,name,'lg');
  $('profSub').textContent=mail?`Профиль привязан к ${mail}`:'Профиль на этом телефоне';
  document.querySelectorAll('#profTabs button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===ui.ptab));
  // три главные цифры крупно, остальное — под «Подробнее»
  const pct=s.games?Math.round((s.wins||0)/s.games*100)+'%':'—';
  $('profStats').innerHTML=`<div class="stats top3"><div class="stat key"><b>${s.games||0}</b><span>Партий</span></div><div class="stat key"><b>${pct}</b><span>Побед</span></div><div class="stat key"><b>${s.valenki||0}</b><span>Был валенком</span></div></div>
    <button class="btn mini pmore" data-act="pmore" aria-expanded="${!!ui.pmore}">${ui.pmore?'Скрыть':'Подробнее'}</button>
    <div class="stats"${ui.pmore?'':' hidden'}>${STAT_ROWS.filter(([k])=>k!=='games'&&k!=='valenki').map(([k,l])=>`<div class="stat ${k==='bestMinus'?'key':''}"><b>${fmtStat(k,s)}</b><span>${l}</span></div>`).join('')}</div>`;
  // аватарка
  $('profPick').hidden=!ui.pick;
  if(ui.pick)$('profPick').innerHTML=`<div class="pick-row">${AVA_ICONS.map((_,i)=>`<button class="pick ${ui.ava.i===i?'on':''}" data-act="pava" data-i="${i}" aria-label="Значок ${i+1}">${avaHTML({i,c:ui.ava.c},'','sm')}</button>`).join('')}</div>
    <div class="pick-row">${AVA_COLS.map((c,k)=>`<button class="pick col ${ui.ava.c===k?'on':''}" data-act="pcol" data-c="${k}" style="background:${c}" aria-label="Цвет ${k+1}"></button>`).join('')}</div>`;
  // достижения: свежие полученные, остальное — по кнопке
  const got=lsGet(ACH_KEY)||{};
  const have=ACH.filter(a=>got[a[0]]).sort((x,y)=>got[y[0]]-got[x[0]]);
  const next=ACH.filter(a=>!got[a[0]]);
  const list=ui.achAll?[...have,...next]:[...have.slice(0,4),...next.slice(0,Math.max(0,4-have.slice(0,4).length))];
  $('profAch').innerHTML=list.map(([id,t,d])=>`<div class="ach ${got[id]?'on':''}"><i aria-hidden="true">${got[id]?'★':'☆'}</i><b>${t}</b><span>${d}</span></div>`).join('');
  $('profAchN').textContent=`★ ${have.length} из ${ACH.length}`;
  $('achAllBtn').textContent=ui.achAll?'Свернуть':`Все достижения (${ACH.length})`;
}
function renderSettings(){
  const seg=(act,cur,opts)=>opts.map(([v,l])=>`<button data-act="${act}" data-v="${v}" aria-pressed="${cur===v}">${l}</button>`).join('');
  $('setTable').innerHTML=seg('stable',ui.table,[['izba','Изба'],['veranda','Веранда'],['felt','Сукно']]);
  $('setBack').innerHTML=seg('sback',ui.back,[['cranberry','Клюква'],['khokhloma','Хохлома'],['gzhel','Гжель']]);
  $('setSound').innerHTML=seg('ssound',ui.sound?'on':'off',[['on','Включён'],['off','Выключен']]);
  $('setVibro').innerHTML=seg('svibro',ui.vibro?'on':'off',[['on','Включена'],['off','Выключена']]);
  $('setMusic').innerHTML=seg('smusic',ui.music?'on':'off',[['on','Включена'],['off','Выключена']]);
  $('setBig').innerHTML=seg('sbig',ui.bigCards?'on':'off',[['off','Обычные'],['on','Крупные']]);
  $('backPreview').innerHTML='<div class="back"></div><div class="back"></div>';
  const mail=ui.pmail;
  $('profAcc').innerHTML=mail
    ?`<p>Профиль привязан к <b>${esc(mail)}</b>. Войдите с этой почтой на другом телефоне — статистика и друзья будут там же.</p>
      <button class="btn" data-act="plogout">Выйти из профиля</button>`
    :`<p>Статистика и друзья хранятся в облаке. Чтобы не потерять их при переустановке приложения или смене телефона, привяжите почту и пароль.</p>
      <input type="email" id="pMail" placeholder="почта" autocomplete="email">
      <input type="password" id="pPw" placeholder="пароль, от 6 символов" autocomplete="current-password">
      <div class="row"><button class="btn" data-act="plogin">Войти</button><button class="btn primary" data-act="plink">Привязать</button></div>`;
}
// текущий экран — куда писать сообщения
function curMsg(){return !$('friendsScr').hidden?'friendsMsg':!$('settingsScr').hidden?'setMsg':'profMsg';}
function updateBadge(){const n=Object.keys(SOC.requests||{}).length,b=$('reqBadge');if(!b)return;b.hidden=!n;b.textContent=n;}
function addRivals(a,b){const o=JSON.parse(JSON.stringify(a||{}));for(const[k,v] of Object.entries(b||{})){const r=o[k]||{games:0,w:0,l:0};r.name=v.name||r.name;r.ava=v.ava||r.ava;r.games+=v.games||0;r.w+=v.w||0;r.l+=v.l||0;o[k]=r;}return o;}
function plural(n,a,b,c){const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<10||h>=20)?b:c;}
async function loadProfile(){
  const pr=await N.getProfile();
  lsSet(CLOUD_KEY,pr.stats);lsSet(RIV_CLOUD,pr.rivals);
  const got=lsGet(ACH_KEY)||{};for(const k of Object.keys(pr.ach||{}))got[k]=got[k]||pr.ach[k];lsSet(ACH_KEY,got);
  if(pr.avatar&&cleanAva(pr.avatar)&&!lsGet('valenok-ava-pending')){ui.ava=cleanAva(pr.avatar);lsSet('valenok-ava',ui.ava);}
  ui.pmail=N.email();
}
async function openProfile(){
  ui.ptab=ui.ptab||'all';ui.pick=false;ui.achAll=false;showScreen('profile');renderProfile();netMsg('Обновляем…',curMsg());
  try{
    await flushStats();await loadProfile();checkAch();
    renderProfile();netMsg('',curMsg());
  }catch(e){netMsg(N.errText(e)+' Показаны данные, сохранённые на телефоне.',curMsg());}
}
async function profAuth(kind){
  const mail=($('pMail')||{}).value?.trim(),pw=($('pPw')||{}).value||'';
  if(kind!=='out'&&(!mail||!pw)){netMsg('Введите почту и пароль.',curMsg());return;}
  netMsg('Подождите…',curMsg());
  try{
    const reset=()=>{for(const k of [CLOUD_KEY,RIV_CLOUD,ACH_KEY,HOST_KEY,GUEST_KEY,'valenok-streak'])lsSet(k,null);};
    if(kind==='link')await N.linkEmail(mail,pw);
    else if(kind==='in'){await flushStats();await N.signInEmail(mail,pw);reset();}
    else{await flushStats();await N.signOutToAnon();reset();}
    await loadProfile();if(kind!=='link'){SOC.friends={};SOC.requests={};SOC.seenReq.clear();await startSocial();}renderSettings();
    netMsg(kind==='link'?'Готово: профиль привязан к почте.':kind==='in'?'Вы вошли в профиль.':'Вы вышли. На телефоне начат новый профиль.',curMsg());
  }catch(e){netMsg(N.authErrText(e),curMsg());}
}
function saveAva(){lsSet('valenok-ava',ui.ava);lsSet('valenok-ava-pending',true);renderProfile();flushStats();}
$('nameIn').addEventListener('change',()=>{lsSet('valenok-name',myName());if(!$('profile').hidden)renderProfile();if(SOC.started)N.updateMe(myName()||null,null).catch(()=>{});});
Object.assign(ACTS,{
  profile(){openProfile();},
  pback(){showSetup();},
  ptab(el){ui.ptab=el.dataset.m;renderProfile();},
  plink(){profAuth('link');},
  plogin(){profAuth('in');},
  plogout(){profAuth('out');},
  pavatar(){ui.pick=!ui.pick;renderProfile();},
  pava(el){ui.ava={i:+el.dataset.i,c:ui.ava.c};saveAva();},
  pcol(el){ui.ava={i:ui.ava.i,c:+el.dataset.c};saveAva();},
  stable(el){ui.table=el.dataset.v;lsSet('valenok-table',ui.table);applyTheme();renderSettings();},
  sback(el){ui.back=el.dataset.v;lsSet('valenok-back',ui.back);applyTheme();renderSettings();},
  slevel(el){ui.level=el.dataset.v;lsSet('valenok-level',ui.level);syncLevel();if(!$('settingsScr').hidden)renderSettings();},
  svibro(el){ui.vibro=el.dataset.v==='on';lsSet('valenok-vibro',ui.vibro);if(ui.vibro)buzz('turn');renderSettings();},
  smusic(el){ui.music=el.dataset.v==='on';lsSet('valenok-music',ui.music);if(ui.music)musicStart();else musicStop();renderSettings();},
  sbig(el){ui.bigCards=el.dataset.v==='on';lsSet('valenok-big',ui.bigCards);applyBig();renderSettings();},
  ssound(el){ui.sound=el.dataset.v==='on';if(ui.sound)musicStart();else musicStop();lsSet('valenok-sound-on',ui.sound);$('sndBtn').setAttribute('aria-pressed',ui.sound);if(ui.sound)sfx('turn');renderSettings();},
  achall(){ui.achAll=!ui.achAll;renderProfile();},
  pmore(){ui.pmore=!ui.pmore;renderProfile();},
  friends(){showScreen('friendsScr');netMsg('','friendsMsg');renderFriends();if(!SOC.started)startSocial().then(renderFriends);else{flushStats().then(()=>N.getProfile()).then(p=>{lsSet(RIV_CLOUD,p.rivals);renderFriends();}).catch(()=>{});}},
  settings(){showScreen('settingsScr');netMsg('','setMsg');renderSettings();N.init().then(()=>{ui.pmail=N.email();renderSettings();}).catch(()=>{});},
  invite(){invite();}
});
function syncLevel(){document.querySelectorAll('#setupLevel button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===ui.level));}
syncLevel();
applyTheme();
setTimeout(()=>{if(lsGet(PEND_KEY)||lsGet(RIV_PEND)||lsGet('valenok-ach-pending')||lsGet('valenok-ava-pending'))flushStats();},3000);
// Ссылка-приглашение: …/valenok/?room=1234
{
  const rq=new URLSearchParams(location.search).get('room');
  if(rq&&/^\d{4}$/.test(rq)){
    history.replaceState(null,'',location.pathname);
    setTimeout(()=>{
      ACTS.mode(document.querySelector('#modeSeg [data-m="friends"]'));$('codeIn').value=rq;
      guestJoin(rq);   // без имени войдёт как «Игрок»; имя можно поменять в «Профиле»
    },0);
  }
}

/* ================= Друзья: заявки, статусы, приглашения ================= */
const SOC={started:false,code:null,friends:{},requests:{},invites:{},seenReq:new Set(),seenInv:new Set(),invited:{},confirmDel:null,queue:[]};
const INV_TTL=10*60e3;
async function startSocial(){
  try{
    await N.init();ui.pmail=N.email();
    SOC.code=await N.ensureFriendCode();
    await N.updateMe(myName()||null,ui.ava);
    await N.watchSocial({
      onFriends(v){SOC.friends=v;socialChanged();},
      onRequests(v){SOC.requests=v;for(const [id,r] of Object.entries(v))if(!SOC.seenReq.has(id)){SOC.seenReq.add(id);popQueue({t:'req',id,...r});}socialChanged();},
      onInvites(v){
        SOC.invites=v;
        for(const [id,r] of Object.entries(v)){
          const key=id+':'+r.at;
          if(Date.now()-r.at>INV_TTL){N.clearInvite(id);continue;}
          if(!SOC.seenInv.has(key)){SOC.seenInv.add(key);popQueue({t:'inv',id,...r});}
        }
      }
    });
    SOC.started=true;statusNow();socialChanged();
  }catch(e){SOC.started=false;}
}
let statusT=null;
function statusNow(){
  if(!SOC.started)return;
  clearTimeout(statusT);
  statusT=setTimeout(()=>{
    const inGame=(!$('app').hidden&&G)||!$('lobby').hidden;
    N.setStatus(inGame?'game':'online',NET.role!=='local'?NET.code:null).catch(()=>{});
  },300);
}
function socialChanged(){
  updateBadge();
  if(!$('friendsScr').hidden)renderFriends();
  if(!$('lobby').hidden)renderLobbyFriends();
}
function statusText(st){
  if(!st)return {t:'не в сети',c:'off'};
  if(st.state==='game')return {t:'в игре',c:'game'};
  if(st.state==='online')return {t:'в сети',c:'on'};
  const m=Math.round((Date.now()-(st.at||0))/60000);
  return {t:m<2?'только что был':m<60?`был ${m} мин назад`:m<1440?`был ${Math.round(m/60)} ч назад`:`был ${Math.round(m/1440)} дн назад`,c:'off'};
}
function friendList(){
  const order={game:0,on:1,off:2};
  return Object.values(SOC.friends).sort((a,b)=>order[statusText(a.status).c]-order[statusText(b.status).c]||String(a.name).localeCompare(b.name));
}

/* ---------- всплывающие окна: заявки и приглашения ---------- */
function popQueue(item){SOC.queue.push(item);if(SOC.queue.length===1)showPop();}
function showPop(){
  let el=$('pop');
  if(!el){el=document.createElement('div');el.id='pop';el.setAttribute('role','alertdialog');document.body.appendChild(el);}
  const it=SOC.queue[0];
  if(!it){el.hidden=true;return;}
  if(it.t==='inv'&&Date.now()-it.at>INV_TTL){SOC.queue.shift();showPop();return;}
  const inRoom=NET.role!=='local'&&NET.code;
  el.innerHTML=it.t==='inv'
    ?`${avaHTML(it.ava,it.name,'')}<div class="pop-txt"><b>${esc(it.name)} зовёт вас в партию</b><span>Комната ${esc(it.room)}${inRoom&&it.room!==NET.code?(NET.role==='host'?' · ваша комната закроется':' · вы выйдете из текущей'):''}</span></div>
      <div class="pop-btns"><button class="btn" data-act="popno">Не сейчас</button><button class="btn primary" data-act="popyes">Войти</button></div>`
    :`${avaHTML(it.ava,it.name,'')}<div class="pop-txt"><b>${esc(it.name)} хочет добавить вас в друзья</b><span>Друзей можно звать в партию прямо из игры</span></div>
      <div class="pop-btns"><button class="btn" data-act="popno">Отклонить</button><button class="btn primary" data-act="popyes">Принять</button></div>`;
  el.classList.toggle('top',!$('app').hidden);el.hidden=false;sfx('join');buzz('turn');
}
async function popAnswer(yes){
  const it=SOC.queue.shift();showPop();
  if(!it)return;
  try{
    if(it.t==='req'){if(yes){await N.acceptRequest(it.id);toastAny(`${it.name} теперь в друзьях`);}else await N.declineRequest(it.id);}
    else{
      await N.clearInvite(it.id);
      if(!yes)return;
      if(NET.role!=='local'&&NET.code===it.room)return;
      if(NET.role!=='local')await leaveGame();
      else if(G){stashClock();save();clearTimeout(timer);G=null;}
      showSetup();ACTS.mode(document.querySelector('#modeSeg [data-m="friends"]'));
      $('codeIn').value=it.room;guestJoin(it.room);
    }
  }catch(e){toastAny(N.errText(e));}
}
function toastAny(m){if(!$('app').hidden)toast(m);else if(!$('profile').hidden||!$('friendsScr').hidden||!$('settingsScr').hidden)netMsg(m,curMsg());else if(!$('lobby').hidden)netMsg(m,'lobbyMsg');else netMsg(m);}

/* ---------- раздел «Друзья» в профиле ---------- */
function renderFriends(){
  const box=$('profFriends');if(!box)return;
  if(!SOC.started){box.innerHTML='<p class="hint">Подключаемся к серверу…</p>';return;}
  const RV=addRivals(lsGet(RIV_CLOUD)||{},lsGet(RIV_PEND)||{});
  const reqs=Object.entries(SOC.requests);
  const fr=friendList();
  const others=Object.entries(RV).filter(([id])=>!SOC.friends[id]&&id!==N.net.uid).sort((a,b)=>b[1].games-a[1].games).slice(0,8);
  const score=id=>{const r=RV[id];return r&&r.games?`<span class="vs ${r.w>r.l?'up':r.w<r.l?'down':''}">${r.w} : ${r.l}</span>`:'';};
  box.innerHTML=`
    <div class="fcode"><span>Ваш код друга</span><b>${SOC.code||'——————'}</b><button class="btn" data-act="fcopy">Поделиться</button></div>
    <div class="joinrow"><input type="text" id="fAdd" maxlength="6" placeholder="код друга" autocomplete="off" autocapitalize="characters"><button class="btn primary" data-act="fadd">Добавить</button></div>
    ${reqs.length?`<ul class="rivals">${reqs.map(([id,r])=>`<li>${avaHTML(r.ava,r.name,'sm')}<b>${esc(r.name)}</b><span>хочет дружить</span><button class="btn mini primary" data-act="freqyes" data-id="${id}">Принять</button><button class="x" data-act="freqno" data-id="${id}" aria-label="Отклонить">×</button></li>`).join('')}</ul>`:''}
    <ul class="rivals">${fr.length?fr.map(f=>{const st=statusText(f.status);return `<li>${avaHTML(f.ava,f.name,'sm')}<b>${esc(f.name)}</b><span class="st ${st.c}">${st.t}</span>${score(f.uid)}<button class="x" data-act="fdel" data-id="${f.uid}" aria-label="Удалить из друзей">${SOC.confirmDel===f.uid?'удалить?':'×'}</button></li>`;}).join('')
      :'<li class="empty">Пока никого. Поделитесь своим кодом или добавьте друга по его коду.</li>'}</ul>
    ${others.length?`<span class="label">Играли вместе</span><ul class="rivals">${others.map(([id,r])=>`<li>${avaHTML(r.ava,r.name,'sm')}<b>${esc(r.name||'Игрок')}</b>${score(id)}<button class="btn mini" data-act="fask" data-id="${id}">В друзья</button></li>`).join('')}</ul>`:''}
    ${ui.pmail?'':'<p class="hint">Привяжите почту в «Настройках», иначе после переустановки приложения список друзей пропадёт.</p>'}`;
}
async function addFriendByCode(){
  const code=($('fAdd').value||'').trim().toUpperCase();
  if(!/^[A-Z2-9]{6}$/.test(code)){netMsg('Код друга — 6 латинских букв и цифр.',curMsg());return;}
  if(code===SOC.code){netMsg('Это ваш собственный код.',curMsg());return;}
  netMsg('Ищем…',curMsg());
  try{
    const uid=await N.findByCode(code);
    if(!uid){netMsg('Игрока с таким кодом нет. Проверьте код.',curMsg());return;}
    await askFriend(uid);
  }catch(e){netMsg(N.errText(e),curMsg());}
}
async function askFriend(uid){
  if(SOC.friends[uid]){netMsg('Этот игрок уже у вас в друзьях.',curMsg());return;}
  if(SOC.requests[uid]){await N.acceptRequest(uid);netMsg('Готово: вы теперь друзья.',curMsg());return;}
  await N.sendRequest(uid,{name:myName()||'Игрок',ava:ui.ava});
  const c=await N.userCard(uid).catch(()=>({name:'игрок'}));
  netMsg(`Заявка отправлена: ${c.name}. Как только примет — появится в списке.`,curMsg());
}
async function shareCode(){
  const text=`Добавь меня в друзья в «Валенке»: мой код ${SOC.code}\nСкачать игру: ${APK_URL}\nИли играть в браузере: ${WEB_URL}`;
  try{
    const S=plug('Share');
    if(S){await S.share({title:'Валенок',text,dialogTitle:'Поделиться кодом'});return;}
    if(navigator.share){await navigator.share({title:'Валенок',text});return;}
    await navigator.clipboard.writeText(text);netMsg('Код скопирован — вставьте его в чат с другом.',curMsg());
  }catch(e){if(!(e&&(e.name==='AbortError'||/cancel/i.test(e.message||''))))netMsg(`Ваш код друга: ${SOC.code}`,curMsg());}
}

/* ---------- позвать друга из комнаты ---------- */
function renderLobbyFriends(){
  const box=$('lobbyFriends');if(!box)return;
  if(!SOC.started){box.innerHTML='';return;}
  const inRoom=new Set((NET.lobby&&NET.lobby.seats||[]).map(s=>s.uid).filter(Boolean));
  const fr=friendList();
  box.innerHTML=`<span class="label">Позвать из друзей</span>
    <ul class="rivals">${fr.length?fr.map(f=>{
      const st=statusText(f.status),here=inRoom.has(f.uid),sent=SOC.invited[f.uid]&&Date.now()-SOC.invited[f.uid]<INV_TTL;
      return `<li>${avaHTML(f.ava,f.name,'sm')}<b>${esc(f.name)}</b><span class="st ${st.c}">${here?'в комнате':st.t}</span>${here?'':`<button class="btn mini ${sent?'':'primary'}" data-act="finvite" data-id="${f.uid}" ${sent?'disabled':''}>${sent?'Позвали':'Позвать'}</button>`}</li>`;
    }).join(''):'<li class="empty">Друзей пока нет — добавьте их в профиле по коду.</li>'}</ul>`;
}
async function inviteFriend(fid){
  try{
    await N.sendInvite(fid,{name:myName()||'Игрок',ava:ui.ava},NET.code);
    SOC.invited[fid]=Date.now();renderLobbyFriends();
    netMsg(`Приглашение отправлено: ${(SOC.friends[fid]||{}).name||'другу'}.`,'lobbyMsg');
  }catch(e){netMsg(N.errText(e),'lobbyMsg');}
}

Object.assign(ACTS,{
  popyes(){popAnswer(true);},
  popno(){popAnswer(false);},
  fcopy(){shareCode();},
  fadd(){addFriendByCode();},
  fask(el){askFriend(el.dataset.id).catch(e=>netMsg(N.errText(e),curMsg()));},
  freqyes(el){N.acceptRequest(el.dataset.id).then(()=>netMsg('Готово: вы теперь друзья.',curMsg())).catch(e=>netMsg(N.errText(e),curMsg()));},
  freqno(el){N.declineRequest(el.dataset.id).catch(()=>{});},
  fdel(el){
    const id=el.dataset.id;
    if(SOC.confirmDel!==id){SOC.confirmDel=id;renderFriends();setTimeout(()=>{if(SOC.confirmDel===id){SOC.confirmDel=null;renderFriends();}},3000);return;}
    SOC.confirmDel=null;N.removeFriend(id).catch(e=>netMsg(N.errText(e),curMsg()));
  },
  finvite(el){inviteFriend(el.dataset.id);}
});
setTimeout(startSocial,1500);

/* ================= Подсказки новичку и обучение ================= */
// что делает карта — для подсказок и долгого нажатия
function cardInfo(c){
  if(isKH(c))return 'следующий берёт 5 карт и пропускает ход';
  return {'6':'следующий берёт 1 карту и пропускает ход','7':'следующий берёт 2 карты и пропускает ход',
    '8':'кроете её сами: той же мастью, восьмёркой или дамой','Q':'кладётся на любую карту, кроме К♥; вы заказываете масть',
    'A':'следующий пропускает ход'}[c.r]||'обычная карта';
}
const TIPS={'6':'<b>6</b> — следующий берёт 1 карту и пропускает ход','7':'<b>7</b> — следующий берёт 2 карты и пропускает ход',
  '8':'<b>8</b> — кто положил, тот и кроет: той же мастью, восьмёркой или дамой','Q':'<b>Дама</b> — на любую карту, кроме К♥; заказывает масть',
  'KH':'<b>К♥</b> — следующий берёт 5 и пропускает ход; другой король сверху отменяет','A':'<b>Туз</b> — следующий игрок пропускает ход'};
// спецкарта впервые легла на стол — один раз объясняем, что она делает
function rankTip(c){
  const k=isKH(c)?'KH':c.r;if(!TIPS[k])return;
  const seen=lsGet('valenok-seen')||{};if(seen[k])return;
  seen[k]=1;lsSet('valenok-seen',seen);showTip(TIPS[k]);
}
function showTip(m){
  let el=$('tipBar');
  if(!el){el=document.createElement('div');el.id='tipBar';el.setAttribute('role','status');$('table').appendChild(el);}
  el.innerHTML=`<span>${m}</span><button data-act="tipx" aria-label="Закрыть подсказку">×</button>`;el.hidden=false;
  clearTimeout(showTip.t);showTip.t=setTimeout(()=>{el.hidden=true;},4200);
}
// долгое нажатие на карту в руке — что она делает и сколько стоит
function cardTip(c,btn){
  document.querySelectorAll('.cardtip').forEach(e=>e.remove());
  const r=btn.getBoundingClientRect(),el=document.createElement('div');el.className='cardtip';
  el.innerHTML=`<b>${ctxt(c)}</b> — ${cardInfo(c)}. <span>${val(c)} очк.</span>`;
  el.style.left=Math.max(130,Math.min(innerWidth-130,r.left+r.width/2))+'px';el.style.top=r.top+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),2400);buzz('turn');
}
let lp=null;
$('hand').addEventListener('pointerdown',e=>{
  ui.lpFired=false;const btn=e.target.closest('.cardbtn');if(!btn)return;
  if(lp)clearTimeout(lp.t);
  lp={x:e.clientX,y:e.clientY,pid:e.pointerId,t:setTimeout(()=>{
    lp=null;const c=byId(btn.dataset.id);if(!c||!btn.isConnected)return;
    ui.lpFired=true;if(drag&&!drag.el)drag=null;cardTip(c,btn);
  },450)};
});
window.addEventListener('pointermove',e=>{if(lp&&e.pointerId===lp.pid&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>10){clearTimeout(lp.t);lp=null;}});
{const end=()=>{if(lp){clearTimeout(lp.t);lp=null;}};window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);}
$('hand').addEventListener('contextmenu',e=>e.preventDefault());
// после долгого нажатия карта не выбирается
document.addEventListener('click',e=>{if(ui.lpFired&&e.target.closest('#hand')){ui.lpFired=false;e.stopImmediatePropagation();e.preventDefault();}},true);

/* ---------- обучение: партия один на один с заранее разложенной колодой ---------- */
// Вы: 6♠ 8♠ Д♥ К♥ 9♥ 9♣, Оля: 10♥ и прочее, на столе 9♠. Сценарий: 6 → 8 → дама (заказ ♥) → Оля 10♥ → К♥ → две девятки.
function tutDeck(){
  const me=['6S','8S','QH','KH','9H','9C'],bot=['10H','7D','JC','10D','AC','7C'],top=[];
  for(let i=0;i<6;i++)top.push(me[i],bot[i]);top.push('9S');
  const all=newDeck(),f=id=>all.find(c=>c.id===id);
  return [...top.map(f),...all.filter(c=>!top.includes(c.id))].reverse();   // карты берутся с конца
}
function tutBot(pi){
  const c=P(pi).hand.find(x=>x.id==='10H');
  return topCard().r==='Q'&&G.namedSuit==='H'&&c?[c]:bestMove(pi);
}
// какие карты сейчас нужно положить (null — свободная игра)
function tutWant(){
  if(!ui.tut||!G||!myTurn())return null;
  const h=P(ME).hand.map(c=>c.id),t=topCard();let w;
  if(h.includes('6S'))w=['6S'];else if(h.includes('8S'))w=['8S'];
  else if(t.r==='8'&&G.eightOwner===ME)w=['QH'];else if(h.includes('KH'))w=['KH'];
  else w=['9H','9C'];
  return w.some(id=>{const c=byId(id);return c&&canStart(c);})?w:null;
}
function tutText(){
  const t=topCard(),w=tutWant(),S=SYM;
  if(G.phase==='suit')return `Дама заказывает масть: следующий обязан ходить ею. Выберите <b>${S.H} черви</b>.`;
  if(G.phase==='round'||G.phase==='over')return 'Готово! Вы избавились от всех карт.';
  if(!w){
    if(!myTurn()){
      if(t.id==='6S')return `<b>6</b> — соперник берёт 1 карту и пропускает ход.`;
      if(isKH(t))return `<b>К${S.H}</b> — соперник берёт 5 карт и пропускает ход!`;
      if(t.r==='Q')return `Оля обязана ходить заказанной мастью — <b>${S.H} черви</b>.`;
      return 'Ходит соперник…';
    }
    return 'Дальше — сами: ходите в масть или в значение. Нечем — возьмите карту.';
  }
  if(w[0]==='6S')return `Ходите <b>в масть или в значение</b> верхней карты. Положите <b>6${S.S}</b> — соперник возьмёт карту и пропустит ход. Нажмите карту и «Сходить» или коснитесь её дважды.`;
  if(w[0]==='8S')return `Соперник пропускает — снова ваш ход. Положите <b>8${S.S}</b>.`;
  if(w[0]==='QH')return `Восьмёрку кроете <b>вы сами</b>: той же мастью, восьмёркой или дамой. Положите <b>Д${S.H}</b> — дама ложится на любую карту.`;
  if(w[0]==='KH')return `Оля сходила червями. Положите <b>К${S.H}</b> — соперник возьмёт 5 карт!`;
  return `Можно выложить <b>несколько карт одного значения</b>: нажмите 9${S.H}, затем 9${S.C} и «Сходить» — и раунд ваш! Долгое нажатие на карту подскажет, что она делает.`;
}
function renderCoach(){
  let el=$('coach');
  if(!ui.tut){if(el)el.hidden=true;return;}
  if(!el){el=document.createElement('div');el.id='coach';el.setAttribute('aria-live','polite');$('app').insertBefore(el,$('status'));}
  const h=`<span class="coach-t">Обучение</span><p>${tutText()}</p><button class="x" data-act="exit" aria-label="Выйти из обучения">×</button>`;
  el.hidden=false;if(el.dataset.h!==h){el.innerHTML=h;el.dataset.h=h;}
}
function tutDoneHTML(){
  return `<h2>Обучение пройдено!</h2><p>Вы первым избавились от карт и выиграли раунд. Остальные получают очки за карты на руке; набравший больше 100 — валенок. Все правила — по кнопке «?» в игре.</p>
    <div class="row"><button class="btn" data-act="tutmenu">В меню</button><button class="btn primary" data-act="tutplay">Играть с ботами</button></div>`;
}
Object.assign(ACTS,{
  tutorial(){
    if(NET.role!=='local')return;
    clearTimeout(timer);lsSet('valenok-tut-offered',true);lsSet('valenok-seen',null);
    if(G){stashClock();save();}
    NET.role='local';ME=0;ui.score=ui.exit=ui.rules=false;ui.tut={};
    newGame([{name:myName()||'Вы'},{name:'Оля',bot:true}],0);
  },
  tutno(){lsSet('valenok-tut-offered',true);$('tutOffer').hidden=true;},
  tutmenu(){clearTimeout(timer);G=null;showSetup();},
  tutplay(){clearTimeout(timer);G=null;ui.tut=null;ACTS.start();},
  tipx(){const el=$('tipBar');if(el)el.hidden=true;}
});

/* ================= Игра с друзьями ================= */
function netMsg(m,id='netMsg'){$(id).textContent=m||'';}
function busy(on){document.querySelectorAll('#panelFriends button').forEach(b=>b.disabled=on);}

async function hostCreate(){
  const name=myName()||'Хозяин';lsSet('valenok-name',myName());
  busy(true);netMsg('Создаём комнату…');
  try{
    const code=await N.createRoom(name,ui.timer,ui.ava);
    NET.role='host';NET.code=code;ME=0;NET.lobby={seats:[{uid:N.net.uid,name,ava:ui.ava,kind:'human'}],timer:ui.timer};
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
    L.seats.push({uid,name:String(v&&v.name||'Игрок').slice(0,14)||'Игрок',ava:cleanAva(v&&v.ava),kind:'human'});
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
  L.seats.push({kind:'bot',name,ava:botAva(name)});N.write(`rooms/${NET.code}/seats`,L.seats);renderLobby();
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
  const pl=seats.map(s=>({name:s.name,bot:s.kind==='bot',uid:s.uid,ava:s.ava}));
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
    h+=`<li>${avaHTML(s.ava,s.name,'sm')}${s.kind==='bot'?'':`<i class="dot ${on?'':'off'}"></i>`}<b>${esc(s.name)}${me&&i!==0?' (вы)':''}</b><span class="chip">${tag||'игрок'}</span>${host&&i>0?`<button class="x" data-act="kick" data-i="${i}" aria-label="Убрать">×</button>`:''}</li>`;
  }
  $('lobbySeats').innerHTML=h;
  renderLobbyFriends();
  $('lobbyBtns').innerHTML=host
    ?`<button class="btn primary" data-act="invite">Позвать друга</button>
      <button class="btn" data-act="addbot" ${L.seats.length>=4?'disabled':''}>Добавить бота</button>
      <button class="btn primary" data-act="begin" ${L.seats.length<2?'disabled':''}>Начать игру (${L.seats.length})</button>
      <button class="btn" data-act="lobbyleave">Закрыть комнату</button>`
    :`<button class="btn" data-act="invite">Позвать ещё друга</button><button class="btn" data-act="lobbyleave">Выйти из комнаты</button>`;
}
let pubQueued=false;
function queuePublish(){if(pubQueued)return;pubQueued=true;setTimeout(publish,0);}
function publish(){
  pubQueued=false;if(NET.role!=='host'||!G)return;
  const code=NET.code;
  const pub={n:G.n,round:G.round,dealer:G.dealer,cur:G.cur,phase:G.phase,namedSuit:G.namedSuit,eightOwner:G.eightOwner,
    suitBy:G.suitBy,drew:G.drew,skipping:!!G.skipping,timer:G.timer,deadline:G.deadline,pile:G.pile.slice(-4),deckLen:G.deck.length,
    log:G.log.slice(-4),result:G.result,streak:(G.streak||[]).slice(),
    players:G.players.map(p=>({name:p.name,score:p.score,skips:p.skips,count:p.hand.length,bot:p.bot,uid:p.uid,online:p.online,ava:p.ava||null}))};
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
    const room=await N.joinRoom(code,name,ui.ava);
    NET.role='guest';NET.code=code;NET.hostUid=room.host;NET.lobby={seats:room.seats||[],timer:room.timer};
    NET.pub=null;NET.hand=[];NET.lastV=-1;NET.firstPub=true;NET.seated=false;NET.status=room.status;ui.gsel=[];G=null;
    lsSet(GUEST_KEY,{code,at:Date.now()});
    guestSubscribe();netMsg('');
    if(room.status==='lobby')renderLobby();
  }catch(e){netMsg(N.errText(e));lsSet(GUEST_KEY,null);$('rejoinBtn').hidden=true;}
  busy(false);
}
function guestSubscribe(){
  const code=NET.code;
  N.watch(`rooms/${code}/seats`,v=>{
    NET.lobby.seats=Array.isArray(v)?v:Object.values(v||{});
    const inRoom=NET.lobby.seats.some(s=>s&&s.uid===N.net.uid);
    if(inRoom)NET.seated=true;
    else if(NET.seated&&!G){guestClosed('Хозяин убрал вас из комнаты.');return;}
    if(!G&&NET.status!=='playing')renderLobby();
  });
  clearTimeout(NET.seatT);NET.seatT=setTimeout(()=>{if(NET.role==='guest'&&!NET.seated&&!G)guestClosed('Не удалось занять место: комната заполнена или хозяин не в сети.');},15000);
  N.watch(`rooms/${code}/presence`,v=>{NET.presence=v||{};if(!G)renderLobby();else{NET.hostAway=!NET.presence[NET.hostUid];guestRender();}});
  N.watch(`rooms/${code}/status`,v=>{
    NET.status=v;
    if(v==='closed'||v===null){guestClosed('Хозяин закрыл комнату.');return;}
    if(v==='lobby'&&!G)renderLobby();
  });
  N.watch(`rooms/${code}/pub`,v=>{if(v){NET.pub=v;guestRender();}});
  N.watch(`hands/${code}/${N.net.uid}`,v=>{NET.hand=Array.isArray(v)?v:[];guestRender();});
}
function guestClosed(m){
  clearTimeout(NET.seatT);N.leave();NET.role='local';NET.code=null;G=null;lsSet(GUEST_KEY,null);showSetup();
  ACTS.mode(document.querySelector('#modeSeg [data-m="friends"]'));netMsg(m);
}
// карты от хозяина проверяем: только настоящие значения и масти
const okCard=c=>c&&RANKS.includes(c.r)&&SUITS.includes(c.s)?{r:c.r,s:c.s,id:c.r+c.s}:null;
const okCards=a=>(Array.isArray(a)?a:Object.values(a||{})).map(okCard).filter(Boolean);
let gRenderQueued=false;
function guestRender(){if(gRenderQueued)return;gRenderQueued=true;setTimeout(guestApply,0);}
function guestApply(){
  gRenderQueued=false;
  const pub=NET.pub;if(!pub||NET.role!=='guest'||!Array.isArray(pub.players))return;
  const me=pub.players.findIndex(p=>p&&p.uid===N.net.uid);
  if(me<0){if(NET.status&&NET.status!=='lobby')guestClosed('Игра началась без вас: места в комнате не хватило.');return;}
  for(const e of pub.ev||[])if(e&&e.cards)e.cards=okCards(e.cards);
  // анимации — до перерисовки, пока карты ещё на своих местах
  if(pub.v!==NET.lastV){
    const first=NET.lastV<0;NET.lastV=pub.v;
    if(!first&&G)for(const e of pub.ev||[]){
      if(e.t==='play'&&e.pi===me){bump('thrown',e.cards.reduce((a,c)=>a+val(c),0));if(isKH(e.cards[e.cards.length-1])&&NET.hand.length)bump('khGiven');}
      if(e.t==='draw'&&e.pi===me){bump('drawn',e.n);bump('maxHand',NET.hand.length);}
      if(e.t==='play'){
        const from=e.pi===me?e.cards.map(c=>{const el=document.querySelector(`#hand [data-cid="${c.id}"]`);return el?el.getBoundingClientRect():null;}):(()=>{const s=seatEl(e.pi);const r=s?s.getBoundingClientRect():null;return e.cards.map(()=>r);})();
        if(!RM){ui.fx.push({t:'play',pi:e.pi,cards:e.cards,from});e.cards.forEach(c=>ui.hold.add(c.id));}else sfx('card');
      }else if(['draw','shake','deal','big','skip','suit','crown','tsar'].includes(e.t)){ui.fx.push(e);if(e.t==='deal'){ui.dealStart=Date.now()+shufMs();ui.dealUntil=ui.dealStart+e.order.length*55+450;ui.flipAt=ui.dealUntil;ui.known=new Set();}}
      else if(e.t==='snd')sfx(e.n);
      else if(e.t==='toast')toast(e.m);
    }
  }
  const wasMyTurn=G&&G.phase==='play'&&G.cur===ME;
  ME=me;
  const hand=okCards(NET.hand);
  G={n:pub.n,round:pub.round,dealer:pub.dealer,cur:pub.cur,phase:pub.phase,namedSuit:pub.namedSuit??null,eightOwner:pub.eightOwner??null,
     suitBy:pub.suitBy??null,drew:!!pub.drew,skipping:!!pub.skipping,timer:pub.timer,deadline:pub.deadline||null,pile:okCards(pub.pile),deck:new Array(pub.deckLen||0),
     log:pub.log||[],result:pub.result||null,sel:[],streak:(Array.isArray(pub.streak)?pub.streak:Object.values(pub.streak||{})).map(x=>+x||0),
     players:pub.players.map((p,i)=>({...p,hand:i===me?hand:new Array(p.count||0).fill(0)}))};
  if(G.result&&!Array.isArray(G.result.rows))G.result.rows=Object.values(G.result.rows||{});
  if(G.result){G.result.finish=String(G.result.finish||'');G.result.rows.forEach(x=>{x.list=okCards(x.list);x.cards=String(x.cards||'');x.name=String(x.name||'Игрок');});}
  ui.gsel=ui.gsel.filter(id=>hand.some(c=>c.id===id));
  if(NET.firstPub){NET.firstPub=false;prevPhase=G.phase;}  // зашли посреди итогов раунда — не считаем его повторно
  if(!wasMyTurn&&G.phase==='play'&&G.cur===ME){sfx('turn');buzz('turn');ui.hintAt=Date.now();}
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
    try{
      await N.write(`rooms/${NET.code}/status`,'closed');
      const u={};u[`rooms/${NET.code}`]=null;
      for(const s of (NET.lobby&&NET.lobby.seats)||[])if(s&&s.uid&&s.kind!=='bot'&&s.uid!==N.net.uid)u[`hands/${NET.code}/${s.uid}`]=null;
      setTimeout(()=>N.patchRoot(u).catch(()=>{}),1500);
    }catch(e){}
    await N.leave();lsSet(HOST_KEY,null);
  }else if(NET.role==='guest'){await N.leave();lsSet(GUEST_KEY,null);}
  else{stashClock();save();}
  const wasOnline=NET.role!=='local';
  NET.role='local';NET.code=null;NET.lobby=null;G=null;ME=0;ui.tut=null;
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
// веранда: стакан чая в подстаканнике (сверху) и яблоко
function glassSVG(){
  const h='M78 58h7a9 9 0 0 1 9 9v10a9 9 0 0 1-9 9h-7';
  return `<svg class="glass" viewBox="0 0 100 110"><defs><radialGradient id="tea2" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#c0602a"/><stop offset="1" stop-color="#5a1c08"/></radialGradient></defs>
    <path d="${h}" fill="none" stroke="#8d939b" stroke-width="7"/><path d="${h}" fill="none" stroke="#dfe2e6" stroke-width="2.2"/>
    <circle cx="48" cy="72" r="32" fill="#b9bec5" stroke="#7d838b" stroke-width="1.6"/>
    <circle cx="48" cy="72" r="29.4" fill="none" stroke="#eceff2" stroke-width="2" stroke-dasharray="1.2 3.4" stroke-linecap="round"/>
    <polygon points="75,72 72.3,83.7 64.8,93.1 54,98.3 42,98.3 31.2,93.1 23.7,83.7 21,72 23.7,60.3 31.2,50.9 42,45.7 54,45.7 64.8,50.9 72.3,60.3" fill="rgba(236,244,248,.6)" stroke="rgba(255,255,255,.85)" stroke-width="1"/>
    <circle cx="48" cy="72" r="23" fill="url(#tea2)"/>
    <circle cx="40" cy="79" r="7.5" fill="#e9c234"/><circle cx="40" cy="79" r="6.2" fill="#f8e58a"/>
    <g stroke="#e9c234" stroke-width="1">${ring(40,79,6,6,8,(x,y)=>`<line x1="40" y1="79" x2="${x}" y2="${y}"/>`)}</g>
    <path d="M58 66L92 24" stroke="#b4bac1" stroke-width="3.6" stroke-linecap="round"/><path d="M58 66L92 24" stroke="#f1f3f5" stroke-width="1.1" stroke-linecap="round"/>
    <ellipse cx="93" cy="22.4" rx="3.4" ry="2.4" transform="rotate(-51 93 22.4)" fill="#b4bac1"/>
    <ellipse cx="38" cy="61" rx="8" ry="3.2" fill="rgba(255,255,255,.25)" transform="rotate(-30 38 61)"/>
    <g class="steam"><path d="M40 64c-6-8 6-14 0-22s6-14 0-20"/><path d="M50 62c6-8-6-14 0-22s-6-14 0-20"/><path d="M58 66c-6-8 6-14 0-22s6-14 0-20"/></g></svg>`;
}
function appleSVG(){
  return `<svg class="apple" viewBox="0 0 60 60"><defs><radialGradient id="apl" cx=".35" cy=".35" r=".75"><stop offset="0" stop-color="#e0503a"/><stop offset=".7" stop-color="#b3263a"/><stop offset="1" stop-color="#7d1626"/></radialGradient></defs>
    <path d="M30 17c-6-5-20-4-22 10-2 13 7 26 16 26 3 0 4-1.4 6-1.4s3 1.4 6 1.4c9 0 18-13 16-26-2-14-16-15-22-10z" fill="url(#apl)"/>
    <ellipse cx="44" cy="36" rx="5" ry="8" fill="rgba(240,190,80,.35)" transform="rotate(-20 44 36)"/><ellipse cx="18" cy="27" rx="4" ry="6.5" fill="rgba(255,255,255,.3)" transform="rotate(25 18 27)"/>
    <path d="M30 18c0-5 1-8 3.4-10.4" fill="none" stroke="#5b3a22" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M33 12c4-6 11-6.5 14-3.4-4 4-9 5.4-14 3.4z" fill="#4f8a3a"/><path d="M33 12c4-2 8-3 13-3" fill="none" stroke="#35652a" stroke-width=".8"/></svg>`;
}
// сукно: грифельная доска со счётом палочками вместо салфетки
function slateSVG(){
  return `<svg class="slate" viewBox="0 0 120 86"><rect x="2" y="2" width="116" height="82" rx="5" fill="#8a5a2b" stroke="#5b3a1c" stroke-width="1.5"/>
    <rect x="5" y="5" width="110" height="76" rx="3" fill="none" stroke="rgba(255,220,170,.25)"/><rect x="10" y="10" width="100" height="66" rx="2" fill="#2f3a36"/>
    <ellipse cx="42" cy="46" rx="28" ry="12" fill="rgba(255,255,255,.05)"/><ellipse cx="82" cy="30" rx="20" ry="8" fill="rgba(255,255,255,.04)"/>
    <g stroke="#ecebe4" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".88">
      <path d="M20 21l.6 16M25 20.5l-.3 16.5M30 21l.4 16M35 20.8l-.2 16.4M17 33l21-8"/>
      <path d="M48 21l.4 16M53 20.6l-.2 16.6M58 21.2l.3 15.8M63 20.6l-.3 16.4M45 32.6l21-7.6"/>
      <path d="M76 21l.3 16M81 20.8l-.2 16.2"/>
      <path d="M20 49l.4 15M25 48.6l-.2 15.6M30 49l.3 15" opacity=".8"/>
      <path d="M17 70q30-3 62 0" stroke-width="1.3" opacity=".6"/></g>
    <rect x="80" y="77.6" width="16" height="4.4" rx="2" fill="#f4f1e8" transform="rotate(-4 88 80)"/></svg>`;
}
// убранство зависит от стола; перерисовываем только при смене
function renderDecor(){
  const d=$('decor'),t=ui.table;if(!d||renderDecor.t===t)return;renderDecor.t=t;
  d.innerHTML=t==='veranda'?doilySVG()+glassSVG()+appleSVG()+bagelsSVG()+seedsSVG()+matchesSVG()
    :t==='felt'?slateSVG()+mugSVG()+bagelsSVG()+matchesSVG()
    :doilySVG()+mugSVG()+bagelsSVG()+seedsSVG()+matchesSVG();
  try{markProps();applySeason();}catch(e){}   // при самом первом вызове праздничный модуль ещё не загружен
}

/* ================= Анимации и украшения ================= */
// элемент, который сам исчезнет после анимации
function fxEl(cls,html,x,y,life=1400){
  const el=document.createElement('div');el.className='fxa '+cls;el.innerHTML=html;
  el.style.left=x+'px';el.style.top=y+'px';document.body.appendChild(el);
  setTimeout(()=>el.remove(),life);return el;
}
function targetCenter(pi){
  const el=pi===ME?$('handWrap'):seatEl(pi);if(!el)return null;
  const r=el.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];
}
// угол места игрока, чтобы штамп не закрывал имя: у соперников — правый нижний, у меня — правый верхний
function targetCorner(pi){
  const el=pi===ME?$('handWrap'):seatEl(pi);if(!el)return null;
  const r=el.getBoundingClientRect();
  return pi===ME?[r.right-58,r.top+26]:[r.right-26,r.bottom-16];
}
// эффекты на одного игрока идут друг за другом (+250 мс), отложенные сбрасываются в конце раунда
const fxBusy={};let fxGen=0;
function queueFx(pi,fn){
  const now=Date.now(),at=Math.max(now,fxBusy[pi]||0);fxBusy[pi]=at+250;
  if(at<=now){fn();return;}
  const g=fxGen;setTimeout(()=>{if(g===fxGen)fn();},at-now);
}
// круглый чернильный штамп «ПРОПУСК ХОДА»; неровный край — статичная маска с крапинками
const SKIP_SVG='<svg viewBox="0 0 100 100" aria-hidden="true"><defs><mask id="skm"><rect width="100" height="100" fill="#fff"/><g fill="#000">'+
  "<circle cx='17.8' cy='18.7' r='1.7'/><circle cx='92' cy='34.1' r='1.9'/><circle cx='90.9' cy='57.5' r='1.9'/><circle cx='22.2' cy='12.3' r='0.8'/><circle cx='11.8' cy='57.5' r='1.4'/><circle cx='17.7' cy='33.8' r='1'/><circle cx='41.3' cy='96.2' r='1.7'/><circle cx='74.5' cy='88.4' r='0.9'/><circle cx='22.2' cy='24.8' r='0.7'/><circle cx='76.6' cy='22.2' r='1'/><circle cx='96.2' cy='44.9' r='1.1'/><circle cx='63.3' cy='95.4' r='1.6'/><circle cx='25.6' cy='79.1' r='0.9'/><circle cx='86.3' cy='65.8' r='1.5'/><circle cx='34' cy='47' r='.8'/><circle cx='68' cy='52' r='.7'/>"+
  '</g></mask></defs><g mask="url(#skm)"><circle cx="50" cy="50" r="46.6" fill="#efe2c8" fill-opacity=".9"/><g fill="none" stroke="#7a1828"><circle cx="50" cy="50" r="44" stroke-width="5.5" stroke-dasharray="52 2 37 1.5 70 2.5 41 1.8 63"/><circle cx="50" cy="50" r="36.5" stroke-width="1.6"/><path d="M16 39.5h68M16 61.5h68" stroke-width="2"/></g>'+
  '<g fill="#7a1828"><text x="50" y="56.6" text-anchor="middle" font-size="17" textLength="64" lengthAdjust="spacingAndGlyphs">ПРОПУСК</text><text x="50" y="77" text-anchor="middle" font-size="10" textLength="30" lengthAdjust="spacingAndGlyphs">ХОДА</text>'+
  '<path d="M38 24.5l2 3.5-2 3.5-2-3.5zM50 22.5l2.4 4-2.4 4-2.4-4zM62 24.5l2 3.5-2 3.5-2-3.5z"/></g></g></svg>';
const CROWN_SVG='<svg viewBox="0 0 64 48" aria-hidden="true"><path d="M6 40h52l-4-28-12 11L32 4 22 23 10 12z" fill="#e0b24a" stroke="#8a6420" stroke-width="2"/><circle cx="32" cy="27" r="4" fill="#b3263a"/><circle cx="18" cy="31" r="3" fill="#2b5aa8"/><circle cx="46" cy="31" r="3" fill="#2b5aa8"/></svg>';
const BOOT_SVG='<svg viewBox="0 0 120 130" aria-hidden="true"><defs><linearGradient id="bootg" x1="0" x2="1"><stop offset="0" stop-color="#8d857d"/><stop offset=".55" stop-color="#a8a097"/><stop offset="1" stop-color="#776f67"/></linearGradient></defs><path fill="url(#bootg)" d="M14 4h44v62c0 9 6 13 16 15l18 4c12 2 17 10 14 19-2 7-8 9-17 9H24c-7 0-12-5-12-12z"/><rect x="11" y="2" width="50" height="13" rx="4" fill="#6f675f"/><path d="M15 33l7-5 7 5 7-5 7 5 7-5 7 5" fill="none" stroke="#b3263a" stroke-width="4" stroke-linejoin="round"/><path d="M15 40h44M15 26h44" stroke="#e9c234" stroke-width="2"/><path fill="#2a2420" d="M11 106h106c-1 8-8 11-18 11H24c-7 0-12-4-13-11z"/></svg>';

// обработка новых эффектов из очереди ui.fx (вызывается из runFx)
function runExtraFx(f){
  if(f.t==='deal'){
    const from=$('deck').getBoundingClientRect();const [fx,fy]=center(from);
    const sh=shufMs();if(sh)riffle(from,sh);   // сначала тасуем над колодой
    f.order.forEach((pi,k)=>{
      const tgt=pi===ME?$('handWrap'):seatEl(pi);if(!tgt)return;
      const [tx,ty]=center(tgt.getBoundingClientRect());
      const el=flyer('<div class="back" style="width:100%;height:100%;border-radius:8px"></div>',from);
      const d=sh+k*55;
      const a=el.animate([{transform:'translate(0,0) rotate(0)',opacity:1},{transform:`translate(${tx-fx}px,${ty-fy}px) rotate(${pi===ME?0:-20}deg) scale(${pi===ME?.75:.32})`,opacity:pi===ME?.9:.2}],
        {duration:330,delay:d,easing:'cubic-bezier(.3,.6,.3,1)',fill:'backwards'});
      if(k%3===0)setTimeout(()=>sfx('draw'),d);
      a.onfinish=()=>el.remove();setTimeout(()=>el.remove(),d+700);
    });
  }else if(f.t==='big'){
    queueFx(f.pi,()=>{const c=targetCorner(f.pi);if(c)fxEl('bigfx',esc(f.text),c[0]-34,c[1]-6,1150);});   // бирка левее штампа
  }else if(f.t==='skip'){
    queueFx(f.pi,()=>{const c=targetCorner(f.pi);if(c)fxEl('skipfx',SKIP_SVG,c[0],c[1],1150);});
  }else if(f.t==='suit'){
    const p=$('pile').getBoundingClientRect(),t=$('table').getBoundingClientRect();
    const el=fxEl('suitfx '+(isRed(f.s)?'red':''),SYM[f.s],p.left+p.width/2,p.top+p.height/2,1500);
    el.style.setProperty('--dy',(t.bottom-20-(p.top+p.height/2))+'px');
  }else if(f.t==='crown'){
    const p=$('pile').getBoundingClientRect();fxEl('crownfx',CROWN_SVG,p.left+p.width/2,p.top+p.height*.3,1500);
  }else if(f.t==='tsar')tsarFx(f.pi);
}

/* ---------- финал: конфетти и падающий валенок ---------- */
// три вида по очереди: бумажки, снежинки, шелуха от семечек
let confStyle=Math.random()*3|0;
function confetti(big){
  if(RM||ui.sim)return;
  const kind=confStyle=(confStyle+1)%3;
  const cols=kind===0?['#d9ad55','#b3263a','#f7f2e8','#2b5aa8','#9fd3a4']:kind===1?['#f7f2e8','#dfe9f5','#bcd3ee']:['#1f1b1a','#2a2522','#d9cdb8'];
  const n=big?40:24;
  for(let i=0;i<n;i++){
    const el=document.createElement('i');el.className='confetti'+(kind===1?' snow':kind===2?' husk':'');
    el.textContent=kind===1?'❄':'';
    el.style.left=Math.random()*100+'vw';
    el.style.background=kind===1?'none':cols[i%cols.length];
    el.style.color=cols[i%cols.length];
    el.style.animationDuration=(kind===1?2.6:1.8)+Math.random()*1.6+'s';
    el.style.animationDelay=(Math.random()*.6)+'s';
    el.style.setProperty('--x',(Math.random()*120-60)+'px');
    el.style.setProperty('--r',(Math.random()*720-360)+'deg');
    document.body.appendChild(el);setTimeout(()=>el.remove(),4900);
  }
}
// валенок падает по-разному: с облачком пыли или с двумя отскоками; изредка следом летит второй — «пара»
function dropBoot(pi){
  const c=targetCenter(pi);if(!c)return;
  const bounce=Math.random()<.5;
  const el=fxEl('bootfx'+(bounce?' bounce':''),BOOT_SVG,c[0],c[1],3200);
  setTimeout(()=>{sfx('thud');buzz('boot');const s=pi===ME?$('handWrap'):seatEl(pi);if(s){s.classList.remove('shake');void s.offsetWidth;s.classList.add('shake');}
    if(!bounce&&!RM)for(let i=0;i<6;i++){const d=fxEl('dust','',c[0]+(i-2.5)*14,c[1]+48,900);d.style.setProperty('--x',(i-2.5)*9+'px');}},620);
  if(Math.random()<.1&&!RM)setTimeout(()=>{fxEl('bootfx small',BOOT_SVG,c[0]+46,c[1]+14,3000);setTimeout(()=>sfx('thud'),620);},380);
  return el;
}
// вызывается при переходе в итоги раунда / партии
function finaleFx(){
  const r=G.result;if(!r)return;
  ui.animRound=null;
  fxGen++;for(const k in fxBusy)delete fxBusy[k];   // отложенные «+N»/«пропуск» уже не нужны
  if(r.over){
    const sc=r.rows.map(x=>x.after),hi=Math.max(...sc),lo=Math.min(...sc);
    const loser=sc.indexOf(hi);
    ui.modalAt=Date.now()+(RM?0:1900);
    setTimeout(()=>dropBoot(loser),250);
    if(r.rows[ME]&&r.rows[ME].after===lo)setTimeout(()=>confetti(true),1100);
    setTimeout(()=>{if(G&&(G.phase==='over'))renderModal();},ui.modalAt-Date.now()+30);
  }else if(r.wi===ME)confetti(false);
  if(r.tsar)fxToast('Царский выход!',300);
  const st=(G.streak&&G.streak[r.wi])||0;
  if(st>=3){fxToast('Три кряду!',r.tsar?2000:300);streakCat(r.wi);}
}
// живой подсчёт очков в окне итогов
function animateScores(){
  const key=G.round+':'+G.phase;
  if(ui.animRound===key||RM)return;ui.animRound=key;
  const rows=[...document.querySelectorAll('#sheet tr[data-i]')];
  let t=150;
  rows.forEach(tr=>{
    const minis=[...tr.querySelectorAll('.card.mini')];
    minis.forEach((m,k)=>{m.style.animationDelay=(t+k*90)+'ms';});
    const dcell=tr.querySelector('[data-d]'),acell=tr.querySelector('[data-a]');
    const start=t+minis.length*90+150;
    countUp(dcell,0,+dcell.dataset.d,start,true);
    countUp(acell,+acell.dataset.b,+acell.dataset.a,start+250,false);
    t=start+350;
  });
}
function countUp(el,from,to,delay,sign){
  if(!el)return;
  const fmt=v=>(sign&&v>0?'+':'')+v;
  el.textContent=fmt(from);
  setTimeout(()=>{
    const t0=performance.now(),dur=650;
    const step=now=>{const k=Math.min(1,(now-t0)/dur);el.textContent=fmt(Math.round(from+(to-from)*(1-Math.pow(1-k,3))));if(k<1)requestAnimationFrame(step);else if(to!==from)el.classList.add('bump');};
    requestAnimationFrame(step);if(to!==from)sfx('tick');
  },delay);
}

/* ---------- перетаскивание карты на стол ---------- */
let drag=null,dragJustEnded=0;
$('hand').addEventListener('pointerdown',e=>{
  const btn=e.target.closest('.cardbtn');if(!btn||!myTurn())return;
  drag={id:btn.dataset.id,btn,x:e.clientX,y:e.clientY,el:null,pid:e.pointerId};
});
window.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pid)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.el){
    if(dy>-14||Math.abs(dy)<Math.abs(dx))return;     // тянем вверх — значит бросаем карту
    const c=byId(drag.id);if(!c)return;
    const r=drag.btn.getBoundingClientRect();
    drag.el=flyer(cardHTML(c,'dragging'),r);drag.r=r;drag.btn.style.visibility='hidden';
  }
  drag.el.style.transform=`translate(${dx}px,${dy}px) rotate(${dx/14}deg)`;
  const t=drag.tr||(drag.tr=$('table').getBoundingClientRect());
  $('pile').classList.toggle('droptarget',e.clientY<t.bottom-10);
});
function endDrag(e){
  if(!drag||(e&&e.pointerId!==drag.pid))return;
  const d=drag;drag=null;$('pile').classList.remove('droptarget');
  if(!d.el)return;
  dragJustEnded=Date.now();
  const t=$('table').getBoundingClientRect();
  const over=e&&e.clientY<t.bottom-10;
  const c=byId(d.id);
  let seq=null;
  if(over&&c&&myTurn()){
    const s=sel();
    if(s.includes(d.id)&&validSeq(s.map(byId)))seq=s.slice();
    else if(canStart(c))seq=[d.id];
    const w=tutWant();if(seq&&w&&!seq.every(id=>w.includes(id)))seq=null;
  }
  if(seq){
    // карта уже «в руке у пальца»: убираем тень и отдаём ход движку (полёт начнётся с места пальца)
    const r=d.el.getBoundingClientRect();d.el.remove();d.btn.style.visibility='';
    d.btn.style.position='fixed';d.btn.style.left=r.left+'px';d.btn.style.top=r.top+'px';
    act({t:'play',ids:seq});
  }else{
    if(over&&c)flash('Эту карту сюда положить нельзя');
    const a=d.el.animate([{transform:d.el.style.transform},{transform:'translate(0,0)'}],{duration:220,easing:'ease-out'});
    a.onfinish=()=>{d.el.remove();d.btn.style.visibility='';};setTimeout(()=>{d.el.remove();d.btn.style.visibility='';},400);
  }
}
window.addEventListener('pointerup',endDrag);
window.addEventListener('pointercancel',e=>{if(drag&&drag.el){drag.el.remove();drag.btn.style.visibility='';}drag=null;$('pile').classList.remove('droptarget');});
// клик сразу после перетаскивания не считается выбором карты
document.addEventListener('click',e=>{if(Date.now()-dragJustEnded<350&&e.target.closest('#hand')){e.stopImmediatePropagation();e.preventDefault();}},true);

/* ---------- живой стол: кот, муха, лампа ---------- */
const CAT_SVG='<svg viewBox="0 0 90 60" aria-hidden="true"><g class="catbody"><path d="M14 38c-9-2-12-12-8-20 2 6 6 10 13 11" fill="none" stroke="#2b2421" stroke-width="5" stroke-linecap="round" class="tail"/><ellipse cx="40" cy="36" rx="24" ry="12" fill="#2b2421"/><g class="legs"><rect x="22" y="40" width="5" height="16" rx="2.5" fill="#2b2421" class="l1"/><rect x="31" y="41" width="5" height="15" rx="2.5" fill="#2b2421" class="l2"/><rect x="47" y="41" width="5" height="15" rx="2.5" fill="#2b2421" class="l1"/><rect x="56" y="40" width="5" height="16" rx="2.5" fill="#2b2421" class="l2"/></g><circle cx="68" cy="26" r="11" fill="#2b2421"/><path d="M60 19l2-11 6 7zM76 19l-2-11-6 7z" fill="#2b2421"/><circle cx="72" cy="25" r="1.8" fill="#e9c234"/><circle cx="65" cy="25" r="1.8" fill="#e9c234"/></g></svg>';
const FLY_SVG='<svg viewBox="0 0 20 14" aria-hidden="true"><ellipse cx="6" cy="4" rx="5" ry="3" fill="rgba(220,230,240,.7)" class="wing"/><ellipse cx="14" cy="4" rx="5" ry="3" fill="rgba(220,230,240,.7)" class="wing"/><ellipse cx="10" cy="8" rx="4" ry="5" fill="#141010"/></svg>';
function easterEgg(){
  if(RM||$('app').hidden||document.hidden){scheduleEgg();return;}
  const d=$('decor');
  if(Math.random()<.55){
    const c=document.createElement('div');c.className='cat';c.innerHTML=CAT_SVG;d.appendChild(c);
    setTimeout(()=>c.classList.add('sit'),6200);setTimeout(()=>c.classList.add('leave'),11000);setTimeout(()=>c.remove(),14500);
  }else{
    const moth=document.body.classList.contains('tod-night');   // ночью к лампе летит мотылёк
    const f=document.createElement('div');f.className='fly'+(moth?' moth':'');f.innerHTML=moth?MOTH_SVG:FLY_SVG;d.appendChild(f);
    if(!moth)setTimeout(()=>{if(f.isConnected&&!f.classList.contains('swat'))sfx('buzz');},200);setTimeout(()=>f.remove(),12500);
  }
  scheduleEgg();
}
function scheduleEgg(){clearTimeout(scheduleEgg.t);scheduleEgg.t=setTimeout(easterEgg,(60+Math.random()*90)*1000);}
scheduleEgg();
{const l=document.createElement('div');l.id='lamp';l.setAttribute('aria-hidden','true');document.body.prepend(l);}

/* ---------- «живинка»: тасовка, отклик стола, царский выход, серии, время суток, праздники ---------- */
const MOTH_SVG='<svg viewBox="0 0 22 14" aria-hidden="true"><path d="M11 6C7 0 1 1 1 5c0 3 4 5 9 3zM11 6c4-6 10-5 10-1 0 3-4 5-9 3z" fill="#cdb89a" class="wing"/><ellipse cx="11" cy="8" rx="1.8" ry="4.5" fill="#6b5640"/></svg>';
const SAMOVAR_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="2.5" rx="1" fill="#8a6420"/><path d="M7 5.5h10l.8 2.6c1.6 1.1 2.2 3 2.2 4.9 0 3.2-2.6 5.5-5.8 5.5H9.8C6.6 18.5 4 16.2 4 13c0-1.9.6-3.8 2.2-4.9z" fill="#e0b24a"/><path d="M19.5 11.5h2.5v2h-2.5z" fill="#8a6420"/><path d="M8 18.5h8l1.5 3.5h-11z" fill="#8a6420"/><circle cx="12" cy="12" r="2" fill="#b3263a"/></svg>';
const shufMs=()=>(RM||ui.sim)?0:350;
// четыре рубашки «перебираются» над колодой перед раздачей
function riffle(from,ms){
  const dk=$('deck'),w=dk.offsetWidth||from.width,h=dk.offsetHeight||from.height,[cx,cy]=center(from);
  const at={left:cx-w/2,top:cy-h/2,width:w,height:h};
  for(let i=0;i<4;i++){
    const el=flyer('<div class="back" style="width:100%;height:100%;border-radius:8px"></div>',at);
    const s=i%2?1:-1,dx=s*(10+i*3);
    el.animate([{transform:'rotate(-9deg)'},{transform:`translate(${dx}px,${-4-i*2}px) rotate(${-9+s*8}deg)`,offset:.35},
      {transform:`translate(${-dx*.6}px,-2px) rotate(${-9-s*5}deg)`,offset:.7},{transform:'rotate(-9deg)'}],{duration:ms-i*20,delay:i*20,easing:'ease-in-out'});
    setTimeout(()=>el.remove(),ms+30);
  }
}
// стол вздрагивает от сильного хода: пар из кружки, семечки подпрыгивают, коробок подскакивает
const PROP_KIND={mug:'steam',seeds:'jitter',bagels:'jitter',matches:'hop'};
function markProps(){
  document.querySelectorAll('#decor > *').forEach(el=>{
    if(el.getAttribute('data-prop')||['doily','cat','fly'].some(c=>el.classList.contains(c)))return;
    const k=Object.keys(PROP_KIND).find(c=>el.classList.contains(c));
    el.setAttribute('data-prop',k?PROP_KIND[k]:'hop');
  });
}
function tableReact(){
  const t=Date.now();if(t-(tableReact.at||0)<250)return;tableReact.at=t;
  markProps();
  const els=[...document.querySelectorAll('#decor [data-prop]')];if(!els.length)return;
  els.forEach(el=>el.classList.remove('react'));void $('decor').offsetWidth;els.forEach(el=>el.classList.add('react'));
  clearTimeout(tableReact.t);tableReact.t=setTimeout(()=>els.forEach(el=>el.classList.remove('react')),350);
}
// надпись поверх всего (и поверх окна итогов)
function fxToast(m,delay=0){
  setTimeout(()=>{const t=$('table').getBoundingClientRect();fxEl('fxtoast',esc(m),innerWidth/2,Math.max(40,t.top+28),1900);},delay);
}
// «Царский выход»: корона летит к игроку, вокруг — золотая шелуха
function tsarFx(pi){
  const p=$('pile').getBoundingClientRect(),[px,py]=center(p);
  const seat=pi===ME?$('me'):seatEl(pi),tg=seat&&(seat.querySelector('.seat-score')||seat);
  const [tx,ty]=tg?center(tg.getBoundingClientRect()):[px,py];
  const el=fxEl('tsarfx',CROWN_SVG,px,py,1500);
  el.animate([{transform:'translate(-50%,-50%) scale(.6) rotate(-20deg)',opacity:0},
    {transform:'translate(-50%,-90%) scale(1.5) rotate(0)',opacity:1,offset:.3},
    {transform:`translate(calc(-50% + ${tx-px}px),calc(-50% + ${ty-py}px)) scale(.5)`,opacity:.9}],{duration:1100,easing:'cubic-bezier(.4,0,.3,1)',fill:'forwards'});
  setTimeout(()=>{for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2+rnd(-.2,.2),r=rnd(28,60),h=fxEl('ghusk','',tx,ty,900);
    h.style.setProperty('--x',(Math.cos(a)*r).toFixed(1)+'px');h.style.setProperty('--y',(Math.sin(a)*r).toFixed(1)+'px');h.style.setProperty('--r',(rnd(-220,220)|0)+'deg');
  }},1050);
}
// серия: от двух побед подряд — самовар у места
function streakMarks(){
  const s=G&&G.streak;if(!Array.isArray(s))return;
  s.forEach((v,i)=>{
    if(v<2)return;
    const seat=i===ME?$('me'):seatEl(i),host=seat&&(i===ME?seat.firstElementChild:seat.querySelector('.seat-top'))||seat;
    if(host&&!host.querySelector('.samovar'))host.insertAdjacentHTML('beforeend',`<span class="samovar" title="${v} кряду">${SAMOVAR_SVG}${v>2?`<b>${v}</b>`:''}</span>`);
  });
}
// три кряду — кот приходит и садится рядом с местом победителя
function streakCat(pi){
  if(RM||ui.sim)return;
  document.querySelectorAll('.seatcat').forEach(e=>e.remove());
  const s=pi===ME?$('table'):seatEl(pi);if(!s)return;
  const r=s.getBoundingClientRect(),x=pi===ME?r.left+8:Math.min(innerWidth-70,r.right-58),y=pi===ME?r.bottom-46:r.bottom-30;
  const c=document.createElement('div');c.className='seatcat walk';c.innerHTML=CAT_SVG;
  c.style.left=x+'px';c.style.top=y+'px';document.body.appendChild(c);
  c.addEventListener('click',()=>purr(c));
  const a=c.animate([{transform:`translateX(${innerWidth-x+20}px)`},{transform:'translateX(0)'}],{duration:1800,easing:'linear',fill:'backwards'});
  const sit=()=>c.classList.remove('walk');a.onfinish=sit;setTimeout(sit,1900);
  setTimeout(()=>c.classList.add('leave'),8000);setTimeout(()=>c.remove(),9000);
}
// пасхалки по нажатию: муху — прихлопнуть, кота — погладить
function swatFly(f){
  const cs=getComputedStyle(f);f.style.left=cs.left;f.style.top=cs.top;f.classList.add('swat');
  sfx('slap');buzz('play');lsSet('valenok-swat',(lsGet('valenok-swat')||0)+1);checkAch();
  setTimeout(()=>f.remove(),700);
}
function purr(c){
  if((c._purr||0)>Date.now())return;c._purr=Date.now()+1300;
  sfx('purr');buzz('play');c.classList.add('purring');setTimeout(()=>c.classList.remove('purring'),1200);
}
$('decor').addEventListener('click',e=>{
  const f=e.target.closest('.fly');if(f){if(!f.classList.contains('swat'))swatFly(f);return;}
  const c=e.target.closest('.cat');if(c)purr(c);
});
// время суток: вечером лампа теплее и тусклее, мотылёк вместо мухи; утром — свет из окна слева
{const t=document.createElement('div');t.id='tod';t.setAttribute('aria-hidden','true');$('lamp').after(t);}
function applyDaytime(){
  const h=new Date().getHours(),b=document.body;
  b.classList.toggle('tod-night',h>=21||h<5);b.classList.toggle('tod-morning',h>=5&&h<9);
}
applyDaytime();setInterval(applyDaytime,10*60e3);
// праздники: Новый год (20.12–10.01) и Масленица (неделя перед Чистым понедельником)
const CLEAN_MONDAY={2026:[1,23],2027:[2,15],2028:[1,28],2029:[1,19],2030:[2,11]};   // [месяц с 0, число]
function seasonNow(d=new Date()){
  const m=d.getMonth(),day=d.getDate(),y=d.getFullYear();
  if((m===11&&day>=20)||(m===0&&day<=10))return 'ny';
  const cm=CLEAN_MONDAY[y];
  if(cm){const t=new Date(y,m,day),end=new Date(y,cm[0],cm[1]),start=new Date(y,cm[0],cm[1]-7);if(t>=start&&t<end)return 'maslenitsa';}
  return '';
}
const SEASON=seasonNow();
const TANGERINE_SVG='<g class="season"><circle cx="58" cy="78" r="23" fill="#e8781c"/><circle cx="51" cy="71" r="9" fill="#f59a3c" opacity=".7"/>'
  +'<g fill="#c45f10">'+ring(58,78,15,15,9,(x,y)=>`<circle cx="${x}" cy="${y}" r=".8"/>`)+'</g><circle cx="60" cy="56.5" r="2" fill="#5a3d1a"/><path d="M60 56c4-7 12-7 15-3-5 4-11 5-15 3z" fill="#3f7d3a"/></g>';
const BLINY_SVG='<g class="season">'+[0,1,2,3].map(k=>`<ellipse cx="${60+(k%2?1.5:-1.5)}" cy="${66-k*3}" rx="43" ry="38" fill="${k===3?'#e9b763':'#d9953f'}" stroke="#a8641f" stroke-width="1.2"/>`).join('')
  +'<g fill="#c07a2e" opacity=".55">'+ring(60,57,22,18,7,(x,y)=>`<circle cx="${x}" cy="${y}" r="2.6"/>`)+'</g><path d="M52 52c0-7 16-7 16 0 3 1 3 6-1 7H53c-4-1-4-6-1-7z" fill="#fbf6ea"/></g>';
function applySeason(){
  const b=document.querySelector('#decor .bagels');if(!b||!SEASON||b.querySelector('.season'))return;
  b.insertAdjacentHTML('beforeend',SEASON==='ny'?TANGERINE_SVG:BLINY_SVG);
}

/* ---------- заставка ---------- */
function splash(){
  if(RM||sessionStorage.getItem('valenok-splash'))return;
  try{sessionStorage.setItem('valenok-splash','1');}catch(e){}
  const word='ВАЛЕНОК';
  const el=document.createElement('div');el.id='splash';
  el.innerHTML=`<div class="sp-fan">${[...word].map((ch,i)=>{const a=(i-3)*7.4;return `<div class="sp-card" style="--a:${a}deg;--i:${i}"><div class="sp-in"><div class="sp-back back"></div><div class="sp-face ${i%2?'':'red'}"><span>${ch}</span></div></div></div>`;}).join('')}</div><p class="sp-sub">карточная игра</p>`;
  document.body.appendChild(el);
  const close=()=>{el.classList.add('out');setTimeout(()=>el.remove(),450);};
  el.addEventListener('click',close);setTimeout(close,2700);
}
splash();

/* ---------- музыка фоном (синтез, своя мелодия) ---------- */
const MEL=[ // восьмые доли, 0 — пауза; ля минор
  69,69,72,69,67,65,64,0, 65,67,69,67,65,64,62,0,
  64,64,65,67,69,67,65,64, 62,64,65,64,62,60,57,0,
  72,72,71,69,71,72,74,72, 71,69,68,69,71,69,68,64,
  69,72,71,69,67,65,64,65, 64,62,60,62,64,0,57,0];
const BASS=[45,50,40,45,45,40,50,45];          // по такту: Am Dm E Am Am E Dm Am
const music={on:false,next:0,step:0,timer:null,gain:null},MUSIC_VOL=.11;
const midi=n=>440*Math.pow(2,(n-69)/12);
function pluck(ctx,dst,f,t,dur,vol){
  [0,4].forEach(det=>{
    const o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.value=f;o.detune.value=det;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.008);g.gain.exponentialRampToValueAtTime(.0008,t+dur);
    o.connect(g).connect(dst);o.start(t);o.stop(t+dur+.05);
  });
}
function musicTick(){
  const ctx=actx();if(!ctx||!music.on)return;
  const eighth=60/100/2;
  while(music.next<ctx.currentTime+.6){
    const i=music.step%MEL.length,t=music.next;
    if(MEL[i])pluck(ctx,music.gain,midi(MEL[i]),t,.32,.5);
    if(MEL[i]&&i%2===0)pluck(ctx,music.gain,midi(MEL[i]),t+eighth*.5,.12,.18);   // балалаечное «тремоло»
    const bar=Math.floor(i/8)%BASS.length,beat=i%8;
    if(beat===0||beat===4)pluck(ctx,music.gain,midi(BASS[bar]),t,.45,.55);
    if(beat===2||beat===6){pluck(ctx,music.gain,midi(BASS[bar]+12),t,.18,.22);pluck(ctx,music.gain,midi(BASS[bar]+19),t,.18,.16);}
    music.next+=eighth;music.step++;
  }
}
function musicStart(){
  if(!ui.music||!ui.sound||music.on||document.hidden)return;
  const ctx=actx();if(!ctx)return;
  if(!music.gain){music.gain=ctx.createGain();music.gain.gain.value=MUSIC_VOL;music.gain.connect(OUT(ctx));}
  music.on=true;music.next=ctx.currentTime+.1;
  music.timer=setInterval(musicTick,180);musicTick();
}
function musicStop(){music.on=false;clearInterval(music.timer);}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){musicStop();if(AC&&AC.state==='running')AC.suspend().catch(()=>{});}
  else{if(AC&&AC.state==='suspended')AC.resume().catch(()=>{});musicStart();}
});
window.addEventListener('pointerdown',()=>musicStart(),{passive:true});

/* ---------- крупные карты ---------- */
function applyBig(){document.body.classList.toggle('bigcards',!!ui.bigCards);if(G&&!$('app').hidden)fitHand();}
applyBig();

/* ================= Запуск ================= */
$('memo1').innerHTML=MEMO;
renderDecor();markProps();applySeason();
$('nameIn').value=lsGet('valenok-name')||'';
window.addEventListener('resize',()=>{if(G)fitHand();});
if('serviceWorker' in navigator&&location.protocol==='https:'&&!window.Capacitor)navigator.serviceWorker.register('sw.js').catch(()=>{});
// для автотестов
window.__valenok={get G(){return G;},set G(v){G=v;},NET,ui,ACTS,newGame,nextRound,beginTurn,botTurn,applyAction,
  setSchedule(f){schedule=f;},sim(on){ui.sim=on;}};
showSetup();
