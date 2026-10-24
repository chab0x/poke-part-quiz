// 地方・図鑑番号データ定義
const REGION_DEFINITIONS = [
    { id: "kanto", name: "カントー", min: 1, max: 151 },
    { id: "johto", name: "ジョウト", min: 152, max: 251 },
    { id: "hoenn", name: "ホウエン", min: 252, max: 386 },
    { id: "sinnoh", name: "シンオウ", min: 387, max: 493 },
    { id: "unova", name: "イッシュ", min: 494, max: 649 },
    { id: "kalos", name: "カロス", min: 650, max: 721 },
    { id: "alola", name: "アローラ", min: 722, max: 809 },
    { id: "galar", name: "ガラル", min: 810, max: 898 },
    { id: "hisui", name: "ヒスイ", min: 899, max: 905 },
    { id: "paldea", name: "パルデア", min: 906, max: 1025 },
];

// 日本語タイプ表記マップ
const TYPE_NAMES_JA = {
    all: "すべてのタイプ",
    normal: "ノーマル",
    fire: "ほのお",
    water: "みず",
    grass: "くさ",
    electric: "でんき",
    ice: "こおり",
    fighting: "かくとう",
    poison: "どく",
    ground: "じめん",
    flying: "ひこう",
    psychic: "エスパー",
    bug: "むし",
    rock: "いわ",
    ghost: "ゴースト",
    dragon: "ドラゴン",
    dark: "あく",
    steel: "はがね",
    fairy: "フェアリー",
};

// --- 表記揺れ正規化関数 ---
function normalizePokemonName(str) {
    if (!str) return "";

    return (
        str
            .trim()
            // 1. ひらがなをカタカナに変換（ぴかちゅう -> ピカチュウ）
            .replace(/[\u3041-\u3096]/g, (match) =>
                String.fromCharCode(match.charCodeAt(0) + 0x60),
            )
            // 2. 全角英数字を半角に変換（ポリゴン２ -> ポリゴン2）
            .normalize("NFKC")
            // 3. 英字を大文字に統一
            .toUpperCase()
            // 4. 各種「オスの表記」を全角の「♂」に寄せる
            .replace(/(おす|オス|男|\(♂\)|\(おす\)|\(オス\)|_M|-M|\sM|M)$/i, "♂")
            // 5. 各種「メスの表記」を全角の「♀」に寄せる
            .replace(/(めす|メス|女|\(♀\)|\(めす\)|\(メス\)|_F|-F|\sF|F)$/i, "♀")
            // 6. 途中のスペースや記号（：や・など）を削除
            .replace(/[\s ・：:\-ー_]/g, "")
    );
}

// --- グローバル状態 ---
let currentCorrectPokemon = null;
let selectedAnswerName = null;
let lastCorrectId = null;

// 設定状態
let gameRule = "challenge";
let answerType = "choice";
let filterSummaryLabel = "";

// デッキ・スコア管理
let availableDeck = [];
let challengeQueue = [];
let totalChallengeCount = 0;
let currentScore = 0;
let streakCount = 0;

let revealTimers = [];
const pokemonCache = {};
const typePokemonCache = {};

// 音量管理
let savedVolume = 0.4;
let isMuted = false;

const soundFiles = {
    start: new Audio("sounds/start.mp3"),
    fanfare: new Audio("sounds/fanfare.mp3"),
    select: new Audio("sounds/select.mp3"),
};

const soundRatios = { start: 1.0, fanfare: 1.0, select: 0.6 };

// Web Audio API による効果音合成（フォールバック）
let audioCtx = null;
function playSynthSound(type) {
    if (isMuted || savedVolume === 0) return;
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === "suspended") {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;
        const gain = audioCtx.createGain();
        gain.gain.value = savedVolume * 0.2;
        gain.connect(audioCtx.destination);

        if (type === "select") {
            const osc = audioCtx.createOscillator();
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
            osc.connect(gain);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (type === "fanfare") {
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            osc1.type = "sine";
            osc2.type = "sine";
            osc1.frequency.setValueAtTime(659.25, now);
            osc1.frequency.setValueAtTime(880.0, now + 0.12);
            osc1.connect(gain);
            osc2.connect(gain);
            osc1.start(now);
            osc1.stop(now + 0.35);
        } else if (type === "start") {
            const osc = audioCtx.createOscillator();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
            osc.connect(gain);
            osc.start(now);
            osc.stop(now + 0.15);
        }
    } catch (e) {
        console.log("Synth sound error:", e);
    }
}

