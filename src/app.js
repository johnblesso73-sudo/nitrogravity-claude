(function(){
'use strict';
const $=(s,r)=>(r||document).querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const money=v=>v>=1e6?'$'+(v/1e6).toFixed(2)+'M':'$'+Math.round(v/1e3)+'k';
const tfmt=t=>{t=Math.max(0,t|0);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');};
const START={counts:{camera:1,'solar-wing':1},mat:'al-standard',crew:4};
let build=clone(START), hist=[], redo=[], tab='propulsion', lastRun=null;
let agency=loadAgency(),flagTex=null,codex=loadCodex();
const flagCv=document.createElement('canvas');flagCv.width=256;flagCv.height=160;drawFlag(agency,flagCv);
function flagPlane(w,h,x,y,z){if(!flagTex)flagTex=new THREE.CanvasTexture(flagCv);const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:flagTex,side:THREE.DoubleSide}));m.position.set(x,y,z);return m;}
let mode='build', fl=null, simAcc=0, speed=6, paused=false, cdT=0, visAlt=0, samples=[], lastSample=0, debTimer=null, prop0=1;
const cache=new Map();
function key(b){return JSON.stringify([Object.keys(b.counts).sort().map(k=>[k,b.counts[k]]),b.mat,b.crew]);}
function sim(b){const k=key(b);if(!cache.has(k))cache.set(k,runHeadless(b));return cache.get(k);}
function announce(m){$('#live').textContent=m;}

/* ---------- audio ---------- */
let AC=null,muted=false,rumble=null;
function actx(){if(muted)return null;if(!AC){try{AC=new(window.AudioContext||window.webkitAudioContext)();}catch(e){return null;}}if(AC.state==='suspended')AC.resume();return AC;}
function blip(f,d,type,vol){const a=actx();if(!a)return;try{const o=a.createOscillator(),g=a.createGain();o.type=type||'square';o.frequency.value=f;g.gain.value=vol||.04;g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+d);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+d);}catch(e){}}
function startRumble(){const a=actx();if(!a||rumble)return;try{const n=a.sampleRate*2,buf=a.createBuffer(1,n,a.sampleRate),d=buf.getChannelData(0);let l=0;for(let i=0;i<n;i++){l=(l+.02*(Math.random()*2-1))/1.02;d[i]=l*3.5;}const s=a.createBufferSource();s.buffer=buf;s.loop=true;const g=a.createGain();g.gain.value=0;const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=380;s.connect(f);f.connect(g);g.connect(a.destination);s.start();rumble={s,g};}catch(e){rumble=null;}}
function setRumble(v){if(rumble){try{rumble.g.gain.value=v*.5;}catch(e){}}}
function stopRumble(){if(rumble){try{rumble.s.stop();}catch(e){}rumble=null;}}

/* ---------- 3D ---------- */
const cv=$('#gl');
const stage=$('#stage');
document.addEventListener('dragstart',e=>{
 const p=e.target.closest('[data-drag-part]'),m=e.target.closest('[data-drag-mat]');
 if(!p&&!m)return;
 e.dataTransfer.effectAllowed='copy';
 e.dataTransfer.setData('text/plain',(p?'part:':'material:')+(p?p.dataset.dragPart:m.dataset.dragMat));
 stage.classList.add('drop-ready');
});
document.addEventListener('dragend',()=>stage.classList.remove('drop-ready'));
stage.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/plain')){e.preventDefault();e.dataTransfer.dropEffect='copy';stage.classList.add('drop-ready');}});
stage.addEventListener('dragleave',e=>{if(!stage.contains(e.relatedTarget))stage.classList.remove('drop-ready');});
stage.addEventListener('drop',e=>{
 e.preventDefault();stage.classList.remove('drop-ready');
 if(mode!=='build'){announce('Return to the build screen before changing the rocket.');return;}
 const raw=e.dataTransfer.getData('text/plain'),cut=raw.indexOf(':');
 if(cut<0)return;
 const kind=raw.slice(0,cut),id=raw.slice(cut+1);
 if(kind==='part'){
  if(canAdd(build,id))addPart(id);
  else announce('That part cannot be added to this build.');
 }else if(kind==='material'&&MATS[id])setMat(id);
});

