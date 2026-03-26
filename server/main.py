import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from game.room import RoomManager

app = FastAPI(title="Sync Jump Online")
room_manager = RoomManager()

client_path = Path(__file__).parent.parent / "client"
app.mount("/static", StaticFiles(directory=str(client_path)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(client_path / "index.html"))


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    player_id = uuid.uuid4().hex[:8]
    room = None

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "join":
                room_code = data.get("room", "auto")
                room = await room_manager.join_room(
                    player_id, websocket, room_code
                )
                await websocket.send_json(
                    {
                        "type": "joined",
                        "player_id": player_id,
                        "role": room.get_role(player_id),
                        "room_id": room.room_id,
                    }
                )
                if room.is_full():
                    await room.start_game()
                else:
                    await websocket.send_json({"type": "waiting"})

            elif msg_type == "input":
                if room:
                    charge = float(data.get("charge", 0))
                    room.handle_input(player_id, data.get("action"), charge)

            elif msg_type == "restart":
                if room and room.state == "gameover":
                    await room.restart()

    except WebSocketDisconnect:
        if room:
            await room_manager.leave_room(player_id, room.room_id)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
