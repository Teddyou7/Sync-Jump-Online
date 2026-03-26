// ============================================================
//  Sync Jump Online - 游戏客户端 v2
//  蓄力跳跃 + 弹性Verlet绳子物理
// ============================================================

// ===================== 物理常量 =====================
const GRAVITY = 1400;
const PLAYER_W = 30;
const PLAYER_H = 48;
const DEATH_Y = 2000;

// 蓄力跳跃
const MAX_CHARGE_TIME = 1.2;
const MIN_JUMP_VY = 380;
const MAX_JUMP_VY = 720;
const MIN_JUMP_VX = 80;
const MAX_JUMP_VX = 400;
const GROUND_FRICTION = 0.60;

// 绳子物理
const MAX_ROPE = 200;
const ROPE_REST = 133;
const ROPE_SEGMENTS = 16;
const ROPE_GRAVITY = 900;
const ROPE_STIFFNESS = 6;
const ROPE_HARD_STIFFNESS = 30;

// ===================== 状态 =====================
let canvas, ctx;
let gameMode = null;
let gameState = "menu";
let players = [];
let platforms = [];
let cameraX = 0;
let cameraY = 0;
let score = 0;
let difficulty = 1.0;
let startTime = 0;
let countdownValue = 0;
let shakeTimer = 0;
let tickCount = 0;

// 蓄力
let chargeA = { active: false, startTime: 0, power: 0 };
let chargeB = { active: false, startTime: 0, power: 0 };
let myCharge = { active: false, startTime: 0, power: 0 };

// Verlet绳子
let ropePoints = [];

// 输入追踪
let activePointers = {};
let keysHeld = {};

// 在线
let socket = null;
let myRole = null;
let roomId = null;
let prevPlayers = [];

// 背景
let clouds = [];
let mountains = [];
let bgStars = [];

// ===================== 初始化 =====================
window.addEventListener("load", () => {
    canvas = document.getElementById("gameCanvas");
    ctx = canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    initBackground();
    bindInput();
    fetchOnlineCount();
    setInterval(fetchOnlineCount, 5000);
    requestAnimationFrame(gameLoop);
});

async function fetchOnlineCount() {
    if (socket && socket.readyState === WebSocket.OPEN) return; // let WS handle it if connected
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        const counter = document.getElementById("onlineCountText");
        if (counter) counter.innerText = data.online_players;
    } catch (e) { }
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function initBackground() {
    clouds = [];
    for (let i = 0; i < 8; i++)
        clouds.push({ x: Math.random() * 2000, y: 40 + Math.random() * 150, r: 25 + Math.random() * 40, speed: 5 + Math.random() * 10 });
    mountains = [];
    for (let i = 0; i < 14; i++)
        mountains.push({ x: i * 200 + Math.random() * 100, h: 60 + Math.random() * 120, w: 150 + Math.random() * 150 });
    bgStars = [];
    for (let i = 0; i < 60; i++)
        bgStars.push({ x: Math.random() * 3000, y: Math.random() * 300, r: 0.5 + Math.random() * 1.5, blink: Math.random() * Math.PI * 2 });
}

// ===================== 菜单 =====================
function startLocal() {
    gameMode = "local";
    document.getElementById("menu").style.display = "none";
    document.getElementById("game-ui").style.display = "block";
    document.querySelector(".split-hint").style.display = "block";
    initLocalGame();
}

function startOnline(roomCode) {
    gameMode = "online";
    document.getElementById("menu").style.display = "none";
    showStatus("正在连接服务器...");
    // 带有 _private_ 前缀标识给服务器创建私人房
    connectWS(roomCode || "auto");
}

function createPrivateRoom() {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    startOnline("private_" + code);
}

function joinRoom() {
    const input = document.getElementById("roomInput");
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) { input.style.borderColor = "#E74C3C"; return; }
    startOnline("private_" + code);
}

function backToMenu() {
    gameState = "menu";
    if (socket) { socket.close(); socket = null; }
    document.getElementById("menu").style.display = "flex";
    document.getElementById("game-ui").style.display = "none";
    document.getElementById("status-overlay").style.display = "none";
    document.querySelector(".split-hint").style.display = "none";
}

function showStatus(msg, code) {
    const overlay = document.getElementById("status-overlay");
    overlay.style.display = "flex";
    document.getElementById("status-text").textContent = msg;
    const codeEl = document.getElementById("room-code-display");
    if (code) { codeEl.textContent = code; codeEl.style.display = "block"; }
    else { codeEl.style.display = "none"; }
}

function hideStatus() {
    document.getElementById("status-overlay").style.display = "none";
}

// ===================== 地图生成器 =====================
class LocalMapGenerator {
    constructor() {
        this.platforms = [];
        this.frontierX = 0;
        this.lastY = 480;
    }

    generateInitial() {
        this.platforms = [{ x: -50, y: 500, width: 350, height: 20, type: "static" }];
        this.frontierX = 300;
        this.lastY = 500;
        this.generateUpTo(1600, 1.0);
        return this.platforms;
    }