let R=null,scene,camera,rocketRoot,rkGroup,rk=null,planet,planetClouds,atmo,stars,points,sunL,visualClock=0;
const cam={az:.7,pol:1.32,dist:17,tx:0,ty:3.2,tz:0,user:0,dragging:false};
const tweens=[],debris=[];
const NP=800,P={pos:new Float32Array(NP*3),col:new Float32Array(NP*3),vel:new Float32Array(NP*3),base:new Float32Array(NP*3),life:new Float32Array(NP),max:new Float32Array(NP),i:0};
let rkx=0,rky=0,rkz=0,exploded=false,shake=0,geoP=null;
const MATCOL={'al-standard':0xc9d3e0,'al-lithium':0x9fe3d6,'steel':0xeef1f4,'titanium':0x6d7686,'cfrp':0x20262e,'printed':0xd9985f,'reclaimed':0xa9a47c};
function M(color,o){return new THREE.MeshStandardMaterial(Object.assign({color:color,roughness:.5,metalness:.35},o||{}));}
function panelTex(){const c=document.createElement('canvas');c.width=128;c.height=256;const x=c.getContext('2d');x.fillStyle='#0c2a58';x.fillRect(0,0,128,256);x.strokeStyle='#5f8fd0';x.lineWidth=2;for(let i=0;i<=4;i++){x.beginPath();x.moveTo(i*32,0);x.lineTo(i*32,256);x.stroke();}for(let j=0;j<=8;j++){x.beginPath();x.moveTo(0,j*32);x.lineTo(128,j*32);x.stroke();}return new THREE.CanvasTexture(c);}
let _ptex=null;
function mesh(geo,mat,x,y,z){const m=new THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);return m;}
function flameMesh(r,h){const g=new THREE.Group();const o=new THREE.Mesh(new THREE.ConeGeometry(r,h,16),new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false}));o.rotation.x=Math.PI;o.position.y=-h/2;const i=new THREE.Mesh(new THREE.ConeGeometry(r*.5,h*.6,16),new THREE.MeshBasicMaterial({color:0xfff2c8,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));i.rotation.x=Math.PI;i.position.y=-h*.3;g.add(o);g.add(i);g.visible=false;return g;}
function buildRocket(b){
 const g=new THREE.Group();const o={group:g,parts:{},boosters:[],flame:null,lights:[]};
 const sm=M(MATCOL[b.mat]||0xc9d3e0,{metalness:b.mat==='cfrp'?.15:.5,roughness:b.mat==='cfrp'?.35:.45});
 const dark=M(0x262c36,{metalness:.6,roughness:.4}),accent=M(0xff8a3d,{metalness:.2,roughness:.5});
 const tag=(id,grp)=>{(o.parts[id]=o.parts[id]||[]).push(grp);g.add(grp);return grp;};
 // fixed core
 const core=tag('core-stage',new THREE.Group());
 core.add(mesh(new THREE.CylinderGeometry(.28,.5,.7,24),dark,0,.35,0));
 core.add(mesh(new THREE.CylinderGeometry(.55,.55,4.4,32),sm,0,2.9,0));
 [1.5,4.6].forEach(y=>{const t=mesh(new THREE.TorusGeometry(.56,.03,8,32),accent,0,y,0);t.rotation.x=Math.PI/2;core.add(t);});core.add(flagPlane(.7,.45,0,3.25,.56));
 for(let k=0;k<3;k++){const a=k*Math.PI*2/3+Math.PI/6;const f=mesh(new THREE.BoxGeometry(.06,.9,.5),sm,Math.cos(a)*.72,1.1,Math.sin(a)*.72);f.rotation.y=-a;core.add(f);}
 const cap=tag('capsule',new THREE.Group());
 cap.add(mesh(new THREE.ConeGeometry(.55,1.3,32),M(0xf3f5f8,{metalness:.2}),0,5.75,0));
 cap.add(mesh(new THREE.SphereGeometry(.12,16,12),new THREE.MeshBasicMaterial({color:0x58d0f5}),0,5.35,.5));
 const nb=(b.counts['booster-side']||0),nh=(b.counts['booster-heavy']||0);
 const list=[];for(let i=0;i<nb;i++)list.push(false);for(let i=0;i<nh;i++)list.push(true);
 list.forEach((heavy,i)=>{
  const x=(i%2===0?-1:1)*(heavy?1.05:.95),r=heavy?.38:.27,h=heavy?3.8:3.2;
  const bg=new THREE.Group();bg.position.set(x,0,0);
  bg.add(mesh(new THREE.CylinderGeometry(r,r,h,24),sm,0,h/2+.4,0));
  bg.add(mesh(new THREE.ConeGeometry(r,.8,24),accent,0,h+.8,0));
  bg.add(mesh(new THREE.CylinderGeometry(r*.55,r*.9,.45,16),dark,0,.18,0));
  [1.2,h-.3].forEach(y=>bg.add(mesh(new THREE.BoxGeometry(.55,.08,.08),dark,-Math.sign(x)*.38,y,0)));
  const fl=flameMesh(r*.9,2.2);fl.position.y=0;bg.add(fl);
  tag(heavy?'booster-heavy':'booster-side',bg);o.boosters.push({g:bg,x:x,flame:fl});
 });
 const ns=b.counts['solar-wing']||0;
 for(let j=0;j<ns;j++){const s=j===0?1:-1;const w=new THREE.Group();w.add(mesh(new THREE.BoxGeometry(.08,.08,.9),dark,0,3.3,s*.85));
  if(!_ptex)_ptex=panelTex();w.add(mesh(new THREE.BoxGeometry(1.0,.04,2.0),new THREE.MeshStandardMaterial({map:_ptex,roughness:.35,metalness:.6,emissive:0x061a33}),0,3.3,s*1.85));tag('solar-wing',w);}
 if(b.counts.rtg){const w=new THREE.Group();w.add(mesh(new THREE.CylinderGeometry(.16,.16,1.0,16),M(0x7c6c3a,{metalness:.7}),.42,1.7,.42));for(let i=0;i<3;i++)w.add(mesh(new THREE.CylinderGeometry(.22,.22,.04,16),dark,.42,1.4+i*.3,.42));tag('rtg',w);}
 const ok=(evalBuild(b).power>0);
 const led=()=>new THREE.MeshBasicMaterial({color:ok?0x5ee6a8:0x553a3a});
 if(b.counts.camera){const w=new THREE.Group();w.add(mesh(new THREE.BoxGeometry(.26,.26,.26),dark,-.45,4.3,.45));const l=mesh(new THREE.CylinderGeometry(.1,.1,.16,16),M(0x111111),-.55,4.3,.55);l.rotation.z=Math.PI/2;l.rotation.y=Math.PI/4;w.add(l);w.add(mesh(new THREE.SphereGeometry(.04,8,8),led(),-.4,4.47,.5));tag('camera',w);}
 if(b.counts.spectrometer){const w=new THREE.Group();w.add(mesh(new THREE.BoxGeometry(.3,.55,.3),M(0x3d6fa8),.45,3.8,.45));w.add(mesh(new THREE.SphereGeometry(.04,8,8),led(),.45,4.12,.45));tag('spectrometer',w);}
 if(b.counts.radar){const w=new THREE.Group();const d=mesh(new THREE.CylinderGeometry(.42,.06,.14,24),M(0xd8dde6),-.5,3.6,-.5);d.rotation.z=Math.PI/2;d.rotation.y=Math.PI/4;w.add(d);w.add(mesh(new THREE.CylinderGeometry(.04,.04,.3,8),dark,-.45,3.6,-.45));w.add(mesh(new THREE.SphereGeometry(.04,8,8),led(),-.4,3.95,-.4));tag('radar',w);}
 o.flame=flameMesh(.5,4);o.flame.position.y=.1;g.add(o.flame);
 return o;
}
function tween(obj){tweens.push({o:obj,t:0,d:.6,from:6});obj.position.y=6;}
function rebuildRocket(addedId){
 if(!R)return;
 if(rkGroup)rocketRoot.remove(rkGroup);
 rk=buildRocket(build);rkGroup=rk.group;rocketRoot.add(rkGroup);
 if(addedId&&rk.parts[addedId]){tween(rk.parts[addedId][rk.parts[addedId].length-1]);}
}
function emit(x,y,z,vx,vy,vz,life,r,g,b){const i=P.i++%NP,k=i*3;P.pos[k]=x;P.pos[k+1]=y;P.pos[k+2]=z;P.vel[k]=vx;P.vel[k+1]=vy;P.vel[k+2]=vz;P.base[k]=r;P.base[k+1]=g;P.base[k+2]=b;P.life[i]=P.max[i]=life;}
function updParticles(dt){for(let i=0;i<NP;i++){const k=i*3;if(P.life[i]>0){P.life[i]-=dt;P.pos[k]+=P.vel[k]*dt;P.pos[k+1]+=P.vel[k+1]*dt;P.pos[k+2]+=P.vel[k+2]*dt;const f=Math.max(0,P.life[i]/P.max[i]);P.col[k]=P.base[k]*f;P.col[k+1]=P.base[k+1]*f;P.col[k+2]=P.base[k+2]*f;}else{P.col[k]=P.col[k+1]=P.col[k+2]=0;}}
 geoP.attributes.position.needsUpdate=true;geoP.attributes.color.needsUpdate=true;}
