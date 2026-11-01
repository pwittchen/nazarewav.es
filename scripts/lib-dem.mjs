import fs from 'fs'; import zlib from 'zlib';
export function readPng(f){const b=fs.readFileSync(f);let p=8,w,h,ct,idat=[];
 while(p<b.length){const l=b.readUInt32BE(p),t=b.toString('ascii',p+4,p+8);const d=b.subarray(p+8,p+8+l);
  if(t==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);ct=d[9]} if(t==='IDAT')idat.push(d);p+=12+l}
 const r=zlib.inflateSync(Buffer.concat(idat));const bpp=ct===6?4:3,st=w*bpp;const o=Buffer.alloc(h*st);
 for(let y=0;y<h;y++){const f=r[y*(st+1)];for(let x=0;x<st;x++){const v=r[y*(st+1)+1+x];const a=x>=bpp?o[y*st+x-bpp]:0,u=y?o[(y-1)*st+x]:0,c=x>=bpp&&y?o[(y-1)*st+x-bpp]:0;
  let q=0;if(f==1)q=a;else if(f==2)q=u;else if(f==3)q=(a+u)>>1;else if(f==4){const pp=a+u-c,pa=Math.abs(pp-a),pb=Math.abs(pp-u),pc=Math.abs(pp-c);q=pa<=pb&&pa<=pc?a:pb<=pc?u:c}
  o[y*st+x]=(v+q)&255}}
 return {w,h,bpp,d:o}}
export function writePng(f,w,h,rgb){const crcT=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
 const crc=b=>{let c=~0;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return (~c)>>>0};
 const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
 const raw=Buffer.alloc(h*(3*w+1));for(let y=0;y<h;y++){raw[y*(3*w+1)]=0;rgb.copy(raw,y*(3*w+1)+1,y*3*w,(y+1)*3*w)}
 fs.writeFileSync(f,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]))}
export function loadMosaic(dir){const xs=[7776,7780],ys=[6223,6228];const nx=xs[1]-xs[0]+1,ny=ys[1]-ys[0]+1;const W=nx*256,H=ny*256;const e=new Float32Array(W*H);
 for(let tx=0;tx<nx;tx++)for(let ty=0;ty<ny;ty++){const p=readPng(`${dir}/14_${xs[0]+tx}_${ys[0]+ty}.png`);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*p.bpp;e[(ty*256+y)*W+tx*256+x]=p.d[i]*256+p.d[i+1]+p.d[i+2]/256-32768}}
 const n=2**14;const lon=px=>(xs[0]+px/256)/n*360-180;const lat=py=>{const t=Math.PI*(1-2*(ys[0]+py/256)/n);return Math.atan(Math.sinh(t))*180/Math.PI};
 const pxOf=l=>((l+180)/360*n-xs[0])*256;const pyOf=la=>((1-Math.asinh(Math.tan(la*Math.PI/180))/Math.PI)/2*n-ys[0])*256;
 const at=(la,lo)=>{const fx=pxOf(lo),fy=pyOf(la),ix=Math.floor(fx),iy=Math.floor(fy),a=fx-ix,b=fy-iy,g=(x,y)=>e[y*W+x];return (g(ix,iy)*(1-a)+g(ix+1,iy)*a)*(1-b)+(g(ix,iy+1)*(1-a)+g(ix+1,iy+1)*a)*b};
 return {W,H,e,lat,lon,at}}
