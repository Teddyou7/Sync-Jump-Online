import random


class MapGenerator:
    """无限地图生成器 - 程序化生成平台"""

    def __init__(self):
        self.platforms = []
        self.frontier_x = 0
        self.last_y = 500

    def generate_initial(self):
        """生成初始安全区域"""
        self.platforms = [
            {"x": -100, "y": 500, "width": 400, "height": 20, "type": "static"},
        ]
        self.frontier_x = 300
        self.last_y = 500
        self.generate_up_to(1200, 1.0)
        return self.platforms

    def generate_up_to(self, target_x, difficulty):
        """生成平台直到 target_x"""
        while self.frontier_x < target_x:
            # 间距随难度增大
            gap = random.uniform(55, 70 + difficulty * 15)
            gap = min(gap, 170)

            # 高度差
            height_diff = random.uniform(-50, 35)
            new_y = self.last_y + height_diff
            new_y = max(280, min(530, new_y))

            # 宽度随难度减小
            width = random.uniform(85, 200 - difficulty * 8)
            width = max(65, width)

            # 平台类型
            ptype = "static"
            r = random.random()
            if r < 0.08 * difficulty:
                ptype = "bounce"
            elif r < 0.13 * difficulty:
                ptype = "collapse"
            elif r < 0.18 * difficulty:
                ptype = "moving"

            plat = {
                "x": round(self.frontier_x + gap, 1),
                "y": round(new_y, 1),
                "width": round(width, 1),
                "height": 20,
                "type": ptype,
            }

            if ptype == "moving":
                plat["move_range"] = round(random.uniform(30, 70), 1)
                plat["move_speed"] = round(random.uniform(1.0, 2.5), 2)
                plat["base_y"] = plat["y"]

            self.platforms.append(plat)
            self.frontier_x = plat["x"] + plat["width"]
            self.last_y = new_y

        return self.platforms

    def remove_behind(self, camera_x):
        """清除摄像机后方的平台"""
        self.platforms = [
            p for p in self.platforms if p["x"] + p["width"] > camera_x - 300
        ]