applyVolume();

function applyVolume() {
    const actualVolume = isMuted ? 0 : savedVolume;
    Object.keys(soundFiles).forEach((key) => {
        soundFiles[key].volume = Math.min(1, actualVolume * soundRatios[key]);
    });
}

function updateVolume(val) {
    savedVolume = parseFloat(val);
    isMuted = savedVolume === 0;
    document.getElementById("audio-icon").textContent = isMuted ? "🔇" : "🔊";
    applyVolume();
}

function toggleMute() {
    isMuted = !isMuted;
    const slider = document.getElementById("volume-slider");
    document.getElementById("audio-icon").textContent = isMuted ? "🔇" : "🔊";
    if (!isMuted && savedVolume === 0) savedVolume = 0.4;
    slider.value = isMuted ? 0 : savedVolume;
    applyVolume();
}

function playSound(audioObject, type = "select") {
    if (isMuted || savedVolume === 0) return;
    Object.values(soundFiles).forEach((sound) => {
        sound.pause();
        sound.currentTime = 0;
    });
    audioObject.play().catch(() => {
        playSynthSound(type);
    });
}

function clearRevealTimers() {
    revealTimers.forEach((timerId) => clearTimeout(timerId));
    revealTimers = [];
}

// --- 地方全選択・全解除 ---
function selectAllRegions(check) {
    document.querySelectorAll(".region-cb").forEach((cb) => {
        cb.checked = check;
    });
}

// --- ゲーム進行ロジック ---
async function startGame() {
    const startBtn = document.getElementById("start-btn");
    const errorEl = document.getElementById("start-error");
    errorEl.classList.add("hidden");
    startBtn.disabled = true;
    startBtn.textContent = "データ準備中...";

    gameRule = document.getElementById("game-rule-select").value;
    answerType = document.getElementById("answer-type-select").value;

    const selectedRegionCbs = Array.from(
        document.querySelectorAll(".region-cb:checked"),
    );
    const selectedType = document.getElementById("type-select").value;

    try {
        if (selectedRegionCbs.length === 0) {
            throw new Error("地方を少なくとも1つ選択してください。");
        }

        const selectedRegionIds = selectedRegionCbs.map((cb) => cb.value);

        // 出題可能なポケモンIDリストをフィルタリング生成
        availableDeck = await getMultiFilteredPokemonIds(
            selectedRegionIds,
            selectedType,
        );

        if (availableDeck.length === 0) {
            throw new Error(
                "選択した条件（地方・タイプ）に該当するポケモンが見つかりませんでした。条件を変更してください。",
            );
        }

        if (
            answerType === "choice" &&
            availableDeck.length < 4 &&
            gameRule !== "speed"
        ) {
            throw new Error(
                `条件に合うポケモンが${availableDeck.length}体しかいないため、4択クイズを作成できません。絞り込みを緩めてください。`,
            );
        }

        // フィルタ概要ラベルの構築（リザルト画面・SNSシェア用）
        let regNames = selectedRegionCbs.map((cb) => {
            const reg = REGION_DEFINITIONS.find((r) => r.id === cb.value);
            return reg ? reg.name : "";
        });

        let regStr = regNames.length === 9 ? "全地方" : regNames.join("・");
        filterSummaryLabel = `【${regStr} × ${TYPE_NAMES_JA[selectedType]}】`;

        // 初期化
        currentScore = 0;
        streakCount = 0;
        if (gameRule === "challenge") {
            challengeQueue = [...availableDeck];
            for (let i = challengeQueue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [challengeQueue[i], challengeQueue[j]] = [
                    challengeQueue[j],
                    challengeQueue[i],
                ];
            }
            totalChallengeCount = challengeQueue.length;
        }

        document.getElementById("start-screen").classList.add("hidden");
        document.getElementById("result-screen").classList.add("hidden");
        document.getElementById("quiz-screen").classList.remove("hidden");

        loadQuestion();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove("hidden");
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = "スタート！";
    }
}

