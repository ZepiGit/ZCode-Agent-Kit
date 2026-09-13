# -*- coding: utf-8 -*-
"""
按 Android-APP/app/src/main/java/com/zcode/proxy/MainActivity.kt 的 Compose 结构
逐组件复刻 UI，生成 SVG（1080×2400，density 3，1dp=3px，1sp=3px），
再用 Chrome headless 渲染为 PNG。

结构映射（.kt → 本脚本函数）：
  AppScreen/Box+Column        → screen()
  TopBar                      → top_bar()
  HeroCard                    → hero_card()
  AccountCard                 → account_card()
  AccessConfigCard            → access_config_card()
  LogsPreviewCard             → logs_preview_card()
  LogsScreen                  → logs_screen()
  SettingsScreen/CardBlock/SettingRow → settings_screen()
  NavItem                     → nav_item()
  SegChip / StatusDot / Sparkline / CopyGlyph → 同名函数
颜色取自 ui/theme/Color.kt 的中国传统色 token。

字体对照 Type.kt（2026-09-09 真机截图校正）：
  - AppTypography = Typography() → 默认字体族 = 设备系统字体；用户的手机
    系统字体为衬线（宋体风格），故常规文本用 Times New Roman + SimSun 复刻。
  - Mono = JetBrains Mono（res/font 打包，CJK 回落系统字体），此处直接内嵌
    Android-APP 里的 ttf（@font-face 相对引用 ./fonts/）。
  - 真机为 edge-to-edge，应用不绘制状态栏内容 → 不画假状态栏。
"""
import base64
import io
import os

from PIL import Image

S = 3.0          # density 3：1dp/1sp = 3px
W, H = 1080, 2400
DIR = os.path.dirname(os.path.abspath(__file__))
_icon = Image.open(os.path.join(DIR, "..", "..", "..", "Android-APP", "design", "assets", "zcode-app-icon.png")).convert("RGBA").resize((240, 240), Image.LANCZOS)
_buf = io.BytesIO()
_icon.save(_buf, "PNG")
ICON_B64 = base64.b64encode(_buf.getvalue()).decode()

SERIF = "'Times New Roman','SimSun',serif"
MONO = "'JetBrains Mono','SimSun',serif"   # CJK 字形回落系统字体（与设备一致）

FONT_FACES = f"""<style>
@font-face{{font-family:'JetBrains Mono';font-weight:400;src:url('fonts/jetbrainsmono_regular.ttf')}}
@font-face{{font-family:'JetBrains Mono';font-weight:600;src:url('fonts/jetbrainsmono_semibold.ttf')}}
@font-face{{font-family:'JetBrains Mono';font-weight:700;src:url('fonts/jetbrainsmono_bold.ttf')}}
</style>"""

# ── Color.kt 亮/暗 token ─────────────────────────────────────────────
class Pal:
    def __init__(self, d):
        self.__dict__.update(d)

LIGHT = Pal(dict(
    surface="#F5F9FA", scLow="#E8F0F3", sc="#E0EAEE", scHigh="#D8E3E8", scHighest="#CFDCE2",
    primary="#177CB0", onPrimary="#FFFFFF", primaryContainer="#D8EAEF", onPrimaryContainer="#123B4E",
    secondaryContainer="#D8EAEF", onSecondaryContainer="#14587D",
    error="#9D2933", onSurface="#1F2A30", onSurfaceVariant="#5A6B74",
    outlineVariant="#CBD9DE", dim="#7C8B92", success="#21A675",
))
DARK = Pal(dict(
    surface="#12181D", scLow="#1C2429", sc="#222B31", scHigh="#2A343A", scHighest="#323E45",
    primary="#7EC3DF", onPrimary="#0C2A38", primaryContainer="#17475E", onPrimaryContainer="#D9EEF6",
    secondaryContainer="#1D5A77", onSecondaryContainer="#C4E3EF",
    error="#E06B76", onSurface="#DEE7EA", onSurfaceVariant="#9DAEB6",
    outlineVariant="#2E3A40", dim="#76878F", success="#5BC89B",
))

def dp(v): return v * S

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

