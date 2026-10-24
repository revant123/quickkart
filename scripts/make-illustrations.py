"""Generates the 40 product illustrations in web/public/img/products/*.svg.

Original flat drawings in one consistent style: packaged goods share a few
shapes (carton, tub, block, jar, bottle, can, snack bag, box, sack), coloured per
product; fruit and vegetables are drawn individually. Transparent background:
the shop tile supplies the aisle colour behind them.

Run from the quickkart folder:  python3 scripts/make-illustrations.py
"""
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'img', 'products')
INK = '#17301F'
SHADOW = '<ellipse cx="100" cy="186" rx="{rx}" ry="7" fill="#17301F" opacity=".12"/>'


def svg(body, shadow=56):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img">'
        + SHADOW.format(rx=shadow) + body + '</svg>'
    )


def label(x, y, w, h, fill, text, color='#fff', size=15, rx=6):
    t = (f'<text x="{x + w / 2}" y="{y + h / 2 + size * 0.36}" text-anchor="middle" '
         f'font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="{size}" '
         f'letter-spacing=".5" fill="{color}">{text}</text>') if text else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"/>' + t


# ---- packaging shapes ---------------------------------------------------------

def carton(main, accent, text, cap='#fff'):
    return svg(
        f'<path d="M62 52 L100 30 L138 52 Z" fill="{accent}"/>'
        f'<rect x="92" y="18" width="16" height="12" rx="3" fill="{cap}" stroke="{INK}" stroke-width="2"/>'
        f'<rect x="62" y="52" width="76" height="130" rx="6" fill="{main}"/>'
        f'<rect x="62" y="52" width="20" height="130" fill="#000" opacity=".06"/>'
        + label(68, 96, 64, 40, accent, text, size=14)
        + f'<path d="M70 150 q15 -10 30 0 t30 0" stroke="{accent}" stroke-width="5" fill="none" stroke-linecap="round"/>',
        shadow=48)


def tub(main, lid, text):
    return svg(
        f'<path d="M56 78 L144 78 L134 178 L66 178 Z" fill="{main}"/>'
        f'<rect x="50" y="64" width="100" height="18" rx="8" fill="{lid}"/>'
        f'<path d="M56 82 L72 82 L80 178 L66 178 Z" fill="#000" opacity=".06"/>'
        + label(70, 112, 60, 34, lid, text, size=13),
        shadow=46)


def block(main, wrap, text):
    return svg(
        f'<path d="M40 112 L100 82 L160 112 L100 142 Z" fill="{main}"/>'
        f'<path d="M40 112 L100 142 L100 178 L40 148 Z" fill="{main}" opacity=".85"/>'
        f'<path d="M160 112 L100 142 L100 178 L160 148 Z" fill="{main}" opacity=".7"/>'
        f'<path d="M58 121 L100 142 L100 166 L58 145 Z" fill="{wrap}"/>'
        + (f'<text x="79" y="150" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" '
           f'font-size="11" fill="#fff" transform="rotate(27 79 147)">{text}</text>' if text else ''),
        shadow=60)


def jar(glass, content, lid, text):
    return svg(
        f'<rect x="64" y="44" width="72" height="20" rx="5" fill="{lid}"/>'
        f'<rect x="58" y="62" width="84" height="118" rx="16" fill="{glass}"/>'
        f'<rect x="64" y="84" width="72" height="90" rx="12" fill="{content}"/>'
        f'<rect x="68" y="70" width="8" height="96" rx="4" fill="#fff" opacity=".45"/>'
        + label(70, 110, 60, 32, lid, text, size=13),
        shadow=46)


def bottle(body, cap, liquid, text, slim=False):
    w = 50 if slim else 60
    x = 100 - w / 2
    return svg(
        f'<rect x="90" y="18" width="20" height="16" rx="3" fill="{cap}"/>'
        f'<path d="M92 34 L108 34 L108 50 Q{x + w} 62 {x + w} 82 L{x + w} 172 Q{x + w} 182 {x + w - 10} 182 '
        f'L{x + 10} 182 Q{x} 182 {x} 172 L{x} 82 Q{x} 62 92 50 Z" fill="{body}"/>'
        f'<rect x="{x + 4}" y="96" width="{w - 8}" height="80" rx="6" fill="{liquid}"/>'
        f'<rect x="{x + 7}" y="70" width="6" height="96" rx="3" fill="#fff" opacity=".5"/>'
        + label(x + 4, 112, w - 8, 30, cap, text, size=10 if slim else 12, rx=4),
        shadow=40)


