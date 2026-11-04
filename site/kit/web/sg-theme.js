/* Sogoma theme button: Auto, Day, Night. One native <button class="sg-theme" hidden data-auto="" data-day="" data-night="">.
   Contract (kit/components/theme-button.spec.*.md):
   - The choice lives in localStorage under `sogoma-theme` (day | night); Auto removes the key. No cookie, nothing is sent.
   - It sets data-theme on <html>; Auto removes the attribute, so the page follows the device. A blocked storage still works for the page.
   - Without JavaScript the button stays hidden and the page follows the device.
   - Load it in <head>, before first paint: it applies the choice at once, so no wrong theme flashes.
   - In the kit charter, data-theme="night" is restricted to the `watch` register, unless the visitor chose it with this button. */
(function (doc) {
  const KEY = "sogoma-theme";
  const CYCLE = ["", "day", "night"];
  const root = doc.documentElement;
  let state = "";
  try {
    state = localStorage.getItem(KEY);
  } catch {
    state = "";
  }
  if (CYCLE.indexOf(state) < 1) state = "";

  function paint() {
    if (state) root.setAttribute("data-theme", state);
    else root.removeAttribute("data-theme");
    doc.querySelectorAll(".sg-theme").forEach((button) => {
      button.hidden = false;
      button.textContent = button.getAttribute(`data-${state || "auto"}`);
    });
  }

  paint();
  doc.addEventListener("DOMContentLoaded", paint);
  doc.addEventListener("click", (event) => {
    if (!event.target.closest(".sg-theme")) return;
    state = CYCLE[(CYCLE.indexOf(state) + 1) % CYCLE.length];
    try {
      if (state) localStorage.setItem(KEY, state);
      else localStorage.removeItem(KEY);
    } catch {
      /* The page still changes; the choice is not kept. */
    }
    paint();
  });
})(document);