class SVG:
    def __init__(self):
        self.e = []

    def rect(self, x, y, w, h, rx, fill, stroke=None, sw=0, fo=1.0, so=1.0):
        s = f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx:.1f}" fill="{fill}"'
        if fo < 1: s += f' fill-opacity="{fo:.2f}"'
        if stroke: s += f' stroke="{stroke}" stroke-width="{sw:.1f}" stroke-opacity="{so:.2f}"'
        self.e.append(s + "/>")

    def circle(self, cx, cy, r, fill, fo=1.0):
        s = f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}"'
        if fo < 1: s += f' fill-opacity="{fo:.2f}"'
        self.e.append(s + "/>")

    def text(self, x, y, s, size, fill, weight=400, anchor="start", mono=False, fo=1.0):
        fam = MONO if mono else SERIF
        self.e.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size:.1f}" '
            f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" dominant-baseline="central"'
            + (f' fill-opacity="{fo:.2f}"' if fo < 1 else "") + f">{esc(s)}</text>")

    def line(self, x1, y1, x2, y2, stroke, sw, fo=1.0, cap="butt"):
        self.e.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                      f'stroke="{stroke}" stroke-width="{sw:.1f}" stroke-opacity="{fo:.2f}" stroke-linecap="{cap}"/>')

    def polyline(self, pts, stroke, sw, fo=1.0, fill=None):
        p = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        if fill:
            self.e.append(f'<polygon points="{p} {pts[-1][0]:.1f},{pts[-1][1]:.1f} {pts[0][0]:.1f},{pts[0][1]:.1f}" fill="{fill}"/>')
        self.e.append(f'<polyline points="{p}" fill="none" stroke="{stroke}" stroke-width="{sw:.1f}" '
                      f'stroke-opacity="{fo:.2f}" stroke-linecap="round" stroke-linejoin="round"/>')

    def icon24(self, name, x, y, size, color):
        """Material filled 图标，24dp viewBox 缩放到 size。"""
        P = {
            "home": "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
            "menu": "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
            "settings": "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
            "chevright": "M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z",
        }
        k = size / 24.0
        self.path(P[name], color, transform=f"translate({x:.1f},{y:.1f}) scale({k:.3f})")

    def path(self, d, fill, transform="", fo=1.0):
        s = f'<path d="{d}" fill="{fill}"'
        if fo < 1: s += f' fill-opacity="{fo:.2f}"'
        if transform: s += f' transform="{transform}"'
        self.e.append(s + "/>")

    def save(self, path, pal):
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
               + FONT_FACES
               + f'<rect width="{W}" height="{H}" fill="{pal.surface}"/>' + "".join(self.e) + "</svg>")
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg)

# ── 组件（对应 .kt 同名 Composable）──────────────────────────────────

def top_bar(s, pal, dark, subtitle):
    y = dp(20 + 8)  # 顶部留白 + vertical 8
    ic = dp(40)
    s.rect(dp(16), y, ic, ic, dp(10), pal.scHigh if dark else "none",
           stroke=pal.outlineVariant if dark else None, sw=dp(1))
    s.e.append(f'<image x="{dp(16):.1f}" y="{y:.1f}" width="{ic:.1f}" height="{ic:.1f}" '
               f'href="data:image/png;base64,{ICON_B64}" clip-path="url(#iconclip{ "_" + ("d" if dark else "l")})"/>')
    s.text(dp(16 + 40 + 12), y + ic / 2 - dp(11), "ZCode Proxy", dp(20), pal.onSurface, weight=600)
    s.text(dp(16 + 40 + 12), y + ic / 2 + dp(12), subtitle, dp(12), pal.onSurfaceVariant)
    s.icon24("settings", W - dp(16) - dp(24), y + (ic - dp(24)) / 2, dp(24), pal.onSurfaceVariant)
    return y + ic + dp(8)

def status_dot(s, pal, cx, cy, color, pulse):
    if pulse:
        s.circle(cx, cy, dp(12), color, fo=0.25)  # 呼吸外环（静态取中值）
    s.circle(cx, cy, dp(6), color)

def sparkline(s, pal, x, y, w, h, data, color):
    """Sparkline 逻辑：data<2 画半高空线；否则折线+0.14 面积+末点呼吸。"""
    if len(data) < 2:
        s.line(x, y + h / 2, x + w, y + h / 2, color, dp(1.33), fo=0.3, cap="round")
        return
    mx = max(max(data), 1)
    step = w / (len(data) - 1)
    pts = [(x + i * step, y + h * (1 - (v / mx)) if v else y + h) for i, v in enumerate(data)]
    s.polyline(pts, color, sw=dp(1.33), fill=_alpha(color, 0.14))
    ex, ey = pts[-1]
    s.circle(ex, ey, dp(3.7), color, fo=0.25)
    s.circle(ex, ey, dp(1.8), color)

