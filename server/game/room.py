import asyncio
import math
import time
from .map_generator import MapGenerator

# 物理常量
GRAVITY = 1400
PLAYER_W = 30
PLAYER_H = 48
TICK_RATE = 30
DEATH_Y = 2000

# 蓄力跳跃
MIN_JUMP_VY = 380
MAX_JUMP_VY = 720
MIN_JUMP_VX = 80
MAX_JUMP_VX = 400
GROUND_FRICTION = 0.60

# 弹性绳子
MAX_ROPE = 200
ROPE_REST = 133
ROPE_STIFFNESS = 6
ROPE_HARD_STIFFNESS = 30


class Player:
    def __init__(self, pid, x, y, role):
        self.id = pid
        self.role = role
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.is_grounded = False
        self.is_charging = False
        self.charge_power = 0.0

    def to_dict(self):
        return {
            "id": self.id,
            "role": self.role,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "vx": round(self.vx, 1),
            "vy": round(self.vy, 1),
            "grounded": self.is_grounded,
            "charging": self.is_charging,
            "charge_power": round(self.charge_power, 2),
        }


class Room:
    def __init__(self, room_id):
        self.room_id = room_id
        self.players = {}
        self.connections = {}
        self.roles = {}
        self.state = "waiting"
        self.map_gen = MapGenerator()
        self.platforms = []
        self.camera_x = 0.0
        self.score = 0
        self.difficulty = 1.0
        self.game_task = None
        self.start_time = 0.0
        self.tick_count = 0

    def add_player(self, pid, ws):
        role = "A" if len(self.players) == 0 else "B"
        x = 100.0 if role == "A" else 160.0
        player = Player(pid, x, 400.0, role)
        self.players[pid] = player
        self.connections[pid] = ws
        self.roles[pid] = role

    def get_role(self, pid):
        return self.roles.get(pid, "spectator")

    def is_full(self):
        return len(self.players) >= 2

    async def start_game(self):
        self.state = "countdown"
        self.map_gen = MapGenerator()
        self.platforms = self.map_gen.generate_initial()

        # 将玩家放在第一个平台上
        for p in self.players.values():
            p.y = self.platforms[0]["y"] - PLAYER_H
            p.is_grounded = True
            p.vx = 0.0
            p.vy = 0.0

        # 倒计时
        for i in range(3, 0, -1):
            await self.broadcast_msg({"type": "countdown", "count": i})
            await asyncio.sleep(1)

        self.state = "playing"
        self.start_time = time.time()
        self.tick_count = 0
        await self.broadcast_msg({"type": "start"})
        self.game_task = asyncio.create_task(self._game_loop())

    async def _game_loop(self):
        dt = 1.0 / TICK_RATE
        try:
            while self.state == "playing":
                loop_start = time.time()
                self.update(dt)
                await self.broadcast_state()
                elapsed = time.time() - loop_start
                await asyncio.sleep(max(0, dt - elapsed))
        except asyncio.CancelledError:
            pass

    def handle_input(self, pid, action, charge=0.0):
        player = self.players.get(pid)
        if not player or self.state != "playing":
            return
            
        if action == "start_charge" and player.is_grounded:
            player.is_charging = True
            player.charge_power = 0.0
            
        elif action == "jump" and player.is_grounded:
            power = max(0.05, min(1.0, charge))
            jump_vy = -(MIN_JUMP_VY + (MAX_JUMP_VY - MIN_JUMP_VY) * power)
            player.vy = jump_vy
            player.vx = MIN_JUMP_VX + (MAX_JUMP_VX - MIN_JUMP_VX) * power
            player.is_grounded = False
            player.is_charging = False
            player.charge_power = 0.0

            # 拖拽挂在下方的玩家
            for other in self.players.values():
                if other.id != player.id and not other.is_grounded:
                    dx = other.x - player.x
                    dy = other.y - player.y
                    dist = math.sqrt(dx*dx + dy*dy)
                    # 如果另一个玩家在下方且绳子具有一定的拉伸趋势
                    if other.y > player.y + 20 and dist > ROPE_REST * 0.8:
                        other.vy = jump_vy * 0.9

    def update(self, dt):
        self.tick_count += 1
        elapsed = time.time() - self.start_time
        self.difficulty = 1.0 + elapsed / 90.0

        # 更新蓄力
        for p in self.players.values():
            if p.is_charging:
                if not p.is_grounded:
                    p.is_charging = False
                    p.charge_power = 0.0
                else:
                    p.charge_power = min(1.0, p.charge_power + dt / 1.2)

        # 更新崩塌平台
        collapsing = []
        for plat in self.platforms:
            if plat.get("collapsing"):
                plat["collapse_timer"] = plat.get("collapse_timer", 300) - 1
                if plat["collapse_timer"] <= 0:
                    collapsing.append(plat)
            if plat.get("type") == "moving":
                if "base_x" not in plat:
                    plat["base_x"] = plat["x"]
                
                prev_x = plat["x"]
                plat["x"] = plat["base_x"] + math.sin(
                    self.tick_count * 0.04 * plat.get("move_speed", 1)
                ) * plat.get("move_range", 40)
                
                # 附加水平平台位移给站在上面的玩家
                dx = plat["x"] - prev_x
                for p in self.players.values():
                    # 简单判断是否站在该平台上
                    if p.is_grounded and \
                       plat["x"] <= p.x <= plat["x"] + plat["width"] and \
                       abs((p.y + PLAYER_H) - plat["y"]) <= 5:
                        p.x += dx

        for c in collapsing:
            self.platforms.remove(c)

        for p in self.players.values():
            if p.is_grounded:
                p.vx *= GROUND_FRICTION ** (dt * 60)
                if abs(p.vx) < 1:
                    p.vx = 0

            if not p.is_grounded:
                p.vy += GRAVITY * dt

            p.x += p.vx * dt
            p.y += p.vy * dt

            # 平台碰撞
            p.is_grounded = False
            for plat in self.platforms:
                if self._collide_platform(p, plat, dt):
                    break

        # 先应用绳子力，再判定死亡（绳子能救回队友）
        players = list(self.players.values())
        if len(players) == 2:
            self._apply_rope(players[0], players[1], dt)

        # 死亡检测：只有两人都在自由落体且都在平台下方很远才算死
        any_grounded = any(p.is_grounded for p in players)
        if not any_grounded:
            lowest_plat_y = 0
            for plat in self.platforms:
                if plat["y"] > lowest_plat_y:
                    lowest_plat_y = plat["y"]
            death_line = lowest_plat_y + 1200
            if all(p.y > death_line for p in players):
                self._end_game()
                return

        # 摄像机（在服务端仅用于控制地图生成的可见范围与淘汰）
        if players:
            avg_x = sum(p.x for p in players) / len(players)
            self.camera_x = avg_x - 1200

        # 分数
        self.score = int(max(p.x for p in players) / 10)

        # 生成地图
        furthest = max(p.x for p in players) + 1000
        self.map_gen.generate_up_to(furthest, self.difficulty)
        self.map_gen.remove_behind(self.camera_x)
        self.platforms = self.map_gen.platforms

    def _collide_platform(self, player, plat, dt):
        p_right = player.x + PLAYER_W
        p_bottom = player.y + PLAYER_H

        if p_right <= plat["x"] or player.x >= plat["x"] + plat["width"]:
            return False

        prev_bottom = p_bottom - player.vy * dt
        if prev_bottom <= plat["y"] + 5 and p_bottom >= plat["y"] and player.vy >= 0:
            player.y = plat["y"] - PLAYER_H
            player.vy = 0
            player.is_grounded = True

            if plat.get("type") == "bounce":
                player.vy = -MAX_JUMP_VY * 1.3
                player.is_grounded = False

            if (
                plat.get("type") == "collapse"
                and not plat.get("collapsing")
            ):
                plat["collapsing"] = True
                plat["collapse_timer"] = 300

            return True
        return False

    def _apply_rope(self, a, b, dt):
        ax = a.x + PLAYER_W / 2
        ay = a.y + PLAYER_H / 2
        bx = b.x + PLAYER_W / 2
        by = b.y + PLAYER_H / 2
        dx = bx - ax
        dy = by - ay
        dist = math.sqrt(dx * dx + dy * dy)
        if dist < 1:
            return
        nx = dx / dist
        ny = dy / dist

        # 弹性力
        if dist > ROPE_REST:
            stretch = dist - ROPE_REST
            force_mag = stretch * ROPE_STIFFNESS
            if dist > MAX_ROPE:
                force_mag += (dist - MAX_ROPE) * ROPE_HARD_STIFFNESS
            if not a.is_grounded:
                a.vx += nx * force_mag * dt
                a.vy += ny * force_mag * dt
            if not b.is_grounded:
                b.vx -= nx * force_mag * dt
                b.vy -= ny * force_mag * dt

        # 硬约束：绳子不可能超过最大长度
        if dist > MAX_ROPE:
            excess = dist - MAX_ROPE
            if a.is_grounded and not b.is_grounded:
                b.x -= nx * excess
                b.y -= ny * excess
                b_vel = b.vx * (-nx) + b.vy * (-ny)
                if b_vel < 0:
                    b.vx -= (-nx) * b_vel
                    b.vy -= (-ny) * b_vel
            elif b.is_grounded and not a.is_grounded:
                a.x += nx * excess
                a.y += ny * excess
                a_vel = a.vx * nx + a.vy * ny
                if a_vel < 0:
                    a.vx -= nx * a_vel
                    a.vy -= ny * a_vel
            else:
                a.x += nx * excess * 0.5
                a.y += ny * excess * 0.5
                b.x -= nx * excess * 0.5
                b.y -= ny * excess * 0.5
                # 消除沿绳方向的远离速度
                a_vel = a.vx * nx + a.vy * ny
                if a_vel < 0:
                    a.vx -= nx * a_vel
                    a.vy -= ny * a_vel
                b_vel = b.vx * (-nx) + b.vy * (-ny)
                if b_vel < 0:
                    b.vx -= (-nx) * b_vel
                    b.vy -= (-ny) * b_vel

    def _end_game(self):
        self.state = "gameover"
        if self.game_task:
            self.game_task.cancel()

    async def restart(self):
        if self.game_task:
            self.game_task.cancel()
            self.game_task = None

        for i, p in enumerate(self.players.values()):
            p.x = 100.0 if p.role == "A" else 160.0
            p.y = 400.0
            p.vx = 0.0
            p.vy = 0.0
            p.is_grounded = False

        self.camera_x = 0.0
        self.score = 0
        self.difficulty = 1.0
        await self.start_game()

    async def broadcast_state(self):
        data = {
            "type": "state" if self.state == "playing" else "gameover",
            "players": [p.to_dict() for p in self.players.values()],
            "platforms": self._visible_platforms(),
            "camera_x": round(self.camera_x, 1),
            "score": self.score,
            "rope_max": MAX_ROPE,
        }
        await self.broadcast_msg(data)

    def _visible_platforms(self):
        return [
            {
                "x": round(p["x"], 1),
                "y": round(p["y"], 1),
                "width": round(p["width"], 1),
                "height": p["height"],
                "type": p.get("type", "static"),
                "collapsing": p.get("collapsing", False),
            }
            for p in self.platforms
            if p["x"] + p["width"] > self.camera_x - 500
            and p["x"] < self.camera_x + 3000
        ]

    async def broadcast_msg(self, data):
        disconnected = []
        for pid, ws in self.connections.items():
            try:
                await ws.send_json(data)
            except Exception:
                disconnected.append(pid)
        for pid in disconnected:
            self.connections.pop(pid, None)


