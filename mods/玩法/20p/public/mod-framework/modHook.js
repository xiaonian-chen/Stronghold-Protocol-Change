// mod-framework/modHook.js — browser-side stub.
// The real modHook runs on the server; this stub satisfies the import in
// sim/content/bands/meta.js when the browser loads it (no server mods exist
// in the browser, so every hook query returns its default/nothing path).

const modHook = {
  on() {},
  off() {},
  emit() { return []; },
  emitUntil() { return undefined; },
  hasListeners() { return false; },
};

export default modHook;
export { modHook };