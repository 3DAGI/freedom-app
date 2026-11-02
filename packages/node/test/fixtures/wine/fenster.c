/* Ein Windows-Programm für den Echttest des Bildstroms (VKi1): eine grüne Fläche über die ganze Arbeitsfläche, ein Klick macht
 * sie rot. Der Test baut es mit mingw-w64 (x86_64-w64-mingw32-gcc -mwindows) als main.exe. */
#include <windows.h>
static COLORREF farbe = RGB(0, 192, 0);
static LRESULT CALLBACK proz(HWND h, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
  case WM_LBUTTONDOWN: farbe = RGB(192, 0, 0); InvalidateRect(h, NULL, TRUE); return 0;
  case WM_ERASEBKGND: return 1;
  case WM_PAINT: {
    PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); HBRUSH b = CreateSolidBrush(farbe);
    FillRect(dc, &ps.rcPaint, b); DeleteObject(b); EndPaint(h, &ps); return 0;
  }
  case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(h, m, w, l);
}
int WINAPI WinMain(HINSTANCE i, HINSTANCE p, LPSTR c, int s) {
  WNDCLASSW k = {0}; k.lpfnWndProc = proz; k.hInstance = i; k.lpszClassName = L"freedom"; k.hCursor = LoadCursor(NULL, IDC_ARROW);
  RegisterClassW(&k);
  CreateWindowExW(0, L"freedom", L"Freedom", WS_POPUP | WS_VISIBLE, 0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN), NULL, NULL, i, NULL);
  MSG m; while (GetMessageW(&m, NULL, 0, 0) > 0) { TranslateMessage(&m); DispatchMessageW(&m); }
  return 0;
}