    generateUpTo(targetX, diff) {
        while (this.frontierX < targetX) {
            const gap = Math.min(60 + Math.random() * (60 + diff * 20), 280);
            const heightDiff = -70 + Math.random() * 100;
            let ny = this.lastY + heightDiff;
            ny = Math.max(260, Math.min(540, ny));
            let w = 90 + Math.random() * (130 - diff * 6);
            w = Math.max(70, w);
            let ptype = "static";
            const r = Math.random();
            if (r < 0.06 * diff) ptype = "bounce";
            else if (r < 0.11 * diff) ptype = "collapse";
            else if (r < 0.16 * diff) ptype = "moving";
            const plat = { x: this.frontierX + gap, y: ny, width: w, height: 20, type: ptype };
            if (ptype === "moving") {
                plat.moveRange = 50 + Math.random() * 50;
                plat.moveSpeed = 0.5 + Math.random() * 0.5;
                plat.baseX = plat.x;
            }
            this.platforms.push(plat);
            this.frontierX = plat.x + plat.width;
            this.lastY = ny;
        }
        return this.platforms;
    }

    removeBehind(cx) {
        this.platforms = this.platforms.filter(p => p.x + p.width > cx - 400);
    }
}

// ===================== 本地初始化 =====================
let localMapGen = null;

function initLocalGame() {
    localMapGen = new LocalMapGenerator();
    platforms = localMapGen.generateInitial();
    players = [
        { id: "A", role: "A", x: 80, y: platforms[0].y - PLAYER_H, vx: 0, vy: 0, grounded: true },
        { id: "B", role: "B", x: 180, y: platforms[0].y - PLAYER_H, vx: 0, vy: 0, grounded: true },
    ];
    cameraX = 0; cameraY = 0; score = 0; difficulty = 1.0;
    gameState = "playing"; startTime = performance.now();
    shakeTimer = 0; tickCount = 0;
    chargeA = { active: false, startTime: 0, power: 0 };
    chargeB = { active: false, startTime: 0, power: 0 };
    initRopePoints(players[0], players[1]);
}

// ===================== Verlet 绳子 =====================
function initRopePoints(a, b) {
    ropePoints = [];
    const ax = a.x + PLAYER_W / 2, ay = a.y + PLAYER_H * 0.35;
    const bx = b.x + PLAYER_W / 2, by = b.y + PLAYER_H * 0.35;
    for (let i = 0; i < ROPE_SEGMENTS; i++) {
        const t = i / (ROPE_SEGMENTS - 1);
        const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        ropePoints.push({ x: px, y: py, oldX: px, oldY: py });
    }
}

function updateVerletRope(dt, a, b) {
    const N = ROPE_SEGMENTS;
    const segLen = MAX_ROPE / (N - 1);
    const ax = a.x + PLAYER_W / 2, ay = a.y + PLAYER_H * 0.35;
    const bx = b.x + PLAYER_W / 2, by = b.y + PLAYER_H * 0.35;

    // Verlet积分
    for (let i = 1; i < N - 1; i++) {
        const p = ropePoints[i];
        const vx = (p.x - p.oldX) * 0.98;
        const vy = (p.y - p.oldY) * 0.98;
        p.oldX = p.x; p.oldY = p.y;
        p.x += vx;
        p.y += vy + ROPE_GRAVITY * dt * dt;
    }

    // 锁端点
    ropePoints[0].x = ax; ropePoints[0].y = ay;
    ropePoints[0].oldX = ax; ropePoints[0].oldY = ay;
    ropePoints[N - 1].x = bx; ropePoints[N - 1].y = by;
    ropePoints[N - 1].oldX = bx; ropePoints[N - 1].oldY = by;

    // 约束求解
    for (let iter = 0; iter < 10; iter++) {
        ropePoints[0].x = ax; ropePoints[0].y = ay;
        ropePoints[N - 1].x = bx; ropePoints[N - 1].y = by;
        for (let i = 0; i < N - 1; i++) {
            const p1 = ropePoints[i], p2 = ropePoints[i + 1];
            const ddx = p2.x - p1.x, ddy = p2.y - p1.y;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dist > segLen && dist > 0.001) {
                const correction = (dist - segLen) / dist * 0.5;
                const ox = ddx * correction, oy = ddy * correction;
                const pin1 = (i === 0), pin2 = (i === N - 2);
                if (pin1 && !pin2) { p2.x -= ox * 2; p2.y -= oy * 2; }
                else if (!pin1 && pin2) { p1.x += ox * 2; p1.y += oy * 2; }
                else if (!pin1 && !pin2) { p1.x += ox; p1.y += oy; p2.x -= ox; p2.y -= oy; }
            }
        }
    }
}

