const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=__dirname;
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.wav':'audio/wav','.woff':'font/woff','.fbx':'application/octet-stream'};
http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(ROOT,u);fs.stat(f,(e,st)=>{if(e||!st.isFile()){s.writeHead(404);s.end('nf');return}s.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(s)})}).listen(8123);
