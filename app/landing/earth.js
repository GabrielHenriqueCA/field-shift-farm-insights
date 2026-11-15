// Terra com geografia real em uma esfera WebGL, sem bibliotecas externas.
// Textura: three.js r160 examples/textures/planets/earth_atmos_2048.jpg.
// Aviso de SI: implementação criada com assistência de IA para Datanauts Brasil.
(() => {
  'use strict';
  window.createRotareGlobe=(canvas,marker,textureUrl)=>{
    const gl=canvas?.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!gl)return null;
    const vertex=`attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
    const fragment=`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uEarth;
      uniform float uLongitude;
      uniform float uLatitude;
      const float PI=3.141592653589793;
      void main(){
        vec2 p=(vUv-.5)/.455;
        float d=length(p);
        if(d>1.){
          float halo=exp(-(d-1.)*42.)*.17;
          if(d>1.095)discard;
          gl_FragColor=vec4(.28,.57,.78,halo);return;
        }
        vec3 n=vec3(p,sqrt(max(0.,1.-dot(p,p))));
        float ca=cos(uLatitude),sa=sin(uLatitude),cl=cos(uLongitude),sl=sin(uLongitude);
        float wy=n.y*ca+n.z*sa;
        float wz=n.z*ca-n.y*sa;
        vec3 world=vec3(n.x*cl+wz*sl,wy,-n.x*sl+wz*cl);
        vec2 uv=vec2(atan(world.x,world.z)/(2.*PI)+.5,asin(clamp(world.y,-1.,1.))/PI+.5);
        vec3 surface=texture2D(uEarth,uv).rgb;
        vec3 light=normalize(vec3(-.65,.52,1.05));
        float diffuse=max(dot(n,light),0.);
        float day=smoothstep(-.08,.2,dot(n,light));
        vec3 color=surface*(.16+.96*diffuse)*day;
        float water=clamp((surface.b-surface.r)*5.,0.,1.);
        float reflection=pow(max(dot(reflect(-light,n),vec3(0.,0.,1.)),0.),38.);
        color+=vec3(.43,.6,.7)*reflection*water*.22;
        color+=vec3(.12,.36,.58)*pow(1.-n.z,3.5)*.65;
        gl_FragColor=vec4(color,1.-smoothstep(.994,1.,d));
      }`;
    function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);return null;}return s;}
    const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);if(!vs||!fs)return null;
    const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))return null;gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const longitudeUniform=gl.getUniformLocation(program,'uLongitude'),latitudeUniform=gl.getUniformLocation(program,'uLatitude');
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([13,27,42,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    let loaded=false,lastElapsed=0,lost=false,disposed=false,manualView=null,insetX=.11,insetY=.11,sizeX=.78,sizeY=.78;
    const aim={x:0,y:0};
    function resize(){
      const wrap=canvas.parentElement,scene=wrap.parentElement,pixels=Math.min(1400,Math.round(wrap.clientWidth*Math.min(devicePixelRatio||1,1.7)));
      canvas.width=Math.max(1,pixels);canvas.height=Math.max(1,pixels);gl.viewport(0,0,canvas.width,canvas.height);
      insetX=wrap.offsetLeft/scene.clientWidth;insetY=wrap.offsetTop/scene.clientHeight;sizeX=wrap.clientWidth/scene.clientWidth;sizeY=wrap.clientHeight/scene.clientHeight;
    }
    function draw(elapsed){
      lastElapsed=elapsed;if(!loaded||lost||disposed)return;
      const longitude=(manualView?.longitude??(-51+Math.sin(elapsed/40000)*24))*Math.PI/180+aim.x,latitude=(manualView?.latitude??-9)*Math.PI/180+aim.y;
      gl.uniform1f(longitudeUniform,longitude);gl.uniform1f(latitudeUniform,latitude);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);
      if(marker){
        const lon=-55.95*Math.PI/180,lat=-12.6*Math.PI/180;
        const x=Math.cos(lat)*Math.sin(lon-longitude),y=Math.cos(latitude)*Math.sin(lat)-Math.sin(latitude)*Math.cos(lat)*Math.cos(lon-longitude),z=Math.sin(latitude)*Math.sin(lat)+Math.cos(latitude)*Math.cos(lat)*Math.cos(lon-longitude);
        marker.style.left=`${(insetX+sizeX*(.5+.455*x))*100}%`;marker.style.top=`${(insetY+sizeY*(.5-.455*y))*100}%`;marker.style.opacity=z>.12?'1':'0';marker.inert=z<=.12;
      }
      canvas.dataset.frame=String(Math.round(elapsed));canvas.dataset.renderer='textured-earth';document.documentElement.classList.add('globe-ready');
    }
    canvas.parentElement.classList.add('earth-loading');
    const image=new Image();image.onload=()=>{if(disposed)return;gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);loaded=true;draw(lastElapsed);};image.onerror=()=>canvas.parentElement.classList.remove('earth-loading');image.src=textureUrl;
    canvas.addEventListener('webglcontextlost',(event)=>{event.preventDefault();lost=true;document.documentElement.classList.remove('globe-ready');});
    let resizeObserver=null;
    if('ResizeObserver'in window){resizeObserver=new ResizeObserver(()=>{if(!disposed){resize();draw(lastElapsed);}});resizeObserver.observe(canvas.parentElement);}else window.addEventListener('resize',resize);
    const surface=canvas.parentElement.parentElement;
    function move(event){if(event.pointerType!=='mouse')return;const box=canvas.parentElement.getBoundingClientRect();aim.x=((event.clientX-box.left)/box.width-.5)*.08;aim.y=-((event.clientY-box.top)/box.height-.5)*.04;}
    function leave(){aim.x=0;aim.y=0;}
    surface.addEventListener('pointermove',move);surface.addEventListener('pointerleave',leave);resize();
    return {draw,resize,setView:view=>{manualView=view;},get ready(){return loaded&&!lost;},dispose:()=>{if(disposed)return;disposed=true;resizeObserver?.disconnect();window.removeEventListener('resize',resize);surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerleave',leave);gl.deleteBuffer(buffer);gl.deleteTexture(texture);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);}};
  };
})();
