const DATA_URL = new URL("./data/questions.json", import.meta.url);
const ROUND_SECONDS = 30;
const MAX_HINTS = 3;
const $ = (id) => document.getElementById(id);
const screens = ["cover-screen", "home-screen", "play-screen", "locked-screen", "reveal-screen", "end-screen", "error-screen"];

const state = {
  questions: [], playlist: [], mode: "solo", players: [], questionIndex: 0,
  playerIndex: 0, answers: [], hintIndex: 0, timer: null,
  seconds: ROUND_SECONDS, startedAt: 0, answering: false,
  online: { peer: null, connection: null, connections: new Map(), role: null, code: "", name: "", ready: false, players: [], answers: new Map(), round: 0, total: 0 }
};

const defaultL3 = "試著比較兩種相反情境：最符合表面直覺的是什麼？若把動機完全反過來，哪個合理情況也符合句中明確事實？";
const aliases = {
  trap: ["trap_keywords", "trapKeywords", "誤導關鍵詞"],
  core: ["core_turn", "coreTurn", "核心轉折點"],
  hints: ["hints", "提示"]
};

function valueOf(question, names, fallback = []) {
  for (const name of names) if (question?.[name] !== undefined) return question[name];
  return fallback;
}
function questionHints(question) {
  const existing = valueOf(question, aliases.hints, []);
  const hints = Array.isArray(existing) ? [...existing] : [];
  const explicit = [question.hint_L1, question.hint_L2, question.hint_L3, question.hintL1, question.hintL2, question.hintL3];
  explicit.forEach((hint, index) => { if (hint) hints[index] = hint; });
  while (hints.length < 3) hints.push(hints.length === 2 ? defaultL3 : "換一個情緒、動機或情境角度，再看一次句子裡明確提供的線索。");
  return hints.slice(0, MAX_HINTS);
}
function currentQuestion() { return state.playlist[state.questionIndex]; }
function showScreen(id) {
  screens.forEach((screen) => { $(screen).hidden = screen !== id; });
  document.body.classList.toggle("cover-mode", id === "cover-screen");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function showCover() {
  clearInterval(state.timer);
  showScreen("cover-screen");
  history.replaceState(null, "", "#cover");
}
function safeText(node, text) { node.textContent = text ?? ""; }
function notify(message) {
  const toast = $("toast");
  safeText(toast, message);
  toast.classList.add("visible");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove("visible"), 2200);
}
function escapeText(value) { return String(value ?? ""); }