function toTitle() {
    clearRevealTimers();
    Object.values(soundFiles).forEach((sound) => {
        sound.pause();
        sound.currentTime = 0;
    });
    document.getElementById("quiz-screen").classList.add("hidden");
    document.getElementById("result-screen").classList.add("hidden");
    document.getElementById("start-screen").classList.remove("hidden");
}

async function loadQuestion() {
    clearRevealTimers();
    selectedAnswerName = null;

    const modeLabel = document.getElementById("mode-label");
    const scoreBadge = document.getElementById("score-badge");

    if (gameRule === "challenge") {
        modeLabel.textContent = "全問制覇";
        // 現在何問目かを計算（全問題数 - 残り問題数 + 1）
        const currentQuestionNum =
            totalChallengeCount - challengeQueue.length + 1;
        scoreBadge.textContent = `${currentQuestionNum}問目／${totalChallengeCount}問中${currentScore}問正解`;
    } else if (gameRule === "endless") {
        modeLabel.textContent = "エンドレス";
        scoreBadge.textContent = `${streakCount} 問連続正解中！🔥`;
    } else {
        modeLabel.textContent = "スピード";
        scoreBadge.textContent = "--";
    }

    document.getElementById("pokemon-name-display").textContent = "だ〜れだ？";
    document.getElementById("submit-btn").disabled = true;
    document.getElementById("next-controls").classList.add("hidden");
    document.getElementById("sub-buttons").classList.remove("hidden");

    const canvas = document.getElementById("quiz-canvas");
    const fullImg = document.getElementById("full-image");

    canvas.style.transition = "none";
    fullImg.style.transition = "none";
    canvas.classList.remove("show", "hidden");
    fullImg.classList.remove("show");
    fullImg.classList.add("hidden");

    void canvas.offsetWidth;

    const isNoEffect = isMuted || savedVolume === 0;
    canvas.style.transition = isNoEffect ? "none" : "";
    fullImg.style.transition = isNoEffect ? "none" : "";

    const optionsContainer = document.getElementById("options-container");
    const textContainer = document.getElementById("text-input-container");
    const speedContainer = document.getElementById("speed-container");
    const answerInput = document.getElementById("answer-input");

    optionsContainer.classList.add("hidden");
    textContainer.classList.add("hidden");
    speedContainer.classList.add("hidden");

    if (gameRule === "speed") {
        speedContainer.classList.remove("hidden");
        document.getElementById("submit-btn").classList.add("hidden");
        document.getElementById("giveup-btn").classList.add("hidden");
    } else if (answerType === "choice") {
        optionsContainer.classList.remove("hidden");
        document.getElementById("submit-btn").classList.remove("hidden");
        document.getElementById("giveup-btn").classList.remove("hidden");
        optionsContainer.innerHTML = "";
    } else if (answerType === "text") {
        textContainer.classList.remove("hidden");
        document.getElementById("submit-btn").classList.remove("hidden");
        document.getElementById("giveup-btn").classList.remove("hidden");
        answerInput.value = "";
        answerInput.disabled = false;
    }

    const cropRatio = parseFloat(
        document.getElementById("difficulty-select").value,
    );

    let correctId = null;
    if (gameRule === "challenge") {
        correctId = challengeQueue[challengeQueue.length - 1];
    } else {
        do {
            correctId =
                availableDeck[Math.floor(Math.random() * availableDeck.length)];
        } while (correctId === lastCorrectId && availableDeck.length > 1);
    }
    lastCorrectId = correctId;

    let choiceIds = [correctId];
    if (gameRule !== "speed" && answerType === "choice") {
        const pool =
            availableDeck.length >= 4
                ? availableDeck
                : Array.from({ length: 1025 }, (_, i) => i + 1);
        while (choiceIds.length < 4) {
            const randId = pool[Math.floor(Math.random() * pool.length)];
            if (!choiceIds.includes(randId)) choiceIds.push(randId);
        }
        for (let i = choiceIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [choiceIds[i], choiceIds[j]] = [choiceIds[j], choiceIds[i]];
        }
    }

    const pokemonList = await Promise.all(
        choiceIds.map((id) => getPokemonData(id)),
    );
    currentCorrectPokemon = pokemonList.find((p) => p.id === correctId);

    fullImg.src = currentCorrectPokemon.imgUrl;
    await drawCroppedImage(currentCorrectPokemon.imgUrl, cropRatio);

    playSound(soundFiles.start, "start");
    setTimeout(() => {
        canvas.classList.add("show");
    }, 50);

    if (gameRule !== "speed" && answerType === "choice") {
        pokemonList.forEach((pokemon, index) => {
            const btn = document.createElement("button");
            btn.className = "option-btn";
            btn.textContent = `${index + 1}. ${pokemon.name}`;
            btn.onclick = () => selectOption(btn, pokemon.name);
            optionsContainer.appendChild(btn);
        });
    } else if (gameRule !== "speed" && answerType === "text") {
        answerInput.focus();
    }
}

