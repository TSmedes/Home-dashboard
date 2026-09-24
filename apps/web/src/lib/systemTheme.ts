/**
 * The kiosk takes its theme from the schedule; a phone should follow the
 * phone. Sets data-theme from the system setting and keeps it in step.
 */
export function followSystemTheme(): void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.theme = query.matches ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", query.matches ? "#0f0f13" : "#f3f3f6");
  };
  apply();
  query.addEventListener("change", apply);
}
