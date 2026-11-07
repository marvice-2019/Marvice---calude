/** Light-show shaders. The fragment shader is the brief's §4 source, copied as is. */

/** One fullscreen triangle: three vertices cover the viewport, no quad seam. */
export const VERTEX_SHADER = `attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}`;

export const FRAGMENT_SHADER = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;uniform vec2 uM;uniform float uT;uniform float uBeat;uniform float uDrop;uniform float uAim;uniform float uN;uniform vec3 uA;uniform vec3 uB;uniform vec3 uC;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float s=0.;float a=.5;for(int i=0;i<4;i++){s+=a*n2(p);p*=2.03;a*=.5;}return s;}
void main(){
 float asp=uRes.x/uRes.y; vec2 uv=gl_FragCoord.xy/uRes; vec2 p=vec2(uv.x*asp,uv.y);
 vec3 col=vec3(0.);
 float haze=fbm(p*vec2(1.6,2.4)+vec2(uT*.04,-uT*.03));
 for(int i=0;i<8;i++){
  float fi=float(i); if(fi>=uN) break;
  float ox=(fi+.5)/uN*asp; vec2 o=vec2(ox,1.08); vec2 d=p-o;
  float ang=atan(d.x,-d.y);
  float sw=sin(uT*(.35+.11*fi)+fi*1.9)*.62+sin(uT*(.9+.05*fi)+fi)*.12;
  float am=atan(uM.x-ox,-(uM.y-1.08));
  float tgt=mix(sw,am+sin(uT*1.6+fi*2.)*.07,uAim);
  float dd=abs(ang-tgt);
  float w=.028+.012*sin(uT*.7+fi)+.02*uBeat;
  float b=smoothstep(w,0.,dd); float core=smoothstep(w*.22,0.,dd);
  float fall=exp(-length(d)*.95)*(.6+haze*1.1);
  float m=mod(fi,3.); vec3 c=m<.5?uA:(m<1.5?uB:uC);
  col+=c*b*fall*(.85+uBeat*1.3)+vec3(1.)*core*fall*.55;
 }
 float fl=smoothstep(.34,0.,uv.y);
 col+=mix(uA,uB,uv.x)*fl*(.16+.2*uBeat)*(.6+haze);
 vec2 gq=vec2(uv.x*asp*34.,uv.y*22.); vec2 g=floor(gq); float hh=h21(g); float pt=smoothstep(.2,0.,length(fract(gq)-vec2(.5)));
 float tw=step(.972,hh)*pt*(.5+.5*sin(uT*2.5+hh*60.))*smoothstep(.55,0.,uv.y);
 col+=vec3(.9,.95,1.)*tw*.5;
 vec2 cc=vec2(asp*.5,.5); float ring=abs(length(p-cc)-(1.-uDrop)*1.7);
 col+=(uA+uB)*.5*smoothstep(.07,0.,ring)*uDrop*1.3+vec3(1.)*uDrop*uDrop*.55;
 col*=1.-.55*length(uv-.5);
 col=1.-exp(-col*1.25);
 gl_FragColor=vec4(col,1.);
}`;

/** "#2BB8DC" → [r, g, b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
