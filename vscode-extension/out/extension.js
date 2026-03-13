"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function activate(context) {
    console.log("EXTENSION ACTIVATED!");
    const provider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("mmrDev.sidebar", provider, { webviewOptions: { retainContextWhenHidden: true } }));
    context.subscriptions.push(vscode.commands.registerCommand('mmrDev.useSelection', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor found.');
            return;
        }
        const selectedText = editor.document.getText(editor.selection);
        if (!selectedText.trim()) {
            vscode.window.showInformationMessage('No code selected. Highlight code first.');
            return;
        }
        provider.sendSelectedCode(selectedText);
    }));
}
class SidebarProvider {
    extensionUri;
    _view;
    _state = 'idle';
    _lastAnalysis = '';
    _lastInput = '';
    _mode = 'feature';
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    getWorkspaceRoot() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0)
            return '';
        const mmr = folders.find(f => f.name.toLowerCase().includes('mmr') ||
            f.uri.fsPath.toLowerCase().includes('mmr'));
        return (mmr ?? folders[0]).uri.fsPath;
    }
    sendSelectedCode(code) {
        this._view?.webview.postMessage({ command: 'inject_code', code });
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible)
                this.tryInjectCurrentSelection();
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.command === 'ask')
                await this.handleMessage(data.text, data.mode);
            if (data.command === 'set_mode') {
                this._mode = data.mode;
                this._state = 'idle';
                this._lastAnalysis = '';
                this._lastInput = '';
            }
            if (data.command === 'get_selection')
                this.tryInjectCurrentSelection();
        });
    }
    tryInjectCurrentSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const selectedText = editor.document.getText(editor.selection);
        if (selectedText.trim())
            this._view?.webview.postMessage({ command: 'inject_code', code: selectedText });
    }
    async handleMessage(text, mode) {
        if (mode)
            this._mode = mode;
        const workspaceRoot = this.getWorkspaceRoot();
        if (this._state === 'idle') {
            this._lastInput = text;
            const loadingId = this.sendLoading();
            try {
                const response = await axios_1.default.post('http://127.0.0.1:8000/ask', {
                    prompt: text, mode: this._mode, workspace_root: workspaceRoot
                });
                this._lastAnalysis = response.data.response;
                this.resolveLoading(loadingId, this._lastAnalysis);
                if (this._mode === 'feature' || this._mode === 'refactor') {
                    this._state = 'awaiting_code_confirm';
                    setTimeout(() => this.sendAssistantMessage('💬 Would you like me to apply these changes to the relevant files in your workspace?\n\nType **yes** to proceed or **no** to skip.', 'confirm'), 400);
                }
            }
            catch {
                this.resolveLoading(loadingId, '⚠️ Backend not running. Please start the FastAPI server.');
                this._state = 'idle';
            }
        }
        else if (this._state === 'awaiting_code_confirm') {
            const answer = text.trim().toLowerCase();
            this._state = 'awaiting_test_confirm';
            if (answer === 'yes' || answer === 'y') {
                const loadingId = this.sendLoading();
                try {
                    const response = await axios_1.default.post('http://127.0.0.1:8000/apply_changes', {
                        story: this._lastInput, analysis: this._lastAnalysis, workspace_root: workspaceRoot
                    });
                    const changes = response.data.changes || [];
                    await this.applyFileChanges(changes);
                    this.resolveLoading(loadingId, `✅ Changes applied to:\n${changes.map(c => `- \`${c.file}\``).join('\n') || 'No files returned.'}`);
                }
                catch {
                    this.resolveLoading(loadingId, '⚠️ Could not apply changes. Backend error.');
                }
            }
            setTimeout(() => this.sendAssistantMessage('🧪 Would you like me to generate and add **RSpec test cases** for the affected code?\n\nType **yes** to proceed or **no** to finish.', 'confirm'), 400);
        }
        else if (this._state === 'awaiting_test_confirm') {
            const answer = text.trim().toLowerCase();
            if (answer === 'yes' || answer === 'y') {
                const loadingId = this.sendLoading();
                try {
                    const response = await axios_1.default.post('http://127.0.0.1:8000/generate_tests', {
                        story: this._lastInput, analysis: this._lastAnalysis, workspace_root: workspaceRoot
                    });
                    const tests = response.data.tests || [];
                    await this.applyFileChanges(tests);
                    this.resolveLoading(loadingId, `✅ Tests added to:\n${tests.map(t => `- \`${t.file}\``).join('\n') || 'No test files returned.'}`);
                }
                catch {
                    this.resolveLoading(loadingId, '⚠️ Could not generate tests. Backend error.');
                }
            }
            else {
                this.sendAssistantMessage('👍 All done! Select a mode below to start a new task.', 'assistant');
            }
            this._state = 'idle';
            this._lastInput = '';
            this._lastAnalysis = '';
        }
        else {
            const loadingId = this.sendLoading();
            try {
                const response = await axios_1.default.post('http://127.0.0.1:8000/ask', {
                    prompt: text, mode: this._mode, workspace_root: workspaceRoot
                });
                this.resolveLoading(loadingId, response.data.response);
            }
            catch {
                this.resolveLoading(loadingId, '⚠️ Backend not running.');
            }
        }
    }
    async applyFileChanges(changes) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || changes.length === 0)
            return;
        const root = workspaceFolders[0].uri.fsPath;
        for (const change of changes) {
            const fullPath = path.join(root, change.file);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, change.content, 'utf8');
        }
    }
    sendLoading() {
        const id = Date.now().toString();
        this._view?.webview.postMessage({ command: 'loading', id });
        return id;
    }
    resolveLoading(id, text) { this._view?.webview.postMessage({ command: 'resolve', id, text }); }
    sendAssistantMessage(text, type) { this._view?.webview.postMessage({ command: 'assistant_message', text, type }); }
    getHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { display:flex; flex-direction:column; height:100vh; font-family:var(--vscode-font-family); font-size:var(--vscode-font-size); background:var(--vscode-sideBar-background); color:var(--vscode-foreground); }
#chat-window { flex:1; overflow-y:auto; padding:12px 10px; display:flex; flex-direction:column; gap:10px; }
.empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:24px; animation:fadeIn 0.4s ease forwards; }
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
.empty-state .logo { width:36px; height:36px; opacity:0.45; }
.empty-state h4 { font-size:13px; font-weight:600; opacity:0.65; }
.empty-state p { font-size:12px; opacity:0.4; line-height:1.6; }
.message { display:flex; flex-direction:column; gap:3px; animation:slideIn 0.18s ease; }
@keyframes slideIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
.message .label { font-size:12px; font-weight:700; opacity:0.45; text-transform:uppercase; letter-spacing:0.6px; padding:0 2px; }
.message .bubble { padding:8px 10px; border-radius:6px; line-height:1.6; word-wrap:break-word; }
.message.user .label { color:var(--vscode-textLink-foreground); }
.message.user .bubble { background:var(--vscode-input-background); border:1px solid var(--vscode-input-border,transparent); white-space:pre-wrap; }
.message.assistant .label,.message.confirm .label { color:#4ec9b0; }
.message.assistant .bubble { background:var(--vscode-editor-inactiveSelectionBackground); }
.message.confirm .bubble { background:var(--vscode-editor-inactiveSelectionBackground); border-left:3px solid #dcdcaa; }
.message.assistant.loading .bubble { opacity:0.5; font-style:italic; }
.bubble h1,.bubble h2,.bubble h3 { margin:8px 0 4px; font-weight:700; }
.bubble p { margin:4px 0; }
.bubble ul,.bubble ol { padding-left:18px; margin:4px 0; }
.bubble li { margin:2px 0; }
.bubble strong { font-weight:700; }
.bubble em { font-style:italic; }
.bubble code { font-family:var(--vscode-editor-font-family,monospace); background:var(--vscode-textCodeBlock-background,#1e1e1e); padding:1px 4px; border-radius:3px; font-size:0.88em; }
.bubble pre { background:var(--vscode-textCodeBlock-background,#1e1e1e); padding:10px; border-radius:5px; overflow-x:auto; margin:6px 0; }
.bubble pre code { background:none; padding:0; }
#code-banner { display:none; align-items:center; gap:6px; margin:0 8px 4px; padding:5px 10px; background:var(--vscode-input-background); border:1px solid var(--vscode-focusBorder,#007acc); border-radius:5px; font-size:10px; }
#code-banner span { flex:1; opacity:0.7; }
#code-banner button { background:none; border:none; cursor:pointer; color:var(--vscode-foreground); opacity:0.5; font-size:13px; }
#code-banner button:hover { opacity:1; }
#input-area { display:flex; flex-direction:column; border-top:1px solid var(--vscode-panel-border,#333); background:var(--vscode-sideBar-background); }
#mode-bar { display:flex; padding:6px 8px 0; gap:2px; overflow-x:auto; scrollbar-width:none; }
#mode-bar::-webkit-scrollbar { display:none; }
.mode-btn { display:flex; align-items:center; gap:4px; padding:5px 10px; border:1px solid transparent; border-bottom:none; border-radius:5px 5px 0 0; background:transparent; color:var(--vscode-foreground); cursor:pointer; font-size:11px; font-family:var(--vscode-font-family); opacity:0.45; transition:opacity 0.15s,background 0.15s; white-space:nowrap; flex-shrink:0; user-select:none; }
.mode-btn:hover { opacity:0.75; }
.mode-btn.active { opacity:1; background:var(--vscode-input-background); border-color:var(--vscode-input-border,#444); border-bottom-color:var(--vscode-input-background); color:var(--vscode-focusBorder,#4fc3f7); }
#mode-hint { font-size:12px; opacity:0.38; padding:4px 10px 0; font-style:italic; min-height:16px; }
#textarea-row { display:flex; align-items:flex-end; gap:6px; padding:6px 8px; }
#input { flex:1; resize:none; min-height:36px; max-height:140px; padding:8px 10px; font-family:var(--vscode-font-family); font-size:var(--vscode-font-size); background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent); border-radius:6px; outline:none; overflow-y:auto; line-height:1.4; transition:border-color 0.15s; }
#input:focus { border-color:var(--vscode-focusBorder); }
#send-btn { width:32px; height:32px; border:none; border-radius:6px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
#send-btn:hover { background:var(--vscode-button-hoverBackground); }
#send-btn:disabled { opacity:0.35; cursor:not-allowed; }
#action-chips { display:flex; flex-wrap:wrap; gap:5px; padding:0 8px 8px; }
.action-chip { font-size:12px; padding:3px 9px; border-radius:20px; border:1px solid var(--vscode-input-border,#444); background:transparent; color:var(--vscode-foreground); cursor:pointer; opacity:0.55; font-family:var(--vscode-font-family); transition:opacity 0.15s,border-color 0.15s,background 0.15s; }
.action-chip:hover { opacity:1; border-color:var(--vscode-focusBorder); background:var(--vscode-input-background); }
#use-selection-btn { display:flex; align-items:center; gap:4px; margin:0 8px 6px auto; padding:3px 9px; border-radius:4px; border:1px solid var(--vscode-input-border,#444); background:transparent; color:var(--vscode-foreground); cursor:pointer; font-size:12px; opacity:0.5; font-family:var(--vscode-font-family); transition:opacity 0.15s,border-color 0.15s; }
#use-selection-btn:hover { opacity:0.9; border-color:var(--vscode-focusBorder); }
</style></head>
<body>
<div id="chat-window">
  <div class="empty-state" id="empty-state">
    <svg class="logo" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.3" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 001.357 2.059l.296.105A2.25 2.25 0 0118 13.104V8.75m-8.25-5.646A24.003 24.003 0 0112 3c.876 0 1.732.056 2.571.164M3 20.25l3.75-3.75M21 20.25l-3.75-3.75M7.5 20.25h9"/>
    </svg>
    <h4>MMR Dev Assistant</h4>
    <p>Indexed against your mmr-api workspace.<br/>Pick a mode and describe your task.</p>
  </div>
</div>
<div id="input-area">
  <div id="mode-bar">
    <button class="mode-btn" data-mode="feature">📋 Feature</button>
    <button class="mode-btn" data-mode="refactor">🔧 Refactor</button>
    <button class="mode-btn" data-mode="explain">🔍 Explain</button>
    <button class="mode-btn" data-mode="story">💬 Chat</button>
  </div>
  <div id="mode-hint"></div>
  <div id="code-banner">
    <span>📎 <span id="banner-text">Code from editor attached</span></span>
    <button id="clear-code-btn" title="Remove">✕</button>
  </div>
  <button id="use-selection-btn">⌄ Use selected code</button>
  <div id="textarea-row">
    <textarea id="input" rows="1"></textarea>
    <button id="send-btn" title="Send (Enter)">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>
  <div id="action-chips"></div>
</div>
<script>
const vscode=acquireVsCodeApi(),chatWindow=document.getElementById('chat-window'),inputEl=document.getElementById('input'),sendBtn=document.getElementById('send-btn'),emptyState=document.getElementById('empty-state'),modeHint=document.getElementById('mode-hint'),actionChips=document.getElementById('action-chips'),codeBanner=document.getElementById('code-banner'),bannerText=document.getElementById('banner-text'),clearCodeBtn=document.getElementById('clear-code-btn'),useSelBtn=document.getElementById('use-selection-btn'),loadingMap={};
let currentMode='feature',attachedCode='';
const modeConfig={
  feature:{hint:'Paste a feature story or describe a new requirement',placeholder:'As a user, I want to… so that…',chips:['Analyze impact on existing files','Estimate story points','List clarification questions','Suggest implementation approach']},
  refactor:{hint:'Paste code to refactor — or use selected code from the editor',placeholder:'Paste your Ruby / Rails code here…',chips:['Extract to service object','Improve readability','Optimize N+1 queries','Apply SOLID principles']},
  explain:{hint:'Paste any code snippet — or use selected code from the editor',placeholder:'Paste the code you want explained…',chips:['Explain step by step','Identify potential bugs','Summarise in one sentence','List dependencies used']},
  story:{hint:'Ask anything about your codebase or development process',placeholder:'Ask a question…',chips:['What models exist?','How does auth work?','Explain Rails conventions','How to add a new endpoint?']}
};
function selectMode(mode){
  currentMode=mode;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  const cfg=modeConfig[mode];
  modeHint.textContent=cfg.hint;
  inputEl.placeholder=cfg.placeholder;
  actionChips.innerHTML='';
  cfg.chips.forEach(label=>{
    const chip=document.createElement('button');
    chip.className='action-chip';chip.textContent=label;
    chip.addEventListener('click',()=>{const base=inputEl.value.trim();send(base?label+': '+base:label);});
    actionChips.appendChild(chip);
  });
  vscode.postMessage({command:'set_mode',mode});
  inputEl.focus();
}
document.querySelectorAll('.mode-btn').forEach(btn=>btn.addEventListener('click',()=>selectMode(btn.dataset.mode)));
selectMode('feature');
function showCodeBanner(code){attachedCode=code;const l=code.split('\\n').length;bannerText.textContent=l+' line'+(l!==1?'s':'')+' from editor attached';codeBanner.style.display='flex';}
function clearAttachedCode(){attachedCode='';codeBanner.style.display='none';}
clearCodeBtn.addEventListener('click',clearAttachedCode);
useSelBtn.addEventListener('click',()=>vscode.postMessage({command:'get_selection'}));
function parseMarkdown(md){
  return md
    .replace(/\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g,'<pre><code>$2</code></pre>')
    .replace(/\`([^\`\\n]+)\`/g,'<code>$1</code>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>').replace(/\\*(.+?)\\*/g,'<em>$1</em>')
    .replace(/^\\d+\\. (.+)$/gm,'<li>$1</li>').replace(/^[-*] (.+)$/gm,'<li>$1</li>')
    .replace(/((?:<li>[\\s\\S]*?<\\/li>\\n?)+)/g,'<ul>$1</ul>')
    .replace(/\\n\\n(?!<)/g,'</p><p>').replace(/\\n(?!<)/g,'<br/>');
}
function appendMessage(role,html,id=null){
  if(emptyState)emptyState.style.display='none';
  const w=document.createElement('div');w.className='message '+role;if(id)w.dataset.id=id;
  const l=document.createElement('div');l.className='label';l.textContent=role==='user'?'You':'MMR Assistant';
  const b=document.createElement('div');b.className='bubble';b.innerHTML=html;
  w.appendChild(l);w.appendChild(b);chatWindow.appendChild(w);chatWindow.scrollTop=chatWindow.scrollHeight;
  return w;
}
function send(overrideText){
  let text=overrideText!==undefined?overrideText:inputEl.value.trim();
  if(!text)return;
  if(attachedCode&&!overrideText)text=text+'\\n\\n\`\`\`\\n'+attachedCode+'\\n\`\`\`';
  appendMessage('user',(overrideText||inputEl.value.trim()).replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  if(!overrideText){inputEl.value='';inputEl.style.height='auto';}
  clearAttachedCode();sendBtn.disabled=true;
  vscode.postMessage({command:'ask',text,mode:currentMode});
}
inputEl.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
sendBtn.addEventListener('click',()=>send());
inputEl.addEventListener('input',()=>{inputEl.style.height='auto';inputEl.style.height=Math.min(inputEl.scrollHeight,140)+'px';});
window.addEventListener('message',event=>{
  const msg=event.data;
  if(msg.command==='inject_code'){
    showCodeBanner(msg.code);
    if(currentMode==='refactor'||currentMode==='explain'){inputEl.value=msg.code;inputEl.style.height='auto';inputEl.style.height=Math.min(inputEl.scrollHeight,140)+'px';}
    inputEl.focus();
  }
  if(msg.command==='loading'){const el=appendMessage('assistant loading','<em>Thinking…</em>',msg.id);loadingMap[msg.id]=el;}
  if(msg.command==='resolve'){const el=loadingMap[msg.id];if(el){el.classList.remove('loading');el.querySelector('.bubble').innerHTML=parseMarkdown(msg.text);delete loadingMap[msg.id];sendBtn.disabled=false;chatWindow.scrollTop=chatWindow.scrollHeight;}}
  if(msg.command==='assistant_message'){appendMessage(msg.type||'assistant',parseMarkdown(msg.text));sendBtn.disabled=false;chatWindow.scrollTop=chatWindow.scrollHeight;}
});
</script>
</body></html>`;
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map