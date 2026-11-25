(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const pencilGrades={H:{width:1.1,opacity:.5},HB:{width:1.7,opacity:.68},'1B':{width:2.5,opacity:.8},'2B':{width:3.4,opacity:.9}};
  function widthAt(s,p){return s.width*(s.pressure?(.25+1.5*clamp(p[2]??.5,0,1)):1)*(s.brush==='pencil'?.94+.06*Math.sin(p[0]*.67+p[1]*.37):1);}
  function outline(s){
    const pts=s.points;if(!pts.length)return '';
    if(pts.length===1){const [x,y]=pts[0],r=widthAt(s,pts[0])/2;return `M ${x-r} ${y} a ${r} ${r} 0 1 0 ${2*r} 0 a ${r} ${r} 0 1 0 ${-2*r} 0`;}
    const left=[],right=[];
    pts.forEach((p,i)=>{const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1,r=widthAt(s,p)/2;left.push([p[0]-dy/len*r,p[1]+dx/len*r]);right.push([p[0]+dy/len*r,p[1]-dx/len*r]);});
    const edge=arr=>{let d=`M ${arr[0][0]} ${arr[0][1]}`;for(let i=1;i<arr.length-1;i++){const p=arr[i],next=arr[i+1];d+=` Q ${p[0]} ${p[1]} ${(p[0]+next[0])/2} ${(p[1]+next[1])/2}`;}const p=arr.at(-1);return d+` L ${p[0]} ${p[1]}`;};
    return edge(left)+' '+edge(right.reverse()).replace(/^M/,'L')+' Z';
  }
  function hits(s,p,radius=9){return s.points.some((q,i)=>{const a=s.points[Math.max(0,i-1)],dx=q[0]-a[0],dy=q[1]-a[1],t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<=radius+widthAt(s,q)/2;});}
  function sample(e,rect,w,h){return [(e.clientX-rect.left)/rect.width*w,(e.clientY-rect.top)/rect.height*h,e.pointerType==='pen'?clamp(Number.isFinite(e.pressure)&&e.pressure>0?e.pressure:.05,.05,1):.5];}
  function imagePlacement(crop,rotation){const {x,y,width:w,height:h}=crop;switch(((rotation%360)+360)%360){case 90:return {x:x+w,y,width:h,height:w,rotation:90};case 180:return {x:x+w,y:y+h,width:w,height:h,rotation:180};case 270:return {x,y:y+h,width:h,height:w,rotation:270};default:return {x,y,width:w,height:h,rotation:0};}}
  const api={pencilGrades,widthAt,outline,hits,sample,imagePlacement};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LeafInk=api;
})(globalThis);
