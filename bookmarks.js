(() => {
  "use strict";
  if (document.getElementById("chatgpt-quick-bookmark")) return;

  const PREFIX = "chatgpt-quick-bookmark:";
  const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,.katex-display";
  let route = location.pathname;
  let bookmarks = [];
  let selectedText = "";
  let selectedElement = null;
  let noticeTimer;

  const host = document.createElement("div");
  host.id = "chatgpt-quick-bookmark";
  host.style.cssText = "position:fixed;right:18px;bottom:88px;z-index:2147483647";
  const ui = host.attachShadow({ mode: "open" });
  ui.innerHTML = `
    <style>
      :host { font: 13px/1.4 system-ui,sans-serif; color:#222; }
      [hidden] { display:none!important; }
      button { border:0; background:transparent; color:inherit; cursor:pointer;
        font:inherit; white-space:nowrap; }
      button:hover { background:#f1f1f1; }
      .compact,.panel { background:#fff; border:1px solid #d6d6d6;
        box-shadow:0 3px 16px #0003; }
      .compact { display:flex; width:max-content; margin-left:auto; border-radius:10px; overflow:hidden; }
      .compact button { padding:8px 10px; }
      .compact button + button { border-left:1px solid #e8e8e8; }
      .panel { width:284px; max-width:calc(100vw - 36px); border-radius:12px; overflow:hidden; }
      .head { display:flex; align-items:center; justify-content:space-between;
        padding:9px 10px 9px 13px; border-bottom:1px solid #ebebeb; font-weight:600; }
      .head button { padding:3px 7px; border-radius:6px; font-size:18px; }
      #panel-save { display:block; width:calc(100% - 20px); margin:10px;
        padding:8px; border:1px solid #d6d6d6; border-radius:8px; text-align:left; }
      #list { max-height:min(310px,45vh); overflow-y:auto; padding:0 6px 6px; }
      .row { display:flex; align-items:center; border-radius:7px; }
      .row:hover { background:#f6f6f6; }
      .row button:hover { background:transparent; }
      .jump { flex:1; min-width:0; padding:8px; overflow:hidden;
        text-overflow:ellipsis; text-align:left; }
      .remove { flex:0 0 auto; padding:8px; opacity:.55; }
      .remove:hover { opacity:1; }
      .empty { padding:8px 10px 13px; color:#777; }
      #notice { display:none; position:absolute; right:0; bottom:calc(100% + 8px);
        padding:7px 9px; border-radius:7px; background:#242424; color:#fff;
        white-space:nowrap; box-shadow:0 3px 12px #0003; }
      @media (prefers-color-scheme:dark) {
        :host { color:#f4f4f4; }
        .compact,.panel { background:#292929; border-color:#555; }
        button:hover,.row:hover { background:#3a3a3a; }
        .compact button + button,.head { border-color:#555; }
        #panel-save { border-color:#555; }
        .empty { color:#aaa; }
      }
    </style>
    <div class="compact" id="compact">
      <button id="quick-save" title="标记当前位置；先选中文字可精确标记">＋</button>
      <button id="open" title="查看所有书签">🔖 <span id="count">0</span></button>
    </div>
    <div class="panel" id="panel" hidden>
      <div class="head"><span id="title">书签</span><button id="close" title="收起">−</button></div>
      <button id="panel-save" title="先选中文字可精确标记">＋ 标记当前位置</button>
      <div id="list"></div>
    </div>
    <div id="notice" role="status"></div>`;

  const compact = ui.getElementById("compact");
  const panel = ui.getElementById("panel");
  const count = ui.getElementById("count");
  const title = ui.getElementById("title");
  const list = ui.getElementById("list");
  const notice = ui.getElementById("notice");

  function say(message) {
    notice.textContent = message;
    notice.style.display = "block";
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.style.display = "none"; }, 2200);
  }
  function key() { return PREFIX + location.pathname; }
  function normalize(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function setExpanded(value) {
    compact.hidden = value;
    panel.hidden = !value;
  }
  function render() {
    count.textContent = String(bookmarks.length);
    title.textContent = `书签 · ${bookmarks.length}`;
    list.replaceChildren();
    if (!bookmarks.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有标记。点击上方按钮即可添加。";
      list.appendChild(empty);
      return;
    }
    for (const bookmark of bookmarks) {
      const row = document.createElement("div");
      row.className = "row";
      const jump = document.createElement("button");
      jump.className = "jump";
      jump.textContent = `🔖 ${bookmark.label}`;
      jump.title = bookmark.label;
      jump.addEventListener("click", () => { setExpanded(false); jumpTo(bookmark); });
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "×";
      remove.title = "删除这条书签";
      remove.addEventListener("click", () => deleteBookmark(bookmark.id));
      row.append(jump, remove);
      list.appendChild(row);
    }
  }
  function isScrollable(element) {
    return Boolean(element && element !== document.body &&
      /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight + 30);
  }
  function scroller(near) {
    for (let element = near; element; element = element.parentElement) {
      if (isScrollable(element)) return element;
    }
    const main = document.querySelector("main") || document.querySelector('[role="main"]');
    const options = main ? [main, ...main.querySelectorAll("*")] : [];
    return options.filter(isScrollable).sort((a, b) =>
      (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] ||
      document.scrollingElement || document.documentElement;
  }
  function mainContent() {
    return document.querySelector("main") || document.querySelector('[role="main"]');
  }
  function findText(text, expectedIndex = -1) {
    if (!text) return null;
    const main = mainContent();
    if (!main) return null;
    const matches = [...main.querySelectorAll(BLOCKS)]
      .map((element, index) => ({ element, index }))
      .filter(item => normalize(item.element.textContent).includes(text));
    if (expectedIndex >= 0) {
      matches.sort((a, b) =>
        Math.abs(a.index - expectedIndex) - Math.abs(b.index - expectedIndex));
    }
    return matches[0]?.element || null;
  }
  function visibleLabel() {
    const main = mainContent();
    if (!main) return "当前阅读位置";
    const targetY = innerHeight * .4;
    let candidates = [...main.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible);
    if (!candidates.length) candidates = [...main.querySelectorAll("p,li")].filter(visible);
    candidates.sort((a, b) =>
      Math.abs(a.getBoundingClientRect().top - targetY) -
      Math.abs(b.getBoundingClientRect().top - targetY));
    return normalize(candidates[0]?.innerText).slice(0, 40) || "当前阅读位置";
  }
  function visible(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight - 80;
  }
  function highlight(element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const oldOutline = element.style.outline;
    const oldOffset = element.style.outlineOffset;
    element.style.outline = "2px solid #d49a29";
    element.style.outlineOffset = "5px";
    setTimeout(() => {
      element.style.outline = oldOutline;
      element.style.outlineOffset = oldOffset;
    }, 2400);
  }
  async function persist() {
    await chrome.storage.local.set({ [key()]: bookmarks });
    render();
  }
  async function load() {
    const path = location.pathname;
    route = path;
    bookmarks = [];
    setExpanded(false);
    render();
    try {
      const result = await chrome.storage.local.get(PREFIX + path);
      if (location.pathname !== path) return;
      const saved = result[PREFIX + path];
      bookmarks = Array.isArray(saved) ? saved : saved ? [{
        id: `old-${Date.now()}`,
        top: saved.top,
        text: saved.text || "",
        label: saved.text || "之前的标记"
      }] : [];
      render();
    } catch (_) { say("扩展未连接，请刷新网页"); }
  }
  async function addBookmark() {
    const text = selectedText;
    selectedText = "";
    const target = selectedElement || findText(text);
    selectedElement = null;
    const top = scroller(target).scrollTop;
    const index = target && mainContent()
      ? [...mainContent().querySelectorAll(BLOCKS)].indexOf(target) : -1;
    if (bookmarks.some(item => item.text === text && Math.abs(item.top - top) < 12)) {
      say("这里已经标记过了");
      return;
    }
    bookmarks.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      top,
      text,
      index,
      label: (text || visibleLabel()).slice(0, 40)
    });
    try {
      await persist();
      setExpanded(false);
      say(`已添加书签 · 共 ${bookmarks.length} 处`);
    } catch (_) { bookmarks.shift(); render(); say("保存失败，请刷新网页"); }
  }
  async function deleteBookmark(id) {
    const previous = bookmarks;
    bookmarks = bookmarks.filter(item => item.id !== id);
    try { await persist(); }
    catch (_) { bookmarks = previous; render(); say("删除失败，请刷新网页"); }
  }
  async function jumpTo(bookmark) {
    let target = findText(bookmark.text, bookmark.index);
    if (target) { highlight(target); return; }
    scroller(null).scrollTo({ top: bookmark.top, behavior: "smooth" });
    if (!bookmark.text) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      target = findText(bookmark.text, bookmark.index);
      if (target) { highlight(target); return; }
    }
    say("已返回附近；若内容未加载，请稍向上滚动");
  }

  function prepareSelection() {
    const selection = getSelection();
    selectedText = normalize(selection?.toString()).slice(0, 80);
    const node = selectedText && selection?.rangeCount
      ? selection.getRangeAt(0).commonAncestorContainer : null;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const block = element?.closest(BLOCKS);
    selectedElement = block && mainContent()?.contains(block) ? block : null;
  }
  ui.getElementById("quick-save").addEventListener("pointerdown", prepareSelection);
  ui.getElementById("panel-save").addEventListener("pointerdown", prepareSelection);
  ui.getElementById("quick-save").addEventListener("click", addBookmark);
  ui.getElementById("panel-save").addEventListener("click", addBookmark);
  ui.getElementById("open").addEventListener("click", () => setExpanded(true));
  ui.getElementById("close").addEventListener("click", () => setExpanded(false));

  document.body.appendChild(host);
  load();
  setInterval(() => { if (location.pathname !== route) load(); }, 1000);
})();
