// Garuda Skies — keyboard + mouse input for flight controls.
// Written fresh from the prose spec. No weapons in this game: the input is
// purely about flying — pitch, roll, throttle, camera, pause, restart, mute.
//
// Keys:
//   ArrowUp / W  pitch up (nose up), ArrowDown / S pitch down — arcade
//   convention, matching flight.js where +1 pitch means nose up.
//   ArrowLeft / A roll left, ArrowRight / D roll right
//   W / Shift throttle up, S / Ctrl throttle down
//   C toggle camera, R restart mission, P / Escape pause, M mute
// Mouse: drag on the canvas to look around in chase view.

export function createInput(target) {
  const keys = new Set();
  const pressed = new Set();
  let lookDx = 0;
  let lookDy = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
    // Keep the arrows and space from scrolling the page while flying.
    if (event.code.startsWith('Arrow') || event.code === 'Space') {
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onMouseDown(event) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function onMouseMove(event) {
    if (!dragging) return;
    lookDx += event.clientX - lastX;
    lookDy += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function onMouseUp() {
    dragging = false;
  }

  function onBlur() {
    // Never leave a key stuck down when the window loses focus.
    keys.clear();
    dragging = false;
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  target.addEventListener('mousedown', onMouseDown);
  target.addEventListener('mousemove', onMouseMove);
  target.addEventListener('mouseup', onMouseUp);
  target.addEventListener('mouseleave', onMouseUp);

  return {
    // True while the physical key is held down.
    isDown(code) {
      return keys.has(code);
    },
    // True once after the key was pressed; each press is reported a single time.
    takePressed(code) {
      if (pressed.has(code)) {
        pressed.delete(code);
        return true;
      }
      return false;
    },
    // Mouse-look drag since the last call, in pixels; resets to zero.
    consumeLook() {
      const out = { dx: lookDx, dy: lookDy };
      lookDx = 0;
      lookDy = 0;
      return out;
    },
    // Flight axes from the current keys, each in [-1, 1].
    // pitch: +1 nose up, -1 nose down. roll: +1 bank right, -1 bank left.
    // throttle: +1 throttle up, -1 throttle down, 0 untouched.
    axes() {
      let pitch = 0;
      let roll = 0;
      let throttle = 0;
      if (keys.has('ArrowUp') || keys.has('KeyW')) pitch += 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) pitch -= 1;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) roll -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) roll += 1;
      // Throttle shares W/S with pitch, Shift/Ctrl are the dedicated keys.
      if (keys.has('KeyW') || keys.has('ShiftLeft') || keys.has('ShiftRight')) throttle += 1;
      if (keys.has('KeyS') || keys.has('ControlLeft') || keys.has('ControlRight')) throttle -= 1;
      return { pitch, roll, throttle };
    },
    // Detach every listener (used when the game is torn down).
    destroy() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      target.removeEventListener('mousedown', onMouseDown);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('mouseleave', onMouseUp);
    },
  };
}