class RoomManager:
    def __init__(self):
        self.rooms = {}
        self.player_rooms = {}

    async def join_room(self, pid, ws, room_code="auto"):
        if room_code == "auto":
            room = self._find_waiting()
            if not room:
                room = self._create_room()
        else:
            room = self.rooms.get(room_code)
            if not room:
                room = self._create_room(room_code)

        room.add_player(pid, ws)
        self.player_rooms[pid] = room.room_id
        return room

    def _find_waiting(self):
        for room in self.rooms.values():
            if room.state == "waiting" and not room.is_full() and not room.room_id.startswith("private_"):
                return room
        return None

    def _create_room(self, room_id=None):
        import uuid

        if not room_id:
            room_id = uuid.uuid4().hex[:6].upper()
        room = Room(room_id)
        self.rooms[room_id] = room
        return room

    async def leave_room(self, pid, room_id):
        room = self.rooms.get(room_id)
        if room:
            room.players.pop(pid, None)
            room.connections.pop(pid, None)
            room.roles.pop(pid, None)
            if not room.players:
                room.state = "ended"
                if room.game_task:
                    room.game_task.cancel()
                self.rooms.pop(room_id, None)
            else:
                room._end_game()
                await room.broadcast_msg({"type": "player_left"})
        self.player_rooms.pop(pid, None)
