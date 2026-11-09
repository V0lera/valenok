# Временный локальный сервер: отдаёт www/ и сохраняет присланные PNG в www/icons
import http.server, os, sys, urllib.parse
ROOT=os.path.join(os.path.dirname(__file__),'..','www')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a,directory=ROOT,**k)
    def do_POST(s):
        q=urllib.parse.urlparse(s.path); name=urllib.parse.parse_qs(q.query)['name'][0]
        assert name.endswith('.png') and os.path.basename(name)==name
        n=int(s.headers['Content-Length']); data=s.rfile.read(n)
        open(os.path.join(ROOT,'icons',name),'wb').write(data)
        s.send_response(200); s.end_headers(); s.wfile.write(b'ok')
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1])),H).serve_forever()