// ===================== 弹性绳子力 + 硬约束 =====================
function applyElasticRope(a, b, dt) {
    const ax = a.x + PLAYER_W / 2, ay = a.y + PLAYER_H / 2;
    const bx = b.x + PLAYER_W / 2, by = b.y + PLAYER_H / 2;
    const dx = bx - ax, dy = by - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;
    const nx = dx / dist, ny = dy / dist;

    // 弹性力（软弹簧）
    if (dist > ROPE_REST) {
        const stretch = dist - ROPE_REST;
        let forceMag = stretch * ROPE_STIFFNESS;
        if (dist > MAX_ROPE) forceMag += (dist - MAX_ROPE) * ROPE_HARD_STIFFNESS;
        if (!a.grounded) {
            a.vx += nx * forceMag * dt;
            a.vy += ny * forceMag * dt;
        }
        if (!b.grounded) {
            b.vx -= nx * forceMag * dt;
            b.vy -= ny * forceMag * dt;
        }
    }

    // 硬约束：绳子不可能超过最大长度
    if (dist > MAX_ROPE) {
        const excess = dist - MAX_ROPE;
        // 如果一人站稳，只拉另一人
        if (a.grounded && !b.grounded) {
            b.x -= nx * excess;
            b.y -= ny * excess;
            const bVelAlongRope = b.vx * (-nx) + b.vy * (-ny);
            if (bVelAlongRope < 0) { b.vx -= (-nx) * bVelAlongRope; b.vy -= (-ny) * bVelAlongRope; }
        } else if (b.grounded && !a.grounded) {
            a.x += nx * excess;
            a.y += ny * excess;
            const aVelAlongRope = a.vx * nx + a.vy * ny;
            if (aVelAlongRope < 0) { a.vx -= nx * aVelAlongRope; a.vy -= ny * aVelAlongRope; }
        } else {
            a.x += nx * excess * 0.5;
            a.y += ny * excess * 0.5;
            b.x -= nx * excess * 0.5;
            b.y -= ny * excess * 0.5;
            // 消除沿绳方向的远离速度
            const aVelAlongRope = a.vx * nx + a.vy * ny;
            if (aVelAlongRope < 0) { a.vx -= nx * aVelAlongRope; a.vy -= ny * aVelAlongRope; }
            const bVelAlongRope = b.vx * (-nx) + b.vy * (-ny);
            if (bVelAlongRope < 0) { b.vx -= (-nx) * bVelAlongRope; b.vy -= (-ny) * bVelAlongRope; }
        }
    }
}

// ===================== 蓄力系统 =====================
function startCharge(role) {
    if (gameState !== "playing") return;
    if (gameMode === "local") {
        const player = players.find(p => p.role === role);
        if (!player || !player.grounded) return;
        const charge = (role === "A") ? chargeA : chargeB;
        if (!charge.active) { charge.active = true; charge.startTime = performance.now(); charge.power = 0; }
    } else if (gameMode === "online") {
        const player = players.find(p => p.role === myRole);
        if (!player || !player.grounded) return;
        if (!myCharge.active) { 
            myCharge.active = true; 
            myCharge.startTime = performance.now(); 
            myCharge.power = 0; 
            sendInput("start_charge");
        }
    }
}

function releaseCharge(role) {
    if (gameState !== "playing") return;
    if (gameMode === "local") {
        const charge = (role === "A") ? chargeA : chargeB;
        if (!charge.active) return;
        const player = players.find(p => p.role === role);
        if (player && player.grounded) applyChargeJump(player, charge.power);
        charge.active = false; charge.power = 0;
    } else if (gameMode === "online") {
        if (!myCharge.active) return;
        sendInput("jump", myCharge.power);
        myCharge.active = false; myCharge.power = 0;
    }
}

function updateCharges() {
    const now = performance.now();
    if (gameMode === "local") {
        [chargeA, chargeB].forEach((charge, i) => {
            if (charge.active) {
                if (!players[i].grounded) { charge.active = false; charge.power = 0; return; }
                charge.power = Math.min(1, (now - charge.startTime) / (MAX_CHARGE_TIME * 1000));
            }
        });
    } else {
        if (myCharge.active) {
            const player = players.find(p => p.role === myRole);
            if (!player || !player.grounded) {
                myCharge.active = false;
                myCharge.power = 0;
            } else {
                myCharge.power = Math.min(1, (now - myCharge.startTime) / (MAX_CHARGE_TIME * 1000));
            }
        }
    }
}

function applyChargeJump(player, power) {
    power = Math.max(0.05, power);
    const jumpVy = -(MIN_JUMP_VY + (MAX_JUMP_VY - MIN_JUMP_VY) * power);
    player.vy = jumpVy;
    player.vx = MIN_JUMP_VX + (MAX_JUMP_VX - MIN_JUMP_VX) * power;
    player.grounded = false;

    // 拖拽挂在下方的玩家 (本地模式)
    const other = players.find(p => p !== player);
    if (other && !other.grounded) {
        const dx = other.x - player.x;
        const dy = other.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (other.y > player.y + 20 && dist > ROPE_REST * 0.8) {
            other.vy = jumpVy * 0.9;
        }
    }
}

// ===================== 本地更新 =====================
function updateLocal(dt) {
    tickCount++;
    const elapsed = (performance.now() - startTime) / 1000;
    difficulty = 1.0 + elapsed / 90;
    updateCharges();

    // 平台更新
    const toRemove = [];
    for (const plat of platforms) {
        if (plat.collapsing) {
            plat.collapseTimer = (plat.collapseTimer || 300) - 1;
            if (plat.collapseTimer <= 0) toRemove.push(plat);
        }
        if (plat.type === "moving" && plat.baseX !== undefined) {
            const prevX = plat.x;
            plat.x = plat.baseX + Math.sin(tickCount * 0.04 * (plat.moveSpeed || 1)) * (plat.moveRange || 40);
            const dx = plat.x - prevX;
            for (let i = 0; i < 2; i++) {
                const p = players[i];
                if (p.grounded && plat.x <= p.x && p.x <= plat.x + plat.width && Math.abs((p.y + PLAYER_H) - plat.y) <= 5) {
                    p.x += dx;
                }
            }
        }
    }
    for (const r of toRemove) { const idx = platforms.indexOf(r); if (idx >= 0) platforms.splice(idx, 1); }

    // 玩家更新
    for (const p of players) {
        if (p.grounded) { p.vx *= Math.pow(GROUND_FRICTION, dt * 60); if (Math.abs(p.vx) < 1) p.vx = 0; }
        if (!p.grounded) p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.grounded = false;
        for (const plat of platforms) { if (collidePlatform(p, plat, dt)) break; }
    }

    // 先应用绳子力，再判定死亡（绳子能救回队友）
    applyElasticRope(players[0], players[1], dt);
    updateVerletRope(dt, players[0], players[1]);

    // 死亡检测：只有两人都在自由落体且都掉到平台下方很远才算死
    const anyGrounded = players.some(p => p.grounded);
    if (!anyGrounded) {
        let lowestPlatY = 0;
        for (const plat of platforms) { if (plat.y > lowestPlatY) lowestPlatY = plat.y; }
        const deathLine = lowestPlatY + 1200;
        const allDead = players.every(p => p.y > deathLine);
        if (allDead) { gameState = "gameover"; shakeTimer = 0.5; return; }
    }

    score = Math.floor(Math.max(players[0].x, players[1].x) / 10);
    const furthest = Math.max(players[0].x, players[1].x) + canvas.width + 300;
    localMapGen.generateUpTo(furthest, difficulty);
    localMapGen.removeBehind(cameraX);
    platforms = localMapGen.platforms;
}

