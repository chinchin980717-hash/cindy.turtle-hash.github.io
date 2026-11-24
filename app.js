const DATA_URL = new URL("./data/questions.json", import.meta.url);
const ROUND_SECONDS = 30;
const MAX_HINTS = 3;
const $ = (id) => document.getElementById(id);
const screens = ["cover-screen", "home-screen", "play-screen", "locked-screen", "reveal-screen", "end-screen", "error-screen"];

const state = {
  questions: [], mode: "solo", players: [], questionIndex: 0,
  playerIndex: 0, answers: [], hintIndex: 0, timer: null,
  seconds: ROUND_SECONDS, startedAt: 0, answering: false
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
function currentQuestion() { return state.questions[state.questionIndex]; }
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

async function loadQuestions() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`題庫 HTTP ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : data.questions;
    state.questions = (list ?? []).filter((q) => q && q.id !== "000" && q.blind_spot_line);
    if (!state.questions.length) throw new Error("沒有可遊玩的題目");
    safeText($("question-count"), `目前題庫：${state.questions.length} 題`);
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
    startGame();
  });
  $("home-link").addEventListener("click", (event) => {
    event.preventDefault();
    showCover();
  });
  document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll(".mode-button").forEach((candidate) => candidate.classList.toggle("selected", candidate === button));
    $("party-setup").hidden = state.mode !== "party";
  }));
  $("player-count").addEventListener("change", renderPlayerNames);
  renderPlayerNames();
  $("start-button").addEventListener("click", startGame);
  $("lock-button").addEventListener("click", () => lockAnswer(false));
  $("skip-button").addEventListener("click", () => { $("answer-input").value = ""; lockAnswer(true); });
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
  clearInterval(state.timer);
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
  if (state.questionIndex >= state.questions.length) { showEnd(); return; }
  const q = currentQuestion();
  state.answers = [];
  state.hintIndex = 0;
  state.playerIndex = 0;
  state.seconds = ROUND_SECONDS;
  safeText($("question-meta"), `${q.id ?? String(state.questionIndex + 1).padStart(3, "0")}　／　${q.category ?? "未分類"}`);
  safeText($("round-progress"), "");
  $("round-progress").style.width = `${((state.questionIndex + 1) / state.questions.length) * 100}%`;
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
function lockAnswer(timedOut) {
  if ($("play-screen").hidden || $("answer-input").disabled) return;
  clearInterval(state.timer);
  const raw = $("answer-input").value.trim();
  const answer = timedOut && !raw ? "（時間到，未作答）" : (raw || "（未作答）");
  const result = scoreAnswer(currentQuestion(), raw);
  state.answers.push({ playerIndex: state.playerIndex, answer, score: result.score, appliedScore: 0, reason: result.reason, hits: result.hits, timedOut: Boolean(timedOut && !raw) });
  $("answer-input").disabled = true;
  $("lock-button").disabled = true;
  $("skip-button").disabled = true;
  $("locked-player").textContent = state.players[state.playerIndex].name;
  $("locked-answer").textContent = answer;
  const hasNext = state.playerIndex + 1 < state.players.length;
  $("locked-quote").hidden = state.mode === "party" && hasNext;
  safeText($("locked-title"), timedOut && !raw ? "時間到，答案已鎖定。" : "答案已鎖定，先別急著翻面。");
  safeText($("locked-copy"), hasNext ? "答案先保留，請把裝置交給下一位玩家。" : "第一直覺已經記下來，現在一起看看大腦補上了什麼。");
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
  safeText($("continue-button"), state.questionIndex === state.questions.length - 1 ? "查看總結 →" : "下一題 →");
}
function nextQuestion() {
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
