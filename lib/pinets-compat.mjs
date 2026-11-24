/**
 * Scoped workaround for PineTS 0.13.1's secondary-context script slicing.
 *
 * Verified on the actual GoldGuard 180 script in Windows Node by its owner:
 * PINETS_DISABLE_LTF_SLICING=1 completed a 180-bar XAUUSD 4h run that
 * otherwise failed in request.security with "reading '144'".
 *
 * No Pine source edits, data interpolation, or signal fallbacks occur here.
 * PineTS checks this environment key when transpiling. Workers normally lack
 * `process`, so a temporary minimal shim is supplied during the run.
 *
 * This is a compatibility workaround, not a guarantee of TradingView parity.
 */
export async function withPineTSSlicingDisabled(enabled, execute) {
  if (!enabled) return execute();
  const scope = globalThis;
  const hadProcess = Object.hasOwn(scope, 'process');
  const originalProcess = scope.process;
  let createdProcess = false;
  let createdEnv = false;
  if (!scope.process) {
    scope.process = { env: {} };
    createdProcess = true;
  } else if (!scope.process.env) {
    scope.process.env = {};
    createdEnv = true;
  }
  const env = scope.process.env;
  const hadFlag = Object.hasOwn(env, 'PINETS_DISABLE_LTF_SLICING');
  const previousFlag = env.PINETS_DISABLE_LTF_SLICING;
  env.PINETS_DISABLE_LTF_SLICING = '1';
  try {
    return await execute();
  } finally {
    if (hadFlag) env.PINETS_DISABLE_LTF_SLICING = previousFlag;
    else delete env.PINETS_DISABLE_LTF_SLICING;
    if (createdProcess) {
      if (hadProcess) scope.process = originalProcess;
      else delete scope.process;
    } else if (createdEnv) {
      delete scope.process.env;
    }
  }
}
