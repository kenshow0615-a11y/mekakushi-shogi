#!/usr/bin/env python3
"""手元のパソコンで試すための簡易サーバー。

使い方:  python3 serve.py   →  ブラウザで http://localhost:8000 を開く
（エンジンのスレッドに必要な COOP/COEP ヘッダーを付けて配信します）
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.wasm': 'application/wasm', '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'http://localhost:{PORT} を開いてください（終了は Ctrl+C）')
    http.server.ThreadingHTTPServer(('', PORT), Handler).serve_forever()