def can(main, top, text):
    return svg(
        f'<rect x="64" y="40" width="72" height="140" rx="12" fill="{main}"/>'
        f'<ellipse cx="100" cy="42" rx="36" ry="8" fill="{top}"/>'
        f'<rect x="64" y="40" width="16" height="140" fill="#fff" opacity=".18"/>'
        f'<path d="M64 120 q36 -22 72 0 v18 q-36 -22 -72 0 Z" fill="#fff" opacity=".9"/>'
        + (f'<text x="100" y="100" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" '
           f'font-size="15" fill="#fff">{text}</text>' if text else ''),
        shadow=42)


def snack_bag(main, accent, text, window=None, text_color='#fff'):
    win = (f'<ellipse cx="100" cy="132" rx="26" ry="18" fill="{window}"/>' if window else '')
    return svg(
        f'<path d="M50 34 L150 34 L144 50 L152 176 L48 176 L56 50 Z" fill="{main}"/>'
        f'<path d="M50 34 L150 34 L148 44 L52 44 Z" fill="#000" opacity=".12"/>'
        f'<path d="M48 176 L152 176 L150 166 L50 166 Z" fill="#000" opacity=".12"/>'
        + label(62, 66, 76, 32, accent, text, color=text_color, size=14) + win,
        shadow=56)


def box(main, accent, text, wide=False):
    if wide:
        return svg(
            f'<path d="M30 92 L130 70 L172 90 L72 112 Z" fill="{accent}"/>'
            f'<path d="M30 92 L72 112 L72 166 L30 146 Z" fill="{main}" opacity=".8"/>'
            f'<path d="M72 112 L172 90 L172 144 L72 166 Z" fill="{main}"/>'
            + f'<text x="122" y="134" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" '
              f'font-size="14" fill="#fff" transform="rotate(-12 122 130)">{text}</text>',
            shadow=66)
    return svg(
        f'<path d="M58 54 L118 40 L146 56 L86 70 Z" fill="{accent}"/>'
        f'<path d="M58 54 L86 70 L86 180 L58 164 Z" fill="{main}" opacity=".8"/>'
        f'<path d="M86 70 L146 56 L146 166 L86 180 Z" fill="{main}"/>'
        + label(92, 98, 48, 30, accent, '', rx=4)
        + f'<text x="116" y="117" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" '
          f'font-size="10" fill="#fff" transform="rotate(-13 116 113)">{text}</text>',
        shadow=50)


def sack(main, accent, text, tie='#8a6a3b'):
    return svg(
        f'<path d="M66 40 Q100 52 134 40 L132 56 Q160 90 156 150 Q152 182 100 182 Q48 182 44 150 Q40 90 68 56 Z" fill="{main}"/>'
        f'<path d="M66 40 Q100 52 134 40 L132 56 Q100 66 68 56 Z" fill="#000" opacity=".1"/>'
        f'<rect x="66" y="50" width="68" height="8" rx="4" fill="{tie}"/>'
        + label(64, 106, 72, 38, accent, text, size=14),
        shadow=58)


# ---- fruit and vegetables -----------------------------------------------------

def apple():
    return svg(
        '<path d="M100 62 C74 44 38 58 40 102 C42 146 74 182 100 168 C126 182 158 146 160 102 C162 58 126 44 100 62 Z" fill="#d7362f"/>'
        '<path d="M60 82 C56 98 58 116 66 130" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".35" fill="none"/>'
        '<path d="M100 64 C100 50 104 40 110 32" stroke="#5a3a1a" stroke-width="6" stroke-linecap="round" fill="none"/>'
        '<path d="M108 44 C120 28 142 30 148 36 C140 48 120 52 108 44 Z" fill="#3f9b4c"/>')