function selectOption(selectedBtn, name) {
    document
        .querySelectorAll(".option-btn")
        .forEach((btn) => btn.classList.remove("selected"));
    selectedBtn.classList.add("selected");
    selectedAnswerName = name;
    document.getElementById("submit-btn").disabled = false;
}

function checkTextInput() {
    const val = document.getElementById("answer-input").value.trim();
    selectedAnswerName = val;
    document.getElementById("submit-btn").disabled = val === "";
}

function handleKeyPress(event) {
    if (
        event.key === "Enter" &&
        !document.getElementById("submit-btn").disabled
    ) {
        checkUserAnswer();
    }
}

window.addEventListener("keydown", (e) => {
    const quizScreen = document.getElementById("quiz-screen");
    if (quizScreen.classList.contains("hidden")) return;

    if (answerType === "choice" && gameRule !== "speed") {
        const keyNum = parseInt(e.key, 10);
        if (keyNum >= 1 && keyNum <= 4) {
            const btns = document.querySelectorAll(".option-btn");
            if (btns[keyNum - 1] && !btns[keyNum - 1].disabled) {
                btns[keyNum - 1].click();
            }
        }
    }

    if (e.key === "Enter") {
        const submitBtn = document.getElementById("submit-btn");
        const nextBtn = document.getElementById("next-btn");
        const nextControls = document.getElementById("next-controls");

        if (!nextControls.classList.contains("hidden")) {
            nextBtn.click();
        } else if (
            !submitBtn.classList.contains("hidden") &&
            !submitBtn.disabled
        ) {
            checkUserAnswer();
        }
    }
});

function skipQuestion() {
    loadQuestion();
}

function checkUserAnswer() {
    if (!selectedAnswerName) return;

    // 表記揺れ対策：両方を正規化してから比較
    const inputNorm = normalizePokemonName(selectedAnswerName);
    const targetNorm = normalizePokemonName(currentCorrectPokemon.name);

    const isCorrect = inputNorm === targetNorm;
    processAnswer(isCorrect, false);
}

function processAnswer(isCorrect, isGiveup = false) {
    playSound(soundFiles.fanfare, "fanfare");

    let resultText = "";
    if (gameRule === "speed") {
        resultText = `正解は ${currentCorrectPokemon.name}！`;
    } else if (isGiveup) {
        resultText = `正解は ${currentCorrectPokemon.name} でした！`;
    } else if (isCorrect) {
        resultText = `⭕️ 正解！ ${currentCorrectPokemon.name}`;
    } else {
        resultText = `❌ 残念... 正解は ${currentCorrectPokemon.name}`;
    }

    document.getElementById("pokemon-name-display").textContent = resultText;

    if (gameRule === "speed") {
        document.getElementById("speed-container").classList.add("hidden");
    } else {
        if (answerType === "choice") {
            document
                .querySelectorAll(".option-btn")
                .forEach((btn) => (btn.disabled = true));
        } else if (answerType === "text") {
            document.getElementById("answer-input").disabled = true;
        }
        document.getElementById("submit-btn").classList.add("hidden");
    }

    document.getElementById("sub-buttons").classList.add("hidden");
    revealFullImage();

    const nextBtn = document.getElementById("next-btn");

    if (gameRule === "challenge") {
        challengeQueue.pop();
        if (isCorrect) currentScore++;

        if (challengeQueue.length === 0) {
            nextBtn.textContent = "結果を見る";
            nextBtn.onclick = () => showFinalResult(true);
        } else {
            nextBtn.textContent = "次の問題へ";
            nextBtn.onclick = () => loadQuestion();
        }
    } else if (gameRule === "endless") {
        if (isCorrect && !isGiveup) {
            streakCount++;
            nextBtn.textContent = "次の問題へ";
            nextBtn.onclick = () => loadQuestion();
        } else {
            nextBtn.textContent = "結果を見る";
            nextBtn.onclick = () => showFinalResult(false);
        }
    } else {
        nextBtn.textContent = "次の問題へ";
        nextBtn.onclick = () => loadQuestion();
    }
}

