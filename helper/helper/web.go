package main

// web.go — 0.8.1 served config/status page.
//
// The helper serves a small web page on the same port as the Bridge WebSocket: a plain
// browser GET gets the page, a WebSocket upgrade gets the protocol. The page lets a
// non-technical user pick the source and COM port from menus (no flags, no terminal),
// shows a plain-language live status, and tells them exactly what to type into RDS Bridge.
//
// Pure standard library plus serial.GetPortsList (already a dependency, cgo-free on all
// platforms). No web framework, no assets — one self-contained HTML string.

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"go.bug.st/serial"
)

// localIPv4 returns this machine's primary LAN IPv4 — the source address the OS would use to
// reach the internet, which is also the address SDR++'s Rigctl Server typically binds to. No
// packets are sent (the UDP "dial" only makes the OS choose a route/source), so it works
// offline and needs no DNS. Returns "" if it can't be determined.
func localIPv4() string {
	c, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer c.Close()
	if ua, ok := c.LocalAddr().(*net.UDPAddr); ok && ua.IP.To4() != nil {
		return ua.IP.To4().String()
	}
	return ""
}

// isWebSocketUpgrade reports whether a request is a WebSocket handshake (vs a browser GET).
func isWebSocketUpgrade(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("Upgrade")), "websocket")
}

