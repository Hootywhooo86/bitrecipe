// Hands-free cook mode: say "next", "back", "repeat", "start timer",
// "stop", "ingredients". Steps can be read aloud. Uses Android's speech
// recognizer and text-to-speech in the app; the browser's in the preview.

const COMMANDS = [
  ['next', /\b(next|done|continue|forward|go on|okay next)\b/],
  ['back', /\b(back|previous|go back|last step)\b/],
  ['repeat', /\b(repeat|again|say that again|read( it)?|what was that)\b/],
  ['timer', /\b(start( the)? timer|set( a)? timer|timer)\b/],
  ['stop', /\b(stop|quiet|dismiss|silence|shut up)\b/],
  ['ingredients', /\b(ingredients?|what do i need)\b/],
  ['finish', /\b(finish|finished|all done)\b/],
];

export function commandOf(text) {
  const t = text.toLowerCase();
  for (const [cmd, re] of COMMANDS) if (re.test(t)) return cmd;
  return null;
}

export function createVoice(BitNative, { onCommand, onState }) {
  let on = false, speaking = false, lastAt = 0, lastCmd = '', web = null, listener = null, spoke = null;
  const handle = (text) => {
    if (!on) return;
    // While reading a step aloud, only a short command counts (and interrupts);
    // long phrases are probably the phone hearing its own voice.
    const words = text.split('|')[0].trim().split(/\s+/).length;
    if (speaking && words > 3) return;
    const cmd = commandOf(text);
    if (!cmd) return;
    if (speaking) hush();
    const now = Date.now();
    if (cmd === lastCmd && now - lastAt < 1800) return; // partial + final of one phrase
    lastCmd = cmd; lastAt = now;
    onCommand(cmd);
  };

  async function start() {
    if (on) return;
    if (BitNative) {
      listener ||= await BitNative.addListener('voice', (e) => handle(e.text || ''));
      spoke ||= await BitNative.addListener('speaking', (e) => { speaking = !!e.on; if (!e.on) lastAt = Date.now(); });
      await BitNative.startVoice();
    } else {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) throw new Error('Voice control works in the Android app.');
      web = new SR();
      web.continuous = true; web.interimResults = true;
      web.onresult = (e) => handle([...e.results].slice(e.resultIndex).map((r) => r[0].transcript).join(' '));
      web.onend = () => { if (on) try { web.start(); } catch { /* already running */ } };
      web.start();
    }
    on = true;
    onState?.(true);
  }

  async function stop() {
    on = false;
    onState?.(false);
    if (BitNative) await BitNative.stopVoice().catch(() => {});
    else if (web) { web.onend = null; web.stop(); web = null; }
  }

  function say(text) {
    if (!text) return;
    if (BitNative) { speaking = true; BitNative.speak({ text }).catch(() => {}); setTimeout(() => { speaking = false; }, Math.min(15000, 600 + text.length * 70)); return; }
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    speaking = true;
    u.onend = u.onerror = () => { speaking = false; lastAt = Date.now(); };
    speechSynthesis.speak(u);
  }

  function hush() {
    if (BitNative) BitNative.stopSpeaking().catch(() => {});
    else window.speechSynthesis?.cancel();
    speaking = false;
  }

  return { start, stop, say, hush, get on() { return on; } };
}