function revealFullImage() {
    clearRevealTimers();
    const canvas = document.getElementById("quiz-canvas");
    const fullImg = document.getElementById("full-image");
    const isNoEffect = isMuted || savedVolume === 0;

    canvas.style.transition = isNoEffect ? "none" : "";
    fullImg.style.transition = isNoEffect ? "none" : "";
    fullImg.classList.remove("hidden");

    const timer1 = setTimeout(() => {
        fullImg.classList.add("show");
        canvas.classList.remove("show");
    }, 50);

    const timer2 = setTimeout(
        () => {
            canvas.classList.add("hidden");
        },
        isNoEffect ? 0 : 5000,
    );

    revealTimers.push(timer1, timer2);
    document.getElementById("next-controls").classList.remove("hidden");
}

function showFinalResult(isChallengeComplete) {
    document.getElementById("quiz-screen").classList.add("hidden");
    document.getElementById("result-screen").classList.remove("hidden");

    const condEl = document.getElementById("result-condition");
    const statusEl = document.getElementById("result-status");
    const scoreEl = document.getElementById("result-score");

    condEl.textContent = filterSummaryLabel;

    if (gameRule === "challenge") {
        if (currentScore === totalChallengeCount) {
            statusEl.textContent = "🎉 ALL CLEAR!（全問正解）";
        } else {
            statusEl.textContent = "チャレンジ終了！";
        }
        scoreEl.textContent = `${currentScore} / ${totalChallengeCount} 問正解`;
    } else if (gameRule === "endless") {
        statusEl.textContent = "ゲームオーバー！";
        scoreEl.textContent = `連続正解数: ${streakCount}問`;
    }
}

function shareResult(platform = "x") {
    let text = `パーツで当てる！ポケモンクイズ\n${filterSummaryLabel}\n`;

    if (gameRule === "challenge") {
        text += `結果: ${currentScore} / ${totalChallengeCount} 問正解！\n`;
        if (currentScore === totalChallengeCount)
            text += `🎉 全問正解達成！\n`;
    } else if (gameRule === "endless") {
        text += `記録: ${streakCount}問 連続正解！🔥\n`;
    }

    const pageUrl = window.location.href;

    if (platform === "bsky") {
        // Blueskyはtext内にURLも含めて指定します
        const fullText = `${text}#ポケモンパーツクイズ\n${pageUrl}`;
        const shareUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(fullText)}`;
        window.open(shareUrl, "_blank");
    } else {
        // X (旧Twitter) 用
        text += `#ポケモンパーツクイズ\n`;
        const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;
        window.open(shareUrl, "_blank");
    }
}

// --- 複合フィルタリング（地方複数 × タイプ） ---
async function getMultiFilteredPokemonIds(regionIds, type) {
    // 1. 選択された地方のID範囲の和集合を取得
    let filteredIds = [];
    regionIds.forEach((regId) => {
        const reg = REGION_DEFINITIONS.find((r) => r.id === regId);
        if (reg) {
            for (let i = reg.min; i <= reg.max; i++) {
                filteredIds.push(i);
            }
        }
    });

    // 2. タイプ指定がある場合の絞り込み
    if (type !== "all") {
        if (!typePokemonCache[type]) {
            const res = await fetch(`https://pokeapi.co/api/v2/type/${type}`);
            const data = await res.json();
            typePokemonCache[type] = data.pokemon
                .map((p) => {
                    const parts = p.pokemon.url.split("/").filter(Boolean);
                    return parseInt(parts[parts.length - 1], 10);
                })
                .filter((id) => id <= 1025);
        }
        const typeSet = new Set(typePokemonCache[type]);
        filteredIds = filteredIds.filter((id) => typeSet.has(id));
    }

    return filteredIds;
}

