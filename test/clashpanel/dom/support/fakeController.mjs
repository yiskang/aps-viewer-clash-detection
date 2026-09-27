// test/clashpanel/dom/support/fakeController.mjs
//
// BROWSER-SIDE PanelController double for the shell tests (Task 31): the PanelController port of plan catalog §4
// (getViewModel/subscribe/dispatch/dispose) over a caller-supplied ViewModel. `set(vm)` notifies subscribers
// exactly like the real controller does on a state change. No Node imports.
export function createFakeController(initialVm) {
  let vm = initialVm;
  const subscribers = new Set();
  const dispatched = [];
  return {
    dispatched,
    subscriberCount: () => subscribers.size,
    getViewModel: () => vm,
    subscribe(cb) {
      if (typeof cb !== 'function') throw new TypeError('subscribe: callback required');
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    dispatch(intent) {
      dispatched.push(JSON.parse(JSON.stringify(intent)));
      return Promise.resolve();
    },
    dispose: () => Promise.resolve(),
    set(next) {
      vm = next;
      for (const cb of [...subscribers]) cb(vm);
    },
  };
}