function collidePlatform(player, plat, dt) {
    const pRight = player.x + PLAYER_W, pBottom = player.y + PLAYER_H;
    if (pRight <= plat.x || player.x >= plat.x + plat.width) return false;
    const prevBottom = pBottom - player.vy * dt;
    if (prevBottom <= plat.y + 5 && pBottom >= plat.y && player.vy >= 0) {
        player.y = plat.y - PLAYER_H;
        player.vy = 0;
        player.grounded = true;
        if (plat.type === "bounce") { player.vy = -MAX_JUMP_VY * 1.3; player.grounded = false; }
        if (plat.type === "collapse" && !plat.collapsing) { plat.collapsing = true; plat.collapseTimer = 300; }
        return true;
    }
    return false;
}

// ===================== 在线部分 =====================
function connectWS(roomCode) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "join", room: roomCode }));
    socket.onmessage = (e) => handleServerMsg(JSON.parse(e.data));
    socket.onclose = () => { if (gameState !== "menu") { showStatus("连接已断开"); setTimeout(backToMenu, 2000); } };
    socket.onerror = () => { showStatus("连接失败"); setTimeout(backToMenu, 2000); };
}

function handleServerMsg(data) {
    switch (data.type) {
        case "joined": myRole = data.role; roomId = data.room_id; break;
        case "waiting":
            let displayCode = roomId;
            if (roomId.startsWith("private_")) {
                displayCode = roomId.replace("private_", "");
            }
            showStatus(roomId.startsWith("private_") ? "等待好友加入..." : "等待对手加入...", displayCode);
            gameState = "waiting";
            break;
        case "countdown":
            hideStatus(); document.getElementById("game-ui").style.display = "block";
            gameState = "countdown"; countdownValue = data.count; break;
        case "start":
            gameState = "playing"; startTime = performance.now();
            myCharge = { active: false, startTime: 0, power: 0 };
            if (data.players) {
                players = data.players;
                if (players.length === 2) initRopePoints(players[0], players[1]);
            }
            break;
        case "state":
            prevPlayers = players.map(p => ({ ...p }));
            players = data.players; platforms = data.platforms;
            score = data.score;
            if (players.length === 2) {
                if (ropePoints.length === 0) initRopePoints(players[0], players[1]);
                updateVerletRope(1 / 30, players[0], players[1]);
            }
            // 更新蓄力进度（联机模式下从本地计时）
            updateCharges();
            break;
        case "gameover":
            players = data.players; platforms = data.platforms;
            score = data.score;
            gameState = "gameover"; shakeTimer = 0.5; break;
        case "player_left": showStatus("对手已离开"); setTimeout(backToMenu, 2000); break;
        case "online_count":
            const counter = document.getElementById("onlineCountText");
            if (counter) counter.innerText = data.count;
            break;
    }
}

function sendInput(action, charge) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const msg = { type: "input", action };
        if (charge !== undefined) msg.charge = Math.round(charge * 100) / 100;
        socket.send(JSON.stringify(msg));
    }
}

function sendRestart() {
    if (socket && socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "restart" }));
}

// ===================== 输入 =====================
function bindInput() {
    canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (gameState === "gameover") {
            const W = canvas.width, H = canvas.height;
            if (e.clientX > W / 2 - 60 && e.clientX < W / 2 + 60 && e.clientY > H / 2 + 90 && e.clientY < H / 2 + 126) {
                backToMenu(); return;
            }
            restartGame(); return;
        }
        if (gameState !== "playing") return;
        if (gameMode === "local") {
            const side = e.clientX < canvas.width / 2 ? "A" : "B";
            activePointers[e.pointerId] = side;
            startCharge(side);
        } else {
            activePointers[e.pointerId] = myRole;
            startCharge(myRole);
        }
    });

    canvas.addEventListener("pointerup", (e) => {
        const side = activePointers[e.pointerId];
        if (side) {
            if (gameMode === "local") releaseCharge(side); else releaseCharge(myRole);
            delete activePointers[e.pointerId];
        }
    });

    canvas.addEventListener("pointercancel", (e) => {
        const side = activePointers[e.pointerId];
        if (side) {
            if (gameMode === "local") releaseCharge(side); else releaseCharge(myRole);
            delete activePointers[e.pointerId];
        }
    });

    canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

    document.addEventListener("keydown", (e) => {
        if (gameState === "gameover" && (e.key === "r" || e.key === "R")) { restartGame(); return; }
        if (gameState !== "playing") return;
        if (keysHeld[e.key]) return;
        keysHeld[e.key] = true;
        if (gameMode === "local") {
            if (e.key === "a" || e.key === "A" || e.key === "ArrowLeft") startCharge("A");
            if (e.key === "d" || e.key === "D" || e.key === "ArrowRight") startCharge("B");
        } else {
            if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") startCharge(myRole);
        }
    });

    document.addEventListener("keyup", (e) => {
        keysHeld[e.key] = false;
        if (gameState !== "playing") return;
        if (gameMode === "local") {
            if (e.key === "a" || e.key === "A" || e.key === "ArrowLeft") releaseCharge("A");
            if (e.key === "d" || e.key === "D" || e.key === "ArrowRight") releaseCharge("B");
        } else {
            if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") releaseCharge(myRole);
        }
    });
}