async function getPokemonData(id) {
    if (pokemonCache[id]) return pokemonCache[id];
    const [speciesRes, pokemonRes] = await Promise.all([
        fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}/`),
        fetch(`https://pokeapi.co/api/v2/pokemon/${id}/`),
    ]);
    const speciesData = await speciesRes.json();
    const pokemonData = await pokemonRes.json();

    const jaName = speciesData.names.find(
        (n) => n.language.name === "ja-Hrkt" || n.language.name === "ja",
    ).name;
    const genusObj = speciesData.genera.find(
        (g) => g.language.name === "ja-Hrkt" || g.language.name === "ja",
    );
    const genus = genusObj ? genusObj.genus : "ポケモン";
    const types = pokemonData.types.map((t) => t.type.name);

    const imgUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
    const fullData = { id, name: jaName, genus, types, imgUrl };
    pokemonCache[id] = fullData;
    return fullData;
}

function drawCroppedImage(imgUrl, cropRatio) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imgUrl;

        img.onload = () => {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext("2d");
            tempCtx.drawImage(img, 0, 0);

            const imgData = tempCtx.getImageData(
                0,
                0,
                img.width,
                img.height,
            ).data;
            const opaquePixels = [];

            for (let y = 0; y < img.height; y += 2) {
                for (let x = 0; x < img.width; x += 2) {
                    if (imgData[(y * img.width + x) * 4 + 3] > 50) {
                        opaquePixels.push({ x, y });
                    }
                }
            }

            if (opaquePixels.length === 0) {
                resolve();
                return;
            }

            const cropSize = img.width * cropRatio;
            let bestSx = 0,
                bestSy = 0;
            let maxOpaqueCount = -1;

            for (let attempt = 0; attempt < 25; attempt++) {
                const randomPixel =
                    opaquePixels[
                        Math.floor(Math.random() * opaquePixels.length)
                    ];
                const sx = Math.max(
                    0,
                    Math.min(
                        img.width - cropSize,
                        randomPixel.x - cropSize / 2,
                    ),
                );
                const sy = Math.max(
                    0,
                    Math.min(
                        img.height - cropSize,
                        randomPixel.y - cropSize / 2,
                    ),
                );

                let count = 0;
                const step = Math.max(1, Math.floor(cropSize / 15));
                for (let cy = sy; cy < sy + cropSize; cy += step) {
                    for (let cx = sx; cx < sx + cropSize; cx += step) {
                        const idx =
                            (Math.floor(cy) * img.width + Math.floor(cx)) * 4 +
                            3;
                        if (imgData[idx] > 50) count++;
                    }
                }

                if (count > maxOpaqueCount) {
                    maxOpaqueCount = count;
                    bestSx = sx;
                    bestSy = sy;
                }
                if (
                    count >
                    (cropSize / step) * (cropSize / step) * 0.35
                )
                    break;
            }

            const canvas = document.getElementById("quiz-canvas");
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(
                img,
                bestSx,
                bestSy,
                cropSize,
                cropSize,
                0,
                0,
                canvas.width,
                canvas.height,
            );
            resolve();
        };
    });
}

// --- モード選択時の回答方法プルダウン制御 ---
function updateInputMethodDisabledState() {
    const ruleSelect = document.getElementById("game-rule-select");
    const inputMethodSelect = document.getElementById("answer-type-select");

    // 要素が存在する場合のみ処理を実行
    if (ruleSelect && inputMethodSelect) {
        if (ruleSelect.value === "speed") {
            inputMethodSelect.disabled = true;
        } else {
            inputMethodSelect.disabled = false;
        }
    }
}

// ページの読み込み完了時にイベントリスナーを登録し、初期状態を反映
window.addEventListener("DOMContentLoaded", () => {
    const ruleSelect = document.getElementById("game-rule-select");
    if (ruleSelect) {
        ruleSelect.addEventListener("change", updateInputMethodDisabledState);
        updateInputMethodDisabledState(); // 読み込み時の初期状態をセット
    }
});
