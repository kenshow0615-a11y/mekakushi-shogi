// やねうら王をこのワーカー内で動かす（画面のスレッドを止めないため）
let mod = null;
const queue = [];
function pump() {
  while (queue.length) {
    const busy = mod.ccall('usi_command', 'number', ['string'], [queue[0]]);
    if (busy) { setTimeout(pump, 5); return; }
    queue.shift();
  }
}
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    try {
      importScripts(d.base + 'yaneuraou.js');
      mod = await self.YaneuraOu({ locateFile: (f) => d.base + f, mainScriptUrlOrBlob: d.base + 'yaneuraou.js' });
      try { mod.FS.mkdir('/eval'); } catch (err) { /* 既にある */ }
      mod.FS.writeFile('/eval/nn.bin', new Uint8Array(d.nn));
      mod.FS.writeFile('/eval/progress.bin', new Uint8Array(d.prog));
      mod.addMessageListener((line) => self.postMessage({ type: 'line', line }));
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  } else if (d.type === 'cmd') {
    queue.push(d.cmd);
    if (queue.length === 1) pump();
  }
};