def copy_glyph(s, pal, x, y, color):
    s.rect(x, y, dp(10), dp(12), dp(2), "none", stroke=color, sw=dp(1.5))
    s.rect(x + dp(5), y + dp(3), dp(10), dp(12), dp(2), color)

def pill_w(label, size_sp, padx=12, mono=False):
    return int(dp(padx * 2) + sum(dp(size_sp) * (1.0 if ord(c) > 0x2E7F else (0.62 if mono else 0.5)) for c in label))

def pill(s, x, y, label, size_sp, fill, fg, mono=False, weight=600, stroke=None, sw=0, padx=12, pady=5):
    tw = pill_w(label, size_sp, padx, mono)
    h = dp(size_sp) + dp(pady * 2)
    s.rect(x, y, tw, h, dp(50), fill, stroke=stroke, sw=sw)
    s.text(x + tw / 2, y + h / 2, label, dp(size_sp), fg, weight=weight, anchor="middle", mono=mono)
    return tw, h

def hero_card(s, pal, y0, running=True):
    p = dp(20)
    y = y0
    card_x, card_w = dp(16), W - dp(32)
    inner_w = card_w - p * 2
    ch = dp(24 + 16 + 34 + 14 + 17 + 36 + 14 + 52) + p * 2
    s.rect(card_x, y, card_w, ch, dp(24), pal.primaryContainer)
    cy = y + p
    # 行1：状态点 + 状态文本 + plan 徽章
    dot_c = pal.success if running else pal.onSurfaceVariant
    status_dot(s, pal, card_x + p + dp(6), cy + dp(12), dot_c, pulse=running)
    s.text(card_x + p + dp(24), cy + dp(12), "运行中" if running else "已停止", dp(20), pal.onPrimaryContainer, weight=600)
    pill(s, card_x + card_w - p - dp(104), cy - dp(1), "coding-plan", 12, _alpha(pal.primary, 0.14),
         pal.onPrimaryContainer, mono=True, weight=400, padx=12, pady=5)
    cy += dp(24 + 16)
    # 行2：地址 + 复制胶囊（停止态为「未启动」，纯文本）
    s.text(card_x + p, cy + dp(17), "127.0.0.1:8080" if running else "未启动", dp(24), pal.onPrimaryContainer,
           weight=600, mono=running)
    if running:
        bw = pill_w("复制", 13, padx=14) + dp(15 + 6)
        bh = dp(13) + dp(14)
        bx = card_x + card_w - p - bw
        s.rect(bx, cy + dp(17) - bh / 2, bw, bh, dp(50), "none", stroke=_alpha(pal.primary, 0.45), sw=dp(1.5))
        copy_glyph(s, pal, bx + dp(14), cy + dp(17) - dp(7.5), _alpha(pal.onPrimaryContainer, 0.85))
        s.text(bx + dp(14) + dp(15) + dp(6), cy + dp(17), "复制", dp(13), pal.onPrimaryContainer, anchor="start")
    cy += dp(34 + 14)
    # 行3：sparkline + UP（停止态无数据：半高空线 + UP —）
    s.text(card_x + p, cy + dp(8), "近 60 分钟请求", dp(11), pal.onPrimaryContainer, fo=0.65)
    spark_w = inner_w - dp(100)
    sparkline(s, pal, card_x + p, cy + dp(17), spark_w, dp(36),
              [] if not running else [0, 1, 0, 2, 3, 1, 0, 1, 4, 2, 6, 3, 2, 5], pal.primary)
    s.text(card_x + p + inner_w, cy + dp(17) + dp(36), "UP 00:12:34" if running else "UP —", dp(12),
           pal.onPrimaryContainer, fo=0.65, anchor="end", mono=True)
    cy += dp(17 + 36 + 14)
    # 主按钮
    s.rect(card_x + p, cy, inner_w, dp(52), dp(50), pal.primary)
    if running:
        s.rect(card_x + p + inner_w / 2 - dp(52), cy + dp(19), dp(14), dp(14), dp(3), pal.onPrimary)
        s.text(card_x + p + inner_w / 2 + dp(5), cy + dp(26), "停止代理", dp(16), pal.onPrimary, weight=600, anchor="start")
    else:
        s.text(card_x + p + inner_w / 2, cy + dp(26), "启动代理", dp(16), pal.onPrimary, weight=600, anchor="middle")
    return y + ch