type statusView struct {
	Build           string `json:"build"`
	LocalIP         string `json:"localIP"`
	SourceType      string `json:"sourceType"`
	SourceLabel     string `json:"sourceLabel"`
	HaveFreq        bool   `json:"haveFreq"`
	FreqHz          int64  `json:"freqHz"`
	BridgeConnected bool   `json:"bridgeConnected"`
	BridgeCount     int    `json:"bridgeCount"`
	LastError       string `json:"lastError"`
	Config          Config `json:"config"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (h *hub) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.statusSnapshot())
}

func handlePorts(w http.ResponseWriter, r *http.Request) {
	ports, err := serial.GetPortsList()
	if err != nil || ports == nil {
		ports = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ports": ports})
}

type configPost struct {
	Source     string `json:"source"`
	SerialPort string `json:"serialPort"`
	Baud       int    `json:"baud"`
	Rigctld    string `json:"rigctld"`
}

func (h *hub) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "POST only"})
		return
	}
	var p configPost
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "bad request"})
		return
	}

	h.srcMu.Lock()
	cfg := h.cfg
	h.srcMu.Unlock()

	cfg.Source = p.Source
	cfg.SerialPort = p.SerialPort
	if p.Baud > 0 {
		cfg.Baud = p.Baud
	}
	if p.Rigctld != "" {
		cfg.Rigctld = p.Rigctld
	}

	src, err := cfg.buildSource()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	h.setSource(src, cfg)
	if err := saveConfig(cfg); err != nil {
		// non-fatal: the live change took effect, we just couldn't persist it
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "warning": "applied, but couldn't save settings file: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleQuit stops the helper cleanly at the user's request (the "Stop helper" button), then
// exits — which also closes the background command-prompt window the helper runs in.
func handleQuit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "POST only"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Helper stopped. You can close this tab."})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(250 * time.Millisecond) // let the reply reach the browser first
		os.Exit(0)
	}()
}

func serveConfigPage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(configHTML))
}

// browseURL turns a listen address into a URL a browser can open.
func browseURL(listen string) string {
	host, port := splitListen(listen)
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/"
}

// hostForBridge is the host:port a user types into RDS Bridge (loopback shown as localhost).
func hostForBridge(listen string) string {
	host, port := splitListen(listen)
	if host == "" || host == "0.0.0.0" || host == "::" || host == "127.0.0.1" {
		host = "localhost"
	}
	return net.JoinHostPort(host, port)
}

func splitListen(listen string) (host, port string) {
	if listen == "" {
		return "127.0.0.1", "8765"
	}
	h, p, err := net.SplitHostPort(listen)
	if err != nil {
		return "127.0.0.1", "8765"
	}
	if p == "" {
		p = "8765"
	}
	return h, p
}

// openBrowser opens url in the user's default browser (best-effort; ignored on failure).
func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "windows":
		cmd, args = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		cmd, args = "open", []string{url}
	default:
		cmd, args = "xdg-open", []string{url}
	}
	_ = exec.Command(cmd, args...).Start()
}

const configHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RDS Bridge Helper</title>
<style>
  :root{--bg:#0f1417;--card:#161d22;--line:#26313a;--ink:#e7edf2;--dim:#9fb0bd;--faint:#6b7c89;
        --amber:#f0a848;--green:#39d98a;--red:#ff6b6b;--accent:#39d98a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:640px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:22px;margin:0 0 2px} .sub{color:var(--faint);margin:0 0 22px;font-size:13px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
  .status{display:flex;align-items:center;gap:12px}
  .dot{width:14px;height:14px;border-radius:50%;flex:0 0 auto;background:var(--faint)}
  .dot.ok{background:var(--green);box-shadow:0 0 0 4px rgba(57,217,138,.15)}
  .dot.wait{background:var(--amber);box-shadow:0 0 0 4px rgba(240,168,72,.15)}
  .dot.err{background:var(--red);box-shadow:0 0 0 4px rgba(255,107,107,.15)}
  .stitle{font-size:17px;font-weight:600} .sline{color:var(--dim);font-size:13px;margin-top:2px}
  label{display:block;font-size:13px;color:var(--dim);margin:14px 0 5px}
  select,input[type=text]{width:100%;padding:9px 11px;background:#0d1216;border:1px solid var(--line);
        border-radius:8px;color:var(--ink);font:inherit}
  select:focus,input:focus{outline:none;border-color:var(--accent)}
  .row{display:flex;gap:10px} .row>*{flex:1}
  .btn{appearance:none;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}
  .btn.primary{background:var(--accent);color:#08130c} .btn.primary:hover{filter:brightness(1.08)}
  .btn.ghost{background:transparent;color:var(--dim);border:1px solid var(--line)} .btn.ghost:hover{color:var(--ink)}
  .btn.stop{background:transparent;color:var(--red);border:1px solid rgba(255,107,107,.4)} .btn.stop:hover{background:rgba(255,107,107,.10)}
  .note code{color:var(--dim);background:#0d1216;padding:1px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .btnrow{display:flex;gap:10px;align-items:center;margin-top:18px}
  .msg{font-size:13px;margin-left:2px} .msg.ok{color:var(--green)} .msg.err{color:var(--red)}
  .hide{display:none}
  .bridge{background:#0d1216;border:1px dashed var(--line);border-radius:8px;padding:12px 14px;display:flex;
        align-items:center;gap:10px;justify-content:space-between}
  .bridge code{color:var(--green);font:600 15px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
  .k{color:var(--faint);font-size:12px}
  details{margin-top:10px} summary{cursor:pointer;color:var(--dim);font-size:13px}
  details ol{margin:10px 0 0;padding-left:20px;color:var(--dim);font-size:13px} details li{margin:4px 0}
  .note{color:var(--faint);font-size:12px;margin-top:6px}
</style>
</head>
<body>
<div class="wrap">
  <h1>RDS Bridge Helper</h1>
  <p class="sub">Feeds your tuned frequency to RDS Bridge. Set it up once below.</p>

  <div class="card">
    <div class="status">
      <div class="dot" id="dot"></div>
      <div>
        <div class="stitle" id="stitle">Starting…</div>
        <div class="sline" id="sline"></div>
      </div>
    </div>
    <div style="margin-top:14px" class="bridge">
      <div><span class="k">In RDS Bridge, connect to</span><br><code id="wsurl">ws://localhost:8765</code></div>
      <button class="btn ghost" id="copyBtn" type="button">Copy</button>
    </div>
  </div>

  <div class="card">
    <label for="source">How does the helper read your tuned frequency?</label>
    <select id="source">
      <option value="serial">SDR Console / CAT radio — serial (COM) port</option>
      <option value="rigctld">SDR++ or Hamlib — network (rigctld)</option>
      <option value="mock">Demo — no radio (for testing)</option>
    </select>

    <div id="serialFields">
      <label for="port">Which COM port? <span class="k">(the com0com port SDR Console is not using)</span></label>
      <div class="row">
        <select id="port"><option value="">— no ports found —</option></select>
        <button class="btn ghost" id="refreshPorts" type="button" style="flex:0 0 auto">Refresh</button>
      </div>
      <label for="baud">Speed <span class="k">(match SDR Console's CAT setting)</span></label>
      <select id="baud">
        <option>4800</option><option>9600</option><option>19200</option>
        <option>38400</option><option selected>57600</option><option>115200</option>
      </select>
      <details>
        <summary>How to set this up in SDR Console</summary>
        <ol>
          <li>Install a com0com virtual COM pair (e.g. COM11 ↔ COM12), "use Ports class" ticked.</li>
          <li>In SDR Console, turn on CAT / Kenwood TS-2000 on one end (say COM11) and note the speed.</li>
          <li>Here, choose the <em>other</em> end (COM12) and the same speed, then Apply.</li>
        </ol>
      </details>
    </div>

    <div id="rigctldFields" class="hide">
      <label for="rigctld">Network address <span class="k">(host:port)</span></label>
      <input type="text" id="rigctld" placeholder="localhost:4532">
      <div class="note">SDR++'s Rigctl Server usually needs this computer's own IP address, not <code>localhost</code>. <span id="ipHint"></span></div>
    </div>

    <div id="mockFields" class="hide">
      <div class="note">Plays a scripted frequency so you can check Bridge without a radio.</div>
    </div>

    <div class="btnrow">
      <button class="btn primary" id="apply" type="button">Apply</button>
      <span class="msg" id="msg"></span>
    </div>
  </div>

  <div class="card">
    <div class="note" style="margin-bottom:12px">
      The helper runs quietly in the background, in a small command-prompt window. You can leave it
      open while you use RDS Bridge — or stop it here, which also closes that window.
    </div>
    <div class="btnrow" style="margin-top:0">
      <button class="btn stop" id="quit" type="button">Stop helper</button>
      <span class="msg" id="quitmsg"></span>
    </div>
    <details style="margin-top:16px">
      <summary>Technical details (for the curious)</summary>
      <div class="note" style="margin-top:10px;line-height:1.7">
        This helper reads your radio's tuned frequency — from a CAT serial port (Kenwood TS-2000
        protocol, e.g. SDR Console) or a rigctld network server (e.g. SDR++) — and sends only the
        frequency to RDS Bridge over a local WebSocket, using the <code>rds-bridge-iq/1</code>
        protocol in meta mode. It is one-way: it never tunes or controls your radio.<br><br>
        The command-prompt window is only where it prints its status log. Closing that window stops
        the helper too, exactly like the Stop button above.<br><br>
        Listening on <code id="techUrl">—</code> · settings saved beside the program in
        <code>rds-bridge-helper.json</code> · version <code id="techVer">—</code>
      </div>
    </details>
  </div>
</div>

<script>
(function(){
  var $=function(id){return document.getElementById(id)};
  var fmtMHz=function(hz){return (hz/1e6).toFixed(3)+" MHz"};

  function showFields(src){
    $("serialFields").classList.toggle("hide", src!=="serial");
    $("rigctldFields").classList.toggle("hide", src!=="rigctld");
    $("mockFields").classList.toggle("hide", src!=="mock");
  }
  $("source").addEventListener("change", function(){ showFields(this.value) });

  function loadPorts(selected){
    fetch("/ports").then(function(r){return r.json()}).then(function(d){
      var sel=$("port"), cur=selected||sel.value, list=d.ports||[];
      sel.innerHTML="";
      if(!list.length){ var o=document.createElement("option"); o.value=""; o.textContent="— no COM ports found —"; sel.appendChild(o); return; }
      list.forEach(function(p){ var o=document.createElement("option"); o.value=p; o.textContent=p; if(p===cur)o.selected=true; sel.appendChild(o); });
    }).catch(function(){});
  }
  $("refreshPorts").addEventListener("click", function(){ loadPorts() });

  var formInit=false;
  function applyStatusToForm(s){
    var cfg=s.config||{};
    if(s.localIP){ $("ipHint").textContent="This computer's address is "+s.localIP+"."; }  // kept fresh every tick
    if(formInit) return; formInit=true;   // seed the form once, so we don't fight the user's edits
    $("source").value=cfg.source||"serial"; showFields($("source").value);
    if(cfg.baud){ $("baud").value=String(cfg.baud); }
    if(cfg.rigctld){ $("rigctld").value=cfg.rigctld; }
    else if(s.localIP){ $("rigctld").value=s.localIP+":4532"; }   // pre-fill this machine's LAN IP (what SDR++ needs)
    loadPorts(cfg.serial_port||"");
  }

  function paint(s){
    var dot=$("dot"), t=$("stitle"), l=$("sline");
    dot.className="dot";
    if(s.haveFreq && !s.lastError){
      dot.classList.add("ok");
      t.textContent="Connected — tuned "+fmtMHz(s.freqHz);
      l.textContent=(s.bridgeConnected?"RDS Bridge is connected.":"Waiting for RDS Bridge to connect.")+"  Source: "+(s.sourceLabel||s.sourceType);
    } else if(s.lastError){
      dot.classList.add("err");
      t.textContent="Can't read the frequency yet";
      l.textContent=friendlyErr(s.lastError,s.sourceType);
    } else {
      dot.classList.add("wait");
      t.textContent="Waiting for your SDR…";
      l.textContent="No frequency yet. Check the settings below, then Apply.";
    }
  }
  function friendlyErr(e,src){
    if(src==="serial"){
      if(/no such file|not.*found|cannot find/i.test(e)) return "That COM port isn't there. Pick another port and Apply.";
      if(/no FA reply/i.test(e)) return "Port opens, but no reply. Turn on CAT (TS-2000) in your SDR software and check the speed.";
      if(/access|denied|busy/i.test(e)) return "The port is in use. Close whatever else has it open, then Apply.";
    }
    if(src==="rigctld") return "No rigctld at that address. Start the Rigctl Server in your SDR software and check the address.";
    return e;
  }

  function tick(){
    fetch("/status").then(function(r){return r.json()}).then(function(s){
      applyStatusToForm(s);
      paint(s);
      $("techUrl").textContent="ws://"+location.host;
      $("techVer").textContent=s.build||"—";
    }).catch(function(){
      $("dot").className="dot err"; $("stitle").textContent="Helper not responding"; $("sline").textContent="";
    });
  }

  $("apply").addEventListener("click", function(){
    var body={source:$("source").value, serialPort:$("port").value, baud:parseInt($("baud").value,10), rigctld:$("rigctld").value.trim()};
    var msg=$("msg"); msg.className="msg"; msg.textContent="Applying…";
    fetch("/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d.ok){ msg.className="msg ok"; msg.textContent=d.warning||"Applied."; }
        else { msg.className="msg err"; msg.textContent=d.error||"Couldn't apply."; }
        setTimeout(function(){ if(msg.textContent==="Applied."){ msg.textContent=""; } }, 2500);
      })
      .catch(function(){ msg.className="msg err"; msg.textContent="Couldn't reach the helper."; });
  });

  $("copyBtn").addEventListener("click", function(){
    var t=$("wsurl").textContent;
    if(navigator.clipboard){ navigator.clipboard.writeText(t); this.textContent="Copied"; var b=this; setTimeout(function(){b.textContent="Copy"},1500); }
  });

  // set the Bridge URL from the page's own location, so it always matches how you reached it
  try{ $("wsurl").textContent="ws://"+location.host; }catch(e){}

  var timer=setInterval(tick, 1500);
  function stopped(){
    clearInterval(timer);
    $("dot").className="dot";
    $("stitle").textContent="Helper stopped";
    $("sline").textContent="You can close this tab.";
    $("quitmsg").className="msg ok"; $("quitmsg").textContent="Stopped.";
    $("apply").disabled=true; $("quit").disabled=true;
  }
  $("quit").addEventListener("click", function(){
    if(!confirm("Stop the helper?\n\nRDS Bridge will stop getting the frequency until you run the helper again.")) return;
    $("quitmsg").className="msg"; $("quitmsg").textContent="Stopping\u2026";
    fetch("/quit",{method:"POST"}).then(function(r){return r.json()}).then(function(){ stopped(); })
      .catch(function(){ stopped(); }); // the process may exit before the reply arrives — treat as stopped
  });

  tick();
})();
</script>
</body>
</html>
`
