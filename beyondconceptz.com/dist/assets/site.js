/* Beyond Conceptz: shared behaviour. Each block runs only when its markup is on the page. */
(function(){
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  /* Arches below the first screen open once as they come into view */
  if(!reduce&&'IntersectionObserver' in window){
    var arches=[].filter.call(document.querySelectorAll('main .arch'),function(a){return !a.closest('.hero-pic,.phero-pic')&&a.getBoundingClientRect().top>innerHeight;});
    var ao=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.remove('await');e.target.classList.add('open');ao.unobserve(e.target);}});},{rootMargin:'0px 0px -12% 0px'});
    arches.forEach(function(a){a.classList.add('await');ao.observe(a);});
  }
  function $(id){return document.getElementById(id);}

  /* Header + mobile menu */
  var top=$('top');
  if(top)addEventListener('scroll',function(){top.classList.toggle('scrolled',scrollY>8)},{passive:true});
  var mb=$('menuBtn'),nav=$('nav'),mq=matchMedia('(max-width:980px)');
  if(mb&&nav){
    var sync=function(){nav.hidden=mq.matches&&mb.getAttribute('aria-expanded')!=='true';};
    mb.onclick=function(){mb.setAttribute('aria-expanded',mb.getAttribute('aria-expanded')!=='true');sync();};
    mq.addEventListener('change',sync);sync();
  }

  /* Services list: the arch follows the open service */
  var list=$('svcList');
  if(list){
    var imgs=document.querySelectorAll('#svcArch img'),cap=$('svcCap');
    list.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click',function(){
        list.querySelectorAll('li').forEach(function(li){li.classList.remove('on');var x=li.querySelector('button');if(x)x.setAttribute('aria-expanded','false');});
        b.closest('li').classList.add('on');b.setAttribute('aria-expanded','true');
        imgs.forEach(function(im){im.classList.toggle('off',im.dataset.k!==b.dataset.k)});
        if(cap)cap.textContent=b.dataset.cap;
      });
    });
  }

  /* Collections and planner. Indicative rates, kept in one place for the client to confirm. */
  var TIERS=[
    {name:'Essential',rate:[2100,2400],desc:'A well-built family home with dependable brands and a clean, simple finish.',
     spec:['RCC frame, M20 concrete, Fe500D steel','Solid concrete blocks','10\'-0"','Tiles up to ₹60/sq.ft','Hardwood frame and shutter','UPVC','Granite counter, steel sink','ISI-brand sanitaryware and fittings','Interior emulsion, weatherproof exterior']},
    {name:'Signature',rate:[2500,2900],desc:'Our most chosen home, with teak joinery, larger tiles and a fuller kitchen.',
     spec:['RCC frame, M25 concrete, Fe550D steel','Wire-cut bricks or AAC blocks','10\'-6"','Tiles up to ₹110/sq.ft','Teak frame and shutter','Teak or premium UPVC','Granite counter, dado to ceiling','Premium-brand fittings, concealed cisterns','Premium emulsion, weatherproof exterior']},
    {name:'Bespoke',rate:[3100,3800],desc:'Designer finishes, system windows and details chosen with you piece by piece.',
     spec:['RCC frame, M25 concrete, Fe550D steel, optimised design','Wire-cut bricks, stone or exposed-brick features','11\'-0" and above','Marble, granite or tiles up to ₹200/sq.ft','Designer teak door with hardware','Aluminium system windows','Quartz counter, designer dado','Luxury-brand fittings, glass partitions','Luxury emulsion, textured feature walls']}
  ];
  var ROWS=['Structure','Walls','Ceiling height','Flooring','Main door','Windows','Kitchen','Bathrooms','Paint'];
  var FLOOR_ADJ={'G':1.04,'G+1':1,'G+2':1.02,'G+3':1.05};
  var STAGES=[['Booking and design',10],['Foundation',15],['Plinth',10],['Walls and columns',15],['Roof slab',15],['Services and plaster',15],['Finishes',15],['Handover',5]];
  var st={t:1,f:'G+1',a:2000};
  function inr(n){return n.toLocaleString('en-IN');}
  function lakh(r){return r>=1e7?(r/1e7).toFixed(2).replace(/0$/,'')+' Cr':(r/1e5).toFixed(r<1e6?1:0)+' L';}
  function rangeTxt(lo,hi){return hi>=1e7?'₹'+lakh(lo)+' – '+lakh(hi):'₹'+Math.round(lo/1e5)+' – '+Math.round(hi/1e5)+' lakh';}
  var sched=$('sched'),specList=$('specList');
  if(sched)sched.innerHTML=STAGES.map(function(s){return '<li><span>'+s[0]+'</span><span class="bar"><i style="width:'+(s[1]/15*100)+'%"></i></span><span class="amt"></span></li>'}).join('');
  function render(){
    var T=TIERS[st.t];
    document.querySelectorAll('#tabs [role=tab]').forEach(function(b){var on=+b.dataset.t===st.t;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;});
    if($('tierPanel'))$('tierPanel').setAttribute('aria-labelledby','tab-'+st.t);
    document.querySelectorAll('#tierPills button').forEach(function(b){b.setAttribute('aria-pressed',+b.dataset.t===st.t)});
    document.querySelectorAll('#floors button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.f===st.f)});
    if(specList){
      $('tName').textContent=T.name;
      $('tRate').innerHTML='₹'+inr(T.rate[0])+' – '+inr(T.rate[1])+' <span>per sq.ft built-up</span>';
      $('tDesc').textContent=T.desc;
      specList.innerHTML=ROWS.map(function(r,i){return '<li><span>'+r+'</span><p>'+T.spec[i]+'</p></li>'}).join('');
    }
    if(sched){
      var adj=FLOOR_ADJ[st.f],lo=T.rate[0]*adj*st.a,hi=T.rate[1]*adj*st.a,mid=(lo+hi)/2;
      $('areaOut').textContent=inr(st.a)+' sq.ft';
      $('range').textContent=rangeTxt(lo,hi);
      $('rangeSub').textContent=T.name+', '+st.f+', '+inr(st.a)+' sq.ft';
      sched.querySelectorAll('.amt').forEach(function(el,i){el.textContent='₹'+lakh(mid*STAGES[i][1]/100)});
    }
  }
  if(specList||sched){
    var tabs=[].slice.call(document.querySelectorAll('#tabs [role=tab]'));
    tabs.forEach(function(b){
      b.addEventListener('click',function(){st.t=+b.dataset.t;render();});
      b.addEventListener('keydown',function(e){
        if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();var n=(tabs.indexOf(b)+(e.key==='ArrowRight'?1:2))%3;st.t=n;render();tabs[n].focus();}
      });
    });
    document.querySelectorAll('#tierPills button').forEach(function(b){b.addEventListener('click',function(){st.t=+b.dataset.t;render();})});
    document.querySelectorAll('#floors button').forEach(function(b){b.addEventListener('click',function(){st.f=b.dataset.f;render();})});
    var area=$('area');
    if(area)area.addEventListener('input',function(){st.a=+area.value;render();});
    render();
  }

  /* Copy helpers */
  function copy(text,btn,node){
    function sel(){var r=document.createRange();r.selectNodeContents(node);var s=getSelection();s.removeAllRanges();s.addRange(r);btn.textContent='Selected, press Ctrl+C';}
    try{navigator.clipboard.writeText(text).then(function(){var t=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=t},1500);},sel);}catch(e){sel();}
  }
  var em=$('email'),ce=$('copyEmail');
  if(em&&ce)ce.onclick=function(){copy(em.textContent,this,em)};

  /* Hero quick enquiry: name and mobile, sent on WhatsApp */
  var q=$('quick');
  if(q){
    q.addEventListener('submit',function(e){
      e.preventDefault();
      var n=q.elements['name'],ph=q.elements['phone'],name=n.value.trim(),phone=ph.value.replace(/[\s-]/g,'');
      var ok=/^(\+?91)?[6-9]\d{9}$/.test(phone)||/^\+\d{8,15}$/.test(phone);
      n.setAttribute('aria-invalid',name?'false':'true');ph.setAttribute('aria-invalid',ok?'false':'true');
      $('q-err').textContent=!name?'Please enter your name.':!ok?'Enter a 10-digit mobile number, or an international number starting with +.':'';
      if(!name){n.focus();return;}if(!ok){ph.focus();return;}
      window.open('https://wa.me/919600029991?text='+encodeURIComponent('Site visit request\nName: '+name+'\nPhone: '+phone),'_blank','noopener');
    });
  }

  /* Enquiry form */
  var f=$('lead');
  if(f){
    var E=f.elements;
    var flag=function(id,input,msg){$(id).textContent=msg;input.setAttribute('aria-invalid',msg?'true':'false');};
    f.addEventListener('submit',function(e){
      e.preventDefault();
      var name=E['name'].value.trim(),phone=E['phone'].value.replace(/[\s-]/g,'');
      var pOk=/^(\+?91)?[6-9]\d{9}$/.test(phone)||/^\+\d{8,15}$/.test(phone);
      flag('e-name',E['name'],name?'':'Please enter your name.');
      flag('e-phone',E['phone'],pOk?'':'Enter a 10-digit mobile number, or an international number starting with +.');
      if(!name||!pOk){(name?E['phone']:E['name']).focus();return;}
      var need=(f.querySelector('input[name=need]:checked')||{}).value||'';
      var txt=['Name: '+name,'Phone: '+phone,'Planning: '+need,'Plot location: '+(E['loc'].value||'–'),'Plot size: '+(E['size'].value||'–'),
        'Budget: '+(E['budget'].value||'–'),'Start: '+(E['when'].value||'–'),'Notes: '+(E['msg'].value.trim()||'–')].join('\n');
      $('summary').textContent=txt;
      $('waSum').href='https://wa.me/919600029991?text='+encodeURIComponent('Site visit request\n'+txt);
      $('mailSum').href='mailto:beyondconceptz@gmail.com?subject='+encodeURIComponent('Site visit request: '+name)+'&body='+encodeURIComponent(txt);
      var r=$('result');r.hidden=false;r.scrollIntoView({block:'nearest'});
    });
    $('copySum').onclick=function(){var s=$('summary');copy(s.textContent,this,s)};
  }

  if($('yr'))$('yr').textContent=new Date().getFullYear();
})();