function restartGame() {
    if (gameMode === "local") initLocalGame(); else sendRestart();
}

// ===================== 主循环 =====================
let lastTime = 0;

function gameLoop(timestamp) {
    const dt = Math.min((timestamp - (lastTime || timestamp)) / 1000, 0.05);
    lastTime = timestamp;
    
    if ((gameState === "playing" || gameState === "gameover") && players.length === 2) {
        updateCamera();
    }
    
    if (gameMode === "local" && gameState === "playing") updateLocal(dt);
    if (shakeTimer > 0) shakeTimer -= dt;
    render(dt);
    requestAnimationFrame(gameLoop);
}

function updateCamera() {
    const avgX = (players[0].x + players[1].x) / 2;
    const avgY = (players[0].y + players[1].y) / 2;
    
    // 竖屏响应式适配：如果是竖屏，留给“前方（右侧）”的视野要更多
    const isPortrait = canvas.width < canvas.height;
    const targetOffsetX = isPortrait ? canvas.width * 0.25 : canvas.width / 3;
    const targetOffsetY = isPortrait ? canvas.height * 0.65 : canvas.height * 0.55;
    
    cameraX += (avgX - targetOffsetX - cameraX) * 0.08;
    cameraY += (Math.min(0, avgY - targetOffsetY) - cameraY) * 0.06;
}

// ===================== 渲染 =====================
function render(dt) {
    const W = canvas.width, H = canvas.height;
    ctx.save();

    if (shakeTimer > 0) {
        const i = shakeTimer * 18;
        ctx.translate((Math.random() - 0.5) * i, (Math.random() - 0.5) * i);
    }

    drawBackground(W, H);
    if (gameState === "menu") { ctx.restore(); return; }

    ctx.save();
    ctx.translate(-cameraX, -cameraY);

    for (const plat of platforms) drawPlatform(plat);
    if (ropePoints.length > 0) drawVerletRope();
    for (const p of players) drawCharacter(p);

    // 蓄力条
    if (gameMode === "local") {
        if (chargeA.active) {
            const pA = players.find(p => p.role === "A");
            if (pA) drawChargeBar(pA.x + PLAYER_W / 2, pA.y - 30, chargeA.power);
        }
        if (chargeB.active) {
            const pB = players.find(p => p.role === "B");
            if (pB) drawChargeBar(pB.x + PLAYER_W / 2, pB.y - 30, chargeB.power);
        }
    } else if (gameMode === "online") {
        for (const p of players) {
            let pPower = 0;
            let pActive = false;
            if (p.role === myRole && myCharge.active) {
                pActive = true;
                pPower = myCharge.power;
            } else if (p.charging) {
                pActive = true;
                pPower = p.charge_power;
            }
            if (pActive) drawChargeBar(p.x + PLAYER_W / 2, p.y - 30, pPower);
        }
    }

    ctx.restore();
    drawUI(W, H);
    if (gameState === "countdown") drawCountdown(W, H);
    if (gameState === "gameover") drawGameOver(W, H);
    ctx.restore();
}