function onlineStatus(message) { safeText($("online-status"), message); }
function onlineName() { return $("online-name").value.trim().slice(0, 18) || "玩家"; }
function makeRoomCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function onlinePlayers() {
  const scores = new Map(state.players.map((player) => [player.id, player.score || 0]));
  return [{ id: "host", name: state.online.role === "host" ? state.online.name : "房主", score: scores.get("host") || 0 }, ...[...state.online.connections.values()].map((connection) => ({ id: connection.peer, name: connection.playerName || "玩家", score: scores.get(connection.peer) || 0 }))];
}
function sendOnline(message) {
  if (state.online.role === "host") [...state.online.connections.values()].forEach((connection) => { if (connection.open) connection.send(message); });
  else if (state.online.connection?.open) state.online.connection.send(message);
}
function resetOnline() {
  state.online.connections.forEach((connection) => connection.close());
  state.online.connection?.close();
  state.online.peer?.destroy();
  state.online = { peer: null, connection: null, connections: new Map(), role: null, code: "", name: "", ready: false, players: [], answers: new Map(), round: 0, total: 0 };
}
function setupOnlineHost() {
  if (!window.Peer) { onlineStatus("PeerJS 載入失敗，請改用單人或同裝置模式。"); return; }
  if (state.online.ready && state.online.role === "host") { startOnlineGame(); return; }
  resetOnline();
  state.online.role = "host";
  state.online.name = onlineName();
  state.online.code = makeRoomCode();
  onlineStatus("正在建立房間…");
  const peer = new window.Peer(`bf-${state.online.code.toLowerCase()}`);
  state.online.peer = peer;
  peer.on("open", () => {
    state.online.ready = true;
    $("start-button").textContent = "開始這局 →";
    onlineStatus(`房間已建立，代碼：${state.online.code}。把代碼給朋友，再按「開始這局」。`);
  });
  peer.on("connection", (connection) => {
    connection.on("open", () => {
      connection.playerName = "玩家";
      state.online.connections.set(connection.peer, connection);
      connection.send({ type: "lobby", players: onlinePlayers() });
      onlineStatus(`房間 ${state.online.code} 已連線 ${state.online.connections.size} 位玩家。`);
    });
    connection.on("data", (message) => handleOnlineMessage(message, connection));
    connection.on("close", () => { state.online.connections.delete(connection.peer); onlineStatus(`房間 ${state.online.code}：目前 ${state.online.connections.size} 位玩家連線。`); });
  });
  peer.on("error", (error) => onlineStatus(`房間連線失敗：${error.type || "未知錯誤"}。請重新建立房間。`));
}
function setupOnlineGuest() {
  if (!window.Peer) { onlineStatus("PeerJS 載入失敗，請改用單人或同裝置模式。"); return; }
  const code = $("room-code").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { onlineStatus("請輸入 6 位房間代碼。"); return; }
  resetOnline();
  state.online.role = "guest";
  state.online.name = onlineName();
  state.online.code = code;
  onlineStatus("正在連線房間…");
  const peer = new window.Peer();
  state.online.peer = peer;
  peer.on("open", () => {
    const connection = peer.connect(`bf-${code.toLowerCase()}`, { reliable: true });
    state.online.connection = connection;
    connection.on("open", () => { connection.send({ type: "join", name: state.online.name }); onlineStatus("已連上房間，等待房主開始遊戲…"); });
    connection.on("data", (message) => handleOnlineMessage(message, connection));
    connection.on("close", () => onlineStatus("與房間的連線已中斷。"));
    connection.on("error", () => onlineStatus("加入房間失敗，請確認代碼後重試。"));
  });
  peer.on("error", (error) => onlineStatus(`加入房間失敗：${error.type || "未知錯誤"}。`));
}
function startOnlineGame() {
  buildPlaylist();
  if (!state.playlist.length) { onlineStatus("這個分類目前沒有可玩的題目。"); return; }
  state.online.players = onlinePlayers();
  state.players = state.online.players;
  state.questionIndex = 0;
  state.online.total = state.playlist.length;
  startOnlineRound();
}
function startOnlineRound() {
  if (state.questionIndex >= state.playlist.length) {
    sendOnline({ type: "end" });
    showEnd();
    return;
  }
  state.online.round = state.questionIndex + 1;
  state.online.answers = new Map();
  state.answers = [];
  state.online.players = onlinePlayers();
  state.players = state.online.players;
  const question = state.playlist[state.questionIndex];
  sendOnline({ type: "question", question, round: state.online.round, total: state.online.total, players: state.players });
  showTurn();
}
function handleOnlineJoin(message, connection) {
  connection.playerName = String(message.name || "玩家").slice(0, 18);
  state.online.connections.set(connection.peer, connection);
  state.online.players = onlinePlayers();
  state.players = state.online.players;
  connection.send({ type: "lobby", players: state.players });
  onlineStatus(`房間 ${state.online.code} 已連線 ${state.online.connections.size} 位玩家。`);
}
function recordOnlineAnswer(playerId, raw, timedOut = false, skipped = false) {
  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0 || state.online.answers.has(playerId)) return;
  const result = scoreAnswer(currentQuestion(), raw);
  const answer = skipped ? "（略過本題）" : (timedOut && !raw ? "（時間到，未作答）" : (raw || "（未作答）"));
  state.online.answers.set(playerId, { playerIndex, playerId, answer, score: result.score, appliedScore: 0, reason: skipped ? "本題略過，不列入直覺判定。" : result.reason, hits: result.hits, timedOut: Boolean(timedOut && !raw), skipped });
  state.answers = [...state.online.answers.values()];
}
function maybeEnableOnlineReveal() {
  if (state.online.role !== "host") return;
  const ready = state.players.length > 0 && state.players.every((player) => state.online.answers.has(player.id));
  $("reveal-button").hidden = !ready;
  safeText($("locked-title"), ready ? "所有玩家已作答。" : "等待其他玩家作答…");
  safeText($("locked-copy"), ready ? "房主可以翻面揭曉，看看大家的第一直覺。" : `目前 ${state.online.answers.size} / ${state.players.length} 位玩家已完成。`);
}
function submitOnlineAnswer(timedOut = false, skipped = false) {
  if ($("play-screen").hidden || $("answer-input").disabled) return;
  clearInterval(state.timer);
  const raw = $("answer-input").value.trim();
  const playerId = state.online.role === "host" ? "host" : state.online.peer.id;
  if (state.online.role === "host") {
    recordOnlineAnswer(playerId, raw, timedOut, skipped);
    maybeEnableOnlineReveal();
  } else {
    state.online.connection?.send({ type: "answer", answer: raw, timedOut, skipped });
    safeText($("locked-title"), skipped ? "本題已略過，等待房主揭曉。" : "答案已送出，等待房主揭曉…");
    safeText($("locked-copy"), "房主完成翻面後，大家會一起看到真相與分數。");
  }
  const answer = skipped ? "（略過本題）" : (timedOut && !raw ? "（時間到，未作答）" : (raw || "（未作答）"));
  $("answer-input").disabled = true;
  $("lock-button").disabled = true;
  $("skip-button").disabled = true;
  $("locked-player").textContent = state.online.name;
  $("locked-answer").textContent = answer;
  $("locked-quote").hidden = true;
  $("next-player-button").hidden = true;
  if (state.online.role !== "host") $("reveal-button").hidden = true;
  showScreen("locked-screen");
}
function handleOnlineMessage(message, connection) {
  if (!message?.type) return;
  if (state.online.role === "host" && message.type === "join") { handleOnlineJoin(message, connection); return; }
  if (state.online.role === "host" && message.type === "answer") {
    recordOnlineAnswer(connection.peer, String(message.answer || ""), Boolean(message.timedOut), Boolean(message.skipped));
    maybeEnableOnlineReveal();
    return;
  }
  if (message.type === "lobby") {
    state.online.players = message.players || [];
    onlineStatus(`已連線房間 ${state.online.code}，目前 ${state.online.players.length} 位玩家。等待房主開始…`);
    return;
  }
  if (message.type === "question") {
    state.online.players = message.players || [];
    state.players = state.online.players;
    state.playlist = [message.question];
    state.questionIndex = 0;
    state.online.round = message.round;
    state.online.total = message.total;
    showTurn();
    return;
  }
  if (message.type === "reveal") {
    state.online.players = message.players || state.online.players;
    state.players = state.online.players;
    state.playlist = [message.question];
    state.questionIndex = 0;
    state.answers = message.answers || [];
    renderScores();
    safeText($("full-context"), message.question.full_context);
    safeText($("insight-copy"), message.question.insight);
    safeText($("reveal-meta"), `${message.question.id ?? ""}　／　${message.question.category ?? ""}`);
    safeText($("revealed-context"), message.question.full_context);
    $("continue-button").hidden = true;
    showScreen("reveal-screen");
    return;
  }
  if (message.type === "end") { showEnd(); }
}

