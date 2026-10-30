/* Architect's card model of the hero house, built in three.js */
(function(){
  var stage=document.getElementById('stage'),fb=document.getElementById('stageFallback');
  var hint=document.getElementById('stageHint'),bW=document.getElementById('vWhole'),bF=document.getElementById('vFloors');
  if(!window.THREE||!THREE.OrbitControls){bW.parentNode.hidden=true;hint.hidden=true;return;}
  var renderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch(e){bW.parentNode.hidden=true;hint.hidden=true;return;}
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputEncoding=THREE.sRGBEncoding;
  stage.insertBefore(renderer.domElement,stage.firstChild);
  fb.hidden=true;

  var scene=new THREE.Scene();
  var camera=new THREE.PerspectiveCamera(32,1,0.1,200);
  camera.position.set(17,11,19);
  var controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.target.set(0,3.2,0);controls.enableDamping=true;controls.enablePan=false;controls.enableZoom=false;
  controls.minPolarAngle=0.35;controls.maxPolarAngle=1.38;controls.autoRotate=!reduce;controls.autoRotateSpeed=0.6;

  scene.add(new THREE.HemisphereLight(0xfff6ea,0xb9a690,0.75));
  var sun=new THREE.DirectionalLight(0xffe2c4,0.95);
  sun.position.set(12,18,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  var sc=sun.shadow.camera;sc.left=-14;sc.right=14;sc.top=14;sc.bottom=-14;sc.near=1;sc.far=60;sun.shadow.bias=-0.0005;
  scene.add(sun);

  function mat(c,r){return new THREE.MeshStandardMaterial({color:c,roughness:r==null?0.85:r,metalness:0});}
  var M={card:mat(0xF7F3EC),brick:mat(0x8D3C27),wood:mat(0x8A5A34,0.7),glass:mat(0x55625a,0.25),base:mat(0xCBB4A4,0.95),leaf:mat(0x414C2C),trunk:mat(0x6E5A44)};
  var edgeMat=new THREE.LineBasicMaterial({color:0x22211E,transparent:true,opacity:0.22});
  function box(g,w,h,d,x,y,z,m,edges){
    var mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);
    if(edges!==false){var l=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),edgeMat);l.position.copy(mesh.position);g.add(l);}
    return mesh;
  }
  var house=new THREE.Group();scene.add(house);

  /* site board */
  var board=box(scene,22,0.4,20,0,-0.2,0,M.base,false);board.castShadow=false;
  box(scene,10.4,0.45,12.4,0.2,0.225,0,M.card);
  /* driveway */
  var dw=box(scene,3.2,0.02,4.5,3.4,0.01,8,mat(0xE6DACF),false);dw.castShadow=false;

  /* ground floor */
  var gf=new THREE.Group();house.add(gf);
  box(gf,6.6,3,10,0.9,1.95,0,M.card);
  box(gf,2.3,3,9.4,-3.55,1.95,0,M.brick);
  box(gf,4.4,2.5,0.06,1.4,1.75,5.03,M.glass,false);
  box(gf,1,2.6,0.06,-1.4,1.8,5.03,M.wood,false);
  box(gf,11.4,0.32,11,0.5,3.61,0.3,M.card);
  var col=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,3,16),M.card);col.position.set(5.6,1.95,5.3);col.castShadow=true;gf.add(col);

  /* first floor */
  var ff=new THREE.Group();house.add(ff);
  box(ff,5.6,3,9,0.6,5.27,-0.4,M.card);
  box(ff,2.3,3,9,-3.55,5.27,-0.4,M.brick);
  /* arched-window stand-in on the brick */
  box(ff,0.9,1.6,0.06,-3.55,5.1,4.13,M.glass,false);
  for(var i=0;i<12;i++){box(ff,0.09,2.7,0.14,-1.6+i*0.38,5.22,4.25,M.wood,false);}
  /* terrace railing over the porch */
  box(ff,0.05,0.9,6.2,5.9,4.22,0.6,M.card,false);
  box(ff,2.8,0.9,0.05,4.5,4.22,3.7,M.card,false);

  /* roof */
  var rf=new THREE.Group();house.add(rf);
  box(rf,9.4,0.3,10.2,-0.5,6.92,-0.4,M.card);
  box(rf,2.8,2.2,3.2,1.6,8.17,-2.2,M.card);
  box(rf,3.2,0.2,3.6,1.6,9.37,-2.2,M.card);

  /* landscape */
  function palm(x,z,h){
    var t=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.16,h,8),M.trunk);t.position.set(x,h/2,z);t.rotation.z=0.06;t.castShadow=true;scene.add(t);
    for(var k=0;k<7;k++){var f=new THREE.Mesh(new THREE.ConeGeometry(0.28,2.4,4),M.leaf);f.position.set(x+Math.cos(k)*0.9,h-0.1,z+Math.sin(k)*0.9);f.rotation.set(Math.sin(k)*1.2,0,-Math.cos(k)*1.2);f.castShadow=true;scene.add(f);}
  }
  palm(-6.6,5.2,6.4);
  [[-7.6,-3.5,0.9],[-6.9,-5.8,0.7],[7.6,-4.2,0.8],[-5.6,7.6,0.6],[6.8,7.2,0.55]].forEach(function(b){
    var sp=new THREE.Mesh(new THREE.SphereGeometry(b[2],18,14),M.leaf);sp.position.set(b[0],b[2]*0.8,b[1]);sp.castShadow=true;scene.add(sp);
  });

  /* exploded view */
  var target=0,cur=0;
  function setView(f){target=f?1:0;bW.setAttribute('aria-pressed',!f);bF.setAttribute('aria-pressed',!!f);if(reduce)cur=target;}
  bW.onclick=function(){setView(false)};bF.onclick=function(){setView(true)};
  controls.addEventListener('start',function(){controls.autoRotate=false;hint.textContent='Drag to turn. Use the buttons to see each floor.';});

  function size(){var w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  new ResizeObserver(size).observe(stage);size();

  var visible=true;
  new IntersectionObserver(function(e){visible=e[0].isIntersecting;},{rootMargin:'100px'}).observe(stage);
  (function loop(){
    requestAnimationFrame(loop);
    if(!visible)return;
    cur+= (target-cur)*0.08;
    ff.position.y=cur*2.4;rf.position.y=cur*5;
    controls.update();renderer.render(scene,camera);
  })();
})();
