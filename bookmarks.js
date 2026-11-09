(() => {
  "use strict";
  if (document.getElementById("chatgpt-quick-bookmark")) return;

  const PREFIX = "chatgpt-quick-bookmark:";
  const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,.katex-display";
  let route = location.pathname;
  let bookmarks = [];
  const liveTargets = new Map();
  const foldedPairs = new Map();
  const foldAttributes = new WeakMap();
  let foldObserver = null;
  let foldTimer;
  let cachedPane = null;
  let selectedText = "";
  let selectedElement = null;
  let noticeTimer;

  const host = document.createElement("div");
  host.id = "chatgpt-quick-bookmark";
  host.style.cssText = "position:fixed;right:18px;bottom:88px;width:min(284px,calc(100vw - 16px));z-index:2147483647;pointer-events:none";
  const ui = host.attachShadow({ mode: "open" });
  ui.innerHTML = `
    <style>
      :host { font: 13px/1.4 system-ui,sans-serif; color:#262626; }
      [hidden] { display:none!important; }
      button { border:0; background:transparent; color:inherit; cursor:pointer;
        font:inherit; white-space:nowrap; }
      button:hover { background:#f3f4f6; }
      button:focus-visible { outline:2px solid #4582d3; outline-offset:-3px; }
      .compact,.panel { pointer-events:auto; background:#fff; border:1px solid #dedfe3;
        box-shadow:0 4px 18px #0002,0 1px 3px #0001; }
      .compact { display:flex; align-items:center; width:max-content; max-width:100%;
        margin-left:auto; border-radius:999px; overflow:hidden; }
      .compact button { height:36px; padding:0 11px; }
      .compact button + button { border-left:1px solid #ebedf0; }
      .compact #quick-save { font-weight:650; }
      .compact #open { font-variant-numeric:tabular-nums; }
      .compact #quick-fold { color:#4b5563; }
      .drag { cursor:grab; touch-action:none; user-select:none; color:#858b96; }
      .drag:active { cursor:grabbing; }
      .compact .drag { width:29px; padding:0; font-size:18px; line-height:1; }
      .panel { box-sizing:border-box; width:100%; border-radius:14px; overflow:hidden; }
      .head { display:flex; align-items:center; justify-content:space-between;
        padding:5px 8px; border-bottom:1px solid #ebedf0; font-weight:600; }
      .head .drag { padding:5px 8px; font-size:18px; }
      .head #title { flex:1; }
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
      #panel-fold { display:block; width:calc(100% - 20px); margin:0 10px 10px;
        padding:8px; border:1px solid #d6d6d6; border-radius:8px; text-align:left; }
      #fold-list { max-height:180px; overflow-y:auto; padding:0 6px 6px; }
      #fold-list:empty { display:none; }
      #notice { display:none; position:absolute; right:0; bottom:calc(100% + 8px);
        padding:7px 9px; border-radius:7px; background:#242424; color:#fff;
        white-space:nowrap; box-shadow:0 3px 12px #0003; pointer-events:none; }
      @media (prefers-color-scheme:dark) {
        :host { color:#f4f4f4; }
        .compact,.panel { background:#292b30; border-color:#4a4d55; }
        button:hover,.row:hover { background:#3a3d44; }
        .compact button + button,.head { border-color:#484b53; }
        .compact #quick-fold { color:#c3c7cf; }
        .drag { color:#aab0bb; }
        #panel-save,#panel-fold { border-color:#555; }
        .empty { color:#aaa; }
      }
    </style>
    <div class="compact" id="compact">
      <button id="drag-compact" class="drag" title="按住拖动工具条" aria-label="拖动工具条">⠿</button>
      <button id="quick-save" title="标记当前位置；先选中文字可精确标记">＋ 标记</button>
      <button id="open" title="查看所有书签">🔖 <span id="count">0</span></button>
      <button id="quick-fold" title="收起当前屏幕正在看的问答">收起问答</button>
    </div>
    <div class="panel" id="panel" hidden>
      <div class="head"><button id="drag-panel" class="drag" title="按住拖动面板" aria-label="拖动面板">⠿</button><span id="title">书签</span><button id="close" title="收起">−</button></div>
      <button id="panel-save" title="先选中文字可精确标记">＋ 标记当前位置</button>
      <button id="panel-fold" title="收起当前屏幕正在看的问答">收起当前问答</button>
      <div id="fold-list"></div>
      <div id="list"></div>
    </div>
    <div id="notice" role="status"></div>`;

  const compact = ui.getElementById("compact");
  const panel = ui.getElementById("panel");
  const count = ui.getElementById("count");
  const title = ui.getElementById("title");
  const list = ui.getElementById("list");
  const foldList = ui.getElementById("fold-list");
  const notice = ui.getElementById("notice");

  function say(message) {
    notice.textContent = message;
    notice.style.display = "block";
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.style.display = "none"; }, 2200);
  }
  function key(path = location.pathname) { return PREFIX + location.host + path; }
  function foldKey(path = location.pathname) { return PREFIX + "fold:" + location.host + path; }
  function positionKey() { return PREFIX + "position:" + location.host; }
  function oldKey(path) { return PREFIX + path; }
  function normalize(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function placeHost(right, bottom) {
    const maxRight = Math.max(8, innerWidth - host.offsetWidth - 8);
    const maxBottom = Math.max(8, innerHeight - host.offsetHeight - 8);
    host.style.right = `${Math.min(Math.max(8, right), maxRight)}px`;
    host.style.bottom = `${Math.min(Math.max(8, bottom), maxBottom)}px`;
  }
  function fitHost() {
    placeHost(parseFloat(host.style.right) || 18, parseFloat(host.style.bottom) || 88);
  }
  async function loadPosition() {
    try {
      const saved = (await chrome.storage.local.get(positionKey()))[positionKey()];
      if (positionTouched) return;
      if (Number.isFinite(saved?.right) && Number.isFinite(saved?.bottom))
        placeHost(saved.right, saved.bottom);
      else fitHost();
    } catch (_) { fitHost(); }
  }
  let positionTouched = false;
  function makeDraggable(handle) {
    let start = null;
    handle.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      positionTouched = true;
      start = { id: event.pointerId, x: event.clientX, y: event.clientY,
        right: parseFloat(host.style.right), bottom: parseFloat(host.style.bottom), moved: false };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
      if (start.moved) placeHost(start.right - dx, start.bottom - dy);
    });
    function finish(event) {
      if (!start || event.pointerId !== start.id) return;
      const moved = start.moved;
      start = null;
      if (moved) chrome.storage.local.set({ [positionKey()]: {
        right: parseFloat(host.style.right), bottom: parseFloat(host.style.bottom)
      } }).catch(() => say("位置已移动，但保存失败"));
    }
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
  function setExpanded(value) {
    compact.hidden = value;
    panel.hidden = !value;
    fitHost();
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
  function renderFolds() {
    foldList.replaceChildren();
    for (const record of [...foldedPairs.values()].reverse()) {
      const button = document.createElement("button");
      button.className = "jump";
      button.style.display = "block";
      button.style.width = "100%";
      button.textContent = `▶ 展开：${record.title}`;
      button.title = record.title;
      button.addEventListener("click", () => expandFold(record.id));
      foldList.appendChild(button);
    }
  }
  function isScrollable(element) {
    return Boolean(element && element !== document.body &&
      /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight + 30);
  }
  function readingPane() {
    if (cachedPane?.isConnected && isScrollable(cachedPane)) return cachedPane;
    const options = [...document.querySelectorAll("*")].filter(isScrollable)
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > innerWidth * .3 && rect.height > innerHeight * .3 &&
          rect.left < innerWidth * .7 && rect.right > innerWidth * .3;
      });
    cachedPane = options.sort((a, b) => {
      const area = element => element.clientWidth * element.clientHeight;
      return area(b) - area(a);
    })[0] || null;
    return cachedPane;
  }
  function scroller(near) {
    for (let element = near; element; element = element.parentElement) {
      if (isScrollable(element)) return element;
    }
    return readingPane() || document.scrollingElement || document.documentElement;
  }
  function mainContent() {
    if (location.hostname === "chat.deepseek.com") {
      const pane = readingPane();
      if (pane) return pane;
    }
    const main = document.querySelector("main") || document.querySelector('[role="main"]');
    return main && blocks(main).length ? main : readingPane() || document.body;
  }
  function blocks(scope) { return [...scope.querySelectorAll(BLOCKS)]; }
  function fallbackBlocks(scope) {
    return [...scope.querySelectorAll("div,span")].filter(element => {
      const text = normalize(element.innerText);
      return text.length >= 4 && text.length <= 500 && !element.isContentEditable;
    });
  }
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
  function messageRecords() {
    const deepseek = location.hostname === "chat.deepseek.com";
    const messages = [];
    if (!deepseek) {
      const scope = document.querySelector('[data-thread-find-target="conversation"]') ||
        document.querySelector("main") || document;
      const searchSelector = '[data-content-search-unit-key$=":user"],' +
        '[data-content-search-unit-key$=":assistant"],' +
        '[data-chatgpt-search-unit-key$=":user"],' +
        '[data-chatgpt-search-unit-key$=":assistant"]';
      let searchNodes = [...scope.querySelectorAll(searchSelector)];
      if (!searchNodes.length && scope !== document)
        searchNodes = [...document.querySelectorAll(searchSelector)];
      for (const node of searchNodes) {
        const searchKey = node.getAttribute("data-content-search-unit-key") ||
          node.getAttribute("data-chatgpt-search-unit-key") || "";
        const role = searchKey.endsWith(":user") ? "user" : "assistant";
        messages.push({ root: node, role,
          key: node.getAttribute("data-qb-message-key") || `${role}:${searchKey}`,
          title: normalize(node.innerText).slice(0, 60) });
      }
      if (messages.length) return messages;
    }
    const roleSelector = '[data-message-author-role="user"],[data-message-author-role="assistant"]';
    const scope = deepseek ? mainContent() : document;
    const nodes = [...scope.querySelectorAll(deepseek ? ".ds-message" : roleSelector)];
    for (const node of nodes) {
      const role = deepseek
        ? node.querySelector(".ds-assistant-message-main-content") ? "assistant" : "user"
        : node.getAttribute("data-message-author-role");
      if (!role) continue;
      const opposite = role === "user" ? "assistant" : "user";
      const root = deepseek ? node.parentElement : [
        node.closest("article"),
        node.closest('[data-testid^="conversation-turn"]'),
        node.closest("[data-turn-id]"),
        node.closest("[data-message-id]"),
        node
      ].find(candidate => candidate &&
        !candidate.querySelector(`[data-message-author-role="${opposite}"]`));
      if (!root || messages.some(item => item.root === root)) continue;
      const preserved = root.getAttribute("data-qb-message-key");
      const stable = deepseek
        ? node.closest("[data-virtual-list-item-key]")?.getAttribute("data-virtual-list-item-key")
        : turnId(root) || turnId(node);
      const index = messages.length;
      messages.push({ root, role,
        key: preserved || (stable ? `${role}:${stable}` :
          `${role}:${index}:${normalize(root.innerText).slice(0, 100)}`),
        title: normalize(root.innerText).slice(0, 60) });
    }
    if (!deepseek && messages.length < 2) {
      const markedTurns = [...document.querySelectorAll(
        '[data-testid^="conversation-turn"],[data-turn-id]')];
      const turns = markedTurns.length ? markedTurns :
        [...document.querySelectorAll("main article")];
      const roots = turns.filter(node => !turns.some(other =>
        other !== node && other.contains(node)));
      if (roots.length > messages.length) {
        messages.length = 0;
        roots.forEach((root, index) => {
          const explicit = root.getAttribute("data-message-author-role") ||
            root.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");
          const turnNumber = Number(root.getAttribute("data-testid")
            ?.match(/conversation-turn-?(\d+)/)?.[1]);
          const role = explicit || (root.querySelector("[data-user-message-bubble]")
            ? "user" : (Number.isInteger(turnNumber) ? turnNumber : index) % 2
              ? "assistant" : "user");
          const stable = turnId(root);
          messages.push({ root, role,
            key: root.getAttribute("data-qb-message-key") ||
              `${role}:${stable || `${index}:${normalize(root.textContent).slice(0, 80)}`}`,
            title: normalize(root.innerText).slice(0, 60) });
        });
      }
    }
    return messages;
  }
  function messagePairs() {
    const messages = messageRecords();
    const pairs = [];
    for (let index = 0; index < messages.length - 1; index++) {
      const question = messages[index], answer = messages[index + 1];
      if (question.role !== "user" || answer.role !== "assistant" ||
          question.root === answer.root) continue;
      pairs.push({ question, answer,
        id: JSON.stringify([question.key, answer.key]) });
    }
    return pairs;
  }
  function clearFoldNode(node) {
    if (node.getAttribute("data-qb-fold") === "question") {
      const original = foldAttributes.get(node);
      if (original) {
        if (original.tabindex === null) node.removeAttribute("tabindex");
        else node.setAttribute("tabindex", original.tabindex);
        if (original.label === null) node.removeAttribute("aria-label");
        else node.setAttribute("aria-label", original.label);
        foldAttributes.delete(node);
      }
    }
    node.removeAttribute("data-qb-fold");
    node.removeAttribute("data-qb-id");
    node.removeAttribute("data-qb-summary");
    node.removeAttribute("data-qb-message-key");
  }
  function syncFolds() {
    const current = new Map(messageRecords().map(message => [message.key, message]));
    const valid = new Set();
    for (const record of foldedPairs.values()) {
      let keys;
      try { keys = JSON.parse(record.id); } catch (_) { continue; }
      if (!Array.isArray(keys) || keys.length !== 2) continue;
      const question = current.get(keys[0]);
      const answer = current.get(keys[1]);
      if (question?.role === "user") {
        const node = question.root;
        valid.add(node);
        if (!foldAttributes.has(node)) foldAttributes.set(node, {
          tabindex: node.getAttribute("tabindex"),
          label: node.getAttribute("aria-label")
        });
        node.setAttribute("data-qb-fold", "question");
        node.setAttribute("data-qb-id", record.id);
        node.setAttribute("data-qb-summary", record.title);
        node.setAttribute("data-qb-message-key", question.key);
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", `展开问答：${record.title}`);
      }
      if (answer?.role === "assistant") {
        const node = answer.root;
        valid.add(node);
        node.setAttribute("data-qb-fold", "answer");
        node.setAttribute("data-qb-id", record.id);
        node.setAttribute("data-qb-message-key", answer.key);
      }
    }
    for (const node of document.querySelectorAll("[data-qb-fold]")) {
      if (!valid.has(node)) clearFoldNode(node);
    }
  }
  function observeFolds() {
    if (foldObserver || !foldedPairs.size) return;
    const messageSelector = "article,.ds-message,[data-message-author-role]," +
      "[data-content-search-unit-key],[data-chatgpt-search-unit-key]," +
      "[data-testid^='conversation-turn'],[data-turn-id]," +
      ".ds-assistant-message-main-content,[data-virtual-list-item-key]";
    foldObserver = new MutationObserver(changes => {
      const changedMessage = changes.some(change => change.type === "attributes" ||
        [...change.addedNodes, ...change.removedNodes].some(node =>
          node.nodeType === 1 &&
          (node.matches(messageSelector) || node.querySelector(messageSelector))));
      if (!changedMessage) return;
      clearTimeout(foldTimer);
      foldTimer = setTimeout(syncFolds, 120);
    });
    foldObserver.observe(document.body, { childList: true, subtree: true,
      attributes: true, attributeFilter: ["data-virtual-list-item-key"] });
  }
  function resetFolds() {
    foldObserver?.disconnect();
    foldObserver = null;
    clearTimeout(foldTimer);
    for (const node of document.querySelectorAll("[data-qb-fold]")) clearFoldNode(node);
    foldedPairs.clear();
    renderFolds();
  }
  function persistFolds() {
    return chrome.storage.local.set({ [foldKey()]: [...foldedPairs.values()] });
  }
  function expandFold(id) {
    const removed = foldedPairs.delete(id);
    for (const node of document.querySelectorAll("[data-qb-fold]")) {
      if (node.getAttribute("data-qb-id") === id) clearFoldNode(node);
    }
    syncFolds();
    if (!foldedPairs.size) { foldObserver?.disconnect(); foldObserver = null; }
    renderFolds();
    if (removed) persistFolds().catch(() => say("展开成功，保存状态失败"));
  }
  function foldCurrent() {
    selectedElement = null;
    selectedText = "";
    const targetY = innerHeight * .42;
    const pairs = messagePairs().filter(item => !foldedPairs.has(item.id));
    const centers = [.5, .4, .6].map(fraction =>
      document.elementFromPoint(innerWidth * fraction, targetY)).filter(Boolean);
    const pair = pairs.find(item => centers.some(element =>
      item.question.root.contains(element) || item.answer.root.contains(element))) ||
      pairs.filter(item => visible(item.question.root) || visible(item.answer.root))
        .sort((a, b) =>
        Math.min(distanceTo(a.question.root, targetY), distanceTo(a.answer.root, targetY)) -
        Math.min(distanceTo(b.question.root, targetY), distanceTo(b.answer.root, targetY)))[0];
    if (!pair) {
      say("当前屏幕没有找到完整问答，请滚动到要收起的回答附近再试");
      return;
    }
    foldedPairs.set(pair.id, { id: pair.id,
      title: pair.question.title || "已折叠的问答" });
    syncFolds();
    observeFolds();
    renderFolds();
    persistFolds().then(() => say("已折叠；点击提问摘要可展开"))
      .catch(() => say("已折叠，但保存状态失败"));
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
    const main = mainContent();
    const allBlocks = blocks(document);
    const matches = (text) => allBlocks.filter(element =>
      (!nearbyOnly || visible(element)) &&
      (normalize(element.textContent).includes(text) ||
        normalize(element.innerText).includes(text)));
    let candidates = bookmark.text ? matches(bookmark.text) : [];
    if (!candidates.length && bookmark.blockText) candidates = matches(bookmark.blockText);
    if (!candidates.length) {
      const text = bookmark.text || bookmark.blockText;
      candidates = fallbackBlocks(document).filter(element =>
        (!nearbyOnly || visible(element)) &&
        (normalize(element.textContent).includes(text) ||
          normalize(element.innerText).includes(text)));
    }
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
    const scopedBlocks = bookmark.fallbackBlock ? fallbackBlocks(main) : blocks(main);
    const indexGap = element => Number.isInteger(bookmark.index) && bookmark.index >= 0
      ? Math.abs(scopedBlocks.indexOf(element) - bookmark.index) : 0;
    candidates.sort((a, b) =>
      exactBlock(a) - exactBlock(b) ||
      blockGap(a) - blockGap(b) ||
      (!bookmark.turnId && !bookmark.turnText ? indexGap(a) - indexGap(b) : 0) ||
      distanceFromSavedPosition(bookmark, a) - distanceFromSavedPosition(bookmark, b) ||
      indexGap(a) - indexGap(b));
    return candidates[0] || null;
  }
  function visibleBlock() {
    const main = mainContent();
    if (!main) return null;
    const targetY = innerHeight * .4;
    const centered = elements => elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < innerWidth * .7 && rect.right > innerWidth * .3;
    });
    const semantic = blocks(main).filter(visible);
    const centerSemantic = centered(semantic);
    const centerFallback = centerSemantic.length ? [] :
      centered(fallbackBlocks(main).filter(visible));
    const candidates = centerSemantic.length ? centerSemantic :
      centerFallback.length ? centerFallback : semantic;
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
    const folded = element.closest("[data-qb-fold]");
    if (folded) expandFold(folded.getAttribute("data-qb-id"));
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
    cachedPane = null;
    resetFolds();
    setExpanded(false);
    render();
    try {
      const storageKey = key(path);
      const result = await chrome.storage.local.get([storageKey, oldKey(path), foldKey(path)]);
      if (location.pathname !== path) return;
      const saved = result[storageKey] ??
        (location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com"
          ? result[oldKey(path)] : null);
      bookmarks = Array.isArray(saved) ? saved : saved ? [{
        id: `old-${Date.now()}`,
        top: saved.top,
        text: saved.text || "",
        label: saved.text || "之前的标记"
      }] : [];
      const savedFolds = result[foldKey(path)];
      if (Array.isArray(savedFolds)) {
        for (const item of savedFolds) {
          if (typeof item?.id === "string" && typeof item.title === "string")
            foldedPairs.set(item.id, item);
        }
      }
      render();
      if (foldedPairs.size) { syncFolds(); observeFolds(); }
      renderFolds();
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
    const semanticIndex = target && main ? blocks(main).indexOf(target) : -1;
    const fallbackBlock = semanticIndex < 0;
    const index = semanticIndex >= 0 ? semanticIndex :
      target && main ? fallbackBlocks(main).indexOf(target) : -1;
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
      fallbackBlock,
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
    let block = element?.closest(BLOCKS);
    if (!block) {
      for (let parent = element; parent && parent !== document.body;
          parent = parent.parentElement) {
        const content = normalize(parent.innerText);
        if (parent.matches?.("div,span") && content.includes(selectedText) &&
            content.length <= 500) { block = parent; break; }
      }
    }
    const target = block || element;
    selectedElement = target?.getRootNode() === document ? target : null;
  }
  ui.getElementById("quick-save").addEventListener("pointerdown", prepareSelection);
  ui.getElementById("panel-save").addEventListener("pointerdown", prepareSelection);
  ui.getElementById("quick-save").addEventListener("click", addBookmark);
  ui.getElementById("panel-save").addEventListener("click", addBookmark);
  ui.getElementById("quick-fold").addEventListener("click", foldCurrent);
  ui.getElementById("panel-fold").addEventListener("click", () => { setExpanded(false); foldCurrent(); });
  ui.getElementById("open").addEventListener("click", () => setExpanded(true));
  ui.getElementById("close").addEventListener("click", () => setExpanded(false));
  makeDraggable(ui.getElementById("drag-compact"));
  makeDraggable(ui.getElementById("drag-panel"));
  window.addEventListener("resize", fitHost);

  function foldedQuestion(event) {
    return event.composedPath().find(node =>
      node instanceof Element && node.getAttribute("data-qb-fold") === "question");
  }
  window.addEventListener("click", event => {
    const question = foldedQuestion(event);
    if (!question) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    expandFold(question.getAttribute("data-qb-id"));
  }, true);
  window.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const question = foldedQuestion(event);
    if (!question) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    expandFold(question.getAttribute("data-qb-id"));
  }, true);

  document.body.appendChild(host);
  loadPosition();
  load();
  setInterval(() => { if (location.pathname !== route) load(); }, 1000);
})();