def _alpha(hex6, a):
    r, g, b = hex6[1:3], hex6[3:5], hex6[5:7]
    return f"#{r}{g}{b}{int(round(a * 255)):02X}"

def account_card(s, pal, y0, logged_in=True, running=True, provider="zai"):
    p = dp(16)
    card_x, card_w = dp(16), W - dp(32)
    ch = dp(48 + 16)
    s.rect(card_x, y0, card_w, ch, dp(24), pal.scLow)
    cy = y0 + ch / 2
    s.circle(card_x + p + dp(24), cy, dp(24), pal.primaryContainer)
    s.text(card_x + p + dp(24), cy + dp(1), "Z", dp(22), pal.onPrimaryContainer, weight=700, anchor="middle")
    tx = card_x + p + dp(48 + 12)
    s.text(tx, cy - dp(11), "Z.AI 账号" if provider == "zai" else "智谱账号", dp(16), pal.onSurface, weight=600)
    s.circle(tx + dp(4), cy + dp(12), dp(4), pal.success if logged_in else pal.error)
    st = "已登录 · 代理运行中 · 登出已锁定" if (logged_in and running) else ("已登录 · OAuth 授权" if logged_in else "未登录")
    bw0 = pill_w("登出", 14, padx=16) if logged_in else pill_w("登录", 14, padx=16)
    avail = card_x + card_w - p - bw0 - dp(12) - (tx + dp(14))
    def tw_(t): return sum(dp(13) * (1.0 if ord(c) > 0x2E7F else 0.5) for c in t)
    while st and tw_(st) > avail:
        st = st[:-2] + "…"
        if tw_(st) <= avail: break
        st = st[:-1]
    s.text(tx + dp(14), cy + dp(12), st, dp(13), pal.onSurfaceVariant)
    if logged_in:
        a = 0.25 if running else 0.55
        bw = pill_w("登出", 14, padx=16)
        bh = dp(14) + dp(16)
        s.rect(card_x + card_w - p - bw, cy - bh / 2, bw, bh, dp(50), "none",
               stroke=_alpha(pal.error, a), sw=dp(1.5))
        s.text(card_x + card_w - p - bw / 2, cy, "登出", dp(14), _alpha(pal.error, 0.38 if running else 1.0),
               weight=500, anchor="middle")
    else:
        pill(s, card_x + card_w - p - dp(76), cy - dp(19), "登录", 14, pal.primary, pal.onPrimary, weight=500, padx=16, pady=8)
    return y0 + ch

def access_config_card(s, pal, y0, running=True, provider="zai"):
    p = dp(16)
    card_x, card_w = dp(16), W - dp(32)
    ch = dp(16 + 24 + 24 + 14 + 37 + 14 + 37) + p
    s.rect(card_x, y0, card_w, ch, dp(24), pal.scLow)
    cy = y0 + p
    s.text(card_x + p, cy + dp(12), "接入配置", dp(16), pal.onSurface, weight=600)
    s.text(card_x + card_w - p, cy + dp(12), "运行中 · 切换已锁定" if running else "停止代理后可切换",
           dp(12), pal.dim, anchor="end")
    cy += dp(24)
    s.line(card_x + p, cy, card_x + card_w - p, cy, pal.outlineVariant, dp(1))
    cy += dp(12)
    chip_w = (card_w - p * 2 - dp(52) - dp(8)) / 2
    s.text(card_x + p, cy + dp(18.5), "服务商", dp(13), pal.onSurfaceVariant)
    x1 = card_x + p + dp(52)
    seg_chip(s, pal, x1, cy, chip_w, dp(37), "Z.AI", provider == "zai", enabled=not running)
    seg_chip(s, pal, x1 + chip_w + dp(8), cy, chip_w, dp(37), "智谱", provider == "bigmodel", enabled=not running)
    cy += dp(37 + 14)
    s.text(card_x + p, cy + dp(18.5), "套餐", dp(13), pal.onSurfaceVariant)
    seg_chip(s, pal, x1, cy, chip_w, dp(37), "coding-plan", True, enabled=not running, mono=True)
    seg_chip(s, pal, x1 + chip_w + dp(8), cy, chip_w, dp(37), "start-plan", False, enabled=not running, mono=True)
    return y0 + ch