function explode(x,y,z,n){for(let i=0;i<n;i++){const a=Math.random()*6.283,e=Math.random()*3.14-1.57,s=6+Math.random()*26;emit(x,y+2,z,Math.cos(a)*Math.cos(e)*s,Math.sin(e)*s*.9+6,Math.sin(a)*Math.cos(e)*s,.8+Math.random()*1.8,1,.45+Math.random()*.4,.12);}}
function makeEarthTexture(){
 const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d');
 const sea=x.createLinearGradient(0,0,0,512);sea.addColorStop(0,'#144a78');sea.addColorStop(.48,'#257fb2');sea.addColorStop(1,'#0b355f');x.fillStyle=sea;x.fillRect(0,0,1024,512);
 const land=[
  [[.04,.22],[.09,.13],[.17,.12],[.23,.17],[.29,.23],[.27,.3],[.23,.34],[.21,.42],[.16,.45],[.13,.39],[.09,.36],[.07,.29]],
  [[.24,.43],[.30,.46],[.34,.53],[.33,.62],[.31,.73],[.28,.84],[.25,.75],[.24,.63],[.22,.53]],
  [[.29,.12],[.32,.08],[.36,.1],[.36,.16],[.33,.2],[.3,.18]],
  [[.43,.23],[.48,.2],[.52,.22],[.54,.27],[.51,.32],[.47,.31],[.44,.28]],
  [[.46,.32],[.52,.31],[.55,.37],[.54,.48],[.52,.57],[.5,.68],[.47,.73],[.44,.62],[.43,.52],[.45,.43]],
  [[.51,.2],[.59,.15],[.68,.16],[.75,.2],[.84,.22],[.9,.29],[.86,.35],[.78,.36],[.74,.42],[.68,.4],[.64,.34],[.57,.33],[.53,.28]],
  [[.78,.57],[.83,.56],[.86,.61],[.84,.68],[.8,.7],[.77,.65]],
  [[.83,.72],[.9,.71],[.94,.77],[.92,.84],[.87,.85],[.83,.8]]
 ];
 x.fillStyle='#5f9b70';x.strokeStyle='#b5d8b0';x.lineWidth=2;
 land.forEach(p=>{x.beginPath();p.forEach((q,i)=>i?x.lineTo(q[0]*1024,q[1]*512):x.moveTo(q[0]*1024,q[1]*512));x.closePath();x.fill();x.stroke();});
 // Soft polar ice caps and scattered cloud bands give the globe depth at game scale.
 x.fillStyle='rgba(220,244,255,.78)';x.fillRect(0,0,1024,18);x.fillRect(0,494,1024,18);
 const tex=new THREE.CanvasTexture(c);tex.needsUpdate=true;return tex;
}
function makeCloudTexture(){
 const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d');
 for(let i=0;i<95;i++){
  const px=(i*137.5)%1024,py=38+((i*83)%430),w=22+(i%6)*11,h=5+(i%4)*3;
  x.fillStyle='rgba(245,250,255,'+(.12+(i%4)*.035)+')';x.beginPath();x.ellipse(px,py,w,h,(i%9-4)*.08,0,Math.PI*2);x.fill();
 }
 const tex=new THREE.CanvasTexture(c);tex.needsUpdate=true;return tex;
}
function init3D(){
 try{R=new THREE.WebGLRenderer({canvas:cv,antialias:true});}catch(e){R=null;$('#nogl').hidden=false;return;}
 R.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
 scene=new THREE.Scene();scene.background=new THREE.Color(0x16233b);
 camera=new THREE.PerspectiveCamera(42,1,.1,300000);
 scene.add(new THREE.HemisphereLight(0x9bbcff,0x1b1d2b,.65));
 sunL=new THREE.DirectionalLight(0xfff0dc,1.25);sunL.position.set(-30,40,25);scene.add(sunL);
 const rim=new THREE.DirectionalLight(0x58d0f5,.55);rim.position.set(30,12,-30);scene.add(rim);
 const gnd=new THREE.Mesh(new THREE.CircleGeometry(70,64),new THREE.MeshStandardMaterial({color:0x101a2a,roughness:.9}));gnd.rotation.x=-Math.PI/2;gnd.position.y=.02;scene.add(gnd);
 const grid=new THREE.GridHelper(140,70,0x2f5a93,0x172a45);grid.position.y=.05;scene.add(grid);
 const ring=new THREE.Mesh(new THREE.RingGeometry(3.4,3.8,64),new THREE.MeshBasicMaterial({color:0xff8a3d,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.07;scene.add(ring);
 const tm=new THREE.MeshStandardMaterial({color:0x4a5668,metalness:.6,roughness:.5});
 const tw=new THREE.Group();tw.add(mesh(new THREE.BoxGeometry(.7,13,.7),tm,0,6.5,0));[3,6,9,12].forEach(y=>tw.add(mesh(new THREE.BoxGeometry(2.6,.18,.18),tm,1.3,y,0)));tw.add(flagPlane(1.8,1.1,1.5,11.3,0));tw.position.set(-4.6,0,0);scene.add(tw);
 planet=new THREE.Mesh(new THREE.SphereGeometry(40000,96,64),new THREE.MeshPhongMaterial({map:makeEarthTexture(),shininess:12}));planet.position.y=-40000;scene.add(planet);
 planetClouds=new THREE.Mesh(new THREE.SphereGeometry(40100,96,64),new THREE.MeshBasicMaterial({map:makeCloudTexture(),transparent:true,opacity:.7,depthWrite:false}));planetClouds.position.y=-40000;scene.add(planetClouds);
 atmo=new THREE.Mesh(new THREE.SphereGeometry(40700,96,64),new THREE.MeshBasicMaterial({color:0x58d0f5,transparent:true,opacity:.18,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false}));atmo.position.y=-40000;atmo.visible=true;scene.add(atmo);
 const sp=new Float32Array(1800*3);for(let i=0;i<1800;i++){const u=Math.random()*2-1,a=Math.random()*6.283,s=Math.sqrt(1-u*u);sp[i*3]=Math.cos(a)*s*100000;sp[i*3+1]=Math.abs(u)*100000;sp[i*3+2]=Math.sin(a)*s*100000;}
 const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
 stars=new THREE.Points(sg,new THREE.PointsMaterial({size:1.8,sizeAttenuation:false,color:0xffffff,transparent:true,opacity:.3,depthWrite:false}));stars.frustumCulled=false;scene.add(stars);
 geoP=new THREE.BufferGeometry();geoP.setAttribute('position',new THREE.BufferAttribute(P.pos,3));geoP.setAttribute('color',new THREE.BufferAttribute(P.col,3));
 points=new THREE.Points(geoP,new THREE.PointsMaterial({size:1.2,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));points.frustumCulled=false;scene.add(points);
 rocketRoot=new THREE.Group();scene.add(rocketRoot);rebuildRocket();
 const ro=new ResizeObserver(resize);ro.observe($('#stage'));resize();
 // camera input
 const ptrs=new Map();let pinch=0;
 cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,[e.clientX,e.clientY]);cam.dragging=true;cam.user=4;});
 cv.addEventListener('pointermove',e=>{const p=ptrs.get(e.pointerId);if(!p)return;const dx=e.clientX-p[0],dy=e.clientY-p[1];p[0]=e.clientX;p[1]=e.clientY;
  if(ptrs.size===2){const a=[...ptrs.values()],d=Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]);if(pinch)cam.dist=clamp(cam.dist*(pinch/d),7,80);pinch=d;}
  else{cam.az-=dx*.007;cam.pol=clamp(cam.pol-dy*.006,.25,2.2);}cam.user=4;});
 const up=e=>{ptrs.delete(e.pointerId);pinch=0;if(!ptrs.size)cam.dragging=false;};
 cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
 cv.addEventListener('wheel',e=>{e.preventDefault();cam.dist=clamp(cam.dist*(1+Math.sign(e.deltaY)*.08),7,80);cam.user=4;},{passive:false});
}
function resize(){if(!R)return;const s=$('#stage');const w=s.clientWidth||600,h=s.clientHeight||400;R.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
const vis=a=>9*Math.pow(Math.max(a,0),.6);
function skyFor(alt){const t=clamp(alt/70000,0,1);const r=(34+(2-34)*t)/255,g=(92+(4-92)*t)/255,b=(150+(10-150)*t)/255;scene.background.setRGB(r,g,b);
 stars.material.opacity=.3+.7*clamp((alt-6000)/40000,0,1);
 planetClouds.visible=true;atmo.visible=true;atmo.material.opacity=.12+.07*(1-t);}
function frame3D(dt){
 visualClock+=dt;
 // tweens
 for(let i=tweens.length-1;i>=0;i--){const t=tweens[i];t.t+=dt;const u=clamp(t.t/t.d,0,1),k=1-Math.pow(1-u,3);t.o.position.y=t.from*(1-k);if(u>=1){t.o.position.y=0;tweens.splice(i,1);}}
 // debris
 for(let i=debris.length-1;i>=0;i--){const d=debris[i];d.t+=dt;d.vy-=9.8*dt*3;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;d.g.position.set(d.x,d.y,d.z);d.g.rotation.z+=d.rz*dt;d.g.rotation.x+=d.rx*dt;if(d.t>7){scene.remove(d.g);debris.splice(i,1);}}
 // rocket pose
 let jx=0,jz=0;
 if(mode==='flight'&&fl&&fl.phase==='shake'&&!RM){const amp=.12+.5*clamp((1.2-fl.d.twr)/.3,0,1);jx=(Math.random()-.5)*amp;jz=(Math.random()-.5)*amp;shake=amp;}else shake=0;
 rkx=jx;rkz=jz;
 if(mode==='flight'||mode==='ended'||mode==='countdown'){
  const a=fl?fl.y:0;visAlt+=(a-visAlt)*Math.min(1,dt*14);rky=vis(visAlt);
 }else rky=0;
 const idleBob=mode==='build'&&!RM?Math.sin(visualClock*2.1)*.035:0;
 rocketRoot.position.set(rkx,rky+idleBob,rkz);
 let pitch=0,yaw=0,roll=0;
 if(mode==='build'&&!RM){yaw=Math.sin(visualClock*.42)*.07;roll=Math.sin(visualClock*1.8)*.008;}
 else if(mode==='countdown'){roll=Math.sin(visualClock*24)*.01;}
 else if(mode==='flight'&&fl){const burn=fl.phase==='burn';pitch=burn?Math.sin(visualClock*2.2)*.012:0;roll=Math.sin(visualClock*(burn?4:18))*(burn?.014:.045);}
 rocketRoot.rotation.set(pitch,yaw,roll);
 if(planet)planet.rotation.y+=dt*.002;
 if(planetClouds)planetClouds.rotation.y+=dt*.0028;
 // flames
 if(rk){
  const live=mode==='flight'&&fl&&(fl.phase==='burn'||fl.phase==='shake')&&!exploded;
  const fk=.85+Math.random()*.3;
  const coreOn=live&&fl.core.prop>0&&(fl.phase==='burn'||Math.random()<.5);
  rk.flame.visible=!!coreOn;if(coreOn){rk.flame.scale.set(fk,fk*(fl.phase==='shake'?.5:1),fk);}
  rk.boosters.forEach((b,i)=>{const fb=fl&&fl.boosters[i];b.flame.visible=!!(live&&fb&&fb.attached&&fb.prop>0&&fl.phase==='burn');if(b.flame.visible)b.flame.scale.set(fk,fk,fk);});
  if(coreOn&&fl.phase==='burn'){for(let n=0;n<3;n++)emit(rkx+(Math.random()-.5)*.4,rky,rkz+(Math.random()-.5)*.4,(Math.random()-.5)*3,-10-Math.random()*8,(Math.random()-.5)*3,.45,1,.62,.2);
   emit(rkx,rky-1,rkz,(Math.random()-.5)*2,-3,(Math.random()-.5)*2,2.4,.34,.34,.4);
   rk.boosters.forEach((b,i)=>{const fb=fl.boosters[i];if(fb&&fb.attached&&fb.prop>0){emit(rkx+b.x,rky,rkz,(Math.random()-.5)*2,-9,(Math.random()-.5)*2,.4,1,.55,.15);emit(rkx+b.x,rky-.5,rkz,0,-2,0,1.8,.32,.32,.36);}});}
 }
 // jettison
 if(fl&&rk&&fl.jett.length){while(fl.jett.length){const b=fl.jett.shift();const i=fl.boosters.indexOf(b);const rb=rk.boosters[i];if(rb&&R){scene.add(rb.g);const sg=Math.sign(rb.x)||1;debris.push({g:rb.g,x:rkx+rb.x,y:rky,z:rkz,vx:sg*3,vy:-2,vz:(Math.random()-.5)*2,rx:(Math.random()-.5)*3,rz:-sg*(1+Math.random()*2),t:0});rb.flame.visible=false;}}}
 updParticles(dt);
 skyFor(visAlt);
 // camera
 let tx=0,ty=3.2,tz=0,dist=cam.dist;
 if(mode==='flight'||mode==='countdown'){tx=rkx;ty=rky+3.2;tz=rkz;}
 else if(mode==='ended'){tx=rkx;ty=rky+3.2;tz=rkz;if(fl&&fl.outcome==='ORBIT'||fl&&fl.outcome==='POWER'){if(cam.user<=0){cam.az+=dt*.12;dist=Math.min(cam.dist+dt*4,60);cam.dist=dist;}}}
 if(mode==='build'&&cam.user<=0&&!RM){cam.az+=dt*.14;}
 if(cam.user>0)cam.user-=dt;
 const sx=shake&&!RM?(Math.random()-.5)*shake:0,sy=shake&&!RM?(Math.random()-.5)*shake:0;
 camera.position.set(tx+dist*Math.sin(cam.pol)*Math.sin(cam.az)+sx,ty+dist*Math.cos(cam.pol)+sy,tz+dist*Math.sin(cam.pol)*Math.cos(cam.az));
 camera.lookAt(tx,ty,tz);
 stars.position.set(camera.position.x,camera.position.y,camera.position.z);
 R.render(scene,camera);
}

/* ---------- build state ---------- */
function setBuild(nb,addedId,msg){hist.push(clone(build));if(hist.length>60)hist.shift();redo.length=0;build=nb;onChange(addedId,msg);}
function onChange(addedId,msg){rebuildRocket(addedId);renderAll();if(msg){logEv(msg,'');announce(msg+'. Thrust to weight '+evalBuild(build).twr.toFixed(2)+'.');}}
function addPart(id){if(mode!=='build'||!canAdd(build,id))return;const nb=clone(build);nb.counts[id]=(nb.counts[id]||0)+1;blip(520+nb.counts[id]*60,.09,'square',.035);setBuild(nb,id,PBY[id].name+' attached to rocket');}
function rmPart(id){if(mode!=='build'||!(build.counts[id]>0))return;const nb=clone(build);nb.counts[id]--;if(!nb.counts[id])delete nb.counts[id];blip(260,.08,'triangle',.04);setBuild(nb,null,PBY[id].name+' removed');}
function setMat(m){if(mode!=='build'||m===build.mat)return;const nb=clone(build);nb.mat=m;blip(420,.1,'sine',.04);setBuild(nb,null,'Structure switched to '+MATS[m].n);}
let crewPending=false;
function setCrew(n){if(mode!=='build'||n===build.crew)return;if(!crewPending){hist.push(clone(build));redo.length=0;crewPending=true;}build.crew=n;renderGauges();renderExamples();}
function loadBuild(b,label){if(mode!=='build')return;hist.push(clone(build));redo.length=0;build=clone(b);onChange(null,label);}

/* ---------- UI render ---------- */
function gate(id,ok,label,val,sub,frac,mark,stat){return '<div class="g '+(ok===null?'neutral':ok?'':'bad')+'"><div class="gl">'+label+'</div><div class="gv">'+val+'</div><div class="bar"><i style="width:'+clamp(frac*100,0,100)+'%"></i>'+(mark!=null?'<b style="left:'+mark*100+'%"></b>':'')+'</div><div class="gs"><span class="chip">'+(ok===null?'·':ok?'✓':'✕')+' '+stat+'</span><span>'+sub+'</span></div></div>';}
function renderGauges(){
 const d=evalBuild(build),G=d.gates;let gen=0,draw=0;for(const p of PARTS){const n=count(build,p.id);if(p.power>0)gen+=n*p.power;else draw-=n*p.power;}
 const f=sim(build);const ap=G.twr.pass?f.maxY/1000:0;
 const eff=efficiency(d);
 const rows=[
  gate('twr',G.twr.pass&&G.struct.pass,'Thrust / weight',d.twr.toFixed(2),'min 1.20 · max '+d.limit.toFixed(1),d.twr/3,1.2/3,G.twr.pass?(G.struct.pass?'OK':'TOO HIGH'):'TOO LOW'),
  gate('bud',G.budget.pass,'Budget',money(d.cost),'ceiling $1.00M',d.cost/1.2e6,1/1.2,G.budget.pass?'OK':'OVER'),
  gate('mass',G.mass.pass,'Mass',Math.round(d.mass).toLocaleString('en-US')+' kg','limit 5,000 kg',d.mass/6000,5000/6000,G.mass.pass?'OK':'OVER'),
  gate('pow',G.power.pass,'Net power',(d.power>=0?'+':'')+d.power.toFixed(1)+' kW','gen '+gen.toFixed(1)+' · draw '+draw.toFixed(1),gen>0?draw/gen:1,null,G.power.pass?'SURPLUS':'DEFICIT'),
  gate('days',null,'Build time',d.days.toFixed(1)+' days','crew '+build.crew+' · '+Math.round(d.hours)+' work hours',d.days/60,null,'INFO'),
  gate('apo',G.twr.pass?ap>=100:false,'Est. apogee',G.twr.pass?ap.toFixed(0)+' km':'crash','target 100 km',ap/120,100/120,G.twr.pass?(ap>=100?'ORBIT':'SHORT'):'NO LIFT')
 ];
 $('#gauges').innerHTML=rows.join('')+gate('eff',null,'Efficiency index',String(eff),'$'+Math.round(d.cost/Math.max(1,d.payload)).toLocaleString('en-US')+' per kg payload',eff/100,null,'SCORE').replace('<div class="g neutral">','<div class="g neutral" style="grid-column:1/-1">');
 const fails=Object.values(G).filter(g=>!g.pass).length+(G.twr.pass&&ap<100?1:0);
 const lb=$('#launch');lb.textContent=fails?'Launch anyway ('+fails+' failing)':'Launch';
}
const TABS=[['propulsion','Propulsion'],['power','Power'],['payload','Payload'],['structure','Structure'],['crew','Crew'],['agency','Agency'],['codex','Codex']];
function renderTabs(){$('#tabs').innerHTML=TABS.map(t=>'<button role="tab" id="tab-'+t[0]+'" aria-selected="'+(tab===t[0])+'" data-tab="'+t[0]+'">'+t[1]+'</button>').join('');}
function chips(p){const mm=matFor(build,p);const m=p.dry*mm.m+p.prop;let h='<span>'+Math.round(m)+' kg</span><span>'+money(p.cost*mm.c)+'</span>';if(p.thrust)h+='<span class="pos">'+(p.thrust/1000)+' kN</span>';if(p.power)h+='<span class="'+(p.power>0?'pos':'neg')+'">'+(p.power>0?'+':'')+p.power+' kW</span>';h+='<span>'+p.hours+' h</span>';return h;}
function renderCatalog(){
 const L=$('#catalog');L.setAttribute('aria-labelledby','tab-'+tab);
 if(tab==='agency'){renderAgency(L);return;}
 if(tab==='codex'){renderCodex(L);return;}
 if(tab==='structure'){L.innerHTML=Object.keys(MATS).map(k=>{const m=MATS[k];const sel=k===build.mat;return '<div class="card'+(sel?' sel':'')+'" draggable="true" data-drag-mat="'+k+'" title="Drag material onto the 3D rocket to select it"><div class="ct"><b>'+m.n+'</b><span class="cnt">'+(sel?'✓ selected':'')+'</span></div><div class="chips"><span>mass ×'+m.m+'</span><span>cost ×'+m.c+'</span><span>time ×'+m.t+'</span><span>limit '+(3*m.s).toFixed(1)+' g</span><span>heat ×'+m.h+'</span></div><p class="note">'+m.note+'</p><div class="act"><button class="btn" data-mat="'+k+'" '+(sel?'disabled':'')+'>'+(sel?'In use':'Use this')+'</button></div></div>';}).join('')+'<p class="fine">Material changes the dry mass, cost and build time of the capsule, core stage and boosters. Strength sets how many g the structure survives at max-Q.</p>';return;}
 if(tab==='crew'){const d=evalBuild(build);L.innerHTML='<div class="card"><div class="ct"><b>Assembly crew</b><span class="cnt">'+build.crew+' people</span></div><label for="crew" class="note">More crew builds faster. Each person above 4 costs $30k.</label><input id="crew" type="range" min="4" max="10" step="1" value="'+build.crew+'"><div class="chips"><span>'+d.days.toFixed(1)+' days</span><span>'+money(Math.max(0,(build.crew-4)*30000))+' extra</span><span>'+Math.round(d.hours)+' work hours</span></div><p class="note">Repeating a part type gets 8% faster each time. Mixing many part types adds 4% integration time each.</p></div>';return;}
 const cats=tab==='propulsion'?['core','propulsion']:[tab];
 L.innerHTML=PARTS.filter(p=>cats.includes(p.cat)).map(p=>{const n=count(build,p.id);const can=canAdd(build,p.id);
  const why=p.booster&&boosterTotal(build)>=2?'Two booster slots are full':(n>=p.max?'Slot full':'');
  return '<div class="card" '+(p.fixed?'':'draggable="true" data-drag-part="'+p.id+'" title="Drag onto the 3D rocket to attach"')+'><div class="ct"><b>'+p.name+'</b><span class="cnt">'+(p.fixed?'included':n+' / '+p.max)+'</span></div><div class="chips">'+chips(p)+'</div><div class="act">'+(p.fixed?'<button class="btn" disabled>Required</button>':'<button class="btn" data-rm="'+p.id+'" '+(n?'':'disabled')+' aria-label="Remove one '+p.name+'">−</button><button class="btn pri" data-add="'+p.id+'" '+(can?'':'disabled')+' title="'+why+'" aria-label="Add '+p.name+'">+ Add</button>')+'</div></div>';}).join('');
}
function renderExamples(){$('#examples').innerHTML=Object.keys(EXAMPLES).map(k=>'<button class="btn" data-ex="'+k+'">'+EXAMPLES[k].name+'</button>').join('');$('#undo').disabled=!hist.length||mode!=='build';$('#redo').disabled=!redo.length||mode!=='build';}
function renderAll(){renderGauges();renderTabs();renderCatalog();renderExamples();}

/* ---------- agency flag & combination codex ---------- */
function loadCodex(){try{const s=JSON.parse(localStorage.getItem('ng-codex')||'null');if(s&&Array.isArray(s.tried)&&Array.isArray(s.mats)&&Array.isArray(s.parts))return {tried:s.tried.slice(0,2000),mats:s.mats,parts:s.parts,best:+s.best||0};}catch(e){}return {tried:[],mats:[],parts:[],best:0};}
function saveCodex(){try{localStorage.setItem('ng-codex',JSON.stringify(codex));}catch(e){}}
function recordTry(b){const k=key(b);if(!codex.tried.includes(k)&&codex.tried.length<2000)codex.tried.push(k);if(!codex.mats.includes(b.mat))codex.mats.push(b.mat);for(const id in b.counts)if(b.counts[id]>0&&!codex.parts.includes(id))codex.parts.push(id);saveCodex();}
function agencySelect(k,label,opts){return '<label class="agl">'+label+'<select data-ag="'+k+'">'+opts.map(o=>'<option value="'+o+'"'+(agency[k]===o?' selected':'')+'>'+o+'</option>').join('')+'</select></label>';}
function agencyColor(k,label){return '<label class="agl">'+label+'<input type="color" data-ag="'+k+'" value="'+agency[k]+'"></label>';}
function agencyPreview(){const i=$('#flagPrev');if(!i)return;try{i.src=flagCv.toDataURL();}catch(e){}const n=$('#agNote');if(n){const c=contrastRatio(agency.emblemColor,agency.field);n.textContent=agency.emblem==='none'?'':'Emblem contrast '+c.toFixed(1)+':1'+(c<3?'. Low: pick a lighter or darker emblem colour.':'. Readable.');}}
function renderAgency(L){
 L.innerHTML='<div class="card"><div class="ct"><b>Agency flag</b><span class="cnt">saved on this device</span></div><img id="flagPrev" alt="Preview of your agency flag" width="256" height="160" style="width:100%;max-width:256px;border:1px solid var(--line);border-radius:3px"><div class="ag"><label class="agl">Agency name<input type="text" maxlength="24" data-ag="name" value="'+escHtml(agency.name)+'"></label>'+agencyColor('field','Field colour')+agencySelect('pattern','Pattern',AG_ENUM.pattern)+agencyColor('stripe','Pattern colour')+agencySelect('emblem','Emblem',AG_ENUM.emblem)+agencyColor('emblemColor','Emblem colour')+agencySelect('pos','Emblem position',AG_ENUM.pos)+agencySelect('size','Emblem size',AG_ENUM.size)+'</div><p class="note" id="agNote"></p></div><p class="fine">The flag appears on the rocket body, the launch tower and the mission debrief.</p>';agencyPreview();}
function renderCodex(L){const total=designSpace(PARTS,MATS),tried=codex.tried.length,pct=Math.max(tried?1:0,Math.round(1000*tried/total)/10);const tag=(on,t)=>'<span class="'+(on?'pos':'')+'">'+(on?'✓ ':'· ')+t+'</span>';L.innerHTML='<div class="card"><div class="ct"><b>Combination codex</b><span class="cnt">'+tried+' / '+total.toLocaleString('en-US')+' designs</span></div><div style="height:5px;background:#0b111c;border-radius:2px"><i style="display:block;height:100%;width:'+pct+'%;background:var(--cyan)"></i></div><p class="note">Every different mix of parts, structure material and crew size counts as one design. A design is logged when you launch it.</p></div>'+'<div class="card"><div class="ct"><b>Structure materials tried</b><span class="cnt">'+codex.mats.length+' / '+Object.keys(MATS).length+'</span></div><div class="chips">'+Object.keys(MATS).map(k=>tag(codex.mats.includes(k),MATS[k].n)).join('')+'</div></div>'+'<div class="card"><div class="ct"><b>Parts flown</b><span class="cnt">'+PARTS.filter(p=>!p.fixed&&codex.parts.includes(p.id)).length+' / '+PARTS.filter(p=>!p.fixed).length+'</span></div><div class="chips">'+PARTS.filter(p=>!p.fixed).map(p=>tag(codex.parts.includes(p.id),p.name)).join('')+'</div></div>'+'<div class="card"><div class="ct"><b>Best efficiency on a clean orbit</b><span class="cnt">'+(codex.best||'none yet')+'</span></div></div>';}
document.addEventListener('input',e=>{const k=e.target&&e.target.dataset&&e.target.dataset.ag;if(!k)return;agency=cleanAgency(Object.assign({},agency,{[k]:e.target.value}));saveAgency(agency);drawFlag(agency,flagCv);if(flagTex)flagTex.needsUpdate=true;agencyPreview();});

/* ---------- log & HUD ---------- */
function logEv(s,cls,t){const L=$('#log');const d=document.createElement('div');d.className=cls||'';d.textContent=(t!=null?'T+'+tfmt(t)+'  ':'')+s;L.appendChild(d);while(L.children.length>5)L.removeChild(L.firstChild);if(mode==='build')setTimeout(()=>{if(d.parentNode&&mode==='build')d.remove();},6000);}
function setStatus(s){$('#status').textContent=s;}
function updHUD(){if(!fl)return;const stage=fl.boosters.some(b=>b.attached&&b.prop>0)?'1 · core + boosters':fl.core.prop>0?'2 · core':'coast';
 let p=fl.core.prop;fl.boosters.forEach(b=>{if(b.attached)p+=b.prop;});
 const spd=Math.abs(fl.v);$('#tele').innerHTML='<span>T+</span><div>'+tfmt(fl.t)+'</div><span>Altitude</span><div>'+(fl.y>=1000?(fl.y/1000).toFixed(1)+' km':Math.round(fl.y)+' m')+'</div><span>Velocity</span><div>'+Math.round(spd)+' m/s</div><span>Throttle</span><div>'+(fl.core.prop>0?'100%':'0%')+'</div><span>Stage</span><div>'+stage+'</div><span>Fuel</span><div>'+Math.round(100*p/prop0)+'%</div><span>Max-Q</span><div>'+(fl.q/1000).toFixed(1)+' kPa</div>';}

/* ---------- flight ---------- */
function setLocked(l){document.querySelectorAll('#bay button,#bay input').forEach(b=>{if(b.id==='mute')return;b.disabled=l;});if(!l){renderAll();$('#reset').disabled=false;}}
function launch(){
 if(mode!=='build')return;closeDeb();actx();recordTry(build);
 fl=newFlight(build);prop0=fl.core.prop+fl.boosters.reduce((s,b)=>s+b.prop,0);samples=[];lastSample=-1;simAcc=0;paused=false;visAlt=0;exploded=false;
 rebuildRocket();debris.forEach(d=>scene&&scene.remove(d.g));debris.length=0;
 mode='countdown';cdT=3.2;setLocked(true);$('#launch').hidden=true;$('#log').innerHTML='';
 $('#tele').hidden=false;$('#speedRow').hidden=false;renderSpeed();$('#hint').textContent='Drag to orbit · Scroll to zoom';setStatus('Countdown');
 cam.dist=17;cam.pol=1.3;announce('Launch sequence started');startRumble();
}
function renderSpeed(){$('#speedRow').innerHTML=[1,6,20,60].map(s=>'<button class="btn" data-speed="'+s+'" aria-pressed="'+(speed===s)+'" style="min-height:32px;padding:5px 10px'+(speed===s?';border-color:var(--thrust)':'')+'">'+s+'×</button>').join('')+'<button class="btn" data-pause="1" style="min-height:32px;padding:5px 10px">'+(paused?'Resume':'Pause')+'</button>';}
function tick(dt){
 if(mode==='countdown'){cdT-=dt;const n=Math.ceil(cdT);const c=$('#count');c.hidden=cdT<=0;if(n>=1)c.textContent=n;if(cdT<=0){c.hidden=true;mode='flight';setStatus('Ascent');ev(fl,'Ignition');flushEv();blip(90,.5,'sawtooth',.06);}return;}
 if(mode!=='flight')return;
 if(!paused){simAcc+=dt*speed;let n=0;while(simAcc>=DT&&n++<400){stepFlight(fl);simAcc-=DT;
  if(fl.t-lastSample>=1){lastSample=fl.t;samples.push({t:fl.t,alt:fl.y/1000,v:fl.v});}
  if(fl.phase==='done'||fl.phase==='crash'||fl.phase==='breakup'){break;}}}
 flushEv();updHUD();
 let th=0;if(fl.phase==='burn'&&fl.thrusting)th=.7;if(fl.phase==='shake')th=.45;setRumble(th);
 if(fl.phase==='crash'||fl.phase==='breakup'){if(!exploded){exploded=true;if(rkGroup)rkGroup.visible=false;explode(rkx,rky,rkz,260);blip(70,.9,'sawtooth',.08);}}
 if(fl.phase==='done'||fl.phase==='crash'||fl.phase==='breakup')endFlight();
}
function flushEv(){if(!fl||!fl.newEvents)return;fl.newEvents.forEach(s=>{const cls=/lost|fail|crash|below/i.test(s)?'bad':/Apogee|Liftoff/.test(s)?'ok':'';logEv(s,cls,fl.t);announce(s);});fl.newEvents.length=0;}
function endFlight(){
 if(mode==='ended')return;mode='ended';samples.push({t:fl.t,alt:fl.y/1000,v:fl.v});stopRumble();$('#speedRow').hidden=true;
 const o=fl.outcome;setStatus(o==='ORBIT'?'Orbit reached':o==='PAD_CRASH'?'Lost on pad':o==='BREAKUP'?'Structural failure':o==='POWER'?'Power failure':'Suborbital');
 if(o==='ORBIT'){blip(660,.2,'sine',.05);setTimeout(()=>blip(880,.3,'sine',.05),180);}
 const wait=o==='ORBIT'||o==='POWER'?2600:1500;
 debTimer=setTimeout(showDeb,wait);
}

/* ---------- debrief ---------- */
function gateText(k,g,d,b){
 const m=MATS[b.mat].n;
 if(k==='twr')return g.pass?'Thrust is '+g.value.toFixed(2)+'× the rocket’s weight. The minimum is 1.20.':'Thrust is only '+g.value.toFixed(2)+'× the rocket’s weight. It must be at least 1.20 to leave the pad.';
 if(k==='budget')return g.pass?'Hardware and crew cost '+money(g.value)+', under the $1.00M ceiling.':'Hardware and crew cost '+money(g.value)+', which is '+money(g.value-g.limit)+' over the $1.00M ceiling.';
 if(k==='mass')return g.pass?'Launch mass is '+Math.round(g.value)+' kg, within the 5,000 kg pad limit.':'Launch mass is '+Math.round(g.value)+' kg, which is '+Math.round(g.value-g.limit)+' kg over the pad limit.';
 if(k==='power')return g.pass?'Generation beats consumption by '+g.value.toFixed(1)+' kW.':'Consumption exceeds generation by '+(-g.value).toFixed(1)+' kW. Payloads go dark in orbit.';
 return g.pass?'Liftoff load is '+g.value.toFixed(2)+' g. '+m+' holds up to '+g.limit.toFixed(1)+' g.':'Liftoff load is '+g.value.toFixed(2)+' g but '+m+' only holds '+g.limit.toFixed(1)+' g. The structure breaks at max-Q.';
}
const GN={twr:'Thrust-to-weight',budget:'Budget',mass:'Pad mass',power:'Net power',struct:'Structure'};
function chart(label,unit,key,col){
 const W=320,H=130,l=38,b=20,t=8,r=10;const S=samples;const mt=Math.max(1,S[S.length-1].t);let mv=1;S.forEach(s=>{mv=Math.max(mv,s[key]);});
 const X=v=>l+(W-l-r)*v/mt,Y=v=>H-b-(H-b-t)*Math.max(0,v)/mv;
 const pts=S.map(s=>X(s.t).toFixed(1)+','+Y(s[key]).toFixed(1)).join(' ');const e=S[S.length-1];
 const evs=fl.events.filter(x=>/separation|cutoff/.test(x.s)).map(x=>'<line class="ev" x1="'+X(x.t)+'" x2="'+X(x.t)+'" y1="'+t+'" y2="'+(H-b)+'"/>').join('');
 return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+label+' over time, peak '+mv.toFixed(key==='alt'?0:0)+' '+unit+'"><line class="ax" x1="'+l+'" x2="'+l+'" y1="'+t+'" y2="'+(H-b)+'"/><line class="ax" x1="'+l+'" x2="'+(W-r)+'" y1="'+(H-b)+'" y2="'+(H-b)+'"/>'+evs+'<polyline class="ln" points="'+pts+'"/><circle cx="'+X(e.t)+'" cy="'+Y(e[key])+'" r="3"/><text x="4" y="'+(t+8)+'">'+Math.round(mv)+'</text><text x="4" y="'+(H-b)+'">0</text><text x="'+l+'" y="'+(H-5)+'">0 s</text><text x="'+(W-r)+'" y="'+(H-5)+'" text-anchor="end">'+Math.round(mt)+' s</text><text x="'+(l+6)+'" y="'+(t+8)+'">'+label+' ('+unit+')</text></svg>';
}
function showDeb(){
 const d=fl.d,o=fl.outcome,G=d.gates,eff=efficiency(d);const allOk=d.allPass&&o==='ORBIT';
 let head,cls,sub;
 if(allOk){head='Orbit reached. Payload online.';cls='ok';sub='Mission success';}
 else if(o==='ORBIT'||o==='POWER'){head=o==='POWER'?'Mission lost: power starvation.':'Reached orbit, but the design broke the rules.';cls=o==='POWER'?'bad':'warn';sub=o==='POWER'?'Failed in orbit':'Rule violation';}
 else if(o==='PAD_CRASH'){head='Liftoff failed: not enough thrust.';cls='bad';sub='Lost on the pad';}
 else if(o==='BREAKUP'){head='Structure failed at max-Q.';cls='bad';sub='Lost in flight';}
 else{head='Ran out of delta-v at '+(fl.maxY/1000).toFixed(0)+' km.';cls='bad';sub='Suborbital';}
 const gates=Object.keys(G).map(k=>'<div class="gc'+(G[k].pass?'':' fail')+'"><div class="t"><span>'+GN[k]+'</span><em>'+(G[k].pass?'✓ Pass':'✕ Fail')+'</em></div><div class="v">'+({twr:G[k].value.toFixed(2),budget:money(G[k].value),mass:Math.round(G[k].value)+' kg',power:(G[k].value>=0?'+':'')+G[k].value.toFixed(1)+' kW',struct:G[k].value.toFixed(2)+' g'})[k]+'</div><p>'+gateText(k,G[k],d,build)+'</p></div>').join('');
 const asc=G.twr.pass?'<div class="gc'+(fl.maxY>=100000?'':' fail')+'"><div class="t"><span>Ascent</span><em>'+(fl.maxY>=100000?'✓ Reached 100 km':'✕ Short')+'</em></div><div class="v">'+(fl.maxY/1000).toFixed(1)+' km apogee</div><p>'+(fl.maxY>=100000?'Enough delta-v to reach orbital altitude.':'The propellant ran out too early. Cut mass or add thrust and fuel.')+'</p></div>':'';
 const cmp=lastRun?['cost','days','eff'].map(k=>{const dv=({cost:d.cost-lastRun.cost,days:d.days-lastRun.days,eff:eff-lastRun.eff})[k];const good=k==='eff'?dv>0:dv<0;const name={cost:'Cost',days:'Build time',eff:'Efficiency'}[k];const txt=k==='cost'?(dv>=0?'+':'−')+money(Math.abs(dv)):k==='days'?(dv>=0?'+':'−')+Math.abs(dv).toFixed(1)+' d':(dv>=0?'+':'')+dv;return '<span class="d '+(dv===0?'':good?'up':'dn')+'">'+name+' '+txt+'</span>';}).join(''):'<span class="d">First attempt</span>';
 let fixes='';
 if(!allOk){const adv=advise(build);fixes=adv.length?adv.map((a,i)=>'<div class="fix"><div><b>'+a.label+'</b><p>'+(a.fixed.length?'Fixes '+a.fixed.map(x=>x.toLowerCase()).join(', ')+'. ':'')+(a.left.length?'Still failing: '+a.left.map(x=>x.toLowerCase()).join(', ')+'. ':'Clears every check. ')+'New thrust-to-weight '+a.d.twr.toFixed(2)+', cost '+money(a.d.cost)+'.</p></div><button class="btn pri" data-apply="'+i+'">Apply</button></div>').join(''):'<p class="fine">No single change fixes this. Try an example design or reset.</p>';}
 else{const imp=improve(build);fixes=imp.length?imp.map((a,i)=>'<div class="fix"><div><b>'+a.label+'</b><p>Efficiency '+eff+' → '+a.eff+'. Cost '+money(a.d.cost)+', build time '+a.d.days.toFixed(1)+' days.</p></div><button class="btn pri" data-apply="'+i+'">Apply</button></div>').join(''):'<p class="fine">No single swap beats this design. Strong build.</p>';window._imp=imp;}
 window._adv=allOk?window._imp:advise(build);
 lastRun={cost:d.cost,days:d.days,eff:eff};
 if(allOk&&eff>codex.best){codex.best=eff;saveCodex();}
 const el=$('#deb');
 el.innerHTML='<div class="sheet"><div class="head '+cls+'"><small>'+escHtml(agency.name)+' · '+sub+' · Mission debrief</small><h2 id="debT">'+head+'</h2></div>'
  +'<div class="deltas"><span class="d">Efficiency index '+eff+'</span><span class="d">'+money(d.cost)+'</span><span class="d">'+d.days.toFixed(1)+' days to build</span><span class="d">'+Math.round(d.mass)+' kg</span>'+cmp+'</div>'
  +'<div class="grid2">'+gates+asc+'</div>'
  +(samples.length>2?'<div class="charts">'+chart('Altitude','km','alt')+chart('Velocity','m/s','v')+'</div>':'')
  +'<div><h3 style="font:600 12px var(--display);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0 0 8px">'+(allOk?'Make it cheaper, faster or more efficient':'What to change')+'</h3><div class="list">'+fixes+'</div></div>'
  +'<div class="row"><button class="btn pri" data-deb="rebuild">Rebuild this design</button><button class="btn" data-deb="reset">Reset to starter</button><button class="btn" data-deb="replay">Launch again</button></div></div>';
 el.hidden=false;el.scrollTop=0;const f=$('[data-deb=rebuild]',el);if(f)f.focus();announce(head);
}
function closeDeb(){clearTimeout(debTimer);$('#deb').hidden=true;}
function backToBuild(){closeDeb();mode='build';fl=null;exploded=false;visAlt=0;rky=0;if(R){debris.forEach(d=>scene.remove(d.g));debris.length=0;P.life.fill(0);rebuildRocket();rkGroup.visible=true;}
 $('#log').innerHTML='';$('#tele').hidden=true;$('#speedRow').hidden=true;$('#count').hidden=true;$('#launch').hidden=false;$('#hint').textContent='Drag parts or materials onto rocket · Drag to orbit · Scroll to zoom';setStatus('Build');cam.dist=17;cam.pol=1.32;cam.user=0;stopRumble();setLocked(false);}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
 const t=e.target.closest('button,[data-tab]');if(!t)return;
 if(t.dataset.tab){tab=t.dataset.tab;renderTabs();renderCatalog();return;}
 if(t.dataset.add)return addPart(t.dataset.add);
 if(t.dataset.rm)return rmPart(t.dataset.rm);
 if(t.dataset.mat)return setMat(t.dataset.mat);
 if(t.dataset.ex){return loadBuild(EXAMPLES[t.dataset.ex],'Loaded example '+EXAMPLES[t.dataset.ex].name);}
 if(t.dataset.speed){speed=+t.dataset.speed;renderSpeed();return;}
 if(t.dataset.pause){paused=!paused;renderSpeed();return;}
 if(t.dataset.apply!==undefined){const a=(window._adv||[])[+t.dataset.apply];if(a){backToBuild();setBuild(clone(a.b),null,a.label);}return;}
 if(t.dataset.deb==='rebuild'){backToBuild();return;}
 if(t.dataset.deb==='reset'){backToBuild();setBuild(clone(START),null,'Reset to starter build');return;}
 if(t.dataset.deb==='replay'){backToBuild();launch();return;}
 if(t.id==='launch')return launch();
 if(t.id==='undo'&&hist.length&&mode==='build'){redo.push(clone(build));build=hist.pop();onChange(null,'Undo');return;}
 if(t.id==='redo'&&redo.length&&mode==='build'){hist.push(clone(build));build=redo.pop();onChange(null,'Redo');return;}
 if(t.id==='reset'&&mode==='build'){setBuild(clone(START),null,'Reset to starter build');return;}
 if(t.id==='mute'){muted=!muted;t.textContent=muted?'Sound off':'Sound on';t.setAttribute('aria-pressed',String(muted));if(muted)stopRumble();return;}
});
document.addEventListener('change',e=>{if(e.target.id==='crew')crewPending=false;});
document.addEventListener('input',e=>{if(e.target.id==='crew'){setCrew(+e.target.value);const d=evalBuild(build);const c=$('#crew');if(c){const ch=c.parentNode.querySelector('.chips');if(ch)ch.innerHTML='<span>'+d.days.toFixed(1)+' days</span><span>'+money(Math.max(0,(build.crew-4)*30000))+' extra</span><span>'+Math.round(d.hours)+' work hours</span>';const ct=c.parentNode.querySelector('.cnt');if(ct)ct.textContent=build.crew+' people';}}});
document.addEventListener('keydown',e=>{if(e.target.matches&&e.target.matches('input,textarea,select'))return;if(e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase();
 if(k==='escape'&&!$('#deb').hidden){backToBuild();return;}
 if(!$('#deb').hidden)return;
 if(k==='l'&&mode==='build'){launch();}
 else if(k==='r'&&mode==='build'){setBuild(clone(START),null,'Reset to starter build');}
 else if(k==='z'&&mode==='build'){if(e.shiftKey){$('#redo').click();}else{$('#undo').click();}}
});

/* ---------- main loop ---------- */
let last=performance.now();
function loop(now){const dt=Math.min(.1,(now-last)/1000);last=now;try{tick(dt);if(R)frame3D(dt);}catch(err){console.error(err);}requestAnimationFrame(loop);}
init3D();renderAll();logEv('Starter build loaded. Add parts, then launch.','');
window.__ng={get mode(){return mode;},get fl(){return fl;},launch,get build(){return build;}};
requestAnimationFrame(loop);
})();
