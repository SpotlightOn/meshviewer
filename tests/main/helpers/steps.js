/**
 * Step builders for the lossless transform tests: the real rotate/crop modules
 * take the transform step as an injectable dependency, so the tests hand them a
 * fixed or recording fake.
 */

/** Bytes a recording step reports when it is not given any. */
const DEFAULT_STEP_BYTES = new Uint8Array([1]);

/**
 * Builds a step that reports fixed bytes, like the real module does.
 * @param {string|Uint8Array} data - Bytes the step reports as its output.
 * @param {object} [fields] - Extra fields of the step result, e.g. `perfect` or `width`.
 * @returns {() => {data: Uint8Array}} Transform step.
 */
function succeedWith(data, fields = {}) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return () => ({ data: bytes, ...fields });
}

/**
 * Builds a step that records the arguments it was called with.
 * @param {object} [fields] - Extra fields of the step result, e.g. `perfect` or `width`.
 * @returns {{step: Function, calls: Array<Array<unknown>>}} Recording step and the arguments of every call.
 */
function recordingStep(fields = {}) {
  const calls = [];
  const step = (...args) => {
    calls.push(args);
    return { data: DEFAULT_STEP_BYTES, ...fields };
  };
  return { step, calls };
}

export { recordingStep, succeedWith };
