/**
 * Opening presentation — name, car, then the three stages.
 *
 * WHO THIS IS FOR: the first seconds after the page paints.
 * WHAT IT DOES: fades Lead Developer, the Celica, then Desert, Forest, Mountain.
 *   A click or key skips to the title. Desktop opens the black on the live car
 *   once the showroom is up. Phones stay on the cards (no stage meshes).
 * HOW IT CONNECTS: index.html #intro-present, started from main.js before the engine.
 */

const BEATS = [
  { id: "name", inn: 380, hold: 780, out: 320 },
  { id: "car", inn: 520, hold: 2100, out: 420 },
  { id: "desert", inn: 480, hold: 1600, out: 380 },
  { id: "forest", inn: 480, hold: 1600, out: 380 },
  { id: "mountain", inn: 480, hold: 1600, out: 380 },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Play the opening once. Safe to call if the markup is missing.
 */
export function playIntro() {
  const root = document.getElementById("intro-present");
  if (!root || root.dataset.played === "1") return;
  root.dataset.played = "1";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stopped = false;

  const finish = (swallowClick) => {
    if (stopped) return;
    stopped = true;
    if (swallowClick) {
      document.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
        { capture: true, once: true }
      );
    }
    root.remove();
    document.documentElement.classList.remove("intro-playing");
    document.documentElement.classList.add("intro-done");
  };

  const onKey = (e) => {
    if (stopped) return;
    const key = e.key;
    if (key !== "Enter" && key !== " " && key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(false);
  };

  root.addEventListener("pointerdown", (e) => {
    if (e.target && e.target.id === "intro-skip") return;
    finish(true);
  });
  window.addEventListener("keydown", onKey, true);
  const skip = document.getElementById("intro-skip");
  if (skip) {
    skip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    });
  }

  const beats = BEATS.map((b) => ({
    ...b,
    el: root.querySelector(`[data-beat="${b.id}"]`),
    inn: reduced ? 0 : b.inn,
    hold: reduced ? 520 : b.hold,
    out: reduced ? 0 : b.out,
  })).filter((b) => b.el);

  (async () => {
    for (let i = 0; i < beats.length; i++) {
      if (stopped) return;
      const beat = beats[i];
      const openCar = beat.id === "car";
      beat.el.style.transition = `opacity ${beat.inn}ms ease`;
      beat.el.style.opacity = "1";
      const carWatch = openCar ? watchCar(root, () => stopped) : null;
      await wait(beat.inn + beat.hold);
      if (stopped) return;
      beat.el.style.transition = `opacity ${beat.out}ms ease`;
      beat.el.style.opacity = "0";
      if (carWatch) carWatch.stop();
      if (openCar) root.classList.remove("is-car-open");
      // Back to black before the next card, so a stage never fades over the car.
      await wait(beat.out + (openCar ? (reduced ? 40 : 460) : reduced ? 40 : 120));
    }
    if (!stopped) finish();
  })();
}

/**
 * While the car card is up, drop the black if the showroom car is on screen.
 * @param {HTMLElement} root
 * @param {() => boolean} stopped
 */
function watchCar(root, stopped) {
  let done = false;
  const tick = () => {
    if (done || stopped()) return;
    const crt = document.getElementById("crt");
    if (crt && crt.classList.contains("showroom-live")) root.classList.add("is-car-open");
  };
  tick();
  const id = setInterval(() => {
    if (done || stopped() || !root.isConnected) {
      clearInterval(id);
      return;
    }
    tick();
  }, 120);
  return {
    stop() {
      done = true;
      clearInterval(id);
    },
  };
}