def banana():
    return svg(
        '<path d="M44 70 C54 140 120 170 166 132 C170 128 168 122 162 122 C118 140 74 116 62 66 Z" fill="#f2c230"/>'
        '<path d="M58 62 C70 128 128 154 168 116 C172 112 170 106 164 106 C124 126 84 104 76 58 Z" fill="#f7d348"/>'
        '<path d="M50 70 L46 56 L58 52 L62 64 Z" fill="#6b4f1d"/>'
        '<path d="M66 60 L64 48 L76 46 L78 58 Z" fill="#6b4f1d"/>'
        '<path d="M162 122 L170 126 M164 106 L172 110" stroke="#4a3714" stroke-width="5" stroke-linecap="round"/>',
        shadow=64)


def tomato():
    return svg(
        '<ellipse cx="100" cy="120" rx="62" ry="56" fill="#e0412c"/>'
        '<path d="M64 98 C60 110 62 126 70 136" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".3" fill="none"/>'
        '<path d="M100 70 L88 56 L100 64 L112 54 L106 68 L124 66 L108 76 L116 88 L100 80 L84 90 L90 76 L74 70 Z" fill="#3f8f46"/>'
        '<path d="M100 66 L100 50" stroke="#3f8f46" stroke-width="5" stroke-linecap="round"/>', shadow=60)


def onion():
    return svg(
        '<path d="M100 52 C70 70 46 100 52 136 C58 170 90 180 100 180 C110 180 142 170 148 136 C154 100 130 70 100 52 Z" fill="#a8466b"/>'
        '<path d="M100 56 C86 80 80 120 92 176 M100 56 C114 80 120 120 108 176" stroke="#7e2f50" stroke-width="3" fill="none" opacity=".6"/>'
        '<path d="M100 54 C96 40 98 26 104 18 M100 54 C104 42 112 34 118 30" stroke="#6f8f3f" stroke-width="5" stroke-linecap="round" fill="none"/>'
        '<path d="M94 178 l-4 8 M100 180 l0 8 M106 178 l4 8" stroke="#c9b48a" stroke-width="3" stroke-linecap="round"/>', shadow=50)


def potato():
    return svg(
        '<path d="M44 110 C40 78 76 62 108 66 C146 70 166 92 160 124 C154 158 116 172 84 166 C56 162 46 140 44 110 Z" fill="#c99a5b"/>'
        '<circle cx="78" cy="98" r="4" fill="#8b6531"/><circle cx="122" cy="88" r="3.5" fill="#8b6531"/>'
        '<circle cx="136" cy="128" r="4" fill="#8b6531"/><circle cx="96" cy="142" r="3.5" fill="#8b6531"/>'
        '<path d="M62 92 C66 84 74 78 84 76" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".3" fill="none"/>', shadow=64)


def spinach():
    leaf = ('<path d="M100 178 C86 150 50 120 56 82 C62 50 92 52 100 76 C108 52 138 50 144 82 '
            'C150 120 114 150 100 178 Z" fill="{c}" transform="rotate({r} 100 178)"/>')
    vein = '<path d="M100 176 L100 84" stroke="#bfe3b4" stroke-width="3" transform="rotate({r} 100 178)"/>'
    parts = ''.join(leaf.format(c=c, r=r) + vein.format(r=r) for c, r in [('#2f7d3a', -30), ('#2f7d3a', 30), ('#3c9a48', 0)])
    return svg(parts + '<rect x="94" y="166" width="12" height="18" rx="4" fill="#d9c27a"/>', shadow=50)


def mango():
    return svg(
        '<path d="M58 70 C88 40 150 52 160 104 C170 156 120 186 82 170 C46 156 34 98 58 70 Z" fill="#f4a51c"/>'
        '<path d="M58 70 C88 40 150 52 160 104 C150 80 108 66 76 84 C60 94 52 80 58 70 Z" fill="#f6c142"/>'
        '<path d="M120 152 C140 140 152 122 154 104" stroke="#e07a14" stroke-width="10" stroke-linecap="round" fill="none" opacity=".5"/>'
        '<path d="M64 68 C60 54 66 42 74 36" stroke="#5a3a1a" stroke-width="5" stroke-linecap="round" fill="none"/>'
        '<path d="M70 44 C80 26 104 28 110 34 C100 46 80 50 70 44 Z" fill="#3f9b4c"/>', shadow=58)