def seg_chip(s, pal, x, y, w, h, label, selected, enabled=True, mono=False):
    if selected:
        s.rect(x, y, w, h, dp(50), pal.primary)
        fg, wt, fo = pal.onPrimary, 600, 1.0
    else:
        s.rect(x, y, w, h, dp(50), pal.surface, stroke=pal.outlineVariant, sw=dp(1))
        fg, wt, fo = pal.onSurfaceVariant, 400, 0.5 if not enabled else 1.0
    s.text(x + w / 2, y + h / 2, label, dp(12 if mono else 13), fg, weight=wt, anchor="middle", mono=mono, fo=fo)

def logs_preview_card(s, pal, y0, lines, err_count=1, count_label="128"):
    p = dp(16)
    card_x, card_w = dp(16), W - dp(32)
    lh = dp(17)
    list_h = lh * len(lines) + dp(4)
    ch = dp(24 + 20 + 8) + list_h + dp(17 + 10)
    s.rect(card_x, y0, card_w, ch, dp(24), pal.scLow)
    cy = y0 + p
    s.text(card_x + p, cy + dp(10), "实时日志", dp(16), pal.onSurface, weight=600)
    bw = pill_w(count_label, 11, padx=9, mono=True)
    s.rect(card_x + p + dp(70), cy + dp(10) - dp(11), bw, dp(22), dp(50), pal.secondaryContainer)
    s.text(card_x + p + dp(70) + bw / 2, cy + dp(10), count_label, dp(11), pal.onSecondaryContainer,
           weight=600, anchor="middle", mono=True)
    ec = pal.error if err_count else pal.success
    s.text(card_x + card_w - p - dp(24) - dp(70), cy + dp(10), f"错误 {err_count}", dp(12), ec, weight=600, mono=True, anchor="end")
    s.text(card_x + card_w - p - dp(24), cy + dp(10), "查看全部", dp(13), pal.primary, weight=500, anchor="end")
    s.icon24("chevright", card_x + card_w - p - dp(20), cy + dp(1), dp(18), pal.primary)
    cy += dp(20 + 10)
    s.line(card_x + p, cy, card_x + card_w - p, cy, pal.outlineVariant, dp(1))
    cy += dp(5)
    for ln, is_err in lines:
        s.text(card_x + p, cy + lh / 2, ln, dp(11), pal.error if is_err else pal.onSurfaceVariant, mono=True)
        cy += lh
    cy += dp(5)
    s.text(card_x + card_w / 2, cy + dp(8), "点击卡片或右上角「查看全部」查看完整日志", dp(12), pal.dim, anchor="middle")
    return y0 + ch

LOG_LINES_RUN = [
    ("#128 OAI glm-4.7 200 batch 0.9s", False),
    ("#127 ANX glm-5.3 200 stream 12.4s", False),
    ("#126 OAI glm-4.6 200 stream 3.1s", False),
    ("#125 OAI glm-4.7 429 stream 0.3s", True),
    ("#124 ANX glm-5.2 200 stream 45.8s", False),
]
LOG_LINES_STOP = [
    ("#005 OAI glm-4.7 200 batch 1.2s", False),
    ("#004 ANX glm-5.3 200 stream 18.6s", False),
    ("#003 OAI glm-4.6 200 stream 2.4s", False),
    ("#002 OAI glm-4.7 200 batch 0.8s", False),
    ("#001 ANX glm-5.2 200 stream 31.5s", False),
]

def nav_bar(s, pal, selected):
    bar_h = dp(68)
    bar_y = H - dp(24) - bar_h  # navigationBarsPadding 24dp
    s.line(0, bar_y, W, bar_y, pal.outlineVariant, dp(1))
    s.rect(0, bar_y + dp(1), W, bar_h + dp(24) - dp(1), 0, pal.sc)
    labels = ["主页", "日志", "设置"]
    icons = ["home", "menu", "settings"]
    for i in range(3):
        cx = W / 6 + i * W / 3
        sel = i == selected
        ic_c = pal.primary if sel else pal.onSurfaceVariant
        if sel:
            s.rect(cx - dp(38), bar_y + dp(8), dp(76), dp(26), dp(50), pal.secondaryContainer)
        s.icon24(icons[i], cx - dp(11), bar_y + dp(10), dp(22), ic_c)
        s.text(cx, bar_y + dp(48), labels[i], dp(11), ic_c, weight=600 if sel else 400, anchor="middle")