async function loadQuestions() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`題庫 HTTP ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : data.questions;
    state.questions = (list ?? []).filter((q) => q && q.id !== "000" && q.blind_spot_line);
    if (!state.questions.length) throw new Error("沒有可遊玩的題目");
    populateCategories();
    updateGameSettingsNote();
    safeText($("footer-question-count"), `${state.questions.length} 題可玩`);
    $("start-button").disabled = false;
    $("enter-game-button").disabled = false;
  } catch (error) {
    console.error("[blindspot] 題庫讀取失敗", error);
    $("start-button").disabled = true;
    $("enter-game-button").disabled = true;
    showScreen("error-screen");
  }
}

function populateCategories() {
  const select = $("category-select");
  const categories = [...new Set(state.questions.map((question) => question.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  select.replaceChildren(new Option("全部分類", "all"));
  categories.forEach((category) => select.add(new Option(category, category)));
}

function updateGameSettingsNote() {
  const category = $("category-select").value;
  const available = state.questions.filter((question) => category === "all" || question.category === category).length;
  const requested = $("round-count").value === "all" ? available : Number($("round-count").value);
  safeText($("question-count"), `可選題目：${available} 題，本局將遊玩 ${Math.min(requested, available)} 題`);
}

function buildPlaylist() {
  const category = $("category-select").value;
  const pool = state.questions.filter((question) => category === "all" || question.category === category);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const requested = $("round-count").value === "all" ? shuffled.length : Number($("round-count").value);
  state.playlist = shuffled.slice(0, Math.min(requested, shuffled.length));
}

function renderPlayerNames() {
  const count = Number($("player-count").value);
  const box = $("player-names");
  box.replaceChildren();
  for (let i = 0; i < count; i += 1) {
    const label = document.createElement("label");
    label.className = "name-field";
    label.innerHTML = `<span>玩家 ${i + 1}</span><input maxlength="18" value="玩家 ${i + 1}" aria-label="玩家 ${i + 1} 名稱">`;
    box.append(label);
  }
}
function configureHome() {
  $("enter-game-button").addEventListener("click", () => {
    showScreen("home-screen");
    history.replaceState(null, "", "#setup");
  });
  $("home-link").addEventListener("click", (event) => {
    event.preventDefault();
    showCover();
  });
  document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll(".mode-button").forEach((candidate) => candidate.classList.toggle("selected", candidate === button));
    $("party-setup").hidden = state.mode !== "party";
    $("online-setup").hidden = state.mode !== "online";
    $("start-button").textContent = state.mode === "online" ? "建立／加入房間 →" : "開始玩 →";
  }));
  $("player-count").addEventListener("change", renderPlayerNames);
  $("round-count").addEventListener("change", updateGameSettingsNote);
  $("category-select").addEventListener("change", updateGameSettingsNote);
  $("online-role").addEventListener("change", () => {
    $("room-code-field").hidden = $("online-role").value !== "guest";
    onlineStatus($("online-role").value === "guest" ? "輸入房主提供的 6 位代碼。" : "建立房間後把代碼分享給朋友。");
    $("start-button").textContent = $("online-role").value === "guest" ? "加入房間 →" : "建立房間 →";
  });
  renderPlayerNames();
  $("start-button").addEventListener("click", startGame);
  $("lock-button").addEventListener("click", () => lockAnswer(false));
  $("skip-button").addEventListener("click", () => { $("answer-input").value = ""; lockAnswer(false, true); });
  $("hint-button").addEventListener("click", unlockHint);
  $("next-player-button").addEventListener("click", nextPlayer);
  $("reveal-button").addEventListener("click", revealQuestion);
  $("continue-button").addEventListener("click", nextQuestion);
  $("restart-button").addEventListener("click", startGame);
  $("answer-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); lockAnswer(false); }
  });
  $("voice-button").addEventListener("click", voiceInput);
}

function startGame() {
  if (state.mode === "online") {
    if ($("online-role").value === "guest") setupOnlineGuest(); else setupOnlineHost();
    return;
  }
  clearInterval(state.timer);
  buildPlaylist();
  if (!state.playlist.length) { notify("這個分類目前沒有可玩的題目。"); return; }
  state.questionIndex = 0;
  state.playerIndex = 0;
  state.answers = [];
  if (state.mode === "party") {
    state.players = [...$("player-names").querySelectorAll("input")].map((input, index) => ({ name: input.value.trim() || `玩家 ${index + 1}`, score: 0 }));
  } else state.players = [{ name: "你", score: 0 }];
  history.replaceState(null, "", "#play");
  showTurn();
}
function showTurn() {
  clearInterval(state.timer);
  if (state.questionIndex >= state.playlist.length) { showEnd(); return; }
  const q = currentQuestion();
  state.answers = [];
  state.hintIndex = 0;
  state.playerIndex = 0;
  state.seconds = ROUND_SECONDS;
  safeText($("question-meta"), `${q.id ?? String(state.questionIndex + 1).padStart(3, "0")}　／　${q.category ?? "未分類"}`);
  safeText($("round-progress"), "");
  const totalRounds = state.mode === "online" ? state.online.total : state.playlist.length;
  const currentRound = state.mode === "online" ? state.online.round : state.questionIndex + 1;
  $("round-progress").style.width = `${(currentRound / totalRounds) * 100}%`;
  safeText($("blind-line"), q.blind_spot_line);
  safeText($("revealed-context"), "準備翻面揭曉…");
  $("blind-card").classList.remove("flipped");
  $("hint-list").replaceChildren();
  safeText($("hint-count"), "0 / 3 已解鎖");
  $("hint-button").disabled = false;
  $("hint-button").textContent = "解鎖提示 L1";
  showScreen("play-screen");
  renderActivePlayer();
}
function renderActivePlayer() {
  const player = state.players[state.playerIndex];
  safeText($("active-player"), state.mode === "party" ? `輪到 ${player.name}` : "你的第一直覺");
  safeText($("turn-status"), state.mode === "party" ? `玩家 ${state.playerIndex + 1} / ${state.players.length}` : "單人模式");
  $("answer-input").value = "";
  $("answer-input").disabled = false;
  $("lock-button").disabled = false;
  $("skip-button").disabled = false;
  $("voice-status").textContent = "";
  startTimer();
  $("answer-input").focus({ preventScroll: true });
}
function startTimer() {
  clearInterval(state.timer);
  state.seconds = ROUND_SECONDS;
  state.startedAt = Date.now();
  renderTimer();
  state.timer = setInterval(() => {
    state.seconds = Math.max(0, ROUND_SECONDS - (Date.now() - state.startedAt) / 1000);
    renderTimer();
    if (state.seconds <= 0) lockAnswer(true);
  }, 100);
}
function renderTimer() {
  const whole = Math.ceil(state.seconds);
  safeText($("timer-value"), String(whole).padStart(2, "0"));
  $("timer-bar").style.width = `${(state.seconds / ROUND_SECONDS) * 100}%`;
  $("timer-bar").classList.toggle("urgent", state.seconds <= 3);
}
function unlockHint() {
  if (state.hintIndex >= MAX_HINTS) return;
  const hints = questionHints(currentQuestion());
  const level = state.hintIndex + 1;
  const item = document.createElement("p");
  item.className = "hint-item";
  item.innerHTML = `<b>L${level}</b><span></span>`;
  item.querySelector("span").textContent = hints[state.hintIndex];
  $("hint-list").append(item);
  state.hintIndex += 1;
  safeText($("hint-count"), `${state.hintIndex} / 3 已解鎖`);
  if (state.hintIndex >= MAX_HINTS) {
    $("hint-button").disabled = true;
    $("hint-button").textContent = "提示已全部解鎖";
  } else $("hint-button").textContent = `解鎖提示 L${state.hintIndex + 1}`;
}
function lockAnswer(timedOut, skipped = false) {
  if (state.mode === "online") { submitOnlineAnswer(timedOut, skipped); return; }
  if ($("play-screen").hidden || $("answer-input").disabled) return;
  clearInterval(state.timer);
  const raw = $("answer-input").value.trim();
  const answer = skipped ? "（略過本題）" : (timedOut && !raw ? "（時間到，未作答）" : (raw || "（未作答）"));
  const result = scoreAnswer(currentQuestion(), raw);
  const reason = skipped ? "本題略過，不列入直覺判定。" : result.reason;
  state.answers.push({ playerIndex: state.playerIndex, answer, score: result.score, appliedScore: 0, reason, hits: result.hits, timedOut: Boolean(timedOut && !raw), skipped });
  $("answer-input").disabled = true;
  $("lock-button").disabled = true;
  $("skip-button").disabled = true;
  $("locked-player").textContent = state.players[state.playerIndex].name;
  $("locked-answer").textContent = answer;
  const hasNext = state.playerIndex + 1 < state.players.length;
  $("locked-quote").hidden = state.mode === "party" && hasNext;
  safeText($("locked-title"), skipped ? "本題已略過。" : (timedOut && !raw ? "時間到，答案已鎖定。" : "答案已鎖定，先別急著翻面。"));
  safeText($("locked-copy"), skipped ? "這題不計入直覺判定，準備繼續下一題。" : (hasNext ? "答案先保留，請把裝置交給下一位玩家。" : "第一直覺已經記下來，現在一起看看大腦補上了什麼。"));
  safeText($("locked-next-note"), hasNext ? "下一位玩家有自己的 30 秒；前面鎖定的答案會暫時隱藏。" : `${state.players.length} 位玩家都已鎖定答案。`);
  $("next-player-button").hidden = !hasNext;
  $("reveal-button").hidden = hasNext;
  showScreen("locked-screen");
}
function nextPlayer() {
  state.playerIndex += 1;
  showScreen("play-screen");
  renderActivePlayer();
}
function normalise(text) { return String(text ?? "").toLocaleLowerCase().replace(/[\s，。！？、,.!?；;：:「」『』（）()【】\[\]"'\-]/g, ""); }
function scoreAnswer(question, answer) {
  const normalized = normalise(answer);
  if (!normalized) return { score: 0, reason: "沒有留下答案。", hits: [] };
  const traps = valueOf(question, aliases.trap, []);
  const core = valueOf(question, aliases.core, []);
  const trapHits = (Array.isArray(traps) ? traps : []).filter((word) => word && normalized.includes(normalise(word)));
  const coreHits = (Array.isArray(core) ? core : []).filter((word) => word && normalized.includes(normalise(word)));
  if (trapHits.length) return { score: 0, reason: "你剛剛掉進了「預設劇本」陷阱！可在揭曉後調整判分。", hits: trapHits };
  if (coreHits.length) return { score: 2, reason: "看穿了盲點，抓到改變情境的核心線索。", hits: coreHits };
  return { score: 1, reason: "避開已知誤導方向；這是輔助判分，請依答案是否合理替代解釋調整。", hits: [] };
}
function revealQuestion() {
  if (state.mode === "online") {
    if (state.online.role !== "host") { notify("請等待房主翻面揭曉。"); return; }
    if (state.online.answers.size < state.players.length) { notify("還有玩家尚未作答。"); return; }
    state.answers = [...state.online.answers.values()];
    const q = currentQuestion();
    renderScores();
    sendOnline({ type: "reveal", question: q, players: state.players, answers: state.answers });
    return;
  }
  const q = currentQuestion();
  safeText($("full-context"), q.full_context);
  safeText($("insight-copy"), q.insight);
  safeText($("reveal-meta"), `${q.id ?? ""}　／　${q.category ?? ""}`);
  safeText($("revealed-context"), q.full_context);
  $("blind-card").classList.add("flipped");
  renderScores();
  showScreen("reveal-screen");
  $("reveal-screen").classList.remove("reveal-in");
  requestAnimationFrame(() => $("reveal-screen").classList.add("reveal-in"));
}
function renderScores() {
  const box = $("score-results");
  box.replaceChildren();
  state.answers.forEach((result) => {
    const player = state.players[result.playerIndex];
    const row = document.createElement("article");
    row.className = "score-row";
    row.innerHTML = `<div class="score-row-main"><span class="score-name"></span><span class="score-guess"></span><span class="score-feedback"></span></div><div class="score-controls" role="group" aria-label="調整分數"></div>`;
    row.querySelector(".score-name").textContent = player.name;
    row.querySelector(".score-guess").textContent = result.answer;
    row.querySelector(".score-feedback").textContent = result.reason;
    const controls = row.querySelector(".score-controls");
    [0, 1, 2].forEach((score) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `score-button ${score === result.score ? "active" : ""}`;
      button.setAttribute("aria-label", `${player.name} 設為 ${score} 分`);
      button.textContent = `${score} 分`;
      button.addEventListener("click", () => {
        const previous = result.score;
        result.score = score;
        player.score += score - previous;
        result.appliedScore = score;
        renderScores();
      });
      controls.append(button);
    });
    if (result.hits.length) {
      const tag = document.createElement("span");
      tag.className = "keyword-tag";
      tag.textContent = `命中：${result.hits.join("、")}`;
      row.querySelector(".score-row-main").append(tag);
    }
    box.append(row);
  });
  state.answers.forEach((result) => {
    const player = state.players[result.playerIndex];
    player.score += result.score - result.appliedScore;
    result.appliedScore = result.score;
  });
  safeText($("continue-button"), state.questionIndex === state.playlist.length - 1 ? "查看總結 →" : "下一題 →");
  if (state.mode === "online") $("continue-button").hidden = state.online.role !== "host";
}
function nextQuestion() {
  if (state.mode === "online") {
    if (state.online.role !== "host") { notify("請等待房主進入下一題。"); return; }
    $("continue-button").hidden = false;
    state.questionIndex += 1;
    startOnlineRound();
    return;
  }
  state.questionIndex += 1;
  showTurn();
}
function showEnd() {
  clearInterval(state.timer);
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  safeText($("final-summary"), state.mode === "party" ? `${top.name} 目前領先，總分 ${top.score} 分。別忘了：這場測驗測的是第一直覺，不是誰比較聰明。` : `你的總分是 ${top.score} 分。記住，第一直覺不是答案，而是大腦寫好的第一個故事。`);
  const box = $("final-scores");
  box.replaceChildren();
  sorted.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "final-score-row";
    row.innerHTML = `<span class="rank"></span><span class="final-player"></span><b class="final-points"></b>`;
    row.querySelector(".rank").textContent = String(index + 1).padStart(2, "0");
    row.querySelector(".final-player").textContent = player.name;
    row.querySelector(".final-points").textContent = `${player.score} 分`;
    box.append(row);
  });
  showScreen("end-screen");
}
function voiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { safeText($("voice-status"), "此瀏覽器不支援語音辨識，請直接輸入答案。"); return; }
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-TW";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  $("voice-button").disabled = true;
  safeText($("voice-status"), "正在聆聽…說出第一直覺即可。");
  recognition.onresult = (event) => {
    $("answer-input").value = event.results[0][0].transcript;
    safeText($("voice-status"), `已辨識：「${event.results[0][0].transcript}」`);
    $("answer-input").focus();
  };
  recognition.onerror = (event) => safeText($("voice-status"), `語音辨識未完成（${event.error}），可改用文字輸入。`);
  recognition.onend = () => { $("voice-button").disabled = false; };
  recognition.start();
}

configureHome();
$("start-button").disabled = true;
showScreen("cover-screen");
loadQuestions();