def carrot():
    return svg(
        '<path d="M70 70 C84 62 110 64 120 74 L72 182 C66 186 60 182 62 176 Z" fill="#ef7d22" transform="rotate(-18 100 120)"/>'
        '<path d="M76 100 l14 4 M74 124 l14 4 M72 148 l12 4" stroke="#c75d10" stroke-width="4" stroke-linecap="round" transform="rotate(-18 100 120)"/>'
        '<path d="M92 62 C84 40 88 24 96 16 M98 62 C100 40 108 26 116 22 M104 64 C116 50 130 46 140 48" '
        'stroke="#3f9b4c" stroke-width="7" stroke-linecap="round" fill="none" transform="rotate(-18 100 120)"/>', shadow=50)


# ---- the 40 kinds ---------------------------------------------------------------

ITEMS = {
    # Dairy
    'milk': carton('#ffffff', '#2f6db5', 'MILK', cap='#2f6db5'),
    'curd': tub('#ffffff', '#3b82c4', 'CURD'),
    'paneer': block('#f7f1de', '#2f7a4c', 'PANEER'),
    'butter': block('#f6d77a', '#d23b2f', 'BUTTER'),
    'cheese': block('#f3c13a', '#2f6db5', 'CHEESE'),
    'ghee': jar('#f3e2a8', '#e8b23c', '#b5791a', 'GHEE'),
    'lassi': carton('#fbe9ef', '#c44569', 'LASSI'),
    'cream': tub('#fffaf0', '#7d5ba6', 'CREAM'),
    # Snacks
    'chips': snack_bag('#f3b21a', '#c0392b', 'CHIPS', window='#f9e08a'),
    'biscuits': box('#2f6db5', '#f4c430', 'BISCUITS', wide=True),
    'namkeen': snack_bag('#d35400', '#17301f', 'NAMKEEN', window='#e9b44c'),
    'cookies': box('#8e5a2b', '#e9c46a', 'COOKIES', wide=True),
    'popcorn': snack_bag('#c0392b', '#ffffff', 'POPCORN', window='#fff3c4', text_color='#c0392b'),
    'peanuts': jar('#e9d8bd', '#c48a4a', '#7a4b1e', 'NUTS'),
    'chocolate': box('#5b3a29', '#c0392b', 'CHOCO', wide=True),
    'wafers': snack_bag('#8e44ad', '#f1c40f', 'WAFERS'),
    # Beverages
    'tea': box('#2e7d32', '#c9a227', 'TEA'),
    'coffee': jar('#c7b49c', '#4a2c1d', '#2c1a10', 'COFFEE'),
    'juice': carton('#ffb347', '#e8590c', 'JUICE', cap='#2f7a4c'),
    'cola': can('#c0392b', '#bdc3c7', 'COLA'),
    'water': bottle('#d6ecfa', '#2f6db5', '#bfe1f7', 'WATER', slim=True),
    'lemonade': bottle('#fbf6c8', '#3f9b4c', '#f4e86a', 'LEMON'),
    'soda': can('#16a085', '#bdc3c7', 'SODA'),
    'shake': bottle('#f7d9e3', '#8e44ad', '#f0a6c0', 'SHAKE'),
    # Staples
    'rice': sack('#f4efe1', '#2f7a4c', 'RICE'),
    'atta': sack('#f2e3c4', '#c0392b', 'ATTA'),
    'dal': sack('#f7d774', '#d35400', 'DAL'),
    'sugar': sack('#ffffff', '#2f6db5', 'SUGAR'),
    'salt': sack('#eef3f7', '#17301f', 'SALT', tie='#2f6db5'),
    'oil': bottle('#f6e27a', '#c48a1c', '#f2cf3c', 'OIL'),
    'poha': sack('#efe6d2', '#8e44ad', 'POHA'),
    'besan': sack('#f6dc7d', '#2e7d32', 'BESAN'),
    # Fruits and vegetables
    'apple': apple(),
    'banana': banana(),
    'tomato': tomato(),
    'onion': onion(),
    'potato': potato(),
    'spinach': spinach(),
    'mango': mango(),
    'carrot': carrot(),
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, content in ITEMS.items():
        with open(os.path.join(OUT, f'{name}.svg'), 'w') as f:
            f.write(content)
    print(f'wrote {len(ITEMS)} illustrations to {os.path.normpath(OUT)}')