// ===================== 背景 =====================
function drawBackground(W, H) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, "#1a1a3e"); skyGrad.addColorStop(0.4, "#2d2d6b");
    skyGrad.addColorStop(0.7, "#4a3f8a"); skyGrad.addColorStop(1, "#1e1e3a");
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);

    const time = performance.now() * 0.001;
    for (const s of bgStars) {
        const sx = ((s.x - cameraX * 0.015) % (W + 100) + W + 100) % (W + 100);
        ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.4 * Math.sin(time * 2 + s.blink)})`;
        ctx.beginPath(); ctx.arc(sx, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = "#1a1a4a";
    for (const m of mountains) {
        const mx = ((m.x - cameraX * 0.08) % (W + 400) + W + 400) % (W + 400) - 150;
        ctx.beginPath(); ctx.moveTo(mx, H); ctx.lineTo(mx + m.w / 2, H - m.h); ctx.lineTo(mx + m.w, H);
        ctx.closePath(); ctx.fill();
    }

    ctx.globalAlpha = 0.25;
    for (const c of clouds) {
        const cx = ((c.x - cameraX * 0.04 + time * c.speed * 0.3) % (W + 200) + W + 200) % (W + 200) - 50;
        ctx.fillStyle = "#ffffff"; ctx.beginPath();
        ctx.arc(cx, c.y, c.r, 0, Math.PI * 2);
        ctx.arc(cx + c.r * 0.7, c.y - c.r * 0.2, c.r * 0.7, 0, Math.PI * 2);
        ctx.arc(cx - c.r * 0.5, c.y + c.r * 0.1, c.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// ===================== 平台 =====================
function drawPlatform(plat) {
    const { x, y, width, height, type } = plat;
    const r = 6;
    ctx.save();

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    roundRect(ctx, x + 3, y + 4, width, height, r); ctx.fill();

    let c1, c2;
    switch (type) {
        case "bounce": c1 = "#FFD700"; c2 = "#FFA500"; break;
        case "collapse": c1 = plat.collapsing ? "#8B4513" : "#A0522D"; c2 = plat.collapsing ? "#654321" : "#8B4513"; break;
        case "moving": c1 = "#00BCD4"; c2 = "#0097A7"; break;
        default: c1 = "#4CAF50"; c2 = "#388E3C";
    }

    const grad = ctx.createLinearGradient(x, y, x, y + height);
    grad.addColorStop(0, c1); grad.addColorStop(1, c2);
    ctx.fillStyle = grad; roundRect(ctx, x, y, width, height, r); ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.25)";
    roundRect(ctx, x + 2, y, width - 4, height / 3, r); ctx.fill();

    if (type === "bounce") {
        ctx.strokeStyle = "#CC8400"; ctx.lineWidth = 2;
        const cx = x + width / 2; ctx.beginPath();
        for (let i = 0; i < 3; i++) {
            const bx = cx - 8 + i * 8;
            ctx.moveTo(bx, y + 4); ctx.lineTo(bx + 4, y + height - 4); ctx.lineTo(bx + 8, y + 4);
        }
        ctx.stroke();
    }

    if (type === "collapse" && plat.collapsing) {
        ctx.strokeStyle = "#3E2723"; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(x + width * 0.3, y); ctx.lineTo(x + width * 0.4, y + height * 0.6); ctx.lineTo(x + width * 0.5, y + height);
        ctx.moveTo(x + width * 0.6, y); ctx.lineTo(x + width * 0.7, y + height); ctx.stroke();
    }

    if (type === "moving") {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        const ax = x + width / 2, ay = y + height / 2;
        ctx.beginPath();
        // left arrow
        ctx.moveTo(ax - 8, ay); ctx.lineTo(ax - 2, ay - 4); ctx.lineTo(ax - 2, ay + 4);
        // right arrow
        ctx.moveTo(ax + 8, ay); ctx.lineTo(ax + 2, ay - 4); ctx.lineTo(ax + 2, ay + 4);
        ctx.closePath(); ctx.fill();
    }

    if (type === "static") {
        ctx.fillStyle = "#66BB6A";
        for (let gx = x + 5; gx < x + width - 5; gx += 12) {
            ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + 2, y - 4); ctx.lineTo(gx + 4, y); ctx.fill();
        }
    }

    ctx.restore();
}

// ===================== Verlet 绳子渲染 =====================
function drawVerletRope() {
    if (ropePoints.length < 2) return;
    const N = ropePoints.length;

    const endDist = Math.sqrt(
        (ropePoints[N - 1].x - ropePoints[0].x) ** 2 + (ropePoints[N - 1].y - ropePoints[0].y) ** 2
    );
    const tension = Math.min(1, Math.max(0, (endDist - ROPE_REST) / (MAX_ROPE - ROPE_REST)));

    const rV = Math.floor(139 + tension * 116);
    const gV = Math.floor(115 - tension * 90);
    const bV = Math.floor(85 - tension * 60);
    const ropeColor = `rgb(${rV},${gV},${bV})`;

    ctx.save();

    // 阴影
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 5;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(ropePoints[0].x + 2, ropePoints[0].y + 3);
    for (let i = 1; i < N; i++) ctx.lineTo(ropePoints[i].x + 2, ropePoints[i].y + 3);
    ctx.stroke();

    // 主线（贝塞尔平滑）
    ctx.strokeStyle = ropeColor; ctx.lineWidth = tension > 0.8 ? 4 : 3;
    ctx.beginPath(); ctx.moveTo(ropePoints[0].x, ropePoints[0].y);
    for (let i = 1; i < N - 1; i++) {
        const xc = (ropePoints[i].x + ropePoints[i + 1].x) / 2;
        const yc = (ropePoints[i].y + ropePoints[i + 1].y) / 2;
        ctx.quadraticCurveTo(ropePoints[i].x, ropePoints[i].y, xc, yc);
    }
    ctx.lineTo(ropePoints[N - 1].x, ropePoints[N - 1].y);
    ctx.stroke();

    // 高光
    ctx.strokeStyle = `rgba(${rV + 40},${gV + 30},${bV + 20},0.4)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ropePoints[0].x - 1, ropePoints[0].y - 1);
    for (let i = 1; i < N - 1; i++) {
        const xc = (ropePoints[i].x + ropePoints[i + 1].x) / 2;
        const yc = (ropePoints[i].y + ropePoints[i + 1].y) / 2;
        ctx.quadraticCurveTo(ropePoints[i].x - 1, ropePoints[i].y - 1, xc - 1, yc - 1);
    }
    ctx.lineTo(ropePoints[N - 1].x - 1, ropePoints[N - 1].y - 1);
    ctx.stroke();

    // 绳结
    for (let i = 2; i < N - 2; i += 3) {
        ctx.fillStyle = ropeColor;
        ctx.beginPath(); ctx.arc(ropePoints[i].x, ropePoints[i].y, tension > 0.7 ? 3 : 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // 紧张脉冲
    if (tension > 0.8) {
        ctx.strokeStyle = `rgba(255,50,50,${0.2 + Math.sin(performance.now() * 0.012) * 0.25})`;
        ctx.lineWidth = 7; ctx.beginPath();
        ctx.moveTo(ropePoints[0].x, ropePoints[0].y);
        for (let i = 1; i < N; i++) ctx.lineTo(ropePoints[i].x, ropePoints[i].y);
        ctx.stroke();
    }

    ctx.restore();
}

// ===================== 蓄力条 =====================
function drawChargeBar(cx, cy, power) {
    const barW = 44, barH = 7;
    const x = cx - barW / 2, y = cy;
    ctx.save();

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(ctx, x - 2, y - 2, barW + 4, barH + 4, 5); ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1;
    roundRect(ctx, x - 2, y - 2, barW + 4, barH + 4, 5); ctx.stroke();

    const fillW = barW * power;
    if (fillW > 0) {
        const grad = ctx.createLinearGradient(x, y, x + barW, y);
        grad.addColorStop(0, "#2ECC71"); grad.addColorStop(0.5, "#F1C40F"); grad.addColorStop(1, "#E74C3C");
        ctx.fillStyle = grad; roundRect(ctx, x, y, fillW, barH, 3); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        roundRect(ctx, x, y, fillW, barH / 2, 3); ctx.fill();
    }

    if (power > 0.95) {
        ctx.fillStyle = `rgba(255,215,0,${0.3 + Math.sin(performance.now() * 0.02) * 0.3})`;
        roundRect(ctx, x - 3, y - 3, barW + 6, barH + 6, 6); ctx.fill();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
        const mx = x + (barW * i) / 4;
        ctx.beginPath(); ctx.moveTo(mx, y + 1); ctx.lineTo(mx, y + barH - 1); ctx.stroke();
    }

    ctx.restore();
}

// ===================== 角色 =====================
function drawCharacter(p) {
    const isA = p.role === "A";
    const time = performance.now() * 0.003;
    const jumpSquash = p.grounded ? 0 : Math.min(1, Math.abs(p.vy || 0) / 500);
    const charge = isA ? chargeA : chargeB;
    let isCharging, chargePower;
    if (gameMode === "local") {
        isCharging = charge.active;
        chargePower = isCharging ? charge.power : 0;
    } else {
        // 联机模式：使用服务器下发的蓄力状态，如果是自己且正在蓄力则使用本地高精度蓄力值以消除延迟感
        isCharging = p.charging;
        if (p.role === myRole && myCharge.active) {
            isCharging = true;
            chargePower = myCharge.power;
        } else {
            chargePower = isCharging ? p.charge_power : 0;
        }
    }
    const cx = p.x + PLAYER_W / 2, cy = p.y + PLAYER_H / 2;

    ctx.save();
    ctx.translate(cx, cy);

    let scaleX, scaleY;
    if (isCharging) { scaleX = 1 + chargePower * 0.15; scaleY = 1 - chargePower * 0.15; }
    else { scaleX = 1 - jumpSquash * 0.15; scaleY = 1 + jumpSquash * 0.15; }
    ctx.scale(scaleX, scaleY);

    const breathe = p.grounded && !isCharging ? Math.sin(time * 2) * 1.5 : 0;
    const bodyColor = isA ? "#4A90D9" : "#E74C3C";
    const bodyDark = isA ? "#357ABD" : "#C0392B";
    const hatColor = isA ? "#2C5F98" : "#962D22";
    const shoeColor = isA ? "#2C5F98" : "#7B241C";
    const skinColor = "#FDDCB5";
    const cheekColor = isA ? "rgba(74,144,217,0.3)" : "rgba(231,76,60,0.3)";

    // 蓄力粒子
    if (isCharging && chargePower > 0.3) {
        const pc = Math.floor(chargePower * 6);
        for (let i = 0; i < pc; i++) {
            const angle = time * 5 + (i / pc) * Math.PI * 2;
            const radius = 20 + chargePower * 10;
            ctx.fillStyle = isA ? `rgba(74,144,217,${chargePower * 0.5})` : `rgba(231,76,60,${chargePower * 0.5})`;
            ctx.beginPath(); ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6 + 5, 2 + chargePower * 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // 阴影
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath(); ctx.ellipse(0, PLAYER_H / 2 + 2, 14, 4, 0, 0, Math.PI * 2); ctx.fill();

    // 腿
    const legSwing = p.grounded && !isCharging ? Math.sin(time * 4) * 3 : (isCharging ? -3 : 8);
    ctx.fillStyle = bodyDark;
    roundRect(ctx, -9, 12 + breathe, 7, 14 + legSwing * 0.5, 3); ctx.fill();
    roundRect(ctx, 2, 12 + breathe, 7, 14 - legSwing * 0.5, 3); ctx.fill();

    // 鞋
    ctx.fillStyle = shoeColor;
    roundRect(ctx, -11, 24 + breathe + legSwing * 0.3, 10, 5, 2); ctx.fill();
    roundRect(ctx, 1, 24 + breathe - legSwing * 0.3, 10, 5, 2); ctx.fill();

    // 身体
    const bodyGrad = ctx.createLinearGradient(0, -8, 0, 14);
    bodyGrad.addColorStop(0, bodyColor); bodyGrad.addColorStop(1, bodyDark);
    ctx.fillStyle = bodyGrad;
    roundRect(ctx, -12, -8 + breathe, 24, 22, 6); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    roundRect(ctx, -9, -6 + breathe, 10, 8, 3); ctx.fill();

    // 手臂
    const armAngle = isCharging ? 0.5 + chargePower * 0.5 : (p.grounded ? Math.sin(time * 3) * 0.15 : -0.8);
    ctx.fillStyle = bodyColor;
    ctx.save(); ctx.translate(-12, -2 + breathe); ctx.rotate(armAngle);
    roundRect(ctx, -8, -3, 9, 6, 3); ctx.fill();
    ctx.fillStyle = skinColor; ctx.beginPath(); ctx.arc(-7, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save(); ctx.fillStyle = bodyColor; ctx.translate(12, -2 + breathe); ctx.rotate(-armAngle);
    roundRect(ctx, -1, -3, 9, 6, 3); ctx.fill();
    ctx.fillStyle = skinColor; ctx.beginPath(); ctx.arc(7, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 头
    const headY = -18 + breathe;
    ctx.fillStyle = skinColor; ctx.beginPath(); ctx.arc(0, headY, 12, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = cheekColor;
    ctx.beginPath(); ctx.ellipse(-8, headY + 3, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, headY + 3, 4, 3, 0, 0, Math.PI * 2); ctx.fill();

    const blinking = ((time * 0.3) % 4) > 3.85;
    if (blinking) {
        ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-6, headY); ctx.lineTo(-2, headY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(2, headY); ctx.lineTo(6, headY); ctx.stroke();
    } else {
        ctx.fillStyle = "white";
        ctx.beginPath(); ctx.ellipse(-4, headY - 1, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(4, headY - 1, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        const lookX = Math.sign(p.vx || 0) * 1.2;
        const lookY = (p.vy || 0) > 150 ? 1.5 : (p.vy || 0) < -150 ? -1 : 0;
        ctx.fillStyle = "#333";
        ctx.beginPath(); ctx.arc(-4 + lookX, headY - 1 + lookY, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(4 + lookX, headY - 1 + lookY, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "white";
        ctx.beginPath(); ctx.arc(-5 + lookX, headY - 2.5 + lookY, 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(3 + lookX, headY - 2.5 + lookY, 0.8, 0, Math.PI * 2); ctx.fill();
    }

    // 嘴
    if (isCharging && chargePower > 0.5) {
        ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(-4, headY + 5); ctx.lineTo(4, headY + 5); ctx.stroke();
    } else if (!p.grounded && (p.vy || 0) > 200) {
        ctx.fillStyle = "#333"; ctx.beginPath(); ctx.ellipse(0, headY + 6, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.strokeStyle = "#333"; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.arc(0, headY + 3, 4, 0.1, Math.PI - 0.1); ctx.stroke();
    }

    // 帽子
    ctx.fillStyle = hatColor;
    roundRect(ctx, -14, headY - 14, 28, 6, 3); ctx.fill();
    roundRect(ctx, -9, headY - 20, 18, 10, 5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath(); ctx.arc(0, headY - 16, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(isA ? "A" : "B", 0, headY - 22);
    ctx.restore();
}

// ===================== UI =====================
function drawUI(W, H) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, W / 2 - 80, 8, 160, 38, 19); ctx.fill();
    ctx.fillStyle = "white"; ctx.font = "bold 18px 'Segoe UI','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`距离: ${score}m`, W / 2, 27);

    if (gameMode === "local" && gameState === "playing") {
        ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
        ctx.setLineDash([10, 10]); ctx.beginPath();
        ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);

        ctx.font = "bold 12px sans-serif"; ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#4A90D9"; ctx.textAlign = "center";
        ctx.fillText("← 长按A键/点击左侧 蓄力跳跃", W / 4, H - 22);
        ctx.fillStyle = "#E74C3C";
        ctx.fillText("长按D键/点击右侧 蓄力跳跃 →", (W * 3) / 4, H - 22);
        ctx.globalAlpha = 1;
    }
}

function drawCountdown(W, H) {
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "white"; ctx.font = `bold ${Math.min(W * 0.3, 200)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(countdownValue, W / 2, H / 2);
    ctx.font = "24px sans-serif"; ctx.fillStyle = "#ccc";
    ctx.fillText("准备！", W / 2, H / 2 + 80);
}

function drawGameOver(W, H) {
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#E74C3C"; ctx.font = `bold ${Math.min(W * 0.08, 64)}px sans-serif`;
    ctx.fillText("游戏结束！", W / 2, H / 2 - 60);
    ctx.fillStyle = "#FFD700"; ctx.font = `bold ${Math.min(W * 0.06, 48)}px sans-serif`;
    ctx.fillText(`距离: ${score} 米`, W / 2, H / 2);
    ctx.fillStyle = "#aaa"; ctx.font = "18px sans-serif";
    ctx.fillText("点击屏幕 或 按 R 重新开始", W / 2, H / 2 + 50);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    roundRect(ctx, W / 2 - 60, H / 2 + 90, 120, 36, 18); ctx.fill();
    ctx.fillStyle = "#ccc"; ctx.font = "14px sans-serif";
    ctx.fillText("返回菜单", W / 2, H / 2 + 108);
}

// ===================== 工具 =====================
function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (r < 0) r = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
