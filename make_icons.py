# -*- coding: utf-8 -*-
"""生成记账本的 PWA 图标：渐变背景 + 白色 ¥"""
from PIL import Image, ImageDraw

# 和应用里 logo 一致的渐变色
C1 = (70, 103, 245)   # #4667f5
C2 = (122, 92, 240)   # #7a5cf0
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size, out_path):
    # 渐变背景（左上到右下）
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x / size * 0.5 + y / size * 0.5)
            px[x, y] = lerp(C1, C2, min(1.0, max(0.0, t)))
    img.paste(grad, (0, 0))

    # 圆角遮罩（iOS/Android 会自己切，但桌面预览好看些）
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)

    # ¥ 符号：内容放在中间 56% 区域内（maskable 安全区）
    draw = ImageDraw.Draw(img)
    cx = size / 2
    top = size * 0.26
    bottom_v = size * 0.74
    half_w = size * 0.17
    stem_w = max(2, int(size * 0.075))

    # 两条斜线
    draw.line([(cx - half_w, top), (cx, top + size * 0.19)],
              fill=WHITE, width=stem_w, joint="curve")
    draw.line([(cx + half_w, top), (cx, top + size * 0.19)],
              fill=WHITE, width=stem_w, joint="curve")
    # 竖线
    draw.line([(cx, top + size * 0.17), (cx, bottom_v)],
              fill=WHITE, width=stem_w, joint="curve")
    # 两条横线
    bar_w = size * 0.26
    for yy in (size * 0.48, size * 0.60):
        draw.line([(cx - bar_w, yy), (cx + bar_w, yy)],
                  fill=WHITE, width=stem_w, joint="curve")

    img.save(out_path, "PNG")
    print(f"  生成 {out_path}  ({size}x{size})")


if __name__ == "__main__":
    import os
    base = os.path.dirname(os.path.abspath(__file__))
    make_icon(512, os.path.join(base, "icon-512.png"))
    make_icon(192, os.path.join(base, "icon-192.png"))
    make_icon(180, os.path.join(base, "apple-touch-icon.png"))
    print("图标全部生成完毕")
