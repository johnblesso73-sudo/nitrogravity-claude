'use strict';
/* Agency creator and combination codex helpers. Pure logic except drawFlag, which draws onto a canvas you pass in. */
const AGENCY_DEFAULT={name:'Nitro Gravity',field:'#0f2a5c',pattern:'stripe',stripe:'#ff8a3d',emblem:'rocket',emblemColor:'#ffffff',pos:'center',size:'M'};
const AG_ENUM={pattern:['stripe','chevron','split','none'],emblem:['none','rocket','star','planet','moon'],pos:['left','center','right'],size:['S','M','L']};
function escHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cleanAgency(a){
 const o=Object.assign({},AGENCY_DEFAULT);
 if(!a||typeof a!=='object')return o;
 ['field','stripe','emblemColor'].forEach(k=>{if(typeof a[k]==='string'&&/^#[0-9a-f]{6}$/i.test(a[k]))o[k]=a[k].toLowerCase();});
 for(const k in AG_ENUM)if(AG_ENUM[k].includes(a[k]))o[k]=a[k];
 if(typeof a.name==='string'){const n=a.name.replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,24);if(n)o.name=n;}
 return o;
}
function loadAgency(){let raw=null;try{raw=JSON.parse(localStorage.getItem('ng-agency')||'null');}catch(e){}return cleanAgency(raw);}
function saveAgency(a){try{localStorage.setItem('ng-agency',JSON.stringify(a));}catch(e){}}
function lum(hex){const c=[1,3,5].map(i=>{const v=parseInt(hex.slice(i,i+2),16)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function contrastRatio(a,b){const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function drawFlag(a,cv){
 const w=cv.width,h=cv.height,x=cv.getContext('2d');
 x.fillStyle=a.field;x.fillRect(0,0,w,h);
 x.fillStyle=a.stripe;
 if(a.pattern==='stripe')x.fillRect(0,h*.4,w,h*.2);
 else if(a.pattern==='chevron'){x.beginPath();x.moveTo(0,0);x.lineTo(w*.45,h/2);x.lineTo(0,h);x.closePath();x.fill();}
 else if(a.pattern==='split')x.fillRect(w/2,0,w/2,h);
 if(a.emblem==='none')return;
 const r=h*({S:.2,M:.3,L:.42}[a.size]||.3),cx=w*({left:.25,center:.5,right:.75}[a.pos]||.5),cy=h/2;
 x.fillStyle=a.emblemColor;x.strokeStyle=a.emblemColor;
 if(a.emblem==='star'){x.beginPath();for(let i=0;i<10;i++){const g=-Math.PI/2+i*Math.PI/5,q=i%2?r*.45:r;x.lineTo(cx+Math.cos(g)*q,cy+Math.sin(g)*q);}x.closePath();x.fill();}
 else if(a.emblem==='planet'){x.beginPath();x.arc(cx,cy,r*.7,0,Math.PI*2);x.fill();x.strokeStyle=a.field;x.lineWidth=r*.32;x.beginPath();x.ellipse(cx,cy,r*1.05,r*.35,-.4,0,Math.PI*2);x.stroke();x.strokeStyle=a.emblemColor;x.lineWidth=r*.12;x.beginPath();x.ellipse(cx,cy,r*1.05,r*.35,-.4,0,Math.PI*2);x.stroke();}
 else if(a.emblem==='moon'){x.beginPath();x.arc(cx,cy,r*.85,Math.PI*.35,Math.PI*1.65,false);x.arc(cx+r*.4,cy,r*.7,Math.PI*1.55,Math.PI*.45,true);x.closePath();x.fill();}
 else if(a.emblem==='rocket'){
  x.beginPath();x.moveTo(cx,cy-r);x.quadraticCurveTo(cx+r*.45,cy-r*.3,cx+r*.3,cy+r*.55);x.lineTo(cx-r*.3,cy+r*.55);x.quadraticCurveTo(cx-r*.45,cy-r*.3,cx,cy-r);x.fill();
  x.beginPath();x.moveTo(cx+r*.3,cy+r*.1);x.lineTo(cx+r*.65,cy+r*.7);x.lineTo(cx+r*.3,cy+r*.55);x.closePath();x.fill();
  x.beginPath();x.moveTo(cx-r*.3,cy+r*.1);x.lineTo(cx-r*.65,cy+r*.7);x.lineTo(cx-r*.3,cy+r*.55);x.closePath();x.fill();
  x.fillStyle=a.field;x.beginPath();x.arc(cx,cy-r*.15,r*.13,0,Math.PI*2);x.fill();
 }
}
/* Number of distinct designs the builder allows: part counts x structure materials x crew sizes. Boosters share a limit of 2 slots. */
function designSpace(parts,mats,crewLevels){
 let n=1;const bs=[];
 for(const p of parts){if(p.fixed)continue;if(p.booster){bs.push(p);continue;}n*=p.max+1;}
 let pairs=1;
 if(bs.length){pairs=0;const a=bs[0].max,b=bs[1]?bs[1].max:0;for(let i=0;i<=a;i++)for(let j=0;j<=b;j++)if(i+j<=2)pairs++;}
 return n*pairs*Object.keys(mats).length*(crewLevels||7);
}
if(typeof module!=='undefined')module.exports={AGENCY_DEFAULT,AG_ENUM,escHtml,cleanAgency,contrastRatio,designSpace,drawFlag};
