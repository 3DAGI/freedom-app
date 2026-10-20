"""Testprogramm fuer den Bildstrom (VKg2a2, `bildstrom.test.ts`): ein Fenster ueber den ganzen Bildschirm, das jede Taste und
jeden Klick in eine Datei schreibt - so sieht der Test, dass Eingaben aus dem Datenkanal ankommen.

Aufruf: python3 taster.py <datei>
"""

import sys

from Xlib import X, XK, display

d = display.Display()
s = d.screen()
f = s.root.create_window(0, 0, s.width_in_pixels, s.height_in_pixels, 0, s.root_depth, X.InputOutput, X.CopyFromParent,
                         background_pixel=s.white_pixel, event_mask=X.KeyPressMask | X.ButtonPressMask | X.ExposureMask)
f.map()
d.sync()
f.set_input_focus(X.RevertToParent, X.CurrentTime)
d.sync()
with open(sys.argv[1], "a", buffering=1) as aus:
    aus.write("bereit\n")
    while True:
        e = d.next_event()
        if e.type == X.KeyPress:
            ks = d.keycode_to_keysym(e.detail, 1 if e.state & X.ShiftMask else 0)
            aus.write(f"taste {XK.keysym_to_string(ks) or hex(ks)}\n")
        elif e.type == X.MappingNotify:
            # die Belegung hat sich geaendert (ein Zeichen ohne Taste bekam eine) - neu lesen
            d.refresh_keyboard_mapping(e)
        elif e.type == X.ButtonPress:
            aus.write(f"klick {e.detail} {e.event_x} {e.event_y}\n")
