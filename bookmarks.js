(() => {
  "use strict";
  if (document.getElementById("chatgpt-quick-bookmark")) return;

  const PREFIX = "chatgpt-quick-bookmark:";
  const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,.katex-display";
  let route = location.pathname;
  let bookmarks = [];
  const liveTargets = new Map();
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
  function blocks(scope) { return [...scope.querySelectorAll(BLOCKS)]; }
  function contentY(element) {
    const scrollElement = scroller(element);
    const origin = scrollElement === document.scrollingElement ||
      scrollElement === document.documentElement ? 0 :
      scrollElement.getBoundingClientRect().top;
    return scrollElement.scrollTop + element.getBoundingClientRect().top - origin;
  }
  function distanceFromSavedPosition(bookmark, element) {
    if (!Number.isFinite(bookmark.anchorY) && !Number.isFinite(bookmark.top)) return 0;
    const expectedY = Number.isFinite(bookmark.anchorY)
      ? bookmark.anchorY : bookmark.top + innerHeight * .4;
    return Math.abs(contentY(element) - expectedY);
  }
  function turnOf(element) {
    return element?.closest("article") || element?.closest("[data-message-id]") || null;
  }
  function turnId(turn) {
    return turn?.getAttribute("data-turn-id") ||
      turn?.getAttribute("data-message-id") ||
      turn?.getAttribute("data-testid") || "";
  }
  function findTurn(bookmark, main) {
    const turns = [...main.querySelectorAll("article")];
    if (bookmark.turnId) {
      const match = turns.find(turn => turnId(turn) === bookmark.turnId) ||
        [...main.querySelectorAll("[data-message-id]")]
          .find(turn => turnId(turn) === bookmark.turnId);
      return match || null;
    }
    return Number.isInteger(bookmark.turnIndex) && bookmark.turnIndex >= 0
      ? turns[bookmark.turnIndex] || null : null;
  }
  function findTarget(bookmark, nearbyOnly = false) {
    if (!bookmark.text && !bookmark.blockText) return null;
    const turns = [...document.querySelectorAll("article")];
    const allBlocks = blocks(document);
    const matches = (text) => allBlocks.filter(element =>
      (!nearbyOnly || visible(element)) &&
      (normalize(element.textContent).includes(text) ||
        normalize(element.innerText).includes(text)));
    let candidates = bookmark.text ? matches(bookmark.text) : [];
    if (!candidates.length && bookmark.blockText) candidates = matches(bookmark.blockText);
    if (!candidates.length) return null;

    const sameAnswer = candidates.filter(element =>
      bookmark.turnText && normalize(turnOf(element)?.innerText).includes(bookmark.turnText));
    const sameTurn = bookmark.turnId && candidates.filter(element => {
      const turn = turnOf(element);
      const index = turns.indexOf(turn);
      return turnId(turn) === bookmark.turnId &&
        (!Number.isInteger(bookmark.turnIndex) || bookmark.turnIndex < 0 ||
          index < 0 || index <= bookmark.turnIndex);
    });
    if (sameAnswer.length) candidates = sameAnswer;
    else if (sameTurn?.length) candidates = sameTurn;
    else if (bookmark.turnId || bookmark.turnText) {
      // Older bookmarks have no answer fingerprint. Only accept a changed turn
      // identifier if the selected text remains near its saved position.
      const tolerance = Math.max(innerHeight, 900);
      candidates = candidates.filter(element => {
        const index = turns.indexOf(turnOf(element));
        return distanceFromSavedPosition(bookmark, element) <= tolerance &&
          (!Number.isInteger(bookmark.turnIndex) || bookmark.turnIndex < 0 ||
            index < 0 || index <= bookmark.turnIndex);
      });
    } else if (Number.isInteger(bookmark.turnIndex) && bookmark.turnIndex >= 0) {
      const sameIndex = candidates.filter(element =>
        turns.indexOf(turnOf(element)) === bookmark.turnIndex);
      if (sameIndex.length) candidates = sameIndex;
      else {
        // A follow-up adds turns after the saved one. Never use their repeated text.
        candidates = candidates.filter(element => {
          const index = turns.indexOf(turnOf(element));
          return index < 0 || index < bookmark.turnIndex;
        });
      }
    }
    const exactBlock = element => bookmark.blockText &&
      normalize(element.textContent).slice(0, 160) === bookmark.blockText ? 0 : 1;
    const blockGap = element => {
      const turn = turnOf(element);
      return turn && Number.isInteger(bookmark.blockIndex) && bookmark.blockIndex >= 0
        ? Math.abs(blocks(turn).indexOf(element) - bookmark.blockIndex) : 0;
    };
    candidates.sort((a, b) =>
      exactBlock(a) - exactBlock(b) ||
      blockGap(a) - blockGap(b) ||
      distanceFromSavedPosition(bookmark, a) - distanceFromSavedPosition(bookmark, b) ||
      Math.abs(allBlocks.indexOf(a) - bookmark.index) -
        Math.abs(allBlocks.indexOf(b) - bookmark.index));
    return candidates[0] || null;
  }
  function visibleBlock() {
    const main = mainContent();
    if (!main) return null;
    const targetY = innerHeight * .4;
    const candidates = blocks(main).filter(visible);
    candidates.sort((a, b) =>
      distanceTo(a, targetY) - distanceTo(b, targetY) ||
      a.getBoundingClientRect().height - b.getBoundingClientRect().height);
    return candidates[0] || null;
  }
  function distanceTo(element, y) {
    const rect = element.getBoundingClientRect();
    return Math.max(rect.top - y, y - rect.bottom, 0);
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
    liveTargets.clear();
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
    const target = selectedElement || visibleBlock();
    selectedElement = null;
    const top = scroller(target).scrollTop;
    const main = mainContent();
    const turn = turnOf(target);
    const turnIndex = turn && main ? [...main.querySelectorAll("article")].indexOf(turn) : -1;
    const blockIndex = turn && target ? blocks(turn).indexOf(target) : -1;
    const index = target && main ? blocks(main).indexOf(target) : -1;
    if (bookmarks.some(item => item.turnId === turnId(turn) &&
        item.blockIndex === blockIndex && item.text === text &&
        Math.abs(item.top - top) < 12)) {
      say("这里已经标记过了");
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    bookmarks.unshift({
      id,
      top,
      text,
      index,
      turnId: turnId(turn),
      turnIndex,
      turnText: normalize(turn?.innerText).slice(0, 180),
      blockIndex,
      blockText: normalize(target?.textContent).slice(0, 160),
      anchorY: target ? contentY(target) : null,
      label: (text || normalize(target?.innerText) || "当前阅读位置").slice(0, 40)
    });
    try {
      await persist();
      if (target) liveTargets.set(id, { target, scrollElement: scroller(target) });
      setExpanded(false);
      say(`已添加书签 · 共 ${bookmarks.length} 处`);
    } catch (_) { bookmarks.shift(); render(); say("保存失败，请刷新网页"); }
  }
  async function deleteBookmark(id) {
    const previous = bookmarks;
    bookmarks = bookmarks.filter(item => item.id !== id);
    try { await persist(); liveTargets.delete(id); }
    catch (_) { bookmarks = previous; render(); say("删除失败，请刷新网页"); }
  }
  async function jumpTo(bookmark) {
    const live = liveTargets.get(bookmark.id);
    if (live?.target?.isConnected && location.pathname === route) {
      highlight(live.target);
      return;
    }
    const hasTurn = Boolean(bookmark.turnId) ||
      Number.isInteger(bookmark.turnIndex) && bookmark.turnIndex >= 0;
    let target = findTarget(bookmark);
    if (target) { highlight(target); return; }
    const turns = [...document.querySelectorAll("article")];
    const namedTurn = findTurn(bookmark, document);
    const savedTurn = bookmark.turnText
      ? [namedTurn, ...turns].find(turn =>
          turn && normalize(turn.innerText).includes(bookmark.turnText))
      : namedTurn;
    if (savedTurn) savedTurn.scrollIntoView({ behavior: "auto", block: "start" });
    else {
      const main = mainContent();
      const visibleTurn = main && [...main.querySelectorAll("article")].find(visible);
      const scrollElement = live?.scrollElement?.isConnected
        ? live.scrollElement : scroller(visibleTurn || visibleBlock());
      scrollElement.scrollTo({ top: bookmark.top, behavior: "auto" });
    }
    if (!bookmark.text && !bookmark.blockText) {
      say("已返回保存时的阅读位置");
      return;
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      target = findTarget(bookmark, !hasTurn);
      if (target) { highlight(target); return; }
    }
    if (savedTurn?.isConnected) {
      savedTurn.scrollIntoView({ behavior: "smooth", block: "start" });
      say("原段落已变化，已返回这条回答的开头");
    } else {
      say("未找到原文，已返回保存时的附近位置");
    }
  }

  function prepareSelection() {
    const selection = getSelection();
    selectedText = normalize(selection?.toString()).slice(0, 80);
    const node = selectedText && selection?.rangeCount
      ? selection.getRangeAt(0).startContainer : null;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const block = element?.closest(BLOCKS);
    selectedElement = block?.getRootNode() === document ? block : null;
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