def screen(pal, dark, name, body, nav_sel=0, subtitle="本地反向代理 · 已连接", topbar=True):
    s = SVG()
    s.e.append(f'<clipPath id="iconclip_{"d" if dark else "l"}"><rect x="{dp(16):.1f}" y="{dp(28):.1f}" width="{dp(40):.1f}" height="{dp(40):.1f}" rx="{dp(10):.1f}"/></clipPath>')
    if topbar:
        top_bar(s, pal, dark, subtitle)
    body(s, pal)
    nav_bar(s, pal, nav_sel)
    s.save(os.path.join(DIR, name + ".svg"), pal)

# ── 三张 Tab + 暗色主页 ──────────────────────────────────────────────

def home_body(s, pal, running=True, provider="zai", log_lines=LOG_LINES_RUN, err_count=1, count_label="128"):
    y = dp(20 + 56 + 4)  # 顶部留白 + TopBar + LazyColumn top padding
    y = hero_card(s, pal, y, running=running) + dp(12)
    y = account_card(s, pal, y, logged_in=True, running=running, provider=provider) + dp(12)
    y = access_config_card(s, pal, y, running=running, provider=provider) + dp(12)
    logs_preview_card(s, pal, y, log_lines, err_count=err_count, count_label=count_label)

def logs_screen_body(s, pal):
    y = dp(20 + 10)
    s.text(dp(16), y + dp(16), "实时日志 (128)", dp(18), pal.onSurface, weight=600)
    s.text(W - dp(16) - dp(60), y + dp(16), "复制", dp(13), pal.primary, anchor="middle")
    s.text(W - dp(16) - dp(10), y + dp(16), "清屏", dp(13), pal.primary, anchor="end")
    y += dp(28 + 8)
    cw = [dp(58), dp(58), dp(58)]
    x = dp(16)
    for i, lab in enumerate(["全部", "成功", "错误"]):
        seg_chip(s, pal, x, y, cw[i], dp(33), lab, i == 0)
        x += cw[i] + dp(8)
    y += dp(33 + 8)
    s.line(dp(16), y, W - dp(16), y, pal.outlineVariant, dp(1))
    y += dp(6)
    lh = dp(17)
    more = [
        ("#123 OAI glm-4.7 200 stream 2.2s", False), ("#122 OAI glm-4.6 200 batch 1.1s", False),
        ("#121 ANX glm-5.1 200 stream 8.7s", False), ("#120 OAI glm-4.7 500 batch 0.2s", True),
        ("#119 OAI glm-4.6v 200 stream 5.4s", False), ("#118 ANX glm-5.3 200 stream 31.0s", False),
        ("#117 OAI glm-4.7 200 stream 1.8s", False), ("#116 OAI glm-4.6 429 batch 0.3s", True),
        ("#115 ANX glm-5.2 200 stream 22.6s", False), ("#114 OAI glm-4.7 200 batch 0.8s", False),
        ("#113 OAI glm-4.7 200 stream 4.0s", False), ("#112 ANX glm-5.1 200 stream 9.3s", False),
        ("#111 OAI glm-4.6 200 stream 2.7s", False), ("#110 OAI glm-4.7 200 batch 1.0s", False),
        ("#109 ANX glm-5.3 200 stream 18.2s", False), ("#108 OAI glm-4.6 200 stream 3.5s", False),
        ("#107 OAI glm-4.7 200 stream 2.9s", False), ("#106 ANX glm-5.2 200 batch 1.4s", False),
    ]
    for ln, is_err in more:
        s.text(dp(16), y + lh / 2, ln, dp(11), pal.error if is_err else pal.onSurfaceVariant, mono=True)
        y += lh

def card_block(s, pal, y0, title, inner_h):
    p = dp(16)
    card_x, card_w = dp(16), W - dp(32)
    ch = dp(24 + 24) + inner_h + p
    s.rect(card_x, y0, card_w, ch, dp(24), pal.scLow)
    cy = y0 + p
    s.text(card_x + p, cy + dp(12), title, dp(16), pal.onSurface, weight=600)
    cy += dp(24)
    s.line(card_x + p, cy, card_x + card_w - p, cy, pal.outlineVariant, dp(1))
    cy += dp(12)
    return card_x + p, card_w - p * 2, cy, y0 + ch

