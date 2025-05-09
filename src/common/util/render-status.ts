// USERNOTE: Runs after 1+ frames, and also would be 2 event loop ticks after.
export const afterNextRender = (cb: (value: unknown) => void): void => {
  requestAnimationFrame(() => setTimeout(cb, 0));
};

export const nextRender = () =>
  new Promise((resolve) => {
    afterNextRender(resolve);
  });