def setting_row(s, pal, x, y, w, label, value, vc=None):
    s.text(x, y, label, dp(14), pal.onSurfaceVariant)
    s.text(x + w, y, value, dp(14), vc or pal.onSurface, weight=500, anchor="end")

def settings_body(s, pal):
    y = dp(20 + 10)
    s.text(dp(16), y + dp(16), "设置", dp(20), pal.onSurface, weight=600)
    y += dp(32 + 10)
    # 外观
    x, w, cy, y2 = card_block(s, pal, y, "外观", dp(37 + 6 + 17))
    s.text(x, cy + dp(18.5), "主题", dp(13), pal.onSurfaceVariant)
    cw = (w - dp(64) - dp(16)) / 3
    for i, lab in enumerate(["跟随系统", "亮色", "暗色"]):
        seg_chip(s, pal, x + dp(64) + i * (cw + dp(8)), cy, cw, dp(37), lab, i == 0)
    s.text(x, cy + dp(37 + 6 + 8), "跟随系统时，深色模式开关即时生效", dp(12), pal.dim)
    y = y2 + dp(12)
    # 接入信息
    x, w, cy, y2 = card_block(s, pal, y, "接入信息", dp(4 * 31 + 4 + 17))
    setting_row(s, pal, x, cy + dp(12), w, "服务商", "Z.AI")
    setting_row(s, pal, x, cy + dp(12 + 31), w, "套餐", "coding-plan")
    setting_row(s, pal, x, cy + dp(12 + 62), w, "状态", "127.0.0.1:8080 · 运行中", vc=pal.success)
    setting_row(s, pal, x, cy + dp(12 + 93), w, "登录", "已登录")
    s.text(x, cy + dp(12 + 124 + 2), "切换服务商/套餐在主页「接入配置」卡", dp(12), pal.dim)
    y = y2 + dp(12)
    # 关于
    x, w, cy, y2 = card_block(s, pal, y, "关于", dp(12 + 93 + 6 + 48 + 25 + 17 + 17 + 10))
    setting_row(s, pal, x, cy + dp(12), w, "应用", "ZCode Proxy")
    setting_row(s, pal, x, cy + dp(12 + 31), w, "版本", "4.6.3")
    setting_row(s, pal, x, cy + dp(12 + 62), w, "控制协议", "Node · 127.0.0.1 本地监听")
    ry = cy + dp(12 + 93 + 6)
    s.text(x, ry + dp(10), "自动检查更新", dp(14), pal.onSurfaceVariant)
    s.text(x, ry + dp(29), "启动时查询 GitHub Releases", dp(12), pal.dim)
    swx, swy = x + w - dp(52), ry + dp(2)
    s.rect(swx, swy, dp(52), dp(32), dp(16), pal.primary)
    s.circle(swx + dp(52 - 16), swy + dp(16), dp(12), pal.onPrimary)
    ry2 = ry + dp(48)
    s.text(x, ry2, "更新", dp(14), pal.onSurfaceVariant)
    s.text(x + dp(40), ry2, "已是最新（v4.6.3）", dp(13), pal.success)
    s.text(x + w, ry2, "检查更新", dp(13), pal.primary, anchor="end")
    s.text(x, ry2 + dp(25), "更新来自 GitHub Releases · TriDefender/zcode-api", dp(12), pal.dim)
    s.text(x, ry2 + dp(25 + 17), "上游：Z.AI / 智谱开放平台（OAuth 登录）", dp(12), pal.dim)

# 亮色主页 = 运行中；暗色主页 = 复刻真机截图状态（已停止 · 智谱 · 已登录 · coding-plan）
screen(LIGHT, False, "home-light", lambda s, p: home_body(s, p, running=True, provider="zai"), nav_sel=0)
screen(DARK, True, "home-dark", lambda s, p: home_body(s, p, running=False, provider="bigmodel",
      log_lines=LOG_LINES_STOP, err_count=0, count_label="5"), nav_sel=0)
screen(LIGHT, False, "logs", logs_screen_body, nav_sel=1, topbar=False)
screen(LIGHT, False, "settings", settings_body, nav_sel=2, topbar=False)
print("SVG generated: home-light home-dark logs settings")
